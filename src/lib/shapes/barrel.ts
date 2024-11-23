// barrels are like an n-sgement cylinder with a pyramid cap on each end.
// the pyramids can be twisted wrt the faces of the cylinder.

import { ConeGeometry, CylinderGeometry, Mesh, MeshBasicMaterial } from "three";
import type { IBlank } from "../model/iface";
import { CSG } from "three-csg-ts";

const pi = Math.PI;
const _m = new MeshBasicMaterial();

export type BarrelOptions = {
  N: number; // number of sides.
  Radius?: number; // width
  MainHeight?: number; // height of main cylinder
  CapHeight?: number; // height of caps
  Twist?: number; // rotation of caps WRT cylinder
};

export function barrel(opts: BarrelOptions): IBlank {
  const N = opts.N;
  const R = opts.Radius ?? 1;
  const Hc = opts.CapHeight ?? R / 6;
  const Hm = opts.MainHeight ?? (R * 3) / 2;
  const Rot = opts.Twist ?? 0;

  // make 2 matching pyramids for the tops.
  // We will make them double height, so we get the overlap and
  // it makes them easier to position correctly.

  const topCap = new ConeGeometry(
    2 * R,
    2 * Hc,
    N,
    1, // heightSegments - we only want a single triangle
    true, // open end
    Rot, // rotate the caps
    2 * pi
  );

  const botCap = new ConeGeometry(
    2 * R,
    2 * Hc,
    N,
    1, // heightSegments - we only want a single triangle
    true, // open end
    Rot, // rotate the caps
    2 * pi
  );
  botCap.rotateZ(pi);
  // now translate them so they are centered at +/- Hm/2
  topCap.center();
  topCap.translate(0, Hm / 2, 0);

  botCap.center();
  botCap.translate(0, -Hm / 2, 0);

  // now add the cylinder, which we will make full height, as it will crop
  // in the intersection
  const body = new CylinderGeometry(
    R, // top radius
    R, // bottom radius = top
    Hm + 2 * Hc, // full height
    N, // segments = our faces
    1,
    true, //open
    0,
    2 * pi
  );
  body.center();

  const a = new Mesh(topCap, _m);
  const b = new Mesh(botCap, _m);
  const c = new Mesh(body, _m);
  const { geometry } = CSG.intersect(c, CSG.intersect(b, a));

  const isTwisted = Rot !== 0;

  let name = `${N}-Sided Uniform Prism with ${
    isTwisted ? "Twisted " : ""
  }Pyramidal Caps`;

  // face indices depend on the rotation.
  // if 0
  // each "face" is 4 triangles.
  // 0,1,2,3
  // 4,5,6,7
  // etc.
  // 4n, 4n+1, 4n+2, 4n+3
  // then the N tops and N bottoms
  // are single triangles.
  // bottom (24-29)
  // 4*N, ... 4*N+n
  // top (30-35)
  // 5*N, 5*N + n

  // if twisted:
  // six on each side face
  // two on each cap face
  let faceIndices: (faceIndex: number) => Array<number>;
  if (isTwisted) {
    faceIndices = (faceIndex) => {
      if (faceIndex < N) {
        // the _actual_ faces
        const n6 = faceIndex * 6;
        return [n6, n6 + 1, n6 + 2, n6 + 3, n6 + 4, n6 + 5];
      }
      // else top/botom
      faceIndex -= N;
      const n6 = N * 6;
      const f2 = faceIndex * 2;
      return [n6 + f2, n6 + f2 + 1];
    };
  } else {
    faceIndices = (faceIndex) => {
      if (faceIndex < N) {
        // the _actual_ faces
        const n4 = faceIndex * 4;
        return [n4, n4 + 1, n4 + 2, n4 + 3];
      }
      // else top/bottom are just 1 triangle
      faceIndex -= N;
      return [4 * N + faceIndex];
    };
  }

  return {
    name,
    geometry,
    faceIndices,
  };
}
