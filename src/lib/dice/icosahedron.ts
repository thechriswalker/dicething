import { polyhedron, type PolyhedronFace, type Shaper } from "$lib/utils/polyhedra";
import { Shape, Vector2, Vector3 } from "three";

// golden ratio
const phi = (1 + Math.sqrt(5)) / 2;
const origin = new Vector2(0,0);

// the insphere radius is phi^2 * edge / (2 * sqrt(3)) ~= 0.756*edge length.
// so the edge length compared to the diameter is:
const insphereDiameterRatio = Math.sqrt(3) / (phi * phi);

const equilateralTriangleHeightRatio = Math.sqrt(3)/2
const equilateralTrianglerVertexSpacing = Math.PI * 2/3

const d20_shape: Shaper = d => {
    const l = insphereDiameterRatio * d;
    //height of triangle is then.
    const h = l * equilateralTriangleHeightRatio;

    const vertices = [new Vector2(0, 2*h/3)] // center is 1/3 h
    vertices.push(vertices[0].clone().rotateAround(origin, equilateralTrianglerVertexSpacing))
    vertices.push(vertices[1].clone().rotateAround(origin, equilateralTrianglerVertexSpacing))

    return new Shape(vertices);
}

const xAxis = new Vector3(1,0,0)
const yAxis = new Vector3(0,1,0)


const rAxis = new Vector3(1, -Math.tan(Math.PI / 3),0).normalize();
const lAxis = new Vector3(-1, -Math.tan(Math.PI/3), 0).normalize();

const innerAngle = Math.PI - Math.acos(-Math.sqrt(5)/3);

// these are a bit more complex, but to keep it "easy" I allowed compounding of the angles we already know...
const d20_faces: Array<PolyhedronFace> = [
    { 
        // face 1
        axis: xAxis, angle: 0
    },
    { 
        // face 2
        axis: rAxis, angle: Math.PI-innerAngle, preRotation: Math.PI*5/3
    },
    { 
        // face 3
        axis: [rAxis, xAxis], angle: [-innerAngle, -innerAngle]
    },
    { 
        // face 4

        axis: [lAxis, xAxis], angle: [innerAngle,  Math.PI-innerAngle]    },
    { 
        // face 5
        axis: [xAxis, rAxis], angle: [innerAngle, innerAngle], preRotation: Math.PI*2/3
    },
    { 
        // face 6
        axis: [lAxis, rAxis], angle: [innerAngle, Math.PI + innerAngle], preRotation: Math.PI*8/3
    },
    { 
        // face 7
        axis: lAxis, angle: innerAngle, preRotation: Math.PI/3
    },
    { 
        // face 8
        axis: xAxis, angle: Math.PI + innerAngle, preRotation: Math.PI
    },
    { 
        // face 9
      axis: [rAxis, lAxis], angle: [-innerAngle, -innerAngle], preRotation: Math.PI*4/3
    },
    { 
        // face 10
        axis: [xAxis, lAxis], angle: [innerAngle, Math.PI-innerAngle], preRotation: Math.PI*4/3
    },
    { 
        // face 11
        axis: [xAxis, lAxis], angle: [innerAngle, -innerAngle], preRotation: Math.PI*4/3
    },
    { 
        // face 12
        axis: [rAxis, lAxis], angle: [-innerAngle, Math.PI-innerAngle], preRotation: Math.PI*4/3
    },
    { 
        // face 13
        axis: xAxis, angle: innerAngle, preRotation: Math.PI
    },
    { 
        // face 14
        axis: lAxis, angle: Math.PI+ innerAngle, preRotation: Math.PI/3    },
    { 
        // face 15
        axis: [lAxis, rAxis], angle: [innerAngle, innerAngle], preRotation: Math.PI*8/3
    },
    { 
        // face 16
        axis: [xAxis, rAxis], angle: [innerAngle, Math.PI+innerAngle], preRotation: Math.PI*2/3
    },
    { 
        // face 17
        axis: [lAxis, xAxis], angle: [innerAngle,  -innerAngle]
    },
    { 
        // face 18
        axis: [rAxis, xAxis], angle: [-innerAngle, Math.PI-innerAngle]
    },
    { 
        // face 19
        axis: rAxis, angle: -innerAngle, preRotation: Math.PI*5/3
    },
    { 
        // face 20
        axis: xAxis, angle: Math.PI
    },
];

export const IcosahedronD20 = polyhedron('icosahedron_d20', 'D20 Icosahedron', d20_faces, d20_shape);