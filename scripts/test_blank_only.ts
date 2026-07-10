import { manifoldToGeometry, toFlatPositions } from '$lib/utils/manifold';
import { buildBlankManifold } from '$lib/utils/die_manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import dice from '$lib/dice';

for (const id of ['d6_cube', 'd20_icosahedron', 'd2_coin'] as const) {
	const model = dice[id];
	const params =
		id === 'd2_coin'
			? { coin_diameter: 24, coin_thickness: 3, coin_segments: 24 }
			: { polyhedron_size: 18 };
	const built = model.build(params);
	const blank = buildBlankManifold(built.faces);
	let man = blank.manifold;
	const cleaned = man.asOriginal();
	man.delete();
	const report = checkMesh(toFlatPositions(manifoldToGeometry(cleaned)));
	console.log(id, 'blank only', report);
	cleaned.delete();
}
