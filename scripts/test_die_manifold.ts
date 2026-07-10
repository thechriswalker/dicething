import { manifoldToGeometry, toFlatPositions } from '$lib/utils/manifold';
import { buildBlankManifold, engraveDie } from '$lib/utils/die_manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Legend } from '$lib/utils/legends';

const legends = await fonts.voltaire.load();

for (const [id, params] of [
	['d6_cube', { polyhedron_size: 18 }],
	['d20_icosahedron', { polyhedron_size: 18 }],
	['d2_coin', { coin_diameter: 24, coin_thickness: 3, coin_segments: 24 }]
] as const) {
	const model = dice[id];
	const built = model.build(params);
	const blank = buildBlankManifold(built.faces);
	console.log(id, 'blank', blank.manifold.status(), 'faces', built.faces.length);
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
	blank.manifold.delete();
}
