import { getManifold, geometryToManifold, manifold, manifoldToGeometry, toFlatPositions } from '$lib/utils/manifold';
import { buildBlankManifold, buildLegendCutter, engraveDie, engraveWithCutter } from '$lib/utils/die_manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { Builder } from '$lib/utils/builder';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Legend } from '$lib/utils/legends';

await getManifold();
const legends = await fonts.voltaire.load();

function exportBlankMesh(model: (typeof dice)[keyof typeof dice], params: Record<string, number>) {
	const built = model.build(params);
	const builder = new Builder(model, legends);
	return {
		built,
		mesh: builder.export(
			{ engraving_depth: 1, engraving_tolerance: 0.5 },
			built.faces.map(() => ({ legend: Legend.BLANK }))
		)
	};
}

function thickenShell(mesh: ReturnType<typeof exportBlankMesh>['mesh'], eps: number) {
	const wasm = manifold();
	const shell = geometryToManifold(mesh.geometry);
	const sphere = wasm.Manifold.sphere(eps);
	const solid = shell.minkowskiSum(sphere);
	shell.delete();
	sphere.delete();
	return solid;
}

for (const [id, params] of [
	['d6_cube', { polyhedron_size: 18 }],
	['d20_icosahedron', { polyhedron_size: 18 }],
	['d2_coin', { coin_diameter: 24, coin_thickness: 3, coin_segments: 24 }]
] as const) {
	const { built, mesh } = exportBlankMesh(dice[id], params);
	const solid = thickenShell(mesh, 0.05);
	console.log(id, 'thickened status', solid.status());
	const blank = { manifold: solid, faceIds: new Uint32Array(built.faces.length) };
	const engraved = engraveDie(blank, {
		faces: built.faces,
		legends,
		faceParams: built.faces.map((f, i) => ({
			legend: f.hidden ? Legend.BLANK : ((i % 20) + 1)
		})),
		depth: 1,
		tolerance: 0.5
	});
	const report = checkMesh(toFlatPositions(manifoldToGeometry(engraved)));
	console.log(id, report);
	engraved.delete();
	solid.delete();
}
