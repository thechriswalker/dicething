// Diagnostic: does the SIZE/ORIENTATION a glyph is engraved at change whether
// the resulting solid is manifold? Each die scales the legend to fit its face,
// so "the face shape" really means "the scale (and rotation) the glyph is
// triangulated at". This sweeps a single glyph through a range of scales and
// rotations on a fixed square surface, runs the exact export pipeline
// (mergeVertices -> removeDuplicateTriangles -> repairDegenerateTriangles) and
// reports the structural check for each, plus the open:non-manifold edge ratio.
//
// Run: bun run vite-node scripts/engrave_scale_sweep.ts

import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Shape, Vector2 } from 'three';
import { engrave } from '../src/lib/utils/engraving';
import { centerShapes } from '../src/lib/utils/shapes';
import { removeDuplicateTriangles, repairDegenerateTriangles } from '../src/lib/utils/bad_edges';
import { toNonIndexed } from '../src/lib/utils/3d';
import { checkMesh } from '../src/lib/utils/mesh_check';
import { shapeFromJSON } from '../src/lib/utils/to_json';
import tektur from '../src/lib/fonts/generated/tektur.json';
import alice from '../src/lib/fonts/generated/alice_in_wonderland.json';
import averia from '../src/lib/fonts/generated/averia.json';
import germania from '../src/lib/fonts/generated/germania_one.json';
import josefin from '../src/lib/fonts/generated/josefin_medium.json';
import siamese from '../src/lib/fonts/generated/siamese_katsong.json';
import voltaire from '../src/lib/fonts/generated/voltaire.json';

const H = 20;
function squareSurface(): Shape {
	return new Shape([
		new Vector2(-H, -H),
		new Vector2(H, -H),
		new Vector2(H, H),
		new Vector2(-H, H)
	]);
}

function loadGlyph(font: any, index: number): Shape[] {
	const shapes = font.shapes[index].map((s: any) => shapeFromJSON(s)) as Shape[];
	return centerShapes(...shapes);
}

// the export pipeline, minus the per-die transforms (we engrave at origin).
function exportLikePipeline(symbols: Shape[], scale: number, rotation: number) {
	const parts = engrave(squareSurface(), symbols, { scale, rotation }, 1, 0.5, 24);
	const prepared = parts
		// drop the "symbol doesn't fit" overlay part; it isn't part of the solid.
		.filter((g) => g.userData?.diceThingPart !== 'symbol')
		.map((g) => {
			const ng = toNonIndexed(g);
			ng.computeVertexNormals();
			delete ng.attributes.uv;
			return ng;
		});
	if (prepared.length === 0) {
		return undefined;
	}
	const combined = mergeGeometries(prepared);
	const merged = mergeVertices(combined);
	const deduped = removeDuplicateTriangles(merged);
	const repaired = repairDegenerateTriangles(deduped);
	return checkMesh(repaired.getAttribute('position').array, { collectBad: true });
}

const fonts: Array<[string, any]> = [
	['tektur', tektur],
	['alice_in_wonderland', alice],
	['averia', averia],
	['germania_one', germania],
	['josefin_medium', josefin],
	['siamese_katsong', siamese],
	['voltaire', voltaire]
];

// The standalone square cap has 4 perimeter edges that are legitimately open
// here (a real die shares them with the neighbouring face). Subtract them so the
// numbers describe the *engraving* defect only.
const PERIMETER_OPEN = 4;

// silence the very chatty engrave logs.
const origLog = console.log;
console.log = () => {};

type Fail = {
	font: string;
	glyph: number;
	scale: number;
	rotation: number;
	open: number;
	nonManifold: number;
	degenerate: number;
};
const failures: Array<Fail> = [];
let tested = 0;

const scales: number[] = [];
for (let s = 0.15; s <= 1.5; s += 0.05) {
	scales.push(Number(s.toFixed(2)));
}
const rotations = [0, Math.PI / 4];

for (const [name, font] of fonts) {
	origLog(`scanning ${name} ...`);
	for (let g = 0; g < font.shapes.length; g++) {
		if (!font.shapes[g] || font.shapes[g].length === 0) {
			continue;
		}
		const base = loadGlyph(font, g);
		for (const rotation of rotations) {
			for (const scale of scales) {
				let report;
				try {
					report = exportLikePipeline(
						base.map((s) => s.clone()),
						scale,
						rotation
					);
				} catch {
					continue;
				}
				if (!report) {
					continue;
				}
				tested++;
				const realOpen = report.boundaryEdgeCount - PERIMETER_OPEN;
				// a "real" engraving defect: anything beyond the square perimeter.
				if (realOpen > 0 || report.nonManifoldEdgeCount > 0 || report.degenerateTriangleCount > 0) {
					failures.push({
						font: name,
						glyph: g,
						scale,
						rotation: Number(rotation.toFixed(3)),
						open: realOpen,
						nonManifold: report.nonManifoldEdgeCount,
						degenerate: report.degenerateTriangleCount
					});
				}
			}
		}
	}
}

console.log = origLog;

console.log(`tested ${tested} engravings; ${failures.length} failed`);
// summarise the open:non-manifold ratio across failures.
const ratios = new Map<string, number>();
for (const f of failures) {
	const r = `open=${f.open} nonManifold=${f.nonManifold} degenerate=${f.degenerate}`;
	ratios.set(r, (ratios.get(r) ?? 0) + 1);
}
console.log('\nfailure signatures (count):');
for (const [r, c] of [...ratios.entries()].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${c.toString().padStart(4)}  ${r}`);
}
console.log('\nfirst 25 failures:');
for (const f of failures.slice(0, 25)) {
	console.log(
		`  ${f.font}[${f.glyph}] scale=${f.scale} rot=${f.rotation}  open=${f.open} nonManifold=${f.nonManifold} degenerate=${f.degenerate}`
	);
}

// For a representative glyph that has the 1:2 signature, show how manifoldness
// flips as the scale changes by tiny amounts -- the crux of "the face shape
// matters" (each die fits the glyph to its face, i.e. picks a scale).
const sample = failures.find((f) => f.nonManifold > 0) ?? failures[0];
if (sample) {
	console.log(
		`\nfine scale sweep for ${sample.font}[${sample.glyph}] rot=${sample.rotation} (defect counts, perimeter removed):`
	);
	const base = loadGlyph(fonts.find(([n]) => n === sample.font)![1], sample.glyph);
	console.log = () => {};
	const line: string[] = [];
	for (let s = 0.3; s <= 1.2; s += 0.02) {
		const r = exportLikePipeline(
			base.map((x) => x.clone()),
			Number(s.toFixed(2)),
			sample.rotation
		);
		const open = (r?.boundaryEdgeCount ?? PERIMETER_OPEN) - PERIMETER_OPEN;
		const nm = r?.nonManifoldEdgeCount ?? 0;
		const ok = open <= 0 && nm === 0 && (r?.degenerateTriangleCount ?? 0) === 0;
		line.push(`${s.toFixed(2)}:${ok ? 'OK' : `o${open}n${nm}`}`);
	}
	console.log = origLog;
	console.log('  ' + line.join('  '));
}
