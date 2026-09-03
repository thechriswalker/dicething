/**
 * Time Builder.build() the way the editor worker does: full d60, then a
 * no-op rebuild, then a single-face offset edit.
 *
 *   bun run vite-node scripts/benchmark_builder_build.ts
 */
import { Vector2 } from 'three';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Builder } from '$lib/utils/builder';
import type { FaceParams } from '$lib/interfaces/dice';

const kind = (process.argv[2] as keyof typeof dice) || 'd60_pentagonal_hexecontahedron';
const model = dice[kind];
const legends = await fonts.voltaire.load();
const size = model.parameters.find((p) => p.id === 'polyhedron_size')?.defaultValue ?? 18;
const dieParams = {
	polyhedron_size: size,
	engraving_depth: 0.8,
	engraving_bevel: 0,
	engraving_tolerance: 0.5
};

const built = model.build(dieParams);
const faceParams: Array<FaceParams> = built.faces.map(() => ({}));

const builder = new Builder(model, legends, 'bench');

const time = (label: string, fn: () => void) => {
	const t0 = performance.now();
	fn();
	console.log(
		`\n=== ${label}: ${(performance.now() - t0).toFixed(1)}ms ===`,
		builder.lastBuildInfo
	);
};

time('1 first build (all faces, forceRerenderFaces)', () => {
	builder.build(dieParams, faceParams, { explode: false });
});

time('2 identical rebuild (should skip faces)', () => {
	builder.build(dieParams, faceParams, { explode: false });
});

const edited = faceParams.map((p, i) => (i === 0 ? { ...p, offset: new Vector2(0.2, 0) } : { ...p }));
time('3 one-face offset edit', () => {
	builder.build(dieParams, edited, { explode: false });
});

time('4 second one-face offset edit', () => {
	edited[0] = { ...edited[0], offset: new Vector2(0.4, 0) };
	builder.build(dieParams, edited, { explode: false });
});
