import { getManifold, geometryToManifold, manifold, manifoldToGeometry, toFlatPositions } from '$lib/utils/manifold';
import { buildLegendCutter, engraveDie, canEngraveLegend } from '$lib/utils/die_manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { Builder } from '$lib/utils/builder';
import { findBestLegendScalingFactor } from '$lib/utils/shapes';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Legend } from '$lib/utils/legends';

await getManifold();
const legends = await fonts.voltaire.load();
const model = dice.d20_icosahedron;
const params = { polyhedron_size: 18, engraving_depth: 1, engraving_tolerance: 0.5 };
const built = model.build(params);
const builder = new Builder(model, legends);
const mesh = builder.export(params, built.faces.map(() => ({ legend: Legend.BLANK })));
const shell = geometryToManifold(mesh.geometry);
const sphere = manifold().Manifold.sphere(0.05);
const solid = shell.minkowskiSum(sphere);
shell.delete();
sphere.delete();
console.log('solid tris', solid.getMesh().numTri);

const faceParams = built.faces.map((f, i) => {
	const legend = (i + 1) as Legend;
	const scale = findBestLegendScalingFactor(f.shape, legends.get(legend), 0.5, f.convex !== false);
	const ok = canEngraveLegend(f.shape, legends.get(legend), { scale }, 0.5, f.convex !== false);
	console.log('face', i, 'legend', legend, 'scale', scale, 'ok', ok);
	return { legend, scale };
});

const blank = { manifold: solid, faceIds: new Uint32Array(20) };
const engraved = engraveDie(blank, {
	faces: built.faces,
	legends,
	faceParams,
	depth: 1,
	tolerance: 0.5
});
console.log('engraved tris', engraved.getMesh().numTri);
const report = checkMesh(toFlatPositions(manifoldToGeometry(engraved)));
console.log(report);
engraved.delete();
solid.delete();
