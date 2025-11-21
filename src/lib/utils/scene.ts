import {
	AmbientLight,
	Color,
	DirectionalLight,
	GridHelper,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer
} from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { getRGB } from './color';

const defaultCameraPosition = new Vector3(0, 50, 80);

export type SceneRenderer = ReturnType<typeof createBaseSceneAndRenderer>;

export function createBaseSceneAndRenderer(
	el: HTMLElement,
	initialCameraPosition: Vector3 = defaultCameraPosition
) {
	const scene = new Scene();
	const renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(el.clientWidth, el.clientHeight);
	el.appendChild(renderer.domElement);
	const resizeContainer = el.parentElement!;
	function darkModeListener() {
		const bgColorCss = window.getComputedStyle(document.body).getPropertyValue('background-color');
		let rgb = getRGB(bgColorCss);
		const { isDark } = window.getLightDark();
		if (isDark) {
			rgb = rgb.lighten(0.05);
		} else {
			rgb = rgb.darken(0.05);
		}
		scene.background = new Color(rgb.toNumber());
		// 	scene.background = window.getLightDark().isDark ? darkBackground : lightBackground;
	}
	darkModeListener();

	window.addEventListener('light-dark', darkModeListener);

	let camera = new PerspectiveCamera(70, el.clientWidth / el.clientHeight, 1, 500);
	camera.position.copy(initialCameraPosition);

	//const controls = new OrbitControls(camera, renderer.domElement);
	const controls = new TrackballControls(camera, renderer.domElement);
	controls.panSpeed = 10;
	controls.rotateSpeed = 10;

	scene.add(new AmbientLight(0x444444, 3));

	const light1 = new DirectionalLight(0xffffff, 1.5);
	light1.position.set(1, 1, 1);
	scene.add(light1);

	const light2 = new DirectionalLight(0xffffff, 4.5);
	light2.position.set(0, -1, 0);
	scene.add(light2);

	camera.lookAt(new Vector3(0, 0, 0));

	const observer = new ResizeObserver((entries) => {
		if (entries.find((e) => e.target === resizeContainer)) {
			const cvs = renderer.domElement;
			cvs.style.width = 'auto';
			cvs.style.height = 'auto';
			cvs.removeAttribute('width');
			cvs.removeAttribute('height');
			setTimeout(() => {
				camera.aspect = el.clientWidth / el.clientHeight;
				camera.updateProjectionMatrix();
				renderer.setSize(el.clientWidth, el.clientHeight);
			});
		}
	});
	//	observer.observe(el);
	observer.observe(resizeContainer);
	let anim = 0;
	// also check the page visibility API to ensure we keep rendering after the page is "stopped"
	const visibilityListener = () => {
		if (disposed) {
			return;
		}
		if (document.hidden) {
			if (anim) {
				cancelAnimationFrame(anim);
			}
		} else {
			anim = requestAnimationFrame(render);
		}
	};

	document.addEventListener('visibilitychange', visibilityListener);

	let disposed = false;
	const onDispose: Array<() => any> = [
		//		() => observer.unobserve(el),
		() => observer.unobserve(resizeContainer),
		() => window.removeEventListener('light-dark', darkModeListener),
		() => window.removeEventListener('visibilitychange', visibilityListener)
	];

	const dispose = () => {
		for (let fn of onDispose) {
			fn();
		}
		disposed = true;
		renderer.dispose();
	};
	let beforeRender = () => {};

	function render() {
		if (disposed) {
			return;
		}
		beforeRender();
		anim = requestAnimationFrame(render);
		controls.update();
		renderer.render(scene, camera);
	}

	return {
		scene,
		dispose,
		camera,
		controls,
		renderer,
		render,
		onBeforeRender(fn: () => void) {
			beforeRender = fn;
		},
		onBeforeDispose(fn: () => any) {
			onDispose.push(fn);
		}
	};
}

export function createGridHelper(divisions: number) {
	const size = divisions; // each division is 1mm

	const centerLineColor = 0xcccccc;
	const gridLineColor = 0x666666;
	const gridHelper = new GridHelper(size, divisions, centerLineColor, gridLineColor);
	return gridHelper;
}
