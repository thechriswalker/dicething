// Focused anatomy of a single "open=1 nonManifold=2" engraving defect.
// Engraves one builtin glyph at a scale known to fail, then reports the
// structural check after EACH pipeline stage, and dumps the offending edge
// coordinates so we can see where (and why) the surface cracks.
//
// Run: bun run vite-node scripts/engrave_defect_anatomy.ts

import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Shape, Vector2, type BufferGeometry } from 'three';
import { engrave } from '../src/lib/utils/engraving';
import { centerShapes } from '../src/lib/utils/shapes';
import { removeDuplicateTriangles, repairDegenerateTriangles } from '../src/lib/utils/bad_edges';
import { toNonIndexed } from '../src/lib/utils/3d';
import { checkMesh } from '../src/lib/utils/mesh_check';
import { shapeFromJSON } from '../src/lib/utils/to_json';
import alice from '../src/lib/fonts/generated/alice_in_wonderland.json';

const FONT = alice as any;
const GLYPH = 86;
const SCALE = 0.66;
const ROT = Math.PI / 4;
const DEPTH = 1;

const H = 20;
function squareSurface(): Shape {
	return new Shape([
		new Vector2(-H, -H),
		new Vector2(H, -H),
		new Vector2(H, H),
		new Vector2(-H, H)
	]);
}
function onPerimeter(x: number, y: number): boolean {
	const e = 1e-3;
	return Math.abs(Math.abs(x) - H) < e || Math.abs(Math.abs(y) - H) < e;
}

const origLog = console.log;
console.log = () => {};
const base = (FONT.shapes[GLYPH] as any[]).map((s) => shapeFromJSON(s)) as Shape[];
const symbols = centerShapes(...base);
const parts = engrave(
	squareSurface(),
	symbols,
	{ scale: SCALE, rotation: ROT },
	DEPTH,
	0.5,
	24
).filter((g) => g.userData?.diceThingPart !== 'symbol');
const prepared = parts.map((g) => {
	const ng = toNonIndexed(g);
	ng.computeVertexNormals();
	delete ng.attributes.uv;
	return ng;
});
const combined = mergeGeometries(prepared);
const merged = mergeVertices(combined);
const deduped = removeDuplicateTriangles(merged);
const repaired = repairDegenerateTriangles(deduped);
console.log = origLog;

function summary(geo: BufferGeometry, label: string) {
	const r = checkMesh(geo.getAttribute('position').array, { collectBad: true });
	const be = r.badEdgePositions ?? new Float32Array(0);
	// classify problem edges: ignore the square perimeter.
	let perim = 0;
	const real: Array<[number, number, number, number, number, number]> = [];
	for (let i = 0; i < be.length; i += 6) {
		const a = [be[i], be[i + 1], be[i + 2]] as const;
		const b = [be[i + 3], be[i + 4], be[i + 5]] as const;
		if (onPerimeter(a[0], a[1]) && onPerimeter(b[0], b[1])) {
			perim++;
		} else {
			real.push([be[i], be[i + 1], be[i + 2], be[i + 3], be[i + 4], be[i + 5]]);
		}
	}
	console.log(
		`\n[${label}] tris=${r.triangleCount} open=${r.boundaryEdgeCount} (perimeter=${perim}, real=${real.length}) nonManifold=${r.nonManifoldEdgeCount} degenerate=${r.degenerateTriangleCount}`
	);
	return real;
}

summary(merged, 'after mergeVertices');
summary(deduped, 'after removeDuplicateTriangles');
const realEdges = summary(repaired, 'after repairDegenerateTriangles (final)');

const f = (n: number) => n.toFixed(4).padStart(9);
console.log('\nreal (non-perimeter) problem edges in final mesh:');
for (const e of realEdges) {
	console.log(
		`  (${f(e[0])},${f(e[1])},${f(e[2])}) -> (${f(e[3])},${f(e[4])},${f(e[5])})  z: ${e[2].toFixed(3)}..${e[5].toFixed(3)}`
	);
}

// For the final mesh, list how many triangles use each real problem edge, and
// the third corner of each, so we can see the T-junction shape.
const pos = toNonIndexed(repaired).getAttribute('position').array;
const q = (n: number) => Math.round(n * 1e4);
const ek = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
	const ka = `${q(ax)},${q(ay)},${q(az)}`;
	const kb = `${q(bx)},${q(by)},${q(bz)}`;
	return ka < kb ? ka + '|' + kb : kb + '|' + ka;
};
const targets = new Set(realEdges.map((e) => ek(e[0], e[1], e[2], e[3], e[4], e[5])));
console.log('\ntriangles touching each real problem edge:');
const hits = new Map<string, Array<number[]>>();
for (let i = 0; i < pos.length; i += 9) {
	const tri = [
		[pos[i], pos[i + 1], pos[i + 2]],
		[pos[i + 3], pos[i + 4], pos[i + 5]],
		[pos[i + 6], pos[i + 7], pos[i + 8]]
	];
	const eds = [
		[tri[0], tri[1]],
		[tri[1], tri[2]],
		[tri[2], tri[0]]
	];
	for (const [a, b] of eds) {
		const k = ek(a[0], a[1], a[2], b[0], b[1], b[2]);
		if (targets.has(k)) {
			if (!hits.has(k)) hits.set(k, []);
			hits.get(k)!.push(tri.flat());
		}
	}
}
for (const [k, tris] of hits) {
	console.log(`  edge ${k}: used by ${tris.length} triangle(s)`);
	for (const t of tris) {
		console.log(`     tri z=[${t[2].toFixed(3)},${t[5].toFixed(3)},${t[8].toFixed(3)}]`);
	}
}
