// we should loop through all the triangles to see if we can detect the problems.

import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Vector3,
	Group,
	type TypedArray
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
	function recur(o: Object3D) {
		if ((o as Group).isGroup) {
			o.children.map(recur);
			return;
		}
		if ((o as Mesh).isMesh) {
			let g = (o as Mesh).geometry;
			if (g.index !== null) {
				g = g.toNonIndexed();
			}
			vertices.push(...g.attributes.position.array);
			return;
		}
		// some other kind of object.
		log('unknown Object3D:', o.type);
	}
	obj.forEach(recur);
	// now we have a big list of vertices, we should run "mergeVertices" on it as
	// we do that in the export step.
	let buf = new BufferGeometry();
	buf.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
	buf = mergeVertices(buf);
	buf = buf.toNonIndexed();
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
	if (g.index) {
		g = g.toNonIndexed();
	}
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
