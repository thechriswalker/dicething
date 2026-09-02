import fonts from '$lib/fonts';
import dice from '$lib/dice';
import { shapesToCrossSection, buildLegendCutter, engraveWithCutter, buildBlankManifoldFromGeometry } from '$lib/utils/die_manifold';
import { Builder } from '$lib/utils/builder';
import { Legend } from '$lib/utils/legends';
import { findBestLegendScalingFactor, scaleShapes } from '$lib/utils/shapes';
import { checkMesh } from '$lib/utils/mesh_check';
import { cloneManifold, manifoldToGeometry, toFlatPositions } from '$lib/utils/manifold';

async function test(label: string, legend: number) {
	const legends = await fonts.voltaire.load();
	const params = { polyhedron_size: 18, engraving_depth: 1, engraving_bevel: 0.2, engraving_tolerance: 0.5 };
	const built = dice.d6_cube.build(params);
	const face = built.faces[0];
	const scale = findBestLegendScalingFactor(face.shape, legends.get(legend), 0.5, true);
	const symbols = legends.get(legend);
	const builder = new Builder(dice.d6_cube, legends);
	const blankMesh = builder.export(params, built.faces.map(() => ({ legend: Legend.BLANK })));
	const blank = buildBlankManifoldFromGeometry(blankMesh.geometry, built.faces);
	const cutter = buildLegendCutter(symbols, { scale }, 1, face, 0, 12, 0.2)!;
	const engraved = engraveWithCutter(cloneManifold(blank.manifold), cutter);
	const report = checkMesh(toFlatPositions(manifoldToGeometry(engraved)));
	console.log(label, 'printable', report.isPrintable, 'degen', report.degenerateTriangleCount, 'tris', engraved.getMesh().numTri);
	engraved.delete();
	blank.manifold.delete();
	cutter.delete();
}

// compare slice vs extrude approaches inline
import { manifold, deleteAll } from '$lib/utils/manifold';

const legends = await fonts.voltaire.load();
const built = dice.d6_cube.build({ polyhedron_size: 18 });
const face = built.faces[0];
const scale = findBestLegendScalingFactor(face.shape, legends.get(0), 0.5, true);
const cs = shapesToCrossSection(scaleShapes(scale, ...legends.get(0)), 12)!;
const bevel = 0.2;
const inset = cs.offset(-bevel, 'Square');
const fb = cs.bounds();
const ib = inset.bounds();
const sx = (fb.max[0] - fb.min[0]) / (ib.max[0] - ib.min[0]);
const sy = (fb.max[1] - fb.min[1]) / (ib.max[1] - ib.min[1]);
const smooth = inset.extrude(bevel, 8, 0, [sx, sy]).translate([0, 0, -1]);
const topSlice = smooth.slice(-0.8);
console.log('smooth top contours', topSlice.toPolygons().length, 'full', cs.toPolygons().length);
deleteAll(smooth, topSlice, cs, inset);

await test('zero', 0);
await test('pip', 1);
