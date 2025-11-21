import { polyhedron, type PolyhedronFace, type Shaper } from '$lib/utils/polyhedra';
import { Shape, Vector2, Vector3 } from 'three';

const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);

// these faces should be in "legend" order.
// i.e. index 0 => 1 face, index 1 => 2 face
const cube_faces: Array<PolyhedronFace> = [
	{ axis: xAxis, angle: 0 },
	{ axis: xAxis, angle: Math.PI / 2 },
	{ axis: [yAxis, zAxis], angle: [-Math.PI / 2, -Math.PI / 2] },
	{ axis: [yAxis, zAxis], angle: [Math.PI / 2, Math.PI / 2] },
	{ axis: [xAxis, zAxis], angle: [-Math.PI / 2, Math.PI] },
	{ axis: [yAxis, zAxis], angle: [Math.PI, Math.PI] }
];
const cube_shape: Shaper = (d) => {
	// cube is easy. faces are sized by face to face distance...
	const x = d / 2;
	return new Shape([
		new Vector2(-x, x),
		new Vector2(x, x),
		new Vector2(x, -x),
		new Vector2(-x, -x)
	]);
};

export const CubeD6 = polyhedron('cube_d6', 'D6 Cube', cube_faces, cube_shape);
