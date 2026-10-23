// Rounded cube d6.
//
// Six flat faces, each a rounded square (a squircle when the corner radius is
// large). Adjacent faces meet through a 90° circular fillet, and each corner —
// where three fillets meet — is a spherical triangle. Two radii control that:
//
//   face corner radius  — rounds the corners of each flat face in its plane.
//                         0 is a square; equal to the remaining half-width is a
//                         circle.
//   edge curve radius   — the radius of the 90° blend between faces. 0 is a
//                         sharp edge (the corner is still the spherical triangle
//                         when the face corners are rounded).
//
// Face-to-face distance is measured between the flat faces, same as the cube.
// The fillets and corners lie inside that cube: nothing bulges past the face
// planes.
//
// The curved patches are hidden facets (see the coin rim). Number faces stay
// the six rounded squares, in the same order and orientation as the cube so
// opposite faces sum to 7 and the cube's spindown layout still applies.
//
// Where the three fillets meet the corner sphere they share a tangent, so the
// patch narrows to a point aimed along each cube edge. The cap is filled with
// rings of evenly spaced directions, and only the outer edge uses the fillet
// samples, so the shell stays welded and every vertex sits on the sphere.
// A thin triangle along that point still has an unstable plane normal. Its
// winding is left as built — flipping it on that normal opens the shell —
// and the preview points each vertex normal out from the sphere centre.
//
// Watertightness: every curved patch is sampled from the same profile helper
// as its neighbours, and the face outline is that profile at angle 0, so
// shared boundaries are the same points.

import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform, previewTilt } from '$lib/utils/3d';
import { PRINT_CLEARANCE_MM } from '$lib/utils/printing';
import { stackedExplode } from '$lib/utils/explode';
import { pickForNumber, Legend } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { Matrix4, Quaternion, Shape, Vector2, Vector3 } from 'three';

const defaultSize = 18;
const defaultCorner = 3;
const defaultEdge = 2.5;

// Chords around a face corner (90°) and along the fillet. The fillet's 45°
// half (face → sphere) uses FILLET_SEGMENTS; the full 90° edge uses twice
// that, so the sphere's vertex lands on a cylinder sample.
const CORNER_SEGMENTS = 12;
const FILLET_SEGMENTS = 6;
// Interior of a corner cap. Samples are spaced in angle around the corner,
// not one-per-boundary-vertex: the boundary pinches in angle at each edge.
const CAP_RINGS = 4;
const CAP_SAMPLES = 24;
// Quads along each straight edge, so the corner blend can ease off without
// pulling the middle of the fillet out of its quarter-circle.
const EDGE_SEGMENTS = 6;

const xAxis = new Vector3(1, 0, 0);

// Same frames as d6_cube (see cube face order): opposite faces sum to 7.
const FACE_AXES: Array<{ n: Vector3; x: Vector3; y: Vector3 }> = [
	{ n: new Vector3(0, 0, 1), x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0) },
	{ n: new Vector3(0, -1, 0), x: new Vector3(1, 0, 0), y: new Vector3(0, 0, 1) },
	{ n: new Vector3(-1, 0, 0), x: new Vector3(0, -1, 0), y: new Vector3(0, 0, 1) },
	{ n: new Vector3(1, 0, 0), x: new Vector3(0, 1, 0), y: new Vector3(0, 0, 1) },
	{ n: new Vector3(0, 1, 0), x: new Vector3(-1, 0, 0), y: new Vector3(0, 0, 1) },
	{ n: new Vector3(0, 0, -1), x: new Vector3(1, 0, 0), y: new Vector3(0, -1, 0) }
];

// Clockwise corners of a face, as signs of the local x / y axes.
const CORNERS: Array<[number, number]> = [
	[1, 1],
	[1, -1],
	[-1, -1],
	[-1, 1]
];

type Frame = {
	center: Vector3;
	x: Vector3;
	y: Vector3;
	normal: Vector3;
	transform: Transform;
};

type Arc = {
	sx: number;
	sy: number;
	phis: Array<number>;
	world: Array<Vector3>;
};

const roundedParameters: Array<DiceParameter> = [
	{ id: 'rounded_size', defaultValue: defaultSize, min: 8, max: 60, step: 0.5 },
	{ id: 'rounded_corner', defaultValue: defaultCorner, min: 0, max: 20, step: 0.1 },
	{ id: 'rounded_edge', defaultValue: defaultEdge, min: 0, max: 12, step: 0.1 }
];

function clampRadii(
	size: number,
	corner: number,
	edge: number
): { h: number; re: number; rf: number; s: number } {
	const h = Math.max(size / 2, 1);
	// Keep a usable flat face (at least ~1mm of half-width, or half of h on a tiny blank).
	const minS = Math.min(1, h * 0.5);
	let re = Math.max(0, edge);
	let rf = Math.max(0, corner);
	if (re > h - minS) {
		re = Math.max(0, h - minS);
	}
	const s = h - re;
	if (rf > s) {
		rf = s;
	}
	return { h, re, rf, s };
}

function makeFrame(axis: { n: Vector3; x: Vector3; y: Vector3 }, h: number): Frame {
	const normal = axis.n.clone();
	const x = axis.x.clone();
	const y = axis.y.clone();
	const center = normal.clone().multiplyScalar(h);
	const basis = new Matrix4().makeBasis(x, y, normal);
	const q = new Quaternion().setFromRotationMatrix(basis);
	return {
		center,
		x,
		y,
		normal,
		transform: new Transform().rotate(q).translate(center)
	};
}

function hiddenFacet(corners: Array<Vector3>, shadeCenter?: Vector3): DieFaceModel {
	const centroid = corners
		.reduce((acc, v) => acc.add(v), new Vector3())
		.multiplyScalar(1 / corners.length);
	// Cap triangles are emitted already wound as one outward shell. Where the
	// corner pinches, a triangle's plane normal flips even though the winding
	// is right, and reversing that one triangle makes the solid non-manifold.
	let ordered = corners;
	if (!shadeCenter) {
		const probe = orientCoplanarVertices(corners);
		if (probe.normal.dot(centroid) < 0) {
			ordered = [...corners].reverse();
		}
	}
	const info = orientCoplanarVertices(ordered);
	return {
		isNumberFace: false,
		hidden: true,
		shape: info.shape,
		defaultLegend: Legend.BLANK,
		transform: new Transform().rotate(info.quat).translate(info.offset),
		shadeCenter: shadeCenter?.clone()
	};
}

function addTri(patches: Array<[Vector3, Vector3, Vector3]>, a: Vector3, b: Vector3, c: Vector3) {
	const cross = b.clone().sub(a).cross(c.clone().sub(a));
	if (cross.lengthSq() < 1e-18) {
		return;
	}
	patches.push([a.clone(), b.clone(), c.clone()]);
}

// Point on the 90° fillet. `theta` 0 is on the face (`point` lies there);
// theta π/2 is on the face whose outward normal is `nSide`.
function profile(
	point: Vector3,
	nFace: Vector3,
	nSide: Vector3,
	theta: number,
	re: number
): Vector3 {
	return point
		.clone()
		.addScaledVector(nFace, re * (Math.cos(theta) - 1))
		.addScaledVector(nSide, re * Math.sin(theta));
}

function arcPhi(sx: number, sy: number, t: number): number {
	// sx*sy > 0 corners are traversed with decreasing phi so the whole outline
	// stays clockwise (matching the cube's front-face winding).
	return (sx * sy > 0 ? 1 - t : t) * (Math.PI / 2);
}

function arcLocal(sx: number, sy: number, phi: number, s: number, rf: number): Vector2 {
	return new Vector2(sx * (s - rf + rf * Math.cos(phi)), sy * (s - rf + rf * Math.sin(phi)));
}

function cornerKey(sx: number, sy: number, sz: number): string {
	return `${sx},${sy},${sz}`;
}

function cornerSigns(frame: Frame, sx: number, sy: number): [number, number, number] {
	const v = frame.normal.clone().addScaledVector(frame.x, sx).addScaledVector(frame.y, sy);
	return [Math.sign(v.x) || 1, Math.sign(v.y) || 1, Math.sign(v.z) || 1];
}

function sphereCenter(signs: [number, number, number], s: number, rf: number): Vector3 {
	return new Vector3(signs[0] * (s - rf), signs[1] * (s - rf), signs[2] * (s - rf));
}

// Sweep `Q` (on the face) off the face by `alpha` (0 = on the face, π/4 = on
// the corner sphere) along the circular fillet of radius `re`.
function sweep(Q: Vector3, nFace: Vector3, O: Vector3, alpha: number, re: number): Vector3 {
	const skeleton = Q.clone().addScaledVector(nFace, -re);
	const toCenter = skeleton.clone().sub(O);
	if (toCenter.lengthSq() < 1e-16 || alpha <= 0) {
		return Q.clone();
	}
	const sphereN = toCenter.normalize();
	const total = nFace.angleTo(sphereN);
	if (!(total > 1e-8) || alpha >= total - 1e-8) {
		return skeleton.addScaledVector(sphereN, re);
	}
	const axis = nFace.clone().cross(sphereN);
	if (axis.lengthSq() < 1e-16) {
		return skeleton.addScaledVector(sphereN, re);
	}
	axis.normalize();
	const n = nFace.clone().applyAxisAngle(axis, alpha);
	return skeleton.addScaledVector(n, re);
}

function stitch(chains: Array<Array<Vector3>>): Array<Vector3> {
	const unused = chains.filter((c) => c.length > 0).map((c) => c.slice());
	if (unused.length === 0) {
		return [];
	}
	let loop = unused.pop()!;
	while (unused.length > 0) {
		const end = loop[loop.length - 1];
		let found = -1;
		let reverse = false;
		for (let i = 0; i < unused.length; i++) {
			const c = unused[i];
			if (c[0].distanceTo(end) < 1e-5) {
				found = i;
				break;
			}
			if (c[c.length - 1].distanceTo(end) < 1e-5) {
				found = i;
				reverse = true;
				break;
			}
		}
		if (found < 0) {
			break;
		}
		let c = unused.splice(found, 1)[0];
		if (reverse) {
			c = c.slice().reverse();
		}
		loop = loop.concat(c.slice(1));
	}
	const cleaned: Array<Vector3> = [];
	for (const p of loop) {
		if (cleaned.length === 0 || cleaned[cleaned.length - 1].distanceTo(p) > 1e-5) {
			cleaned.push(p);
		}
	}
	if (cleaned.length > 1 && cleaned[0].distanceTo(cleaned[cleaned.length - 1]) < 1e-5) {
		cleaned.pop();
	}
	return cleaned;
}

type CapPolar = { ang: number; pos: Vector3; dir: Vector3 };

// Project the cap boundary onto the tangent plane at `centerDir`. Returns the
// loop in counter-clockwise order with strictly increasing angles, or null
// when a ray from the corner centre hits the boundary more than once.
function projectCapBoundary(
	boundary: Array<Vector3>,
	O: Vector3,
	centerDir: Vector3
): Array<CapPolar> | null {
	const helper = Math.abs(centerDir.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
	const u = new Vector3().crossVectors(helper, centerDir).normalize();
	const v = new Vector3().crossVectors(centerDir, u).normalize();
	const raw: Array<CapPolar> = [];
	for (const pos of boundary) {
		const dir = pos.clone().sub(O);
		if (dir.lengthSq() < 1e-16) {
			return null;
		}
		dir.normalize();
		raw.push({ ang: Math.atan2(dir.dot(v), dir.dot(u)), pos, dir });
	}
	let wind = 0;
	for (let i = 0; i < raw.length; i++) {
		let d = raw[(i + 1) % raw.length].ang - raw[i].ang;
		while (d > Math.PI) {
			d -= Math.PI * 2;
		}
		while (d < -Math.PI) {
			d += Math.PI * 2;
		}
		wind += d;
	}
	if (Math.abs(wind) < Math.PI) {
		return null;
	}
	if (wind < 0) {
		raw.reverse();
	}
	const unwrapped: Array<CapPolar> = [{ ...raw[0] }];
	let prev = raw[0].ang;
	for (let i = 1; i < raw.length; i++) {
		let a = raw[i].ang;
		while (a <= prev) {
			a += Math.PI * 2;
		}
		if (a - prev > Math.PI) {
			return null;
		}
		prev = a;
		unwrapped.push({ ang: a, pos: raw[i].pos, dir: raw[i].dir });
	}
	const closing = unwrapped[0].ang + Math.PI * 2 - unwrapped[unwrapped.length - 1].ang;
	if (closing <= 1e-6 || closing > Math.PI) {
		return null;
	}
	return unwrapped;
}

function directionAt(theta: number, loop: Array<CapPolar>): Vector3 {
	const n = loop.length;
	const start = loop[0].ang;
	let t = theta;
	while (t < start) {
		t += Math.PI * 2;
	}
	while (t >= start + Math.PI * 2) {
		t -= Math.PI * 2;
	}
	for (let i = 0; i < n; i++) {
		const a0 = loop[i].ang;
		const a1 = i + 1 < n ? loop[i + 1].ang : loop[0].ang + Math.PI * 2;
		if (t >= a0 && t <= a1) {
			const span = a1 - a0;
			const f = span < 1e-9 ? 0 : (t - a0) / span;
			return loop[i].dir
				.clone()
				.lerp(loop[(i + 1) % n].dir, f)
				.normalize();
		}
	}
	return loop[0].dir.clone();
}

// Triangles bridging an interior ring and the fillet boundary. Both loops are
// ordered by angle around the corner; advancing whichever comes next keeps the
// band non-crossing and uses each boundary sample exactly once.
function stitchCapRing(
	patches: Array<[Vector3, Vector3, Vector3]>,
	inner: Array<CapPolar>,
	outer: Array<CapPolar>
) {
	const inn = inner.concat([{ ...inner[0], ang: inner[0].ang + Math.PI * 2 }]);
	const out = outer.concat([{ ...outer[0], ang: outer[0].ang + Math.PI * 2 }]);
	let i = 0;
	let j = 0;
	while (i < inn.length - 1 || j < out.length - 1) {
		const advanceInner =
			j === out.length - 1 || (i < inn.length - 1 && inn[i + 1].ang <= out[j + 1].ang);
		if (advanceInner) {
			addTri(patches, inn[i].pos, out[j].pos, inn[i + 1].pos);
			i++;
		} else {
			addTri(patches, inn[i].pos, out[j].pos, out[j + 1].pos);
			j++;
		}
	}
}

function addSphericalCap(
	patches: Array<[Vector3, Vector3, Vector3]>,
	boundary: Array<Vector3>,
	O: Vector3,
	radius: number,
	centerDir: Vector3
) {
	if (boundary.length < 3 || radius < 1e-8) {
		return;
	}
	const loop = projectCapBoundary(boundary, O, centerDir);
	if (!loop) {
		return;
	}
	const center = O.clone().addScaledVector(centerDir, radius);
	const start = loop[0].ang;
	const rings: Array<Array<CapPolar>> = [];
	for (let r = 1; r <= CAP_RINGS; r++) {
		const t = r / (CAP_RINGS + 1);
		const ring: Array<CapPolar> = [];
		for (let k = 0; k < CAP_SAMPLES; k++) {
			const ang = start + (k / CAP_SAMPLES) * Math.PI * 2;
			const dir = directionAt(ang, loop);
			const blended = centerDir.clone().lerp(dir, t).normalize();
			ring.push({
				ang,
				dir: blended,
				pos: O.clone().addScaledVector(blended, radius)
			});
		}
		rings.push(ring);
	}
	const first = rings[0];
	for (let k = 0; k < first.length; k++) {
		addTri(patches, center, first[k].pos, first[(k + 1) % first.length].pos);
	}
	for (let r = 0; r < rings.length - 1; r++) {
		stitchCapRing(patches, rings[r], rings[r + 1]);
	}
	stitchCapRing(patches, rings[rings.length - 1], loop);
}

function sideNormal(frame: Frame, sx: number, sy: number, phi: number): Vector3 {
	if (phi < Math.PI / 4) {
		return frame.x.clone().multiplyScalar(sx);
	}
	return frame.y.clone().multiplyScalar(sy);
}

export const RoundedD6: DieModel = {
	id: 'd6_rounded',
	name: 'D6 Rounded',
	parameters: roundedParameters,
	blankParameters(params, offset) {
		const size = params.rounded_size ?? defaultSize;
		const edge = params.rounded_edge ?? defaultEdge;
		// Inset keeps the face-corner radius and shrinks the edge fillet, matching
		// a morphological inset of this convex solid (outset grows the fillet).
		return {
			...params,
			rounded_size: size - offset * 2,
			rounded_edge: Math.max(0, edge - offset)
		};
	},
	build(params) {
		const { h, re, rf, s } = clampRadii(
			params.rounded_size ?? defaultSize,
			params.rounded_corner ?? defaultCorner,
			params.rounded_edge ?? defaultEdge
		);
		const frames = FACE_AXES.map((axis) => makeFrame(axis, h));
		const segments = rf > 1e-6 ? CORNER_SEGMENTS : 1;

		const faceArcs: Array<Array<Arc>> = frames.map((frame) =>
			CORNERS.map(([sx, sy]) => {
				const phis: Array<number> = [];
				const world: Array<Vector3> = [];
				for (let k = 0; k <= segments; k++) {
					const phi = arcPhi(sx, sy, k / segments);
					phis.push(phi);
					const local = arcLocal(sx, sy, phi, s, rf);
					world.push(frame.transform.applyToVector3(new Vector3(local.x, local.y, 0)));
				}
				return { sx, sy, phis, world };
			})
		);

		const faces: Array<DieFaceModel> = frames.map((frame, i) => {
			const pts: Array<Vector2> = [];
			const push = (p: Vector2) => {
				const prev = pts[pts.length - 1];
				if (prev && prev.distanceTo(p) < 1e-8) {
					return;
				}
				pts.push(p);
			};
			for (let e = 0; e < CORNERS.length; e++) {
				const [sx, sy] = CORNERS[e];
				const [nsx, nsy] = CORNERS[(e + 1) % CORNERS.length];
				for (let k = 0; k <= segments; k++) {
					push(arcLocal(sx, sy, arcPhi(sx, sy, k / segments), s, rf));
				}
				// Same stations as the fillet's straight run, so the face edge
				// welds to every quad along it.
				if (re > 1e-6) {
					const end = arcLocal(sx, sy, arcPhi(sx, sy, 1), s, rf);
					const start = arcLocal(nsx, nsy, arcPhi(nsx, nsy, 0), s, rf);
					for (let u = 1; u < EDGE_SEGMENTS; u++) {
						push(end.clone().lerp(start, u / EDGE_SEGMENTS));
					}
				}
			}
			if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-8) {
				pts.pop();
			}
			return {
				isNumberFace: true,
				shape: new Shape(pts),
				defaultLegend: pickForNumber(i, 6),
				transform: frame.transform
			};
		});

		const patches: Array<[Vector3, Vector3, Vector3]> = [];
		const nAngle = FILLET_SEGMENTS * 2;
		// Outer boundary of each corner's spherical triangle, one chain per face.
		const sphereChains = new Map<string, Array<Array<Vector3>>>();
		// Full quarter-circle at a corner (used when the face corner radius is 0
		// and there is no torus between the cylinder and the sphere).
		const cornerLoops = new Map<string, Array<Array<Vector3>>>();

		const pushChain = (
			map: Map<string, Array<Array<Vector3>>>,
			key: string,
			chain: Array<Vector3>
		) => {
			const list = map.get(key);
			if (list) {
				list.push(chain);
			} else {
				map.set(key, [chain]);
			}
		};

		for (let fi = 0; fi < frames.length; fi++) {
			const frame = frames[fi];
			const arcs = faceArcs[fi];
			for (let e = 0; e < arcs.length; e++) {
				const arc = arcs[e];
				const next = arcs[(e + 1) % arcs.length];
				const A0 = arc.world[arc.world.length - 1];
				const A1 = next.world[0];
				const sharedSx = arc.sx === next.sx;
				const nSide = sharedSx
					? frame.x.clone().multiplyScalar(arc.sx)
					: frame.y.clone().multiplyScalar(arc.sy);
				const adjacent = frames.findIndex((f) => f.normal.dot(nSide) > 0.9);

				if (re > 1e-6 && A0.distanceTo(A1) > 1e-6 && adjacent > fi) {
					const columns: Array<Array<Vector3>> = [];
					for (let u = 0; u <= EDGE_SEGMENTS; u++) {
						const along = A0.clone().lerp(A1, u / EDGE_SEGMENTS);
						const column: Array<Vector3> = [];
						for (let a = 0; a <= nAngle; a++) {
							column.push(profile(along, frame.normal, nSide, (a / nAngle) * (Math.PI / 2), re));
						}
						columns.push(column);
					}
					for (let u = 0; u < EDGE_SEGMENTS; u++) {
						for (let a = 0; a < nAngle; a++) {
							addTri(patches, columns[u][a], columns[u][a + 1], columns[u + 1][a + 1]);
							addTri(patches, columns[u][a], columns[u + 1][a + 1], columns[u + 1][a]);
						}
					}
				}

				if (re > 1e-6 && rf < 1e-6 && adjacent > fi) {
					// Square face: each edge fillet runs straight into the corner
					// sphere. Record the quarter-circle once (the other face shares it).
					const ends: Array<[Vector3, number, number]> = [
						[A0, arc.sx, arc.sy],
						[A1, next.sx, next.sy]
					];
					for (const [end, sx, sy] of ends) {
						const signs = cornerSigns(frame, sx, sy);
						const loop: Array<Vector3> = [];
						for (let a = 0; a <= nAngle; a++) {
							loop.push(profile(end, frame.normal, nSide, (a / nAngle) * (Math.PI / 2), re));
						}
						pushChain(cornerLoops, cornerKey(signs[0], signs[1], signs[2]), loop);
					}
				}
			}

			if (re > 1e-6 && rf > 1e-6) {
				for (const arc of arcs) {
					const signs = cornerSigns(frame, arc.sx, arc.sy);
					const O = sphereCenter(signs, s, rf);
					const n0 = sideNormal(frame, arc.sx, arc.sy, arc.phis[0]);
					const n1 = sideNormal(frame, arc.sx, arc.sy, arc.phis[arc.phis.length - 1]);
					const grid: Array<Array<Vector3>> = [];
					for (let p = 0; p < arc.world.length; p++) {
						const col: Array<Vector3> = [];
						const atStart = p === 0;
						const atEnd = p === arc.world.length - 1;
						for (let a = 0; a <= FILLET_SEGMENTS; a++) {
							const alpha = (a / FILLET_SEGMENTS) * (Math.PI / 4);
							if (atStart) {
								col.push(profile(arc.world[0], frame.normal, n0, alpha, re));
							} else if (atEnd) {
								col.push(profile(arc.world[p], frame.normal, n1, alpha, re));
							} else if (a === 0) {
								col.push(arc.world[p].clone());
							} else {
								col.push(sweep(arc.world[p], frame.normal, O, alpha, re));
							}
						}
						grid.push(col);
					}
					for (let p = 0; p < grid.length - 1; p++) {
						for (let a = 0; a < FILLET_SEGMENTS; a++) {
							addTri(patches, grid[p][a], grid[p + 1][a], grid[p + 1][a + 1]);
							addTri(patches, grid[p][a], grid[p + 1][a + 1], grid[p][a + 1]);
						}
					}
					pushChain(
						sphereChains,
						cornerKey(signs[0], signs[1], signs[2]),
						grid.map((col) => col[FILLET_SEGMENTS])
					);
				}
			} else if (re <= 1e-6 && rf > 1e-6) {
				// Sharp edges, rounded face corners: the spherical triangle meets
				// the face along the corner arc itself.
				for (const arc of arcs) {
					const signs = cornerSigns(frame, arc.sx, arc.sy);
					pushChain(
						sphereChains,
						cornerKey(signs[0], signs[1], signs[2]),
						arc.world.map((p) => p.clone())
					);
				}
			}
		}

		const radius = rf * Math.SQRT2 + re;
		const caps = rf > 1e-6 ? sphereChains : cornerLoops;
		if (radius > 1e-6) {
			for (const [key, chains] of caps) {
				const boundary = stitch(chains);
				const [sx, sy, sz] = key.split(',').map((n) => Number(n));
				const signs: [number, number, number] = [sx, sy, sz];
				const O = sphereCenter(signs, s, rf);
				const centerDir = new Vector3(sx, sy, sz).normalize();
				addSphericalCap(patches, boundary, O, radius, centerDir);
			}
		}

		// One sphere per corner. Cap triangles lie on it; fillet triangles do not,
		// so this only tags the corner patch.
		const spheres: Array<{ O: Vector3; radius: number }> = [];
		if (radius > 1e-6) {
			for (const sx of [-1, 1]) {
				for (const sy of [-1, 1]) {
					for (const sz of [-1, 1]) {
						spheres.push({
							O: sphereCenter([sx, sy, sz], s, rf),
							radius
						});
					}
				}
			}
		}
		const onSphere = (p: Vector3, O: Vector3, sphereRadius: number) =>
			Math.abs(p.distanceTo(O) - sphereRadius) < 5e-4;
		for (const [a, b, c] of patches) {
			const cross = b.clone().sub(a).cross(c.clone().sub(a));
			if (cross.lengthSq() < 1e-18) {
				continue;
			}
			let shadeCenter: Vector3 | undefined;
			for (const sphere of spheres) {
				if (
					!onSphere(a, sphere.O, sphere.radius) ||
					!onSphere(b, sphere.O, sphere.radius) ||
					!onSphere(c, sphere.O, sphere.radius)
				) {
					continue;
				}
				shadeCenter = sphere.O;
				break;
			}
			faces.push(hiddenFacet([a, b, c], shadeCenter));
		}

		stackedExplode(faces);

		// Rest on a flat face. The fillets stay inside the face planes, so the
		// face sits flush on the bed and the curves lift clear of it.
		const printingTransform = new Transform()
			.rotateByAxisAngle(xAxis, Math.PI / 2)
			.translateBy(0, h + PRINT_CLEARANCE_MM, 0);

		return {
			faces,
			faceToFaceDistance: h * 2,
			printingTransform,
			previewTransform: previewTilt()
		};
	}
};
