/**
 * Benchmark single-face engraving CSG strategies.
 *
 * A  difference(fullBlank, cutter)           — current engraveFace path
 * B  clone → trimByPlane (~T mm behind face) → difference — proposed preview path
 * C  difference(facePrism, cutter)           — extruded-face blank
 *
 * Usage:
 *   bun run vite-node scripts/benchmark_face_engrave_trim.ts
 *   bun run vite-node scripts/benchmark_face_engrave_trim.ts --kind d6_cube --iters 8 --trim 2
 *   bun run vite-node scripts/benchmark_face_engrave_trim.ts --blank export
 *   bun run vite-node scripts/benchmark_face_engrave_trim.ts --blank prism
 */
import { Vector3 } from 'three';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import {
	assembleBlankExportShellGeometry,
	buildBlankManifold,
	buildBlankManifoldFromGeometry,
	buildFaceVolume,
	buildLegendCutter,
	cutterOriginalId,
	engraveDie,
	extractFaceGeometry,
	faceOriginalId,
	type DieManifoldBlank
} from '$lib/utils/die_manifold';
import {
	cloneManifold,
	manifold,
	manifoldToGeometry,
	toFlatPositions,
	type Manifold
} from '$lib/utils/manifold';
import { DefaultDivisions, PreviewDivisions } from '$lib/utils/engraving';
import { findBestLegendScalingFactor } from '$lib/utils/shapes';
import { checkMesh } from '$lib/utils/mesh_check';
import type { DieFaceModel, DieModel } from '$lib/interfaces/dice';

type KindId = keyof typeof dice;

function arg(flag: string, fallback: string): string {
	const i = process.argv.indexOf(flag);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const KIND = arg('--kind', 'all') as KindId | 'all';
const ITERS = Math.max(1, Number(arg('--iters', '5')));
const TRIM_MM = Number(arg('--trim', '2'));
const BLANK = arg('--blank', 'both'); // export | prism | both
const WARMUP = 1;

const KINDS: Array<KindId> =
	KIND === 'all'
		? (['d6_cube', 'd60_pentagonal_hexecontahedron'] as Array<KindId>)
		: [KIND];

function stats(samples: Array<number>): { mean: number; med: number; min: number; max: number } {
	const sorted = [...samples].sort((a, b) => a - b);
	const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
	return { mean, med: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1)! };
}

function fmtMs(s: ReturnType<typeof stats>): string {
	return `${s.mean.toFixed(1)}ms mean  (med ${s.med.toFixed(1)}, ${s.min.toFixed(1)}–${s.max.toFixed(1)})`;
}

function uniqueIds(man: Manifold): Array<number> {
	const mesh = man.getMesh();
	const ids = mesh.runOriginalID;
	if (!ids?.length) {
		return [];
	}
	return [...new Set(ids)];
}

function hasId(ids: Array<number>, id: number): boolean {
	return ids.includes(id);
}

function extractSummary(
	man: Manifold,
	face: DieFaceModel,
	faceIndex: number,
	depth: number
): { parts: Array<string>; tris: Record<string, number> } {
	const geos = extractFaceGeometry(man, face, faceIndex, depth);
	const tris: Record<string, number> = {};
	const parts: Array<string> = [];
	for (const g of geos) {
		const part = String(g.userData.diceThingPart ?? 'unknown');
		parts.push(part);
		const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
		tris[part] = n;
		g.dispose();
	}
	return { parts, tris };
}

function trimBlankToFaceShell(blank: Manifold, face: DieFaceModel, thicknessMm: number): Manifold {
	const onFace = face.transform.applyToVector3(new Vector3(0, 0, 0));
	const outward = face.transform
		.applyToVector3(new Vector3(0, 0, 1))
		.sub(onFace)
		.normalize();
	const originOffset = outward.dot(onFace) - thicknessMm;
	const cloned = cloneManifold(blank);
	const trimmed = cloned.trimByPlane([outward.x, outward.y, outward.z], originOffset);
	cloned.delete();
	return trimmed;
}

function defaultParams(model: DieModel): Record<string, number> {
	if (model.id === 'd2_coin') {
		return { coin_diameter: 24, coin_thickness: 3, coin_segments: 24 };
	}
	const size = model.parameters.find((p) => p.id === 'polyhedron_size');
	return {
		polyhedron_size: size?.defaultValue ?? 18,
		engraving_depth: 1,
		engraving_bevel: 0,
		engraving_tolerance: 0.5
	};
}

async function benchKind(kind: KindId) {
	const model = dice[kind];
	if (!model) {
		throw new Error(`unknown kind ${kind}`);
	}
	const legends = await fonts.voltaire.load();
	const params = defaultParams(model);
	const built = model.build(params);
	const faceIndex = built.faces.findIndex((f) => !f.hidden);
	if (faceIndex < 0) {
		throw new Error(`${kind}: no visible faces`);
	}
	const face = built.faces[faceIndex];
	const legend = face.defaultLegend;
	const symbols = legends.get(legend);
	const depth = params.engraving_depth;
	const scale = findBestLegendScalingFactor(face.shape, symbols, params.engraving_tolerance, face.convex !== false);
	const orientation = { scale };
	const divisions = PreviewDivisions;
	const wasm = manifold();
	const faceId = faceOriginalId(faceIndex);
	const cutId = cutterOriginalId(faceIndex);

	console.log(`\n=== ${kind}  face ${faceIndex}  legend ${legend}  scale ${scale.toFixed(3)}  trim ${TRIM_MM}mm ===`);

	const cutterSamples: Array<number> = [];
	for (let i = 0; i < WARMUP + ITERS; i++) {
		const t0 = performance.now();
		const cutter = buildLegendCutter(symbols, orientation, depth, face, faceIndex, divisions, 0);
		const dt = performance.now() - t0;
		if (!cutter) {
			throw new Error('failed to build cutter');
		}
		if (i >= WARMUP) {
			cutterSamples.push(dt);
		}
		if (i === WARMUP) {
			console.log(`cutter: ${cutter.numTri()} tris`);
		}
		cutter.delete();
	}
	console.log(`cutter build:                 ${fmtMs(stats(cutterSamples))}`);

	const timeFn = (fn: () => Manifold): Array<number> => {
		const samples: Array<number> = [];
		for (let i = 0; i < WARMUP + ITERS; i++) {
			const t0 = performance.now();
			const man = fn();
			const dt = performance.now() - t0;
			if (i >= WARMUP) {
				samples.push(dt);
			}
			man.delete();
		}
		return samples;
	};

	const makeCutter = () =>
		buildLegendCutter(symbols, orientation, depth, face, faceIndex, divisions, 0)!;

	const inspect = (label: string, man: Manifold) => {
		const ids = uniqueIds(man);
		const extract = extractSummary(man, face, faceIndex, depth);
		const report = checkMesh(toFlatPositions(manifoldToGeometry(man)));
		console.log(
			`${label}: ${man.numTri()} tris  status=${man.status()}  ` +
				`faceId=${hasId(ids, faceId)}  cutterId=${hasId(ids, cutId)}  ` +
				`runs=${ids.length}`
		);
		console.log(
			`         extract parts=[${extract.parts.join(', ')}]  tris=${JSON.stringify(extract.tris)}`
		);
		console.log(
			`         mesh_check watertight=${report.isWatertight} manifold=${report.isManifold} ` +
				`degen=${report.degenerateTriangleCount} boundary=${report.boundaryEdgeCount}`
		);
	};

	const runOnBlank = (blankLabel: string, blank: DieManifoldBlank) => {
		console.log(
			`\n-- ${blankLabel} blank: ${blank.manifold.numTri()} tris, ${uniqueIds(blank.manifold).length} original-id runs`
		);

		const samplesA = timeFn(() => {
			const cutter = makeCutter();
			const result = wasm.Manifold.difference(blank.manifold, cutter);
			cutter.delete();
			return result;
		});
		const samplesTrim = timeFn(() => trimBlankToFaceShell(blank.manifold, face, TRIM_MM));
		const samplesB = timeFn(() => {
			const trimmed = trimBlankToFaceShell(blank.manifold, face, TRIM_MM);
			const cutter = makeCutter();
			const result = wasm.Manifold.difference(trimmed, cutter);
			trimmed.delete();
			cutter.delete();
			return result;
		});
		const prism = buildFaceVolume(face, faceIndex, divisions);
		const samplesC = timeFn(() => {
			const cutter = makeCutter();
			const result = wasm.Manifold.difference(prism, cutter);
			cutter.delete();
			return result;
		});

		console.log(`A  full blank difference:     ${fmtMs(stats(samplesA))}`);
		console.log(`   trimByPlane only:          ${fmtMs(stats(samplesTrim))}`);
		console.log(`B  trim + difference:         ${fmtMs(stats(samplesB))}`);
		console.log(`C  face prism difference:     ${fmtMs(stats(samplesC))}`);

		{
			const cutter = makeCutter();
			const a = wasm.Manifold.difference(blank.manifold, cutter);
			cutter.delete();
			inspect('A result', a);
			a.delete();
		}
		{
			const trimmed = trimBlankToFaceShell(blank.manifold, face, TRIM_MM);
			console.log(`B trim: ${trimmed.numTri()} tris  faceId=${hasId(uniqueIds(trimmed), faceId)}`);
			const cutter = makeCutter();
			const b = wasm.Manifold.difference(trimmed, cutter);
			trimmed.delete();
			cutter.delete();
			inspect('B result', b);
			b.delete();
		}
		{
			const cutter = makeCutter();
			const c = wasm.Manifold.difference(prism, cutter);
			cutter.delete();
			inspect('C result', c);
			c.delete();
		}
		prism.delete();
	};

	if (BLANK === 'export' || BLANK === 'both') {
		const t0 = performance.now();
		const shell = assembleBlankExportShellGeometry(built.faces, DefaultDivisions);
		const blank = buildBlankManifoldFromGeometry(shell, built.faces, DefaultDivisions);
		shell.dispose();
		console.log(`export-shell blank build:     ${(performance.now() - t0).toFixed(1)}ms`);
		runOnBlank('export-shell', blank);
		blank.manifold.delete();
	}

	if (BLANK === 'prism' || BLANK === 'both') {
		const t0 = performance.now();
		const blank = buildBlankManifold(built.faces, DefaultDivisions);
		console.log(`prism-union blank build:      ${(performance.now() - t0).toFixed(1)}ms`);
		runOnBlank('prism-union', blank);
		blank.manifold.delete();
	}

	const faceParams = built.faces.map((f) => {
		if (f.hidden) {
			return { legend: f.defaultLegend };
		}
		const s = findBestLegendScalingFactor(
			f.shape,
			legends.get(f.defaultLegend),
			params.engraving_tolerance,
			f.convex !== false
		);
		return { legend: f.defaultLegend, scale: s };
	});
	const shell = assembleBlankExportShellGeometry(built.faces, DefaultDivisions);
	const exportBlank = buildBlankManifoldFromGeometry(shell, built.faces, DefaultDivisions);
	shell.dispose();
	const samplesDie: Array<number> = [];
	for (let i = 0; i < WARMUP + Math.min(ITERS, 3); i++) {
		const t0 = performance.now();
		const engraved = engraveDie(exportBlank, {
			faces: built.faces,
			legends,
			faceParams,
			depth,
			bevel: 0,
			tolerance: params.engraving_tolerance,
			divisions
		});
		const dt = performance.now() - t0;
		if (i >= WARMUP) {
			samplesDie.push(dt);
		}
		engraved.delete();
	}
	console.log(`\nengraveDie (all faces, export blank): ${fmtMs(stats(samplesDie))}`);
	exportBlank.manifold.delete();
}

for (const kind of KINDS) {
	await benchKind(kind);
}
