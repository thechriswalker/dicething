// Generic machinery for building isohedral dice from a convex polyhedron's
// rotational symmetry.
//
// Every die here is face-transitive (isohedral): all faces are one congruent
// shape. So we build a single 2D face `Shape` from one "seed" face and place a
// copy on every face by applying the solid's rotational symmetry group (see
// src/lib/utils/symmetry.ts). Because all faces share one `Shape`, the exploded
// view and the engraved legends are oriented consistently - this is exactly how
// the regular-polyhedron builder (src/lib/utils/polyhedra.ts) works.
//
// All the supported solids are Catalan duals of a vertex-transitive (Archimedean
// / antiprism / snub) source. `dualSeedFace` derives one dual face directly from
// the source vertices without a convex hull.

import { numberingOrders } from '$lib/utils/numbering_orders';
import type { DiceParameter, DieFaceModel, DieModel } from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { gridExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices, rotateShapes } from '$lib/utils/shapes';
import { Matrix4, Quaternion, Shape, Vector2, Vector3 } from 'three';

const round = (x: number, places = 4) => {
	const f = Math.pow(10, places);
	return Math.round(x * f) / f;
};

const Z_AXIS = new Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// seed face from a Catalan dual's source vertices (hull-free)
// ---------------------------------------------------------------------------

// keep the part of `poly` (a 2D polygon, in order) on the side `A*x + B*y <= C`.
// (Sutherland-Hodgman clip against one half-plane.)
function clipHalfPlane(poly: Array<Vector2>, A: number, B: number, C: number): Array<Vector2> {
	const out: Array<Vector2> = [];
	const m = poly.length;
	for (let i = 0; i < m; i++) {
		const cur = poly[i];
		const nxt = poly[(i + 1) % m];
		const fc = A * cur.x + B * cur.y - C;
		const fn = A * nxt.x + B * nxt.y - C;
		const cin = fc <= 1e-9;
		const nin = fn <= 1e-9;
		if (cin) {
			out.push(cur);
		}
		if (cin !== nin) {
			const t = fc / (fc - fn);
			out.push(new Vector2(cur.x + t * (nxt.x - cur.x), cur.y + t * (nxt.y - cur.y)));
		}
	}
	return out;
}

// the ordered 3D corners of the one dual face around source vertex `seed`.
//
// The polar dual of conv{sourceVerts} is {x : x.v <= 1 for all source v}; its
// facet for source vertex s is {x : x.s = 1, x.v <= 1}. We intersect those
// half-spaces inside the plane x.s = 1 (a 2D half-plane intersection), which
// needs no convex hull. The source must be vertex-transitive on a sphere (true
// for every Archimedean/antiprism/snub source), so the plane's foot x0 = s/|s|^2
// is always feasible.
export function dualSeedFace(sourceVerts: Array<Vector3>, seed: Vector3): Array<Vector3> {
	const s2 = seed.dot(seed);
	const x0 = seed.clone().multiplyScalar(1 / s2); // x0 . seed = 1
	const n = seed.clone().normalize();
	// an in-plane basis (u, w) perpendicular to the seed direction.
	const ref = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
	const u = ref
		.clone()
		.sub(n.clone().multiplyScalar(ref.dot(n)))
		.normalize();
	const w = n.clone().cross(u).normalize();

	const R = 1e4;
	let poly: Array<Vector2> = [
		new Vector2(R, R),
		new Vector2(-R, R),
		new Vector2(-R, -R),
		new Vector2(R, -R)
	];
	for (const v of sourceVerts) {
		const A = u.dot(v);
		const B = w.dot(v);
		const C = 1 - x0.dot(v);
		// constraints parallel to the seed direction (v collinear with s) carry no
		// in-plane edge.
		if (Math.abs(A) < 1e-9 && Math.abs(B) < 1e-9) {
			continue;
		}
		poly = clipHalfPlane(poly, A, B, C);
		if (poly.length === 0) {
			break;
		}
	}
	const corners = poly.map((p) => x0.clone().addScaledVector(u, p.x).addScaledVector(w, p.y));
	// clipping leaves coincident vertices (where several constraints meet at one
	// dual corner) and the occasional point on a straight edge; drop both so the
	// face is a clean simple polygon.
	return cleanPolygon(corners);
}

// drop consecutive-coincident and collinear vertices from a closed polygon.
function cleanPolygon(pts: Array<Vector3>): Array<Vector3> {
	if (pts.length < 3) {
		return pts;
	}
	const scale = Math.max(...pts.map((p) => p.length()), 1e-9);
	const eps = 1e-6 * scale;
	const deduped: Array<Vector3> = [];
	for (const p of pts) {
		const prev = deduped.length ? deduped[deduped.length - 1] : pts[pts.length - 1];
		if (p.distanceTo(prev) > eps) {
			deduped.push(p);
		}
	}
	if (deduped.length > 1 && deduped[0].distanceTo(deduped[deduped.length - 1]) <= eps) {
		deduped.pop();
	}
	const n = deduped.length;
	if (n < 4) {
		return deduped;
	}
	const out: Array<Vector3> = [];
	for (let i = 0; i < n; i++) {
		const prev = deduped[(i + n - 1) % n];
		const cur = deduped[i];
		const nxt = deduped[(i + 1) % n];
		const e1 = cur.clone().sub(prev).normalize();
		const e2 = nxt.clone().sub(cur).normalize();
		if (e1.cross(e2).length() > 1e-4) {
			out.push(cur);
		}
	}
	return out.length >= 3 ? out : deduped;
}

// order a set of coplanar points into a simple polygon, counter-clockwise about
// their shared plane normal. needed before `orientCoplanarVertices`, which
// assumes its input is already in boundary order. used by the hand-built
// (non-isohedral) truncated dice.
export function orderCoplanar(verts: Array<Vector3>): Array<Vector3> {
	const centroid = verts
		.reduce((acc, v) => acc.add(v.clone()), new Vector3())
		.multiplyScalar(1 / verts.length);
	// any three non-collinear points fix the plane normal.
	let normal = new Vector3();
	for (let i = 2; i < verts.length; i++) {
		normal = verts[1].clone().sub(verts[0]).cross(verts[i].clone().sub(verts[0]));
		if (normal.lengthSq() > 1e-12) {
			break;
		}
	}
	normal.normalize();
	const ref = Math.abs(normal.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
	const u = ref
		.clone()
		.sub(normal.clone().multiplyScalar(ref.dot(normal)))
		.normalize();
	const w = normal.clone().cross(u).normalize();
	const angle = (p: Vector3) => {
		const d = p.clone().sub(centroid);
		return Math.atan2(d.dot(w), d.dot(u));
	};
	return [...verts].sort((a, b) => angle(a) - angle(b));
}

// ---------------------------------------------------------------------------
// placing one shape on every face via a rotation group
// ---------------------------------------------------------------------------

export type PlacedFaces = {
	// the single shared face shape (centred, lying flat in the XY plane).
	shape: Shape;
	// one placement transform per distinct face.
	transforms: Array<Transform>;
	// the placed face centroids (for ordering / sizing).
	centroids: Array<Vector3>;
};

// build a flat `Shape` from the seed face's 3D corners, ensuring its engraving
// front (+z) faces outward, then place a copy on every face by applying each
// rotation. duplicate placements (when |group| > face count, e.g. the d30) are
// collapsed by face-centroid direction.
//
// `seedRotationDegrees` spins the (shared) seed shape about its own normal by
// the given angle (counter-clockwise) while compensating the placement
// transforms, so the solid's 3D geometry is unchanged but legends - which are
// engraved upright in the shape's frame - and the exploded-view outline are
// re-oriented relative to each face. this lets a die pick how its number sits on
// its (asymmetric) faces.
export function orbitFace(
	corners: Array<Vector3>,
	rotations: Array<Quaternion>,
	seedRotationDegrees = 0
): PlacedFaces {
	const centroid = corners
		.reduce((acc, v) => acc.add(v.clone()), new Vector3())
		.multiplyScalar(1 / corners.length);
	let info = orientCoplanarVertices(corners);
	if (info.normal.dot(centroid) < 0) {
		info = orientCoplanarVertices([...corners].reverse());
	}

	let shape = info.shape;
	let base = new Transform().rotate(info.quat).translate(info.offset);
	if (seedRotationDegrees) {
		const theta = (seedRotationDegrees * Math.PI) / 180;
		shape = rotateShapes(theta, shape)[0];
		// pre-rotate by -theta so transform . rotatedShape == transform . shape.
		const compensate = new Quaternion().setFromAxisAngle(Z_AXIS, -theta);
		base = new Transform().rotate(compensate).rotate(info.quat).translate(info.offset);
	}

	const transforms: Array<Transform> = [];
	const centroids: Array<Vector3> = [];
	const seen = new Set<string>();
	for (const g of rotations) {
		const t = base.clone().rotate(g);
		const c = t.translation;
		const dir = c.clone().normalize();
		const key = `${round(dir.x)},${round(dir.y)},${round(dir.z)}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		transforms.push(t);
		centroids.push(c);
	}
	return { shape, transforms, centroids };
}

// ---------------------------------------------------------------------------
// the rotational symmetry group of a solid, derived from its vertices
// ---------------------------------------------------------------------------

// two unit quaternions are the same rotation when |dot| ~ 1 (q and -q agree).
function sameRotation(a: Quaternion, b: Quaternion): boolean {
	return Math.abs(a.dot(b)) > 1 - 1e-6;
}

// a right-handed orthonormal frame whose x-axis is along `p` and whose xy-plane
// contains `edge` (used to pin down the in-plane "twist").
function frame(p: Vector3, edge: Vector3): Matrix4 {
	const x = p.clone().normalize();
	const y = edge
		.clone()
		.sub(x.clone().multiplyScalar(edge.dot(x)))
		.normalize();
	const z = x.clone().cross(y);
	return new Matrix4().makeBasis(x, y, z);
}

// Every rotational symmetry `g` of a vertex-transitive solid is fixed by where
// it sends one directed edge: g(v0) is some vertex t, and g(n0) is one of t's
// nearest neighbours. So we try mapping the reference directed edge (v0 -> n0)
// onto every (t -> nt) candidate, keep the rotations that map the whole vertex
// set onto itself, and dedupe. This derives the group from the solid's own
// geometry, so it never depends on the coordinate orientation. (Only proper
// rotations are produced, since both frames are right-handed - exactly what we
// want, including for chiral solids.)
export function rotationGroupOf(verts: Array<Vector3>): Array<Quaternion> {
	const n = verts.length;
	const scale = Math.max(...verts.map((v) => v.length()), 1e-9);
	const eps = 1e-6 * scale;

	const keyOf = (v: Vector3) =>
		`${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
	const present = new Set(verts.map(keyOf));

	const nearestDistance = (i: number) => {
		let m = Infinity;
		for (let j = 0; j < n; j++) {
			if (j === i) {
				continue;
			}
			const d = verts[i].distanceTo(verts[j]);
			if (d > eps && d < m) {
				m = d;
			}
		}
		return m;
	};
	const neighbours = (i: number) => {
		const m = nearestDistance(i);
		const out: Array<number> = [];
		for (let j = 0; j < n; j++) {
			if (j !== i && Math.abs(verts[i].distanceTo(verts[j]) - m) < m * 1e-3) {
				out.push(j);
			}
		}
		return out;
	};

	const v0 = verts[0];
	const v0Min = nearestDistance(0);
	const n0 = verts[neighbours(0)[0]];
	const f0Inv = frame(v0, n0.clone().sub(v0)).clone().transpose();

	const group: Array<Quaternion> = [];
	for (let i = 0; i < n; i++) {
		// only vertices with the same local geometry can receive v0.
		if (Math.abs(nearestDistance(i) - v0Min) > eps) {
			continue;
		}
		const t = verts[i];
		for (const j of neighbours(i)) {
			const m = frame(t, verts[j].clone().sub(t)).multiply(f0Inv);
			const q = new Quaternion().setFromRotationMatrix(m);
			let preserved = true;
			for (const v of verts) {
				if (!present.has(keyOf(v.clone().applyQuaternion(q)))) {
					preserved = false;
					break;
				}
			}
			if (preserved && !group.some((g) => sameRotation(g, q))) {
				group.push(q);
			}
		}
	}
	return group;
}

// ---------------------------------------------------------------------------
// the die builder
// ---------------------------------------------------------------------------

export type ConvexPolyhedronOptions = {
	id: string;
	name: string;
	// the vertices of the vertex-transitive SOURCE solid (Archimedean / antiprism
	// / snub) whose polar dual is this die. the die's faces, single shape and
	// placement transforms are all derived from these. receives the current
	// parameters so shape-altering parameters can rebuild the source.
	source: (params: Record<string, number>) => Array<Vector3>;
	// size parameter bounds (face-to-face / insphere diameter in mm).
	defaultSize?: number;
	minSize?: number;
	maxSize?: number;
	sizeStep?: number;
	// default legend for the n-th number face (in deterministic face order).
	numbering?: (numberIndex: number, numberCount: number) => Legend;
	// rotate the seed face's 2D shape (counter-clockwise, in degrees) about its
	// own normal, so legends sit how you want on these asymmetric faces. the 3D
	// solid is unchanged - only the legend/explode orientation moves. tune per
	// die to taste.
	seedRotation?: number;
	// size each legend to its own face (needed when faces are small).
	individualLegendScaling?: boolean;
	// chiral solids expose a left/right "handedness" parameter. when set, the
	// supplied `seedFace` defines the left-handed form and the right-handed form
	// is produced by mirroring across the x=0 plane.
	chiral?: boolean;
	// extra shape parameters (beyond size/handedness) surfaced on the die.
	extraParameters?: Array<DiceParameter>;
};

const SIZE_PARAM = 'polyhedron_size';
const HANDEDNESS_PARAM = 'handedness';

export function compareKeys(a: Array<number>, b: Array<number>): number {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return a[i] - b[i];
		}
	}
	return 0;
}

// ---------------------------------------------------------------------------
// face numbering order
// ---------------------------------------------------------------------------

// the faces come out of `orbitFace` in an arbitrary (build) order; numbering
// just assigns value k+1 to the k-th face in the array. To get nicely numbered
// dice (opposite faces summing to n+1, numbers spread out) we reshuffle the
// faces using a precomputed order from `numberingOrders` - generated offline by
// scripts/generate_numbering.ts, no maths at runtime. `order[k]` is the build
// index of the face that should carry value k+1.
function resolveNumberingOrder(id: string, handed: number, n: number): Array<number> {
	const entry = numberingOrders[id];
	let order: Array<number> | undefined;
	if (entry) {
		order = Array.isArray(entry[0])
			? (entry as Array<Array<number>>)[handed]
			: (entry as Array<number>);
	}
	if (order && isPermutation(order, n)) {
		return order;
	}
	// no (valid) order on file: fall back to build order so the die still works.
	return Array.from({ length: n }, (_, i) => i);
}

function isPermutation(arr: Array<number>, n: number): boolean {
	if (arr.length !== n) {
		return false;
	}
	const seen = new Array<boolean>(n).fill(false);
	for (const x of arr) {
		if (!Number.isInteger(x) || x < 0 || x >= n || seen[x]) {
			return false;
		}
		seen[x] = true;
	}
	return true;
}

export function convexPolyhedronDie(opts: ConvexPolyhedronOptions): DieModel {
	const defaultSize = opts.defaultSize ?? 18;
	const parameters: Array<DiceParameter> = [
		{
			id: SIZE_PARAM,
			defaultValue: defaultSize,
			min: opts.minSize ?? 6,
			max: opts.maxSize ?? 60,
			step: opts.sizeStep ?? 0.1
		}
	];
	if (opts.extraParameters) {
		parameters.push(...opts.extraParameters);
	}
	// handedness is a 0 (left) / 1 (right) toggle exposed as a parameter so the
	// two mirror-image forms share a single entry in the dice list.
	if (opts.chiral) {
		parameters.push({
			id: HANDEDNESS_PARAM,
			defaultValue: 0,
			min: 0,
			max: 1,
			step: 1,
			display: {
				kind: 'toggle',
				options: [
					{ value: 0, label: 'handedness_left' },
					{ value: 1, label: 'handedness_right' }
				]
			}
		});
	}

	const numbering = opts.numbering ?? ((i, n) => pickForNumber(i, n));

	return {
		id: opts.id,
		name: opts.name,
		parameters,
		blankParameters(params, offset) {
			const size = params[SIZE_PARAM] ?? defaultSize;
			return { ...params, [SIZE_PARAM]: size - offset * 2 };
		},
		build(params) {
			const size = params[SIZE_PARAM] ?? defaultSize;

			let src = opts.source(params);
			// the right-handed mirror form: reflect the whole source, so its derived
			// group, seed face and tiling all come out consistently mirrored.
			if (opts.chiral && Math.round(params[HANDEDNESS_PARAM] ?? 0) === 1) {
				src = src.map((v) => new Vector3(-v.x, v.y, v.z));
			}
			const rotations = rotationGroupOf(src);
			const corners = dualSeedFace(src, src[0]);

			// inradius = distance from the origin to the (single) face plane; scale
			// it so the insphere diameter matches the requested size.
			const centroid = corners
				.reduce((acc, v) => acc.add(v.clone()), new Vector3())
				.multiplyScalar(1 / corners.length);
			let info = orientCoplanarVertices(corners);
			if (info.normal.dot(centroid) < 0) {
				info = orientCoplanarVertices([...corners].reverse());
			}
			const inradius = Math.abs(centroid.dot(info.normal));
			const scale = size / 2 / inradius;

			const placed = orbitFace(
				corners.map((v) => v.clone().multiplyScalar(scale)),
				rotations,
				opts.seedRotation ?? 0
			);

			const handed = opts.chiral ? Math.round(params[HANDEDNESS_PARAM] ?? 0) : 0;
			const order = resolveNumberingOrder(opts.id, handed, placed.transforms.length);

			const numberCount = order.length;
			const faces: Array<DieFaceModel> = order.map((idx, i) => ({
				isNumberFace: true,
				shape: placed.shape,
				defaultLegend: numbering(i, numberCount),
				transform: placed.transforms[idx]
			}));

			const faceToFaceDistance = inradius * 2 * scale;

			const explodes = gridExplode(faces.map((f) => f.shape));
			faces.forEach((f, i) => (f.explodeTransform = explodes[i]));

			return {
				faceToFaceDistance,
				sizeLegendsIndividually: opts.individualLegendScaling,
				faces
			};
		}
	};
}

// ---------------------------------------------------------------------------
// helpers for building source vertex sets
// ---------------------------------------------------------------------------

// all sign combinations of the given magnitudes (2^k points; zeros are not
// duplicated).
export function signs(...coords: Array<number>): Array<Vector3> {
	const out: Array<Vector3> = [];
	const xs = coords[0] === 0 ? [0] : [coords[0], -coords[0]];
	const ys = coords[1] === 0 ? [0] : [coords[1], -coords[1]];
	const zs = coords[2] === 0 ? [0] : [coords[2], -coords[2]];
	for (const x of xs) {
		for (const y of ys) {
			for (const z of zs) {
				out.push(new Vector3(x, y, z));
			}
		}
	}
	return out;
}

// all (3) cyclic permutations of a coordinate triple.
export function cyclic(a: number, b: number, c: number): Array<[number, number, number]> {
	return [
		[a, b, c],
		[c, a, b],
		[b, c, a]
	];
}

// even permutations of a coordinate triple (the 3 cyclic rotations).
export function evenPerms(a: number, b: number, c: number): Array<[number, number, number]> {
	return cyclic(a, b, c);
}

// odd permutations of a coordinate triple (the 3 non-cyclic orderings).
export function oddPerms(a: number, b: number, c: number): Array<[number, number, number]> {
	return [
		[a, c, b],
		[b, a, c],
		[c, b, a]
	];
}

// all (6) permutations of a coordinate triple.
export function allPerms(a: number, b: number, c: number): Array<[number, number, number]> {
	return [
		[a, b, c],
		[a, c, b],
		[b, a, c],
		[b, c, a],
		[c, a, b],
		[c, b, a]
	];
}

// the golden ratio, used for icosahedral-symmetry solids.
export const PHI = (1 + Math.sqrt(5)) / 2;

// the tribonacci constant, used for the (chiral) snub solids.
export const TRIBONACCI =
	(1 + Math.cbrt(19 + 3 * Math.sqrt(33)) + Math.cbrt(19 - 3 * Math.sqrt(33))) / 3;

// generate snub-solid vertices from magnitude triples: even permutations take
// sign patterns with an even number of plus signs, odd permutations take an odd
// number of plus signs. this selects a single chirality.
export function snubVertices(m: [number, number, number]): Array<Vector3> {
	const out: Array<Vector3> = [];
	const add = (perm: [number, number, number], wantEvenPlus: boolean) => {
		for (let s = 0; s < 8; s++) {
			const sx = s & 1 ? -1 : 1;
			const sy = s & 2 ? -1 : 1;
			const sz = s & 4 ? -1 : 1;
			const plusCount = (sx > 0 ? 1 : 0) + (sy > 0 ? 1 : 0) + (sz > 0 ? 1 : 0);
			if ((plusCount % 2 === 0) === wantEvenPlus) {
				out.push(new Vector3(perm[0] * sx, perm[1] * sy, perm[2] * sz));
			}
		}
	};
	evenPerms(m[0], m[1], m[2]).forEach((p) => add(p, true));
	oddPerms(m[0], m[1], m[2]).forEach((p) => add(p, false));
	return out;
}
