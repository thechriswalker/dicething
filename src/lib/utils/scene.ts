import {
	ACESFilmicToneMapping,
	AmbientLight,
	Color,
	DirectionalLight,
	GridHelper,
	HemisphereLight,
	type Material,
	Mesh,
	MeshPhysicalMaterial,
	Object3D,
	PerspectiveCamera,
	PMREMGenerator,
	Scene,
	SRGBColorSpace,
	type Texture,
	Vector2,
	Vector3,
	WebGLRenderer
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
	let camera = new PerspectiveCamera(70, el.clientWidth / el.clientHeight, 1, 500);
	camera.position.copy(initialCameraPosition);

	//const controls = new OrbitControls(camera, renderer.domElement);
	const controls = new TrackballControls(camera, renderer.domElement);
	controls.panSpeed = 2;
	controls.rotateSpeed = 10;

	scene.add(new AmbientLight(0x444444, 3));

	const light1 = new DirectionalLight(0xffffff, 1.5);
	light1.position.set(1, 1, 1);
	scene.add(light1);

	const light2 = new DirectionalLight(0xffffff, 4.5);
	light2.position.set(0, -1, 0);
	scene.add(light2);

	camera.lookAt(new Vector3(0, 0, 0));

	const composer = new EffectComposer(renderer);
	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);
	const primaryOutlinePass = new OutlinePass(
		new Vector2(el.clientWidth, el.clientHeight),
		scene,
		camera
	);
	composer.addPass(primaryOutlinePass);
	primaryOutlinePass.edgeStrength = 4;
	primaryOutlinePass.edgeGlow = 1;
	primaryOutlinePass.edgeThickness = 2;
	primaryOutlinePass.visibleEdgeColor = new Color(0xffffff);
	primaryOutlinePass.hiddenEdgeColor = new Color(0x666666);
	const secondaryOutlinePass = new OutlinePass(
		new Vector2(el.clientWidth, el.clientHeight),
		scene,
		camera
	);
	composer.addPass(secondaryOutlinePass);
	secondaryOutlinePass.edgeStrength = 4;
	secondaryOutlinePass.edgeGlow = 1;
	secondaryOutlinePass.edgeThickness = 4;
	secondaryOutlinePass.pulsePeriod = 3;
	secondaryOutlinePass.visibleEdgeColor = new Color(0x00caca);
	secondaryOutlinePass.hiddenEdgeColor = new Color(0x00caca);

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
				composer.setSize(el.clientWidth, el.clientHeight);
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
		composer.render();
	}

	return {
		scene,
		dispose,
		camera,
		controls,
		renderer,
		composer,
		render,
		setPrimarySelectedItems(selectedItems: Array<Object3D>) {
			primaryOutlinePass.selectedObjects = selectedItems;
		},
		setSecondarySeletedItems(selectedItems: Array<Object3D>) {
			secondaryOutlinePass.selectedObjects = selectedItems;
		},
		onBeforeRender(fn: () => void) {
			beforeRender = fn;
		},
		onBeforeDispose(fn: () => any) {
			onDispose.push(fn);
		}
	};
}

// A toggleable "fancy" rendering layer for a scene: swaps meshes to a PBR
// material lit by image-based lighting and a key light, plus a subtle
// ambient-occlusion pass so recessed engravings read clearly. Turning it off
// restores each mesh's original material and the plain renderer state, so the
// default normal-material look is unchanged.
export function createFancyRender(ctx: SceneRenderer) {
	const { scene, renderer, camera, composer } = ctx;

	// resin-like die material; the clearcoat + IBL highlights pick out the
	// bevelled walls of the engravings.
	const material = new MeshPhysicalMaterial({
		color: 0x6b7b94,
		roughness: 1.0,
		metalness: 0.25,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9
	});

	// soft, even environment lighting so every face is legible regardless of
	// orientation. generated once from the built-in room scene.
	const pmrem = new PMREMGenerator(renderer);
	const envTexture: Texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	// key light for directional shading that picks out the engraving walls.
	const keyLight = new DirectionalLight(0xffffff, 2.2);
	keyLight.position.set(28, 60, 24);

	// second key light from a different angle (roughly opposite, lower) to
	// illuminate the side that faces away from the main key light.
	const keyLight2 = new DirectionalLight(0xffffff, 8);
	keyLight2.position.set(-34, 18, -28);

	// hemisphere fill so the side facing away from the key light isn't black;
	// keeps a soft top->bottom gradient so engraving relief is preserved.
	const fillLight = new HemisphereLight(0xffffff, 0x404048, 1.5);

	// ambient occlusion darkens the crevices between glyph strokes and the
	// engraving walls, which is what makes the numbers pop.
	const ao = new GTAOPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
	ao.output = GTAOPass.OUTPUT.Default;
	ao.enabled = false;
	ao.updateGtaoMaterial({
		radius: 2.5,
		distanceExponent: 1,
		thickness: 1,
		distanceFallOff: 1,
		scale: 1,
		samples: 16,
		screenSpaceRadius: false
	});
	// run AO right after the scene render, before the outline overlays.
	composer.insertPass(ao, 1);

	let enabled = false;
	const baseToneMapping = renderer.toneMapping;

	function setEnabled(on: boolean) {
		enabled = on;
		ao.enabled = on;
		scene.environment = on ? envTexture : null;
		renderer.toneMapping = on ? ACESFilmicToneMapping : baseToneMapping;
		if (on) {
			scene.add(keyLight);
			scene.add(keyLight2);
			scene.add(fillLight);
		} else {
			scene.remove(keyLight);
			scene.remove(keyLight2);
			scene.remove(fillLight);
		}
	}

	// Apply the current render style to a mesh, remembering its original
	// material so it can be restored when fancy mode is turned off.
	function styleMesh(mesh: Mesh) {
		if (!mesh.userData.baseMaterial) {
			mesh.userData.baseMaterial = mesh.material;
		}
		mesh.material = enabled ? material : (mesh.userData.baseMaterial as Material);
	}

	function dispose() {
		pmrem.dispose();
		envTexture.dispose();
		material.dispose();
	}

	// TEMP: set the material base colour from 0..1 sRGB components.
	function setColor(r: number, g: number, b: number) {
		material.color.setRGB(r, g, b, SRGBColorSpace);
	}

	return {
		setEnabled,
		styleMesh,
		dispose,
		setColor,
		// exposed for the temporary tuning panel on the export page.
		material,
		ao,
		keyLight,
		keyLight2,
		fillLight,
		get enabled() {
			return enabled;
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
