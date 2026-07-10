import { geometryToManifold, manifoldToGeometry, toFlatPositions } from '$lib/utils/manifold';
import { buildLegendCutter, engraveWithCutter } from '$lib/utils/die_manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { Builder } from '$lib/utils/builder';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Legend } from '$lib/utils/legends';

const legends = await fonts.voltaire.load();
const model = dice.d20_icosahedron;
const built = model.build({ polyhedron_size: 18 });
const builder = new Builder(model, legends);
const mesh = builder.export(
	{ engraving_depth: 1, engraving_tolerance: 0.5 },
	built.faces.map(() => ({ legend: Legend.BLANK }))
);
const blank = geometryToManifold(mesh.geometry);
console.log('shell blank status', blank.status());
const cutter = buildLegendCutter(
	legends.get(Legend.ONE),
	{ scale: 1 },
	1,
	built.faces[0],
	0
)!;
const result = engraveWithCutter(blank, cutter);
const report = checkMesh(toFlatPositions(manifoldToGeometry(result)));
console.log('shell engrave one face', report);
result.delete();
