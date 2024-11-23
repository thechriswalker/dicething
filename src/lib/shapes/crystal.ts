import { ConeGeometry, Mesh, MeshBasicMaterial } from "three";
import type { IBlank } from "../model/iface";
import { CSG } from "three-csg-ts";

const pi = Math.PI;
const _m = new MeshBasicMaterial();

export type CrystalOptions = {
  N: number; // number of sides
  CapHeight?: number;
  MainHeight?: number;
  Radius?: number;
  Twist?: number;
};

// a crystal is 2 uneven pyramids conjoined
// the numbers are on the "bottom" faces.
// very similar to the trapezohedron in geometry
export function crystal(opts: CrystalOptions): IBlank {
  const N = opts.N;
  const R = opts.Radius ?? 1;
  const Hc = opts.CapHeight ?? R / 4;
  const Hm = opts.MainHeight ?? (R * 3) / 2;
  const Rot = opts.Twist ?? 0;
  // I am going to make both pyramids at full height overlapping on a common z axis.
  // then we will intersect them.
  // this is easy because of the ConeGeometry
  /*
  ConeGeometry(
    radius : Float, 
    height : Float, 
    radialSegments : Integer, 
    heightSegments : Integer, 
    openEnded : Boolean, 
    thetaStart : Float, 
    thetaLength : Float
  )
  */

  // we want to make the height of each double,
  // but we want the "mid-radius" to be R
  // so we must work out the new final radius.
  // remember the the ratio of height/radius is constant
  // so Hc / R = (Hm + Hc) / R'
  // solve for R'
  //  R' = (Hm + Hc) * R / Hc

  const cap = new ConeGeometry(
    ((Hm + Hc) * R) / Hc,
    Hm + Hc,
    N,
    1, // heightSegments - we only want a single triangle
    true, // open end
    0, // start the top one at zero
    2 * pi
  );

  // same for main
  const main = new ConeGeometry(
    ((Hm + Hc) * R) / Hm,
    Hm + Hc,
    N,
    1, // heightSegments - we only want a single triangle
    true, // open end
    Rot, // start the bottom one offset zero
    2 * pi
  );
  // flip it upside down
  main.rotateZ(pi);

  const a = new Mesh(cap, _m);
  const b = new Mesh(main, _m);
  // now intersect
  a.updateMatrix();
  b.updateMatrix();

  const { geometry } = CSG.intersect(a, b);

  // I now have the geometry for the combined shape, but I want all the faces
  // each Face is actually 2 triangles.
  // once I have them I can assign positions to them and draw the symbols.
  // now I want to be able to find all "faces" that make a given face on the die.
  // basically this is a mapping between logical faces and physical faces.
  // each logical face is made by >=1 physical face depending on the shape.
  // an Icosahedron has pentagonal logical faces, made of 3 triangles.
  // let's see if I can make a good interface for this.
  // for our kites, we have 2 triangles, but I  don't know their order.
  // I will do sopme investigation.
  // on my kite, the top faces, are indexes [0,1], [2,3], ... to [2*n-2,2*n-1].
  // then the bottom faces are: [2*n, 2*n+1], ... 4n-1, 4n-2
  // const faces = new FaceMapping(
  //   new Map<number, Array<number>>(
  //     Array.from({ length: 2 * N }).map((_, i) => {
  //       // face i, is index 2*i and 2*i+1;
  //       return [i, [2 * i, 2 * i + 1]];
  //     })
  //   )
  // );

  const isDipyramid = Math.abs(Rot / (pi / N)) <= Number.EPSILON;
  const isAntiDipyramid = Math.abs(Rot / (pi / N) - 1) <= Number.EPSILON;
  const isUneven = Hc != Hm;
  return {
    name: getName(N, isDipyramid, isAntiDipyramid, isUneven),
    geometry,
    faceIndices(faceIndex) {
      // for an "unEven" one, we want the bottom faces to be 0-n,
      // if (isUneven) {
      //   if (faceIndex < N) {
      //     faceIndex += N;
      //   } else {
      //     faceIndex -= N;
      //   }
      // }

      // if rotation mod pi/n == 0 then we have a dipyramid
      if (isDipyramid) {
        // we have a dipyramid, and there is only one triangle per face!
        return [faceIndex];
      } else {
        // some twisted anti-dipyramid and we have two triangles per face.
        return [2 * faceIndex, 2 * faceIndex + 1];
      }
    },
  };
}

function getName(
  n: number,
  isDipyramid: boolean,
  isAntiDipyramid: boolean,
  isUneven: boolean
): string {
  const options = (
    ifDi: string,
    ifAnti: string,
    ifTwisted: string = "Twisted " + ifAnti
  ) => {
    const prefix = isUneven ? "Uneven " : "";
    if (isDipyramid) {
      return prefix + ifDi;
    }
    if (isAntiDipyramid) {
      return prefix + ifAnti;
    }
    return prefix + ifTwisted;
  };

  switch (n) {
    case 3: // cuboid
      return options("Trigonal Dipyramid", "Rhombohedron");
    case 4: // d8
      return options("Square Dipyramid", "Tetragonal Trapezohedron");
    case 5: // d10/d100
      return options("Pentagonal Dipyramid", "Pentagonal Trapezohedron");
    case 6: // jewel d12
      return options("Hexagonal Dipyramid", "Hexagonal Trapezohedron");
    default:
      return options(`${n}-gonal Dipyramid`, `${n}-gonal Trapezohedron`);
  }
}
