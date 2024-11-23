import {
  AmbientLight,
  Scene,
  WebGLRenderer,
  Color,
  PerspectiveCamera,
  Vector2,
  Vector3,
  Raycaster,
  Mesh,
  Object3D,
  GridHelper,
  AxesHelper,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TrackballControls } from "three/examples/jsm/Addons.js";

const defaultCameraPosition = new Vector3(0, 50, 80);

export type DiceScene = {
  readonly camera: PerspectiveCamera;

  // passthru the scene add/remove functions
  // to be managed outside this object
  add(p: Object3D): void;
  remove(p: Object3D): void;

  // removes existing and replaces with
  // new parts, these parts are checked in the click handlers
  setDiceFaces(parts: Array<Mesh>): void;

  // add a handler for when a face is clicked.
  // this scene will take care of rendering the
  // highlights.
  onFaceClick(handler: (idx: number) => void): void;

  // make the camera look at a specific position.
  lookAt(v: Vector3): void;
  // move the camera to a specific point in space.
  moveCamera(v: Vector3): void;

  dispose(): void; // teardown
};

export function createScene(
  el: HTMLElement,
  initialCameraPosition: Vector3 = defaultCameraPosition
) {
  let disposed = false;

  const scene = new Scene();
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(el.clientWidth, el.clientHeight);
  el.appendChild(renderer.domElement);
  scene.background = new Color(0x444444);
  let camera = new PerspectiveCamera(
    70,
    el.clientWidth / el.clientHeight,
    1,
    500
  );
  camera.position.copy(initialCameraPosition);

  //const controls = new OrbitControls(camera, renderer.domElement);
  const controls = new TrackballControls(camera, renderer.domElement);
  controls.panSpeed = 10;
  controls.rotateSpeed = 10;

  const ambientLight = new AmbientLight(0x000000);
  scene.add(ambientLight);

  camera.lookAt(new Vector3(0, 0, 0));

  const mouse = new Vector2();
  const raycaster = new Raycaster();

  let clickHandler = (_: number) => {};
  const diceFaces: Array<Mesh> = [];

  let _clickTimer = 0;
  function mouseDown(ev: MouseEvent) {
    mouse.x = (ev.clientX / el.clientWidth) * 2 - 1;
    mouse.y = -1 * (ev.clientY / el.clientHeight) * 2 + 1;
    _clickTimer = Date.now();
  }
  function mouseUp(ev: MouseEvent) {
    const elapsed = Date.now() - _clickTimer;
    if (elapsed > 300) {
      // bail early, not a "click"
      return;
    }
    const x = (ev.clientX / el.clientWidth) * 2 - 1;
    const y = -1 * (ev.clientY / el.clientHeight) * 2 + 1;
    const dx = Math.abs(mouse.x - x);
    const dy = Math.abs(mouse.y - y);

    if (dx > 0.1 || dy > 0.1) {
      // ignore...
      return;
    }
    mouse.x = x;
    mouse.y = y;

    raycaster.setFromCamera(mouse, camera);
    // all dice faces
    let hitIndex = -1;
    diceFaces.forEach((s, i) => {
      const intersects = raycaster.intersectObject(s);
      if (intersects.length > 0) {
        hitIndex = i;
      }
    });
    if (hitIndex >= 0) {
      try {
        clickHandler(hitIndex);
      } catch (e) {
        console.error("error in clickHandler", e);
      }
    }
  }

  renderer.domElement.addEventListener("mousedown", mouseDown);
  renderer.domElement.addEventListener("mouseup", mouseUp);

  // grid, should be 10cm across

  const size = 100;
  const divisions = 10; // each division is 1cm

  const centerLineColor = 0xcccccc;
  const gridLineColor = 0x666666;
  const gridHelper = new GridHelper(
    size,
    divisions,
    centerLineColor,
    gridLineColor
  );
  scene.add(gridHelper);

  // axis
  const axis = new AxesHelper(5);
  // put it at the back left, just off the grid.
  axis.position.set(-51, 0, -51);
  scene.add(axis);

  function render() {
    if (disposed) {
      return;
    }
    requestAnimationFrame(render);

    // solid.rotation.x += 0.005;
    // solid.rotation.y += 0.005;
    controls.update();
    renderer.render(scene, camera);
  }

  const diceScene: DiceScene = {
    camera,
    add(p: Object3D) {
      scene.add(p);
    },
    remove(p: Object3D) {
      scene.remove(p);
    },
    setDiceFaces(parts) {
      diceFaces.forEach((p) => {
        scene.remove(p);
      });
      diceFaces.length = 0;
      diceFaces.push(...parts);
      diceFaces.forEach((p) => {
        scene.add(p);
      });
    },
    onFaceClick(handler) {
      clickHandler = handler;
    },
    lookAt(v) {
      camera.lookAt(v);
    },
    moveCamera(v) {
      camera.position.copy(v);
    },
    dispose() {
      // void.
      disposed = true;
      renderer.dispose();
      diceFaces.forEach((p) => {
        p.geometry.dispose();
      });
    },
  };

  el.addEventListener(
    "resize",
    function () {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientHeight, el.clientHeight);
    },
    false
  );

  render();

  return diceScene;
}
