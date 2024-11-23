// this is constructed from square pyramids arranged with their
// bases together to form a cube.
// the height of the pyramids is the the same as the half the length of the cube size.
// so the "width" of this model is 2x the cube length.

import { ConeGeometry, MeshBasicMaterial } from "three";
import type { IBlank } from "../model/iface";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const sqrtHalf = Math.SQRT1_2;
const _m = new MeshBasicMaterial();

export function rhombicDodecahedron(cubeSize: number): IBlank {
  // six square pyramids
  const cones = Array.from({ length: 6 }).map((_, idx) => {
    const cone = new ConeGeometry(
      sqrtHalf * cubeSize,
      cubeSize / 2,
      4,
      1,
      true,
      Math.PI / 4
    );
    // it will be centered by default and pointing up
    // so we move it up so the tip (currently cubesize/4)
    // is at cubesize*2
    cone.center();
    cone.translate(0, cubeSize - cubeSize / 4, 0);
    switch (idx) {
      case 0:
        // leave it. this can be the top.
        break;
      case 1:
        // rotate 180 - the bottom
        cone.rotateX(Math.PI);
        break;
      case 2:
        // move around the X axis a quarter - front (or back)
        cone.rotateX(Math.PI / 2);
        break;
      case 3:
        // move around the X axis a quarter the other way - back (or front)
        cone.rotateX(-Math.PI / 2);
        break;
      case 4:
        // move around the Z axis to get this to the left (or right)
        cone.rotateZ(Math.PI / 2);
        break;
      case 5:
        // move around the Z axis to get this to the right (or left)
        cone.rotateZ(-Math.PI / 2);
        break;
    }
    return cone;
  });

  return {
    geometry: mergeGeometries(cones, false),
    name: "Rhombic Dodecahedron",
    faceIndices(faceIndex) {
      // these are more complex, so I just list them...
      return faces[faceIndex];
    },
  };
}

// done by visual inspection of the geometry
const faces = [
  [0, 22], // 1
  [1, 15],
  [2, 16],
  [3, 9], // 4

  [4, 20],
  [5, 11],
  [6, 18],
  [7, 13],

  [8, 23],
  [10, 19],
  [12, 21],
  [14, 17],
];
