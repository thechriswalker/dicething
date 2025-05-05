import { polyhedron, type PolyhedronFace, type Shaper } from '$lib/utils/polyhedra';
import { Shape, Vector2, Vector3 } from 'three';

const yAxis = new Vector3(0, 1, 0);
const rAxis = new Vector3(1, 0, 1).normalize();
const lAxis = new Vector3(-1, 0, 1).normalize();

const rhombic_shape: Shaper = (d) => {
	// l is the length of the 2 matching sides of the isoceles
	const l = d / (2 * Math.cos(Math.PI / 4));
	// this is the base
	const b = d * Math.sin(Math.PI / 4);
	// the rhombi in the d12 have long length = root-2 * short length
	// which means the height of each triangle is half that.
	const h = (Math.SQRT2 * b) / 2;

	const rhombus_vertices: Vector2[] = [
		new Vector2(0, l / 2),
		new Vector2(h, 0),
		new Vector2(0, -l / 2),
		new Vector2(-h, 0)
	];

	return new Shape(rhombus_vertices);
};
const rhombic_faces: Array<PolyhedronFace> = [
	{ axis: [], angle: 0 }, //face 1
	{ axis: [lAxis, yAxis], angle: [Math.PI / 2, Math.PI], preRotation: Math.PI }, // face 2
	{ axis: [rAxis, yAxis], angle: [-Math.PI / 2, -Math.PI / 2] }, //face 3
	{ axis: [lAxis, yAxis], angle: [Math.PI / 2, Math.PI / 2] }, //face 4
	{ axis: yAxis, angle: -Math.PI / 2 }, //face 5
	{ axis: [rAxis, yAxis], angle: [-Math.PI / 2, -Math.PI] }, // face 6
	{ axis: rAxis, angle: -Math.PI / 2 }, // face 7
	{ axis: yAxis, angle: Math.PI / 2 }, // face 8
	{ axis: lAxis, angle: -Math.PI / 2, preRotation: Math.PI }, // face 9
	{ axis: rAxis, angle: Math.PI / 2, preRotation: Math.PI }, // face 10
	{ axis: lAxis, angle: Math.PI / 2 }, //face 11
	{ axis: yAxis, angle: Math.PI } // face 12
];
export const RhombicD12 = polyhedron('rhombic_d12', 'D12 Rhombic', rhombic_faces, rhombic_shape);
