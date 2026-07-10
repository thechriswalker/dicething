// Manifold-based die engraving: volumetric blank solids + cross-section subtract.
//
// Die faces are still defined as 2D shapes + transforms (DieModel.build). This
// module turns them into a watertight Manifold blank, subtracts extruded legend
// profiles per face, and converts back to Three.js geometry where needed.

import type { DieFaceModel, DieModel, FaceParams } from '$lib/interfaces/dice';
import type { CrossSection, Manifold, Mat4 } from './manifold';
import {
	BufferGeometry,
	Float32BufferAttribute,
	Matrix4,
	Mesh,
	Path,
	Shape,
	ShapeUtils,
	Vector2,
	Vector3
} from 'three';
import { Transform } from './3d';
import { DefaultDivisions, Part, type SymbolOrientation } from './engraving';
import { Legend, type LegendSet } from './legends';
import { cloneManifold, deleteAll, geometryToManifold, manifold, manifoldToGeometry } from './manifold';
import {
	isContained,
	rotateShapes,
	scaleShapes,
	translateShapes
} from './shapes';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shapeGeometry } from './tessellate';

const FACE_ID_BASE = 0;
const CUTTER_ID_BASE = 10_000;
const PENETRATION_EPS = 0.05;
const CUTTER_SURFACE_EPS = 0.1;

export type DieManifoldBlank = {
	// Borrowed from blankCache — do not .delete(); use clearBlankCache() to evict.
	manifold: Manifold;
	faceIds: Uint32Array;
};

export type EngravedDieManifold = {
	manifold: Manifold;
	blank: DieManifoldBlank;
};

// --- Shape / CrossSection bridge ------------------------------------------------

function vec2s(points: Array<Vector2>): Array<[number, number]> {
	return points.map((p) => [p.x, p.y] as [number, number]);
}

function normalizeLoop(points: Array<Vector2>, ccw: boolean): Array<Vector2> {
	const pts = points.slice();
	if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) {
		pts.pop();
	}
	if (pts.length < 3) {
		return pts;
	}
	const cw = ShapeUtils.isClockWise(pts);
	if (ccw ? cw : !cw) {
		pts.reverse();
	}
	return pts;
}

export function shapeToPolygons(shape: Shape, divisions: number = DefaultDivisions): Array<Array<[number, number]>> {
	const outer = normalizeLoop(shape.getPoints(divisions), true);
	const contours: Array<Array<[number, number]>> = [vec2s(outer)];
	for (const hole of shape.holes) {
		const loop = normalizeLoop(hole.getPoints(divisions), false);
		if (loop.length >= 3) {
			contours.push(vec2s(loop));
		}
	}
	return contours;
}

export function shapeToCrossSection(
	shape: Shape,
	divisions: number = DefaultDivisions
): CrossSection {
	const wasm = manifold();
	const contours = shapeToPolygons(shape, divisions);
	return new wasm.CrossSection(contours, contours.length > 1 ? 'EvenOdd' : 'Positive');
}

export function shapesToCrossSection(
	shapes: Array<Shape>,
	divisions: number = DefaultDivisions
): CrossSection | undefined {
	const wasm = manifold();
	if (shapes.length === 0) {
		return undefined;
	}
	const contours: Array<Array<[number, number]>> = [];
	for (const shape of shapes) {
		contours.push(...shapeToPolygons(shape, divisions));
	}
	if (contours.length === 0) {
		return undefined;
	}
	return new wasm.CrossSection(contours, 'EvenOdd');
}

// --- Transforms -----------------------------------------------------------------

export function transformToMat4(t: Transform): Mat4 {
	const o = t.applyToVector3(new Vector3(0, 0, 0));
	const px = t.applyToVector3(new Vector3(1, 0, 0));
	const py = t.applyToVector3(new Vector3(0, 1, 0));
	const pz = t.applyToVector3(new Vector3(0, 0, 1));
	const m = new Matrix4();
	m.makeBasis(
		px.sub(o).normalize(),
		py.sub(o).normalize(),
		pz.sub(o).normalize()
	);
	m.setPosition(o);
	return m.elements as Mat4;
}

// Distance from the die origin to the face plane along the inward normal (face
// local +Z is outward; inward is -Z).
export function facePenetrationDepth(face: DieFaceModel): number {
	const onFace = face.transform.applyToVector3(new Vector3(0, 0, 0));
	const outward = face.transform
		.applyToVector3(new Vector3(0, 0, 1))
		.sub(onFace)
		.normalize();
	const inward = outward.negate();
	return Math.max(PENETRATION_EPS, Math.abs(onFace.dot(inward))) + PENETRATION_EPS;
}

// --- Manifold tagging -----------------------------------------------------------

function tagWithOriginalId(man: Manifold, originalId: number): Manifold {
	const wasm = manifold();
	const mesh = man.getMesh();
	const nTri = mesh.numTri;
	mesh.runOriginalID = new Uint32Array([originalId]);
	mesh.runIndex = new Uint32Array([0, nTri * 3]);
	const tagged = new wasm.Manifold(mesh);
	man.delete();
	return tagged;
}

function unionManifolds(parts: Array<Manifold>): Manifold {
	const wasm = manifold();
	if (parts.length === 1) {
		return parts[0];
	}
	let acc = parts[0];
	for (let i = 1; i < parts.length; i++) {
		const u = wasm.Manifold.union(acc, parts[i]);
		deleteAll(acc, parts[i]);
		acc = u;
	}
	return acc;
}

export function faceOriginalId(faceIndex: number): number {
	return FACE_ID_BASE + faceIndex;
}

export function cutterOriginalId(faceIndex: number): number {
	return CUTTER_ID_BASE + faceIndex;
}

// --- Blank solid ----------------------------------------------------------------

export function buildFaceVolume(
	face: DieFaceModel,
	faceIndex: number,
	divisions: number = DefaultDivisions
): Manifold {
	const wasm = manifold();
	const penetration = facePenetrationDepth(face);
	const cs = shapeToCrossSection(face.shape, divisions);
	// Prism under the face: full cross-section extruded inward (no taper-to-point
	// slivers at the die centre when many faces union).
	let vol = cs.extrude(penetration);
	cs.delete();
	// Extrude along +Z, shift into the die (−Z). Do not rotate 180° around X —
	// that mirrors face-local Y and breaks legend orientation vs legacy engrave().
	vol = vol.translate([0, 0, -penetration]);
	vol = vol.transform(transformToMat4(face.transform));
	return tagWithOriginalId(vol, faceOriginalId(faceIndex));
}

export function buildBlankManifold(
	faces: Array<DieFaceModel>,
	divisions: number = DefaultDivisions
): DieManifoldBlank {
	const parts = faces.map((face, i) => buildFaceVolume(face, i, divisions));
	const blank = unionManifolds(parts);
	const faceIds = new Uint32Array(faces.map((_, i) => faceOriginalId(i)));
	return { manifold: blank, faceIds };
}

// --- Export-shell blank with per-face runOriginalID --------------------------------

const CAP_Z_EPS = 0.15;

function pointInPolygon(x: number, y: number, poly: Array<Vector2>): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const vi = poly[i];
		const vj = poly[j];
		const crosses =
			vi.y > y !== vj.y > y && x < ((vj.x - vi.x) * (y - vi.y)) / (vj.y - vi.y) + vi.x;
		if (crosses) {
			inside = !inside;
		}
	}
	return inside;
}

function openFaceLoop(shape: Shape | Path, divisions: number): Array<Vector2> {
	const pts = shape.getPoints(divisions);
	if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-12) {
		pts.pop();
	}
	return pts;
}

function pointInFaceShape(shape: Shape, x: number, y: number, divisions: number): boolean {
	const outer = openFaceLoop(shape, divisions);
	if (!pointInPolygon(x, y, outer)) {
		return false;
	}
	for (const hole of shape.holes) {
		if (pointInPolygon(x, y, openFaceLoop(hole, divisions))) {
			return false;
		}
	}
	return true;
}

const _centroid = new Vector3();
const _normal = new Vector3();
const _edgeA = new Vector3();
const _edgeB = new Vector3();
const _onFace = new Vector3();
const _outward = new Vector3();

function assignTriangleFaceIndex(
	centroid: Vector3,
	normal: Vector3,
	faces: Array<DieFaceModel>,
	invs: Array<Matrix4>,
	divisions: number
): number {
	let best = -1;
	let bestScore = -1;
	for (let i = 0; i < faces.length; i++) {
		_local.copy(centroid).applyMatrix4(invs[i]);
		if (Math.abs(_local.z) > CAP_Z_EPS) {
			continue;
		}
		if (!pointInFaceShape(faces[i].shape, _local.x, _local.y, divisions)) {
			continue;
		}
		_onFace.copy(faces[i].transform.applyToVector3(new Vector3(0, 0, 0)));
		_outward
			.copy(faces[i].transform.applyToVector3(new Vector3(0, 0, 1)))
			.sub(_onFace)
			.normalize();
		const align = normal.dot(_outward);
		if (align < 0.25) {
			continue;
		}
		const score = align - Math.abs(_local.z);
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	}
	if (best >= 0) {
		return best;
	}
	// Edge/seam fallback: pick the face whose plane the centroid lies closest to
	// while still inside the face outline.
	let bestDist = Infinity;
	for (let i = 0; i < faces.length; i++) {
		_local.copy(centroid).applyMatrix4(invs[i]);
		if (!pointInFaceShape(faces[i].shape, _local.x, _local.y, divisions)) {
			continue;
		}
		const dist = Math.abs(_local.z);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	if (best >= 0) {
		return best;
	}
	// Last resort: face whose outward normal best matches the triangle (bevel/rim caps
	// whose centroid sits outside the 2D outline after welding).
	let bestAlign = -1;
	for (let i = 0; i < faces.length; i++) {
		_onFace.copy(faces[i].transform.applyToVector3(new Vector3(0, 0, 0)));
		_outward
			.copy(faces[i].transform.applyToVector3(new Vector3(0, 0, 1)))
			.sub(_onFace)
			.normalize();
		const align = normal.dot(_outward);
		if (align > bestAlign) {
			bestAlign = align;
			best = i;
		}
	}
	return best;
}

// Blank face cap in face-local space (z = 0), for assembling the export shell.
export function buildBlankFaceCapGeometry(
	face: DieFaceModel,
	divisions: number = DefaultDivisions
): BufferGeometry {
	return shapeGeometry(face.shape, divisions);
}

// Full die blank from the watertight export shell, with every triangle tagged by
// the face it belongs to so extractFaceGeometry can filter on runOriginalID.
export function buildBlankManifoldFromExportShell(
	shellGeometry: BufferGeometry,
	faces: Array<DieFaceModel>,
	divisions: number = DefaultDivisions
): DieManifoldBlank {
	const wasm = manifold();
	const positionOnly = new BufferGeometry();
	const srcPos = shellGeometry.getAttribute('position');
	positionOnly.setAttribute('position', srcPos.clone());
	if (shellGeometry.index) {
		positionOnly.setIndex(shellGeometry.index.clone());
	}
	const welded = mergeVertices(positionOnly);
	const pos = welded.getAttribute('position');
	const index = welded.index;
	if (!index) {
		throw new Error('mergeVertices did not produce an indexed geometry');
	}

	const invs = faces.map((face) => new Matrix4().fromArray(transformToMat4(face.transform)).invert());
	const buckets = new Map<number, Array<number>>();

	for (let t = 0; t < index.count; t += 3) {
		const ia = index.getX(t);
		const ib = index.getX(t + 1);
		const ic = index.getX(t + 2);
		_centroid.set(0, 0, 0);
		for (const vi of [ia, ib, ic]) {
			_centroid.x += pos.getX(vi);
			_centroid.y += pos.getY(vi);
			_centroid.z += pos.getZ(vi);
		}
		_centroid.multiplyScalar(1 / 3);
		_edgeA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia));
		_edgeB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib));
		_normal
			.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic))
			.sub(_edgeA)
			.cross(_edgeB.sub(_edgeA))
			.normalize();

		const faceIndex = assignTriangleFaceIndex(_centroid, _normal, faces, invs, divisions);
		if (faceIndex < 0) {
			throw new Error('buildBlankManifoldFromExportShell: triangle matched no face');
		}
		const origId = faceOriginalId(faceIndex);
		let bucket = buckets.get(origId);
		if (!bucket) {
			bucket = [];
			buckets.set(origId, bucket);
		}
		bucket.push(ia, ib, ic);
	}

	if (buckets.size === 0) {
		throw new Error('buildBlankManifoldFromExportShell: no triangles matched a face');
	}

	const vertProperties = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		vertProperties[i * 3] = pos.getX(i);
		vertProperties[i * 3 + 1] = pos.getY(i);
		vertProperties[i * 3 + 2] = pos.getZ(i);
	}

	const sortedIds = [...buckets.keys()].sort((a, b) => a - b);
	const triVerts: Array<number> = [];
	const runOriginalID = new Uint32Array(sortedIds.length);
	const runIndex = new Uint32Array(sortedIds.length + 1);
	let offset = 0;
	for (let r = 0; r < sortedIds.length; r++) {
		const tris = buckets.get(sortedIds[r])!;
		runOriginalID[r] = sortedIds[r];
		runIndex[r] = offset;
		triVerts.push(...tris);
		offset += tris.length;
	}
	runIndex[sortedIds.length] = offset;

	const mesh = new wasm.Mesh({
		numProp: 3,
		vertProperties,
		triVerts: new Uint32Array(triVerts)
	});
	mesh.runIndex = runIndex;
	mesh.runOriginalID = runOriginalID;
	mesh.merge();
	const man = wasm.Manifold.ofMesh(mesh);
	const status = man.status();
	if (status !== 'NoError') {
		console.warn('buildBlankManifoldFromExportShell: non-manifold input ->', status);
	}
	return {
		manifold: man,
		faceIds: new Uint32Array(faces.map((_, i) => faceOriginalId(i)))
	};
}

// Turn the watertight export-shell mesh into a Manifold solid. The closed surface
// around the die already bounds the volume Manifold needs for boolean subtract.
// Each triangle is tagged with the face it came from (runOriginalID).
export function buildBlankManifoldFromGeometry(
	geometry: BufferGeometry,
	faces: Array<DieFaceModel>,
	divisions?: number
): DieManifoldBlank {
	return buildBlankManifoldFromExportShell(geometry, faces, divisions);
}

// --- Legend cutters -------------------------------------------------------------

export function buildLegendCutter(
	symbols: Array<Shape>,
	orientation: SymbolOrientation,
	depth: number,
	face: DieFaceModel,
	faceIndex: number,
	divisions: number = DefaultDivisions
): Manifold | undefined {
	if (symbols.length === 0) {
		return undefined;
	}
	let oriented = symbols;
	if (orientation.scale && orientation.scale !== 1) {
		oriented = scaleShapes(orientation.scale, ...oriented);
	}
	if (orientation.rotation) {
		oriented = rotateShapes(orientation.rotation, ...oriented);
	}
	if (orientation.offset && orientation.offset.lengthSq() !== 0) {
		oriented = translateShapes(orientation.offset, ...oriented);
	}
	const cs = shapesToCrossSection(oriented, divisions);
	if (!cs) {
		return undefined;
	}
	const eps = CUTTER_SURFACE_EPS;
	// Legacy engrave(): walls run z = 0 (face surface) down to z = -depth. Extrude
	// along +Z, shift into the die — top flush with the face, extra ε below for
	// robust boolean subtract. (No rotate 180° X: that mirrors Y and reverses legends.)
	const h = depth + eps;
	let cutter = cs.extrude(h, 0, 0, [1, 1]);
	cs.delete();
	cutter = cutter.translate([0, 0, -depth]);
	cutter = cutter.transform(transformToMat4(face.transform));
	return tagWithOriginalId(cutter, cutterOriginalId(faceIndex));
}

export function canEngraveLegend(
	surface: Shape,
	symbols: Array<Shape>,
	orientation: SymbolOrientation,
	clearance: number,
	convex: boolean
): boolean {
	let oriented = symbols;
	if (orientation.scale && orientation.scale !== 1) {
		oriented = scaleShapes(orientation.scale, ...oriented);
	}
	if (orientation.rotation) {
		oriented = rotateShapes(orientation.rotation, ...oriented);
	}
	if (orientation.offset && orientation.offset.lengthSq() !== 0) {
		oriented = translateShapes(orientation.offset, ...oriented);
	}
	return isContained(surface, oriented, clearance, convex);
}

// --- Engraving ------------------------------------------------------------------

export function engraveWithCutter(blank: Manifold, cutter: Manifold): Manifold {
	const wasm = manifold();
	const result = wasm.Manifold.difference(blank, cutter);
	cutter.delete();
	return result;
}

export function engraveFace(
	blank: DieManifoldBlank,
	face: DieFaceModel,
	faceIndex: number,
	symbols: Array<Shape>,
	orientation: SymbolOrientation,
	depth: number,
	divisions: number = DefaultDivisions
): Manifold {
	const cutter = buildLegendCutter(symbols, orientation, depth, face, faceIndex, divisions);
	if (!cutter) {
		return cloneManifold(blank.manifold);
	}
	return engraveWithCutter(blank.manifold, cutter);
}

export type EngraveDieArgs = {
	faces: Array<DieFaceModel>;
	legends: LegendSet;
	faceParams: Array<FaceParams>;
	depth: number;
	tolerance: number;
	divisions?: number;
	getScaleForLegend?: (legend: Legend) => number;
};

export function engraveDie(blank: DieManifoldBlank, args: EngraveDieArgs): Manifold {
	const wasm = manifold();
	const divisions = args.divisions ?? DefaultDivisions;
	const cutters: Array<Manifold> = [];

	for (let i = 0; i < args.faces.length; i++) {
		const face = args.faces[i];
		const params = args.faceParams[i] ?? {};
		const legend = params.legend ?? face.defaultLegend;
		if (legend === Legend.BLANK) {
			continue;
		}
		const symbols = args.legends.get(legend);
		const orientation: SymbolOrientation = {
			scale: params.scale ?? args.getScaleForLegend?.(legend) ?? 1,
			rotation: params.rotation,
			offset: params.offset
		};
		if (!canEngraveLegend(face.shape, symbols, orientation, args.tolerance, face.convex !== false)) {
			continue;
		}
		const cutter = buildLegendCutter(
			symbols,
			orientation,
			args.depth + (params.extraDepth ?? 0),
			face,
			i,
			divisions
		);
		if (cutter) {
			cutters.push(cutter);
		}
	}

	if (cutters.length === 0) {
		return cloneManifold(blank.manifold);
	}

	const cutUnion = unionManifolds(cutters);
	const result = wasm.Manifold.difference(blank.manifold, cutUnion);
	cutUnion.delete();
	return result;
}

// --- Geometry extraction --------------------------------------------------------

function filterMeshByOriginalIds(
	mesh: ReturnType<Manifold['getMesh']>,
	ids: ReadonlySet<number>
): { positions: Float32Array; indices: Uint32Array } | undefined {
	const { triVerts, runIndex, runOriginalID, numProp, vertProperties } = mesh;
	if (!runIndex?.length || !runOriginalID?.length) {
		return undefined;
	}

	const keptTris: Array<number> = [];
	for (let run = 0; run < runOriginalID.length; run++) {
		if (!ids.has(runOriginalID[run])) {
			continue;
		}
		const start = runIndex[run];
		const end = runIndex[run + 1] ?? triVerts.length;
		for (let t = start; t < end; t += 3) {
			keptTris.push(triVerts[t], triVerts[t + 1], triVerts[t + 2]);
		}
	}
	if (keptTris.length === 0) {
		return undefined;
	}

	const remap = new Map<number, number>();
	const positions: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i < keptTris.length; i++) {
		const vi = keptTris[i];
		let out = remap.get(vi);
		if (out === undefined) {
			out = positions.length / 3;
			remap.set(vi, out);
			const base = vi * numProp;
			positions.push(vertProperties[base], vertProperties[base + 1], vertProperties[base + 2]);
		}
		indices.push(out);
	}
	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array(indices)
	};
}

export function manifoldDieToGeometry(man: Manifold): BufferGeometry {
	return manifoldToGeometry(man);
}

const _local = new Vector3();

function classifyPart(localZ: number, depth: number): Part {
	if (localZ > -depth * 0.15) {
		return Part.Front;
	}
	if (localZ < -depth * 0.85) {
		return Part.Engraved;
	}
	return Part.Walls;
}

function extractFacePartsGeometric(
	man: Manifold,
	face: DieFaceModel,
	faceIndex: number,
	depth: number
): Array<BufferGeometry> {
	const inv = new Matrix4().fromArray(transformToMat4(face.transform)).invert();
	const mesh = man.getMesh();
	const ids = new Set([faceOriginalId(faceIndex), cutterOriginalId(faceIndex)]);
	const filtered = filterMeshByOriginalIds(mesh, ids);

	const parts = new Map<Part, { positions: number[]; indices: number[]; remap: Map<number, number> }>();
	const addPart = (part: Part) => {
		if (!parts.has(part)) {
			parts.set(part, { positions: [], indices: [], remap: new Map() });
		}
		return parts.get(part)!;
	};

	const processTris = (triList: Array<number>) => {
		for (let t = 0; t < triList.length; t += 3) {
			const verts = [triList[t], triList[t + 1], triList[t + 2]];
			let sumZ = 0;
			const world = verts.map((vi) => {
				const base = vi * mesh.numProp;
				const v = new Vector3(
					mesh.vertProperties[base],
					mesh.vertProperties[base + 1],
					mesh.vertProperties[base + 2]
				);
				_local.copy(v).applyMatrix4(inv);
				sumZ += _local.z;
				return v;
			});
			const part = classifyPart(sumZ / 3, depth);
			const bucket = addPart(part);
			const faceIndices = verts.map((vi) => {
				let out = bucket.remap.get(vi);
				if (out === undefined) {
					const base = vi * mesh.numProp;
					out = bucket.positions.length / 3;
					bucket.remap.set(vi, out);
					bucket.positions.push(
						mesh.vertProperties[base],
						mesh.vertProperties[base + 1],
						mesh.vertProperties[base + 2]
					);
				}
				return out;
			});
			bucket.indices.push(faceIndices[0], faceIndices[1], faceIndices[2]);
		}
	};

	if (filtered) {
		const pos = filtered.positions;
		const idx = filtered.indices;
		for (let i = 0; i < idx.length; i += 3) {
			let sumZ = 0;
			for (let k = 0; k < 3; k++) {
				const vi = idx[i + k];
				_local.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).applyMatrix4(inv);
				sumZ += _local.z;
			}
			const part = classifyPart(sumZ / 3, depth);
			const bucket = addPart(part);
			const faceIndices = [idx[i], idx[i + 1], idx[i + 2]].map((vi) => {
				let out = bucket.remap.get(vi);
				if (out === undefined) {
					out = bucket.positions.length / 3;
					bucket.remap.set(vi, out);
					bucket.positions.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
				}
				return out;
			});
			bucket.indices.push(faceIndices[0], faceIndices[1], faceIndices[2]);
		}
	} else {
		// Geometric fallback: all triangles near this face.
		const onFace = face.transform.applyToVector3(new Vector3(0, 0, 0));
		const outward = face.transform
			.applyToVector3(new Vector3(0, 0, 1))
			.sub(onFace)
			.normalize();
		const maxDist = facePenetrationDepth(face) + depth + 1;
		const triVerts = mesh.triVerts;
		for (let t = 0; t < triVerts.length; t += 3) {
			let cx = 0;
			let cy = 0;
			let cz = 0;
			for (let k = 0; k < 3; k++) {
				const base = triVerts[t + k] * mesh.numProp;
				cx += mesh.vertProperties[base];
				cy += mesh.vertProperties[base + 1];
				cz += mesh.vertProperties[base + 2];
			}
			cx /= 3;
			cy /= 3;
			cz /= 3;
			const c = new Vector3(cx, cy, cz);
			const dist = Math.abs(c.clone().sub(onFace).dot(outward));
			if (dist > maxDist) {
				continue;
			}
			processTris([triVerts[t], triVerts[t + 1], triVerts[t + 2]]);
		}
	}

	const out: Array<BufferGeometry> = [];
	for (const [part, bucket] of parts) {
		if (bucket.indices.length === 0) {
			continue;
		}
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(bucket.positions, 3));
		geo.setIndex(bucket.indices);
		geo.computeVertexNormals();
		geo.userData.diceThingPart = part;
		out.push(geo);
	}
	return out;
}

export function extractFaceGeometry(
	man: Manifold,
	face: DieFaceModel,
	faceIndex: number,
	depth: number
): Array<BufferGeometry> {
	return extractFacePartsGeometric(man, face, faceIndex, depth);
}

// Simple in-memory blank cache keyed by serialised die params.
const blankCache = new Map<string, DieManifoldBlank>();

export function blankCacheKey(
	modelId: string,
	params: Record<string, number>,
	stringParams: Record<string, string> = {}
): string {
	return JSON.stringify({ modelId, params, stringParams });
}

export type BlankSource = 'prism' | 'export';

export function getOrBuildBlankManifold(
	modelId: string,
	faces: Array<DieFaceModel>,
	params: Record<string, number>,
	stringParams: Record<string, string> = {},
	opts: {
		divisions?: number;
		source?: BlankSource;
		exportGeometry?: BufferGeometry;
	} = {}
): DieManifoldBlank {
	const source = opts.source ?? 'export';
	const key = blankCacheKey(modelId, params, stringParams) + `:${source}`;
	const cached = blankCache.get(key);
	if (cached) {
		return cached;
	}
	let built: DieManifoldBlank;
	if (source === 'export' && opts.exportGeometry) {
		built = buildBlankManifoldFromExportShell(
			opts.exportGeometry,
			faces,
			opts.divisions
		);
	} else {
		built = buildBlankManifold(faces, opts.divisions);
	}
	blankCache.set(key, built);
	return built;
}

export type BuildEngravedDieArgs = {
	model: DieModel;
	legends: LegendSet;
	params: Record<string, number>;
	stringParams?: Record<string, string>;
	faceParams: Array<FaceParams>;
	depth: number;
	tolerance: number;
	divisions?: number;
	getScaleForLegend?: (legend: Legend) => number;
	blankExportGeometry?: BufferGeometry;
};

export function buildEngravedDieManifold(args: BuildEngravedDieArgs): Manifold {
	const built = args.model.build(args.params, args.stringParams);
	const blank = getOrBuildBlankManifold(args.model.id, built.faces, args.params, args.stringParams ?? {}, {
		source: args.blankExportGeometry ? 'export' : 'prism',
		exportGeometry: args.blankExportGeometry,
		divisions: args.divisions
	});
	const engraved = engraveDie(blank, {
		faces: built.faces,
		legends: args.legends,
		faceParams: args.faceParams,
		depth: args.depth,
		tolerance: args.tolerance,
		divisions: args.divisions,
		getScaleForLegend: args.getScaleForLegend
	});
	return engraved;
}

export type ManifoldDieExport = {
	manifold: Manifold;
	previewMesh: Mesh;
};

// Preview mesh is a Three.js copy for display only; export should use manifold.
export function buildManifoldDieExport(man: Manifold): ManifoldDieExport {
	return {
		manifold: man,
		previewMesh: new Mesh(manifoldDieToGeometry(man))
	};
}

export function buildEngravedDieExport(args: BuildEngravedDieArgs): ManifoldDieExport {
	return buildManifoldDieExport(buildEngravedDieManifold(args));
}

export function disposeManifoldDieExport(exported: ManifoldDieExport | undefined): void {
	exported?.previewMesh.geometry.dispose();
	exported?.manifold.delete();
}

export type BuildBlankManifoldExportArgs = {
	model: DieModel;
	faces: Array<DieFaceModel>;
	params: Record<string, number>;
	stringParams?: Record<string, string>;
	exportGeometry: BufferGeometry;
	offset?: number;
	divisions?: number;
};

// Morphological inset/outset on a watertight blank solid. Positive offset shrinks
// (inset); negative offset grows (outset). Returns a new manifold; `man` is unchanged.
export function offsetBlankManifold(man: Manifold, offset: number): Manifold {
	if (offset === 0) {
		return cloneManifold(man);
	}
	const wasm = manifold();
	const r = Math.abs(offset);
	const segments = Math.max(12, Math.ceil(r * 8));
	const sphere = wasm.Manifold.sphere(r, segments);
	const result = offset > 0 ? man.minkowskiDifference(sphere) : man.minkowskiSum(sphere);
	sphere.delete();
	return result;
}

export function buildBlankManifoldSolid(
	modelId: string,
	faces: Array<DieFaceModel>,
	params: Record<string, number>,
	stringParams: Record<string, string>,
	exportGeometry: BufferGeometry,
	divisions?: number
): Manifold {
	const blank = getOrBuildBlankManifold(modelId, faces, params, stringParams, {
		source: 'export',
		exportGeometry,
		divisions
	});
	return cloneManifold(blank.manifold);
}

export function buildBlankManifoldExport(args: BuildBlankManifoldExportArgs): ManifoldDieExport {
	let man = buildBlankManifoldSolid(
		args.model.id,
		args.faces,
		args.params,
		args.stringParams ?? {},
		args.exportGeometry,
		args.divisions
	);
	const offset = args.offset ?? 0;
	if (offset !== 0) {
		const offsetMan = offsetBlankManifold(man, offset);
		man.delete();
		man = offsetMan;
	}
	return buildManifoldDieExport(man);
}

export function clearBlankCache(): void {
	for (const entry of blankCache.values()) {
		entry.manifold.delete();
	}
	blankCache.clear();
}

export function buildPlatformViaCrossSection(
	shape: Shape,
	{ height, inset, outset }: { height: number; inset: number; outset: number },
	divisions: number = DefaultDivisions
): BufferGeometry {
	const cs = shapeToCrossSection(shape, divisions);
	let topCs = cs;
	if (inset > 0) {
		const insetCs = cs.offset(-inset, 'Round');
		cs.delete();
		topCs = insetCs;
	}
	if (topCs.isEmpty()) {
		topCs.delete();
		return new BufferGeometry();
	}
	let baseCs = topCs;
	if (outset > 0) {
		baseCs = topCs.offset(outset, 'Round');
	}
	const tb = topCs.bounds();
	const bb = baseCs.bounds();
	const wx = tb.max[0] - tb.min[0];
	const wy = tb.max[1] - tb.min[1];
	const bx = bb.max[0] - bb.min[0];
	const by = bb.max[1] - bb.min[1];
	const sx = wx > 1e-6 && bx > 1e-6 ? bx / wx : 1;
	const sy = wy > 1e-6 && by > 1e-6 ? by / wy : 1;
	const solid = topCs.extrude(height, 0, 0, [sx, sy]);
	topCs.delete();
	if (baseCs !== topCs) {
		baseCs.delete();
	}
	const geo = manifoldToGeometry(solid);
	solid.delete();
	// CrossSection extrudes along +Z; the platform convention uses +Y up.
	geo.rotateX(-Math.PI / 2);
	return geo;
}

// True 2D polygon inset via Clipper (Manifold CrossSection.offset). Returns the
// largest resulting loop, or undefined when inset collapses the shape.
export function insetShapeViaCrossSection(
	shape: Shape,
	delta: number,
	divisions: number = DefaultDivisions
): Array<Vector2> | undefined {
	if (delta <= 0) {
		return shape.getPoints(divisions);
	}
	const cs = shapeToCrossSection(shape, divisions);
	const inset = cs.offset(-delta, 'Round');
	cs.delete();
	if (inset.isEmpty()) {
		inset.delete();
		return undefined;
	}
	const polys = inset.toPolygons();
	inset.delete();
	if (polys.length === 0 || polys[0].length < 3) {
		return undefined;
	}
	let best = polys[0];
	let bestArea = 0;
	for (const poly of polys) {
		let area = 0;
		for (let i = 0; i < poly.length; i++) {
			const a = poly[i];
			const b = poly[(i + 1) % poly.length];
			area += a[0] * b[1] - b[0] * a[1];
		}
		area = Math.abs(area);
		if (area > bestArea) {
			bestArea = area;
			best = poly;
		}
	}
	return best.map(([x, y]) => new Vector2(x, y));
}
