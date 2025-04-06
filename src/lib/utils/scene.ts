import {
	AmbientLight,
	Color,
	GridHelper,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer
} from 'three';
import { TrackballControls}  from 'three/examples/jsm/controls/TrackballControls.js';

const defaultCameraPosition = new Vector3(0, 50, 80);

export function createBaseSceneAndRenderer(
	el: HTMLElement,
	initialCameraPosition: Vector3 = defaultCameraPosition
) {
	const scene = new Scene();
	const renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(el.clientWidth, el.clientHeight);
	el.appendChild(renderer.domElement);
	scene.background = new Color(0x444444);
	let camera = new PerspectiveCamera(70, el.clientWidth / el.clientHeight, 1, 500);
	camera.position.copy(initialCameraPosition);

	//const controls = new OrbitControls(camera, renderer.domElement);
	const controls = new TrackballControls(camera, renderer.domElement);
	controls.panSpeed = 10;
	controls.rotateSpeed = 10;

	const ambientLight = new AmbientLight(0x000000);
	scene.add(ambientLight);

	camera.lookAt(new Vector3(0, 0, 0));

	function adaptSize() {
		camera.aspect = el.clientWidth / el.clientHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(el.clientWidth, el.clientHeight);
	}

	el.addEventListener('resize', adaptSize, false);
	let disposed = false;
	const dispose = () => {
		disposed = true;
		el.removeEventListener('resize', adaptSize);
		renderer.dispose();
	};

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

	return {
		scene,
		dispose,
		camera,
		controls,
		renderer,
		render
	};
}

export function createGridHelper(divisions: number) {
	const size = divisions; // each division is 1cm

	const centerLineColor = 0xcccccc;
	const gridLineColor = 0x666666;
	const gridHelper = new GridHelper(size, divisions, centerLineColor, gridLineColor);
	return gridHelper;
}
