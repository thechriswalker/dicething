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
	UnsignedByteType,
	Vector2,
	Vector3,
	WebGLRenderer,
	WebGLRenderTarget
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import Stats from 'three/addons/libs/stats.module.js';
import { getRGB } from './color';
import {
	applyCameraAutoRotate,
	AUTO_ROTATE_RAD_PER_SEC
} from './camera_auto_rotate';

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
	primaryOutlinePass.edgeStrength = 1.5;
	primaryOutlinePass.edgeGlow = 0.5;
	primaryOutlinePass.edgeThickness = 1;
	primaryOutlinePass.visibleEdgeColor = new Color(0xffffff);
	// black hidden colour => occluded parts of the outline contribute nothing,
	// so the glow is hidden behind the rest of the die instead of bleeding through.
	primaryOutlinePass.hiddenEdgeColor = new Color(0x000000);
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
	secondaryOutlinePass.hiddenEdgeColor = new Color(0x000000);

	// pulsing-glow highlight for the available-legend-area aid. its source is the
	// invisible filled polygon the builder adds per face, so the glow traces the
	// legend-area boundary while a thin line keeps the exact edge crisp.
	const legendOutlinePass = new OutlinePass(
		new Vector2(el.clientWidth, el.clientHeight),
		scene,
		camera
	);
	composer.addPass(legendOutlinePass);
	legendOutlinePass.edgeStrength = 6;
	legendOutlinePass.edgeGlow = 1;
	legendOutlinePass.edgeThickness = 2;
	// steady (no pulse); the pulse is reserved for the red "bad engraving" pass.
	legendOutlinePass.pulsePeriod = 0;
	legendOutlinePass.visibleEdgeColor = new Color(0x00cc00);
	legendOutlinePass.hiddenEdgeColor = new Color(0x000000);

	// red sibling of the legend pass for faces whose legend won't engrave cleanly.
	const legendErrorOutlinePass = new OutlinePass(
		new Vector2(el.clientWidth, el.clientHeight),
		scene,
		camera
	);
	composer.addPass(legendErrorOutlinePass);
	legendErrorOutlinePass.edgeStrength = 6;
	legendErrorOutlinePass.edgeGlow = 1;
	legendErrorOutlinePass.edgeThickness = 2;
	legendErrorOutlinePass.pulsePeriod = 2;
	legendErrorOutlinePass.visibleEdgeColor = new Color(0xff2d2d);
	legendErrorOutlinePass.hiddenEdgeColor = new Color(0x000000);

	const legendPasses = [legendOutlinePass, legendErrorOutlinePass];
	for (const pass of [primaryOutlinePass, secondaryOutlinePass, ...legendPasses]) {
		// Fix: when several faces are selected, OutlinePass renders them all into
		// one mask, and its prepare-mask shader marks "a selected object is here"
		// (red channel) for every selected fragment regardless of whether it's
		// occluded. The edge detector finds the legend outline purely from
		// red-channel contrast. So a fully-hidden back face that projects into the
		// front face's legend holes still fills those holes with "selected here",
		// killing the contrast at the inner rim and punching the back face's shape
		// out of the front face's glow. Because we draw hidden edges as black
		// (invisible) anyway, simply discarding occluded fragments in the mask
		// removes that false fill without changing how visible outlines look.
		const maskMat = pass.prepareMaskMaterial;
		const patched = maskMat.fragmentShader.replace(
			'gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);',
			'if (depthTest > 0.5) discard;\n\t\t\t\t\tgl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);'
		);
		if (patched === maskMat.fragmentShader) {
			console.warn(
				'OutlinePass prepare-mask shader patch did not apply; multi-select outlines may break through holes.'
			);
		}
		maskMat.fragmentShader = patched;
		maskMat.needsUpdate = true;

		// Complementary correctness fix: OutlinePass allocates this occluder depth
		// buffer as HalfFloatType, but MeshDepthMaterial writes RGBADepthPacking,
		// which is designed for an 8-bit-per-channel (UnsignedByteType) target.
		// Half-float storage loses precision in the packed bytes, which makes the
		// visible/hidden compare unreliable for near-coincident geometry (e.g. a
		// rim sitting on its own engraving wall). setSize() only resizes (keeps
		// the type), so this sticks across window resizes.
		pass.renderTargetDepthBuffer.dispose();
		const depthRT = new WebGLRenderTarget(el.clientWidth, el.clientHeight, {
			type: UnsignedByteType
		});
		depthRT.texture.name = 'OutlinePass.depth';
		depthRT.texture.generateMipmaps = false;
		pass.renderTargetDepthBuffer = depthRT;

		// Keep lines (the floor grid) out of the outline computation entirely.
		// OutlinePass already hides lines for its mask pass ("lines should not
		// affect the outline computation") but NOT for its occluder depth pass, so
		// grid lines still write depth and count as occluders. The grid plane runs
		// through the middle of the die, so grid lines sit in front of the lower
		// part of a selected face; with the discard above those fragments would
		// drop out of the mask and paint spurious outline-coloured edges along
		// every grid line inside the face. Hiding lines for the whole pass render
		// (the beauty RenderPass has already run) removes them as occluders while
		// leaving the real mesh occluders that fix the hole bleed-through intact.
		//
		// The legend-area glow fills are non-line meshes that sit just in front of
		// their face purely as the source for a legend highlight pass. Every pass
		// must hide the fills it doesn't own: a stray fill writes occluder depth
		// over the selected/hovered face and the discard above carves the legend
		// boundary out of that face's glow (a stray hole in the white selection
		// glow); likewise the lime pass must not be perturbed by red fills and vice
		// versa. So each pass keeps only its own fill (by diceThingPart) and hides
		// every other 'legend-area-glow*' fill (and all lines, as before).
		const keepGlowPart =
			pass === legendOutlinePass
				? 'legend-area-glow'
				: pass === legendErrorOutlinePass
					? 'legend-area-glow-error'
					: null;
		const originalRender = pass.render.bind(pass);
		pass.render = (...args: Parameters<typeof originalRender>) => {
			const hidden: Object3D[] = [];
			scene.traverse((o) => {
				if (!o.visible) {
					return;
				}
				const line = o as { isLine?: boolean };
				const part = o.userData?.diceThingPart;
				const isOtherGlowFill =
					typeof part === 'string' && part.startsWith('legend-area-glow') && part !== keepGlowPart;
				if (line.isLine || isOtherGlowFill) {
					o.visible = false;
					hidden.push(o);
				}
			});
			try {
				originalRender(...args);
			} finally {
				for (const o of hidden) {
					o.visible = true;
				}
			}
		};
	}

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

	// Turntable spin around the current look-at target; starts from wherever the camera is.
	let autoRotate = false;
	let lastSpinNow = 0;

	function syncTrackballAfterProgrammaticMove() {
		const c = controls as TrackballControls & {
			_eye: Vector3;
			_lastPosition: Vector3;
			_lastZoom: number;
			_lastAngle: number;
			_movePrev: Vector2;
			_moveCurr: Vector2;
			_zoomStart: Vector2;
			_zoomEnd: Vector2;
			_panStart: Vector2;
			_panEnd: Vector2;
		};
		c._eye.subVectors(camera.position, controls.target);
		c._lastPosition.copy(camera.position);
		c._lastZoom = camera.zoom;
		c._panStart.copy(c._panEnd);
		c._zoomStart.copy(c._zoomEnd);
		c._movePrev.copy(c._moveCurr);
		c._lastAngle = 0;
	}

	function stepAutoRotate() {
		const now = performance.now();
		if (!lastSpinNow) {
			lastSpinNow = now;
			return;
		}
		const dt = Math.min(0.05, (now - lastSpinNow) / 1000);
		lastSpinNow = now;
		applyCameraAutoRotate(camera, controls.target, AUTO_ROTATE_RAD_PER_SEC * dt);
		syncTrackballAfterProgrammaticMove();
	}

	function setAutoRotate(enabled: boolean) {
		autoRotate = enabled;
		if (enabled) {
			lastSpinNow = performance.now();
		}
	}

	// --- developer mode helpers (wireframe + stats) ---
	let wireframeOn = false;
	function applyWireframe() {
		scene.traverse((o) => {
			const mesh = o as Mesh;
			if (!mesh.isMesh) {
				return;
			}
			// leave overlay aids (e.g. the legend-area outline/glow) untouched.
			const part = o.userData?.diceThingPart;
			if (typeof part === 'string' && part.startsWith('legend-area')) {
				return;
			}
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				const m = mat as Material & { wireframe?: boolean };
				if (m && 'wireframe' in m && m.wireframe !== wireframeOn) {
					m.wireframe = wireframeOn;
				}
			}
		});
	}
	function setWireframe(on: boolean) {
		wireframeOn = on;
		// apply immediately so toggling off restores solid shading too.
		applyWireframe();
	}

	let stats: Stats | undefined;
	function setStatsVisible(on: boolean) {
		if (on && !stats) {
			stats = new Stats();
			// pin the panel to the bottom-left of the scene container.
			stats.dom.style.position = 'absolute';
			stats.dom.style.left = '0';
			stats.dom.style.top = 'auto';
			stats.dom.style.bottom = '0';
			if (!el.style.position) {
				el.style.position = 'relative';
			}
			el.appendChild(stats.dom);
		}
		if (stats) {
			stats.dom.style.display = on ? 'block' : 'none';
		}
	}
	onDispose.push(() => {
		stats?.dom.remove();
	});

	function render() {
		if (disposed) {
			return;
		}
		stats?.begin();
		beforeRender();
		anim = requestAnimationFrame(render);
		controls.update();
		if (autoRotate) {
			stepAutoRotate();
		}
		// while on, re-apply so meshes built after the toggle become wireframe too.
		if (wireframeOn) {
			applyWireframe();
		}
		composer.render();
		stats?.end();
	}

	return {
		scene,
		dispose,
		camera,
		controls,
		renderer,
		composer,
		render,
		setWireframe,
		setStatsVisible,
		setAutoRotate,
		setPrimarySelectedItems(selectedItems: Array<Object3D>) {
			primaryOutlinePass.selectedObjects = selectedItems;
		},
		setSecondarySeletedItems(selectedItems: Array<Object3D>) {
			secondaryOutlinePass.selectedObjects = selectedItems;
		},
		setLegendAreaItems(selectedItems: Array<Object3D>) {
			legendOutlinePass.selectedObjects = selectedItems;
		},
		setLegendAreaErrorItems(selectedItems: Array<Object3D>) {
			legendErrorOutlinePass.selectedObjects = selectedItems;
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
