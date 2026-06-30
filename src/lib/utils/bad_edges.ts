// we should loop through all the triangles to see if we can detect the problems.

import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Vector3,
	Group,
	type TypedArray
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toNonIndexed } from './3d';

// each triangle edge should be connected to EXACTLY 2 triangles.
type Triangle = {
	id: string;
	instances: number;
	points: Array<number>; // slice of the position array (length 9)
};
type TriangleWithEdges = Triangle & {
	edges: [Edge, Edge, Edge];
};
type Edge = {
	id: string;
	triangles: Array<Triangle>;
};

const debug = true;
const log = debug ? console.log : (...a: any) => {};

const badMat = new MeshBasicMaterial({ side: DoubleSide, color: 0xff0000 });

function sortV3(a: Vector3, b: Vector3): number {
	let x = a.x - b.x;
	if (x === 0) {
		x = a.y - b.y;
		if (x === 0) {
			x = a.z - b.z;
		}
	}
	return x;
}

function id(...vectors: Array<Vector3>): string {
	return vectors
		.sort(sortV3)
		.map((v) => [v.x.toFixed(6), v.y.toFixed(6), v.z.toFixed(6)].join(','))
		.join(':');
}

export function findAllBadTriangles(...obj: Array<Object3D>) {
	const vertices: Array<number> = [];
	// face geometry is built at the origin and positioned via its Group's transform,
	// so we must bake each mesh's accumulated transform in before comparing vertices.
	function recur(o: Object3D, parentMatrix: Matrix4) {
		o.updateMatrix();
		const worldMatrix = parentMatrix.clone().multiply(o.matrix);
		if ((o as Group).isGroup) {
			o.children.forEach((c) => recur(c, worldMatrix));
			return;
		}
		if ((o as Mesh).isMesh) {
			let g = (o as Mesh).geometry;
			if (g.index !== null) {
				g = toNonIndexed(g);
			} else {
				g = g.clone();
			}
			g.applyMatrix4(worldMatrix);
			vertices.push(...g.attributes.position.array);
			return;
		}
		// some other kind of object.
		log('unknown Object3D:', o.type);
	}
	obj.forEach((o) => recur(o, new Matrix4().identity()));
	// now we have a big list of vertices, we should run "mergeVertices" on it as
	// we do that in the export step.
	let buf = new BufferGeometry();
	buf.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
	buf = mergeVertices(buf);
	buf = toNonIndexed(buf);
	buf = removeDuplicateTriangles(buf);

	return findBadTriangles(buf.attributes.position.array);
}

function findBadTriangles(pos: TypedArray): Mesh | null {
	const tris = new Map<string, TriangleWithEdges>();
	const edges = new Map<string, Edge>();
	function createEdges(...vectors: [Vector3, Vector3, Vector3]): [Edge, Edge, Edge] {
		// for each pair.
		return [
			createOrRetrieveEdge(vectors[0], vectors[1]),
			createOrRetrieveEdge(vectors[1], vectors[2]),
			createOrRetrieveEdge(vectors[2], vectors[0])
		];
	}
	function createOrRetrieveEdge(a: Vector3, b: Vector3): Edge {
		const eid = id(a, b);
		let e = edges.get(eid);
		if (!e) {
			e = { id: eid, triangles: [] };
			edges.set(eid, e);
		}
		return e;
	}

	// iterate over vertices and triangles.
	// each triangle is 9 vertices.
	const v0 = new Vector3();
	const v1 = new Vector3();
	const v2 = new Vector3();
	for (let i = 0; i < pos.length; i += 9) {
		v0.set(pos[i], pos[i + 1], pos[i + 2]);
		v1.set(pos[i + 3], pos[i + 4], pos[i + 5]);
		v2.set(pos[i + 6], pos[i + 7], pos[i + 8]);
		// I don't care about orientation, so we sort the points x->y->z
		const triangleId = id(v0, v1, v2);
		let t = tris.get(triangleId);
		if (!t) {
			t = {
				id: triangleId,
				points: [...pos.slice(i, i + 9)],
				edges: createEdges(v0, v1, v2),
				instances: 1
			};
			tris.set(triangleId, t);
		} else {
			t.instances++;
			log('duplicate triangle');
		}
		t.edges[0].triangles.push(t);
		t.edges[1].triangles.push(t);
		t.edges[2].triangles.push(t);
	}

	// now we iterate all edges an find the "naked" or "non-manifold"
	// edges.
	// and we will push those triangles into a set, so we can create a geometry out of them.
	const badTriangles = new Set<Triangle>();
	let badEdgeCount = 0;
	edges.forEach((edge) => {
		if (edge.triangles.length !== 2) {
			log('bad edge [%s] %s triangles', edge.id, edge.triangles.length);
			edge.triangles.forEach((t) => badTriangles.add(t));
			badEdgeCount++;
		}
	});
	log('bad edges: ', badEdgeCount);
	log('bad triangles: ', badTriangles.size);
	log(
		'duplicates',
		[...tris.values()].reduce((p, c) => p + c.instances, 0)
	);

	if (badTriangles.size === 0) {
		return null;
	}

	const badTrianglePositions: Array<number> = [];
	badTriangles.forEach((t) => {
		badTrianglePositions.push(...t.points);
	});
	const badTriangleGeometry = new BufferGeometry();
	badTriangleGeometry.setAttribute(
		'position',
		new BufferAttribute(new Float32Array(badTrianglePositions), 3)
	);
	badTriangleGeometry.computeVertexNormals();
	return new Mesh(badTriangleGeometry, badMat);
}

export function removeDuplicateTriangles(g: BufferGeometry): BufferGeometry {
	g = toNonIndexed(g);

	// we don't care about order, so simply iterate and remove.
	const tris = new Map<string, Triangle>();
	const pos = g.getAttribute('position').array;
	// iterate over vertices and triangles.
	// each triangle is 9 vertices.
	const v0 = new Vector3();
	const v1 = new Vector3();
	const v2 = new Vector3();
	for (let i = 0; i < pos.length; i += 9) {
		v0.set(pos[i], pos[i + 1], pos[i + 2]);
		v1.set(pos[i + 3], pos[i + 4], pos[i + 5]);
		v2.set(pos[i + 6], pos[i + 7], pos[i + 8]);
		// I don't care about orientation, so we sort the points x->y->z
		const triangleId = id(v0, v1, v2);
		let t = tris.get(triangleId);
		if (!t) {
			t = {
				id: triangleId,
				points: [...pos.slice(i, i + 9)],
				instances: 1
			};
			tris.set(triangleId, t);
		} else {
			t.instances++;
		}
	}
	const array = new Float32Array(tris.size * 9);
	[...tris.values()].forEach((t, i) => {
		array.set(t.points, i * 9);
	});
	const buf = new BufferGeometry();
	buf.setAttribute('position', new BufferAttribute(array, 3));
	buf.computeVertexNormals();
	return buf;
}

// A vertex with its quantised key, used by the T-junction repair below.
type KeyedVertex = { x: number; y: number; z: number; key: string };

// Remove truly-degenerate triangles while keeping the mesh closed.
//
// Two kinds of bad triangle can reach here:
//
//  1. Coincident-corner triangles (two vertices weld to the same point, i.e. a
//     zero-length edge). These are genuinely degenerate and just dropped.
//
//  2. Thin "slivers": three DISTINCT vertices but near-collinear (perpendicular
//     height below the weld tolerance). These are NOT automatically degenerate -
//     a sliver whose three edges are each shared with exactly one other triangle
//     is a load-bearing part of the closed surface (mesh_check.ts treats such
//     3-distinct-vertex slivers as sound for exactly this reason). Dropping a
//     BALANCED sliver orphans its three edges and tears the mesh open - the bug
//     that left "1 boundary + 2 non-manifold" edges per face on dice like the
//     tetartoid / trapezohedra. So a balanced sliver is KEPT.
//
//     Only an UNbalanced sliver (some edge not shared by exactly two triangles)
//     signals a real T-junction: libtess emitted it because a neighbour carries
//     the whole long edge while the sliver's middle vertex M sits on it. There
//     we drop the sliver and record M, then split every triangle that has M on
//     one of its edges (T -> two proper triangles) to close the gap.
//
// Edge balance is measured BEFORE anything is dropped, over every non-coincident
// triangle (the slivers included), so a sliver's own edges are counted.
export function repairDegenerateTriangles(g: BufferGeometry, tolerance = 1e-4): BufferGeometry {
	g = toNonIndexed(g);

	const pos = g.getAttribute('position').array;
	const invTol = 1 / tolerance;
	const keyOf = (x: number, y: number, z: number) =>
		`${Math.round(x * invTol)},${Math.round(y * invTol)},${Math.round(z * invTol)}`;
	const vAt = (i: number): KeyedVertex => {
		const x = pos[i],
			y = pos[i + 1],
			z = pos[i + 2];
		return { x, y, z, key: keyOf(x, y, z) };
	};
	const dist = (a: KeyedVertex, b: KeyedVertex) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	// twice the triangle area (magnitude of the edge cross product).
	const doubleArea = (a: KeyedVertex, b: KeyedVertex, c: KeyedVertex) => {
		const ux = b.x - a.x,
			uy = b.y - a.y,
			uz = b.z - a.z;
		const vx = c.x - a.x,
			vy = c.y - a.y,
			vz = c.z - a.z;
		const cx = uy * vz - uz * vy;
		const cy = uz * vx - ux * vz;
		const cz = ux * vy - uy * vx;
		return Math.hypot(cx, cy, cz);
	};
	const edgeKey = (a: KeyedVertex, b: KeyedVertex) =>
		a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;

	type Tri = [KeyedVertex, KeyedVertex, KeyedVertex];
	type Candidate = {
		tri: Tri;
		thin: boolean;
		mid: KeyedVertex | null;
		edges: [string, string, string];
	};
	const candidates: Array<Candidate> = [];
	const edgeCount = new Map<string, number>();

	// First pass: drop coincident-corner triangles outright; for everything else,
	// classify thin vs good and tally edge usage so balance can be judged next.
	for (let i = 0; i < pos.length; i += 9) {
		const a = vAt(i),
			b = vAt(i + 3),
			c = vAt(i + 6);
		const distinct = a.key !== b.key && b.key !== c.key && a.key !== c.key;
		if (!distinct) {
			continue; // coincident corner -> zero-length edge -> truly degenerate
		}
		// A sliver is judged by its HEIGHT (perpendicular distance of the off-vertex
		// to the longest edge), not absolute area: area scales with edge length, so
		// a fixed area epsilon flips above/below threshold with the die's position
		// in the export grid. The middle vertex (opposite the longest edge) is the
		// one that would sit on a neighbour's edge in a T-junction.
		const ab = dist(a, b),
			bc = dist(b, c),
			ca = dist(c, a);
		const longest = Math.max(ab, bc, ca);
		const height = longest > 0 ? doubleArea(a, b, c) / longest : 0;
		const thin = height <= tolerance;
		const mid = thin ? (longest === ab ? c : longest === bc ? a : b) : null;
		const edges: [string, string, string] = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
		for (const e of edges) {
			edgeCount.set(e, (edgeCount.get(e) ?? 0) + 1);
		}
		candidates.push({ tri: [a, b, c], thin, mid, edges });
	}

	// Second pass: keep good triangles and BALANCED slivers; drop UNbalanced
	// slivers, recording their middle vertex as a T-junction to heal.
	const good: Array<Tri> = [];
	const junctions = new Map<string, KeyedVertex>();
	for (const cand of candidates) {
		if (cand.thin && cand.mid) {
			const balanced = cand.edges.every((e) => edgeCount.get(e) === 2);
			if (!balanced) {
				if (!junctions.has(cand.mid.key)) {
					junctions.set(cand.mid.key, cand.mid);
				}
				continue;
			}
		}
		good.push(cand.tri);
	}

	const tPoints = [...junctions.values()];
	const out: Array<number> = [];
	const emit = (a: KeyedVertex, b: KeyedVertex, c: KeyedVertex) => {
		out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
	};

	// true when m lies strictly between p and q (within tolerance of the segment).
	const onSegment = (p: KeyedVertex, q: KeyedVertex, m: KeyedVertex): boolean => {
		if (m.key === p.key || m.key === q.key) {
			return false;
		}
		const pqx = q.x - p.x,
			pqy = q.y - p.y,
			pqz = q.z - p.z;
		const pq2 = pqx * pqx + pqy * pqy + pqz * pqz;
		if (pq2 <= 0) {
			return false;
		}
		const t = ((m.x - p.x) * pqx + (m.y - p.y) * pqy + (m.z - p.z) * pqz) / pq2;
		if (t <= 1e-4 || t >= 1 - 1e-4) {
			return false;
		}
		const dx = m.x - (p.x + pqx * t);
		const dy = m.y - (p.y + pqy * t);
		const dz = m.z - (p.z + pqz * t);
		return Math.hypot(dx, dy, dz) <= tolerance;
	};

	// split a triangle at any junction points lying on its edges, recursing into
	// the two halves (so an edge carrying several junctions is fully resolved).
	const split = (a: KeyedVertex, b: KeyedVertex, c: KeyedVertex, pts: Array<KeyedVertex>) => {
		if (pts.length > 0) {
			const edges: Array<[KeyedVertex, KeyedVertex, KeyedVertex]> = [
				[a, b, c],
				[b, c, a],
				[c, a, b]
			];
			for (const [p, q, opp] of edges) {
				const idx = pts.findIndex((m) => onSegment(p, q, m));
				if (idx >= 0) {
					const m = pts[idx];
					const rest = pts.filter((_, k) => k !== idx);
					split(p, m, opp, rest);
					split(m, q, opp, rest);
					return;
				}
			}
		}
		emit(a, b, c);
	};

	for (const [a, b, c] of good) {
		if (tPoints.length === 0) {
			emit(a, b, c);
		} else {
			split(a, b, c, tPoints);
		}
	}

	const buf = new BufferGeometry();
	buf.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
	buf.computeVertexNormals();
	return buf;
}
