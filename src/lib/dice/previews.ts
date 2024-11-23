import {
  Color,
  Group,
  Mesh,
  MeshMatcapMaterial,
  MeshNormalMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from "three";
import type { DiceKind } from ".";
import { AllBlanks } from "../symbols/symbols";
import diceMap from ".";
import type { mx_bilerp_0 } from "three/src/nodes/materialx/lib/mx_noise.js";
import { Vector } from "three-csg-ts/lib/esm/Vector";

// cached preview images of the dice
const cache: Record<string, string> = {};

// preview sizes
const imageWidth = 256;
const imageHeight = 256;

// we will use a single renderer/camera/scene
const renderer = new WebGLRenderer({ alpha: true });
renderer.setSize(imageWidth, imageHeight);
const camera = new PerspectiveCamera(40, imageWidth / imageHeight, 1, 500);
camera.position.y = 10;
camera.position.z = 40;
camera.lookAt(new Vector3(0, 0, 0));
const scene = new Scene();
// const _m = new MeshMatcapMaterial({
//   color: 0x9999cc,
// });
const _m = new MeshNormalMaterial();
function createPreview(
  dice: Array<BufferGeometry>,
  rotation: [number, number] = [0, 0],
  scale: number = 1
): string {
  const obj = new Group();
  for (let face of dice) {
    obj.add(new Mesh(face, _m));
  }
  const [x, y] = rotation;
  if (x != 0) {
    obj.rotateX(x);
  }
  if (y != 0) {
    obj.rotateY(y);
  }
  if (scale != 1) {
    obj.scale.setScalar(scale);
  }
  scene.add(obj);
  renderer.render(scene, camera);
  // this is synchronous...
  const url = renderer.domElement.toDataURL();
  scene.remove(obj);
  for (let face of dice) {
    face.dispose();
  }
  return url;
}

export function getImagePreview(k: DiceKind): string {
  if (k in cache === false) {
    const d = diceMap[k];
    cache[k] = createPreview(
      d.factory(AllBlanks, {}).getFaces(),
      d.displayRotation,
      d.displayScale
    );
  }
  return cache[k];
}
