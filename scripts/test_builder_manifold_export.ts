import { toFlatPositions } from '$lib/utils/manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { Builder } from '$lib/utils/builder';
import dice from '$lib/dice';
import fonts from '$lib/fonts';

const legends = await fonts.voltaire.load();
const params = { polyhedron_size: 18, engraving_depth: 1, engraving_tolerance: 0.5 };
const builder = new Builder(dice.d6_cube, legends);
builder.useManifoldEngraving = true;
const mesh = builder.export(params, []);
const report = checkMesh(toFlatPositions(mesh.geometry));
console.log('builder manifold export', report);
mesh.geometry.dispose();
