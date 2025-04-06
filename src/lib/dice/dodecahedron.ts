import { polyhedron, type PolyhedronFace, type Shaper } from "$lib/utils/polyhedra";
import { Shape, Vector2, Vector3 } from "three";

const xAxis = new Vector3(1, 0, 0);


// we will need the golden ratio for the dodecahedron
const phi = (1 + Math.sqrt(5)) / 2;

// the face to face distance is the diameter of the "inscribed" sphere (which is tangent to each face)
// this relates to the edge length of the pentagon as follows;
const edgeDiameterRatio = Math.sqrt(3 - phi) / (phi * phi); // ~1.114
// so the edge length = edgeDiameterRatio * d

// and the "circumradius" of the pentagon with edge length 1 is:
const edgeToCircumRadius = Math.sqrt((5 + Math.sqrt(5)) / 10); // ~0.8507

const origin = new Vector2(0, 0);

const innerAngle = (Math.PI * 2) / 5; // 72 degrees
const dodecahedron_shape: Shaper = (d) => {
	const edge = edgeDiameterRatio * d;
	const r = edgeToCircumRadius * edge;

	// now we have 5 equally spaced points
	const vertices = [new Vector2(0, r)]; //start with the top.
	for (let i = 1; i < 5; i++) {
		// add the other points.
		vertices.push(vertices[i - 1].clone().rotateAround(origin, innerAngle));
	}
	return new Shape(vertices);
};

const face2faceAngle = Math.PI - 2 * Math.atan(phi);

// ratio from vertical to the top 2 edges
const top = Math.tan((Math.PI * 3) / 10);
// ratio from horizontal to the bottom 2 edges
const bot = Math.tan(innerAngle);

const dodecahedron_faces: Array<PolyhedronFace> = [
	{ axis: xAxis, angle: 0 }, // 1 face: point that forwards.
	{
		// face 2
		preRotation: -innerAngle / 2,
		axis: new Vector3(top, -1, 0).normalize(),
		angle: -face2faceAngle
	},
	{
		// face 3
		axis: new Vector3(-1, bot, 0).normalize(),
		angle: Math.PI - face2faceAngle,
		preRotation: (innerAngle * 3) / 2
	},
	{
		// face 4
		axis: xAxis,
		angle: face2faceAngle,
		preRotation: Math.PI
	},
	{
		// face 5
		axis: new Vector3(-1, -bot, 0).normalize(),
		angle: Math.PI - face2faceAngle,
		preRotation: -(innerAngle * 3) / 2
	},

	{
		//face 6
		axis: new Vector3(-top, -1).normalize(),
		angle: face2faceAngle,
		preRotation: innerAngle / 2
	},
	{
		// face 7
		axis: new Vector3(-top, -1).normalize(),
		angle: Math.PI + face2faceAngle,
		preRotation: innerAngle / 2
	},
	{
		// face 8
		axis: new Vector3(-1, -bot, 0).normalize(),
		angle: -face2faceAngle,
		preRotation: -(innerAngle * 3) / 2
	},
	{
		//face 9
		axis: xAxis,
		angle: Math.PI + face2faceAngle,
		preRotation: Math.PI
	},
	{
		// face 10
		axis: new Vector3(-1, bot, 0).normalize(),
		angle: -face2faceAngle,
		preRotation: (innerAngle * 3) / 2
	},
	{
		//face 11
		preRotation: -innerAngle / 2,
		axis: new Vector3(top, -1, 0).normalize(),
		angle: Math.PI - face2faceAngle
	},
	{
		//face 12
		axis: xAxis,
		angle: Math.PI
	}
];
export const DodecahedronD12 = polyhedron(
	'dodecahedron_d12',
	'D12 Dodecahedron',
	dodecahedron_faces,
	dodecahedron_shape
);