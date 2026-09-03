import { polyhedron, type PolyhedronFace, type Shaper } from '$lib/utils/polyhedra';
import { Shape, Vector2, Vector3 } from 'three';

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

// Face placements in a convenient geographic order: face 0 opposite face 11,
// then two belts. Numbering 1..12 in *this* order is the historic "dicething"
// layout (1 surrounded by evens, 12 by odds). Standard numbering is Bosch
// (below), which keeps the same 1/12 poles and reshuffles the belts.
const dodecahedron_faces_geographic: Array<PolyhedronFace> = [
	{ axis: xAxis, angle: 0 }, // pole (+z)
	{
		preRotation: -innerAngle / 2,
		axis: new Vector3(top, -1, 0).normalize(),
		angle: -face2faceAngle
	},
	{
		axis: new Vector3(-1, bot, 0).normalize(),
		angle: Math.PI - face2faceAngle,
		preRotation: (innerAngle * 3) / 2
	},
	{
		axis: xAxis,
		angle: face2faceAngle,
		preRotation: Math.PI
	},
	{
		axis: new Vector3(-1, -bot, 0).normalize(),
		angle: Math.PI - face2faceAngle,
		preRotation: -(innerAngle * 3) / 2
	},
	{
		axis: new Vector3(-top, -1).normalize(),
		angle: face2faceAngle,
		preRotation: innerAngle / 2
	},
	{
		axis: new Vector3(-top, -1).normalize(),
		angle: Math.PI + face2faceAngle,
		preRotation: innerAngle / 2
	},
	{
		axis: new Vector3(-1, -bot, 0).normalize(),
		angle: -face2faceAngle,
		preRotation: -(innerAngle * 3) / 2
	},
	{
		axis: xAxis,
		angle: Math.PI + face2faceAngle,
		preRotation: Math.PI
	},
	{
		axis: new Vector3(-1, bot, 0).normalize(),
		angle: -face2faceAngle,
		preRotation: (innerAngle * 3) / 2
	},
	{
		preRotation: -innerAngle / 2,
		axis: new Vector3(top, -1, 0).normalize(),
		angle: Math.PI - face2faceAngle
	},
	{
		axis: xAxis,
		angle: Math.PI
	} // pole (-z)
];

// Bosch / OptiDice standard: opposite faces sum to 13, and 2,6,3,4,5 run
// around 12 (Robert Bosch). Same layout the d12 skew uses via numbering_orders.
// Index i here is the explode/standard face for value i+1; the value is a
// geographic-order index.
const BOSCH_FROM_GEOGRAPHIC = [0, 2, 10, 4, 8, 6, 5, 3, 7, 1, 9, 11];
const dodecahedron_faces: Array<PolyhedronFace> = BOSCH_FROM_GEOGRAPHIC.map(
	(i) => dodecahedron_faces_geographic[i]
);

export const DodecahedronD12 = polyhedron(
	'd12_dodecahedron',
	'D12 Dodecahedron',
	dodecahedron_faces,
	dodecahedron_shape
);
