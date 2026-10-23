// Offscreen WebGL viewport for the die-engine worker. Ports the interactive
// scene from scene.ts (composer, outlines, trackball, fancy mode).
import {
	ACESFilmicToneMapping,
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	type Material,
	Matrix4,
	Mesh,
	MeshPhysicalMaterial,
	Object3D,
	PerspectiveCamera,
	PMREMGenerator,
	Quaternion,
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
import type { DieFaceModel } from '$lib/interfaces/dice';
import type { EngineOutlineState, EnginePointerEvent } from './die_engine_protocol';
import { EnginePicker } from './die_engine_picking';
import { applyCameraAutoRotate, AUTO_ROTATE_RAD_PER_SEC } from './camera_auto_rotate';
import {
	installWorkerWindowPolyfill,
	syntheticPointerEvent,
	syntheticWheelEvent,
	WorkerControlSurface
} from './die_engine_worker_dom';

const defaultCameraPosition = new Vector3(0, 10, 40);
const explodeCameraPosition = new Vector3(0, 0, 100);
const CAMERA_TRANSITION_MS = 1000;
// Hold camera distance while the view direction eases; distance only changes in the tail.
const EXPLODE_CAMERA_DIST_DELAY = 0.4;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const _defaultUp = new Vector3(0, 1, 0);
const _tweenTarget = new Vector3();
const _offset = new Vector3();
const _slerpQuat = new Quaternion();
const _lookAtMatrix = new Matrix4();
const _back = new Vector3();

type CameraTween = {
	startQuat: Quaternion;
	endQuat: Quaternion;
	startDist: number;
	endDist: number;
	startTarget: Vector3;
	endTarget: Vector3;
	// Unit vector from the target to the eye, and the up hint for that look-at.
	endBack: Vector3;
	endUp: Vector3;
	startZoom: number;
	endZoom: number;
	// 0..1 fraction of the transition spent holding startDist before easing toward endDist.
	distDelay: number;
	start: number;
};

type TrackballInternals = TrackballControls & {
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

export class EngineViewport {
	readonly scene = new Scene();
	readonly camera: PerspectiveCamera;
	readonly renderer: WebGLRenderer;
	readonly controls: TrackballControls;
	readonly composer: EffectComposer;
	readonly picker = new EnginePicker();

	private primaryOutlinePass: OutlinePass;
	private secondaryOutlinePass: OutlinePass;
	private legendOutlinePass: OutlinePass;
	private legendErrorOutlinePass: OutlinePass;
	private anim = 0;
	private disposed = false;
	private beforeRender: () => void = () => {};
	private wireframeOn = false;
	private width = 1;
	private height = 1;
	private fancy: ReturnType<typeof createWorkerFancyRender> | undefined;
	private controlSurface: WorkerControlSurface;
	private camTween: CameraTween | null = null;
	// Orbit centre. Print pose lifts the die off the origin; this follows that
	// lift so the die stays in frame instead of sitting high above the target.
	private viewCenter = new Vector3();
	// Camera pose from before support mode, restored when that mode turns off.
	private printViewSaved: { position: Vector3; up: Vector3; target: Vector3 } | null = null;
	private exploded = false;
	private autoRotate = false;
	private lastSpinNow = 0;
	// Shift-left-drag pans. Track whether the pointer actually moved so a
	// shift-click can still toggle face selection.
	private shiftPan = false;
	private shiftPanMoved = false;
	private shiftPanX = 0;
	private shiftPanY = 0;

	constructor(canvas: OffscreenCanvas, width: number, height: number, dpr: number) {
		installWorkerWindowPolyfill();
		this.width = width;
		this.height = height;
		this.controlSurface = new WorkerControlSurface(width, height);
		this.renderer = new WebGLRenderer({ antialias: true, canvas });
		this.renderer.setPixelRatio(dpr);
		this.renderer.setSize(width, height, false);
		this.camera = new PerspectiveCamera(70, width / height, 1, 500);
		this.camera.position.copy(defaultCameraPosition);
		this.controls = new TrackballControls(
			this.camera,
			this.controlSurface as unknown as HTMLElement
		);
		this.controls.panSpeed = 2;
		this.controls.rotateSpeed = 10;
		this.scene.add(new AmbientLight(0x444444, 3));
		const light1 = new DirectionalLight(0xffffff, 1.5);
		light1.position.set(1, 1, 1);
		this.scene.add(light1);
		const light2 = new DirectionalLight(0xffffff, 4.5);
		light2.position.set(0, -1, 0);
		this.scene.add(light2);
		this.camera.lookAt(0, 0, 0);
		this.picker.setCamera(this.camera);

		this.composer = new EffectComposer(this.renderer);
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.primaryOutlinePass = this.addOutlinePass(0xffffff, 1.5, 0.5, 1, 0);
		this.secondaryOutlinePass = this.addOutlinePass(0x00caca, 4, 1, 4, 3);
		this.legendOutlinePass = this.addOutlinePass(0x00cc00, 6, 1, 2, 0);
		this.legendErrorOutlinePass = this.addOutlinePass(0xff2d2d, 6, 1, 2, 2);
		this.patchOutlinePasses();
		this.fancy = createWorkerFancyRender(this);
	}

	private addOutlinePass(
		color: number,
		edgeStrength: number,
		edgeGlow: number,
		edgeThickness: number,
		pulsePeriod: number
	): OutlinePass {
		const pass = new OutlinePass(new Vector2(this.width, this.height), this.scene, this.camera);
		pass.edgeStrength = edgeStrength;
		pass.edgeGlow = edgeGlow;
		pass.edgeThickness = edgeThickness;
		pass.pulsePeriod = pulsePeriod;
		pass.visibleEdgeColor = new Color(color);
		pass.hiddenEdgeColor = new Color(0x000000);
		this.composer.addPass(pass);
		return pass;
	}

	private patchOutlinePasses() {
		for (const pass of [
			this.primaryOutlinePass,
			this.secondaryOutlinePass,
			this.legendOutlinePass,
			this.legendErrorOutlinePass
		]) {
			const maskMat = pass.prepareMaskMaterial;
			const patched = maskMat.fragmentShader.replace(
				'gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);',
				'if (depthTest > 0.5) discard;\n\t\t\t\t\tgl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);'
			);
			maskMat.fragmentShader = patched;
			maskMat.needsUpdate = true;
			pass.renderTargetDepthBuffer.dispose();
			const depthRT = new WebGLRenderTarget(this.width, this.height, { type: UnsignedByteType });
			depthRT.texture.generateMipmaps = false;
			pass.renderTargetDepthBuffer = depthRT;
		}
	}

	start() {
		if (this.anim) {
			return;
		}
		this.anim = 1;
		this.renderer.setAnimationLoop(() => {
			if (this.disposed) {
				return;
			}
			this.beforeRender();
			if (this.camTween) {
				this.stepCameraTween();
			} else {
				this.controls.update();
				if (this.exploded) {
					// Trackball lookAt uses camera.up. A face-view up left over from the
					// solid die is not perpendicular to +Z, and damping can leave the
					// view edge-on to the face plane. Hold the explode pose.
					this.enforceExplodeView();
				} else if (this.autoRotate) {
					this.stepAutoRotate();
				}
			}
			if (this.wireframeOn) {
				this.applyWireframe();
			}
			this.composer.render();
		});
	}

	stop() {
		if (this.anim) {
			this.renderer.setAnimationLoop(null);
			this.anim = 0;
		}
	}

	dispose() {
		this.disposed = true;
		this.stop();
		this.fancy?.dispose();
		this.renderer.dispose();
	}

	resize(width: number, height: number, dpr: number) {
		this.width = width;
		this.height = height;
		this.controlSurface.setSize(width, height);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setPixelRatio(dpr);
		this.renderer.setSize(width, height, false);
		this.composer.setSize(width, height);
		this.controls.handleResize();
	}

	setBackground(hex: number) {
		this.scene.background = new Color().setHex(hex);
	}

	onBeforeRender(fn: () => void) {
		this.beforeRender = fn;
	}

	setWireframe(on: boolean) {
		this.wireframeOn = on;
		this.applyWireframe();
	}

	private applyWireframe() {
		this.scene.traverse((o) => {
			const mesh = o as Mesh;
			if (!mesh.isMesh) {
				return;
			}
			const part = o.userData?.diceThingPart;
			if (typeof part === 'string' && part.startsWith('legend-area')) {
				return;
			}
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			for (const mat of mats) {
				const m = mat as Material & { wireframe?: boolean };
				if (m && 'wireframe' in m) {
					m.wireframe = this.wireframeOn;
				}
			}
		});
	}

	setFancy(enabled: boolean) {
		this.fancy?.setEnabled(enabled);
	}

	setExploded(explode: boolean) {
		this.exploded = explode;
		this.controls.noRotate = explode;
		if (explode) {
			this.setAutoRotate(false);
			this.animateExplodeCamera();
		}
	}

	/**
	 * Look at `center` with world +Y up, from the usual front angle, keeping the
	 * current zoom. Support rafts lie on the xz plane, so this puts that plane
	 * flat across the viewport for every die.
	 */
	frameLevelPrintView(center: Vector3) {
		if (!this.printViewSaved) {
			this.printViewSaved = {
				position: this.camera.position.clone(),
				up: this.camera.up.clone(),
				target: this.controls.target.clone()
			};
		}
		this.camTween = null;
		const dist = this.camera.position.distanceTo(this.controls.target);
		const eye = defaultCameraPosition.clone().normalize();
		eye.multiplyScalar(dist > 1e-6 ? dist : defaultCameraPosition.length());
		this.viewCenter.copy(center);
		this.controls.target.copy(center);
		this.camera.up.set(0, 1, 0);
		this.camera.position.copy(center).add(eye);
		this.camera.lookAt(center);
		this.syncTrackballEye();
	}

	/** Put the camera back where it was before `frameLevelPrintView`. */
	restoreFramedView() {
		const saved = this.printViewSaved;
		this.printViewSaved = null;
		this.camTween = null;
		this.viewCenter.set(0, 0, 0);
		if (!saved) {
			return;
		}
		this.camera.position.copy(saved.position);
		this.camera.up.copy(saved.up);
		this.controls.target.copy(saved.target);
		this.camera.lookAt(saved.target);
		this.syncTrackballEye();
	}

	/**
	 * Move the orbit centre, carrying the camera and any in-flight tween by the
	 * same delta so the viewing direction stays put.
	 */
	setViewCenter(next: Vector3) {
		const delta = next.clone().sub(this.viewCenter);
		if (delta.lengthSq() < 1e-8) {
			return;
		}
		this.camera.position.add(delta);
		this.controls.target.add(delta);
		if (this.camTween) {
			this.camTween.startTarget.add(delta);
			this.camTween.endTarget.add(delta);
		}
		this.viewCenter.copy(next);
		this.camera.lookAt(this.controls.target);
		this.syncTrackballEye();
	}

	setAutoRotate(enabled: boolean) {
		if (!enabled || this.exploded) {
			this.autoRotate = false;
			return;
		}
		// Orbit in place from the current camera — no pull-out tween.
		this.autoRotate = true;
		this.lastSpinNow = performance.now();
	}

	private stepAutoRotate() {
		const now = performance.now();
		if (!this.lastSpinNow) {
			this.lastSpinNow = now;
			return;
		}
		const dt = Math.min(0.05, (now - this.lastSpinNow) / 1000);
		this.lastSpinNow = now;
		applyCameraAutoRotate(this.camera, this.controls.target, AUTO_ROTATE_RAD_PER_SEC * dt);
		this.syncTrackballEye();
	}

	private syncTrackballEye() {
		const controls = this.controls as TrackballInternals;
		controls._eye.subVectors(this.camera.position, this.controls.target);
		controls._lastPosition.copy(this.camera.position);
		controls._lastZoom = this.camera.zoom;
		// Collapse pointer deltas so damping doesn't keep panning/zooming/rotating
		// after a programmatic camera move.
		controls._panStart.copy(controls._panEnd);
		controls._zoomStart.copy(controls._zoomEnd);
		controls._movePrev.copy(controls._moveCurr);
		controls._lastAngle = 0;
	}

	// Face geometry lives in local XY, +Z outward, +Y toward the top of the legend.
	private faceFrame(face: DieFaceModel): { back: Vector3; up: Vector3 } {
		const q = face.transform.rotation;
		const back = new Vector3(0, 0, 1).applyQuaternion(q);
		const up = new Vector3(0, 1, 0).applyQuaternion(q);
		if (back.lengthSq() < 1e-12) {
			back.set(0, 0, 1);
		}
		back.normalize();
		up.addScaledVector(back, -up.dot(back));
		if (up.lengthSq() < 1e-12) {
			up.set(Math.abs(back.y) > 0.9 ? 1 : 0, Math.abs(back.y) > 0.9 ? 0 : 1, 0);
			up.addScaledVector(back, -up.dot(back));
		}
		up.normalize();
		return { back, up };
	}

	private animateFaceView(face: DieFaceModel) {
		// Trackball zooms a perspective camera by dollying (eye length), not camera.zoom.
		// Keep that distance so framing a face doesn't snap back to the default offset.
		const { back, up } = this.faceFrame(face);
		const dist = this.camera.position.distanceTo(this.controls.target);
		const endDist = dist > 1e-6 ? dist : defaultCameraPosition.length();
		this.animateLookAt(back, up, this.viewCenter.clone(), endDist, 0, this.camera.zoom);
	}

	// Eye sits on `endBack` from the target. `endUp` is the on-screen up (world +Y
	// for the explode grid, the face's legend up otherwise). The pose is a real
	// lookAt, not a rotation of the default camera offset: that offset is not
	// perpendicular to its up, so rebuilding from it leaves the view off the
	// plane and rolls the numbers.
	private animateLookAt(
		endBack: Vector3,
		endUp: Vector3,
		endTarget: Vector3,
		endDist: number,
		distDelay: number,
		endZoom: number
	) {
		const back = endBack.clone().normalize();
		const up = endUp.clone().normalize();
		_offset.copy(endTarget).addScaledVector(back, endDist);
		_lookAtMatrix.lookAt(_offset, endTarget, up);
		let endQuat = new Quaternion().setFromRotationMatrix(_lookAtMatrix);
		if (this.camera.quaternion.dot(endQuat) < 0) {
			endQuat = new Quaternion(-endQuat.x, -endQuat.y, -endQuat.z, -endQuat.w);
		}
		this.camTween = {
			startQuat: this.camera.quaternion.clone(),
			endQuat,
			startDist: this.camera.position.distanceTo(this.controls.target),
			endDist,
			startTarget: this.controls.target.clone(),
			endTarget: endTarget.clone(),
			endBack: back,
			endUp: up,
			startZoom: this.camera.zoom,
			endZoom,
			distDelay,
			start: performance.now()
		};
	}

	// Sit on +Z over `target`, world +Y up, so the XY face grid is face-on and upright.
	private placeExplodeCamera(target: Vector3, dist: number) {
		this.camera.up.set(0, 1, 0);
		this.camera.position.set(target.x, target.y, target.z + dist);
		this.camera.lookAt(target);
	}

	private animateExplodeCamera() {
		this.animateLookAt(
			new Vector3(0, 0, 1),
			_defaultUp,
			this.viewCenter.clone(),
			explodeCameraPosition.length(),
			EXPLODE_CAMERA_DIST_DELAY,
			1
		);
	}

	// After trackball update: keep the eye on +Z at the current dolly distance so
	// zoom and pan still work, but a side-on orientation cannot stick.
	private enforceExplodeView() {
		const target = this.controls.target;
		const dist = this.camera.position.distanceTo(target);
		this.placeExplodeCamera(target, dist > 1e-3 ? dist : explodeCameraPosition.length());
		(this.controls as TrackballInternals)._eye.subVectors(this.camera.position, target);
	}

	private stepCameraTween() {
		if (!this.camTween) {
			return;
		}
		const t = Math.min(1, (performance.now() - this.camTween.start) / CAMERA_TRANSITION_MS);
		const e = easeInOut(t);
		const tw = this.camTween;
		_tweenTarget.lerpVectors(tw.startTarget, tw.endTarget, e);
		_slerpQuat.slerpQuaternions(tw.startQuat, tw.endQuat, e);
		const distT =
			tw.distDelay > 0
				? easeInOut(Math.min(1, Math.max(0, (t - tw.distDelay) / (1 - tw.distDelay))))
				: e;
		const dist = tw.startDist + (tw.endDist - tw.startDist) * distT;
		this.controls.target.copy(_tweenTarget);
		_slerpQuat.normalize();
		_back.set(0, 0, 1).applyQuaternion(_slerpQuat);
		this.camera.position.copy(_tweenTarget).addScaledVector(_back, dist);
		this.camera.quaternion.copy(_slerpQuat);
		this.camera.up.set(0, 1, 0).applyQuaternion(_slerpQuat).normalize();
		this.camera.zoom = tw.startZoom + (tw.endZoom - tw.startZoom) * e;
		this.camera.updateProjectionMatrix();
		if (t >= 1) {
			this.camera.up.copy(tw.endUp);
			this.camera.position.copy(tw.endTarget).addScaledVector(tw.endBack, tw.endDist);
			this.camera.lookAt(tw.endTarget);
			this.syncTrackballEye();
			this.camTween = null;
		}
	}

	setOutline(state: EngineOutlineState, getOutline: (face: number) => Array<Object3D>) {
		this.primaryOutlinePass.selectedObjects = state.primaryFaces.flatMap((f) => getOutline(f));
		this.secondaryOutlinePass.selectedObjects = state.secondaryFaces.flatMap((f) => getOutline(f));
	}

	setLegendAreaOutlines(ok: Array<Object3D>, error: Array<Object3D>) {
		this.legendOutlinePass.selectedObjects = ok;
		this.legendErrorOutlinePass.selectedObjects = error;
	}

	dispatchPointer(ev: EnginePointerEvent) {
		if (ev.type === 'pointerdown') {
			this.camTween = null;
			const leftButton = (ev.button === undefined || ev.button === 0) && (ev.buttons & 1) !== 0;
			this.shiftPan = ev.shiftKey && leftButton;
			this.shiftPanMoved = false;
			this.shiftPanX = ev.offsetX;
			this.shiftPanY = ev.offsetY;
		} else if (
			this.shiftPan &&
			(ev.type === 'pointermove' || ev.type === 'pointerup' || ev.type === 'pointerleave')
		) {
			if (Math.hypot(ev.offsetX - this.shiftPanX, ev.offsetY - this.shiftPanY) > 4) {
				this.shiftPanMoved = true;
			}
		}
		const type = ev.type === 'wheel' ? 'wheel' : ev.type === 'pointerleave' ? 'pointerup' : ev.type;
		// Trackball pans on the right button. Report shift-left as that button
		// so a Mac trackpad can pan without a right-drag.
		const trackballEv =
			this.shiftPan && ev.type === 'pointerdown' ? { ...ev, button: 2, buttons: 2 } : ev;
		if (type === 'wheel' && ev.deltaY !== undefined) {
			this.controlSurface.dispatchEvent(syntheticWheelEvent(ev.deltaY));
		} else if (type !== 'wheel') {
			this.controlSurface.dispatchEvent(syntheticPointerEvent(trackballEv, type));
		}
		const suppressClick = ev.type === 'pointerup' && this.shiftPan && this.shiftPanMoved;
		if (ev.type === 'pointerup' || ev.type === 'pointerleave') {
			this.shiftPan = false;
		}
		if (!suppressClick) {
			this.picker.handlePointer(ev);
		}
	}

	resetCamera() {
		this.camTween = null;
		this.controls.reset();
		this.camera.position
			.copy(this.exploded ? explodeCameraPosition : defaultCameraPosition)
			.add(this.viewCenter);
		this.camera.up.set(0, 1, 0);
		this.controls.target.copy(this.viewCenter);
		this.camera.lookAt(this.viewCenter);
		this.syncTrackballEye();
	}

	lookAtFace(faceIndex: number, getFace: (face: number) => DieFaceModel | undefined) {
		if (this.exploded) {
			this.animateExplodeCamera();
			return;
		}
		const face = getFace(faceIndex);
		if (!face) {
			return;
		}
		this.animateFaceView(face);
	}

	styleMesh(mesh: Mesh) {
		this.fancy?.styleMesh(mesh);
	}
}

function createWorkerFancyRender(viewport: EngineViewport) {
	const { scene, renderer, camera, composer } = viewport;
	const material = new MeshPhysicalMaterial({
		color: 0x6b7b94,
		roughness: 1.0,
		metalness: 0.25,
		clearcoat: 0.81,
		clearcoatRoughness: 0.5,
		envMapIntensity: 0.9
	});
	const pmrem = new PMREMGenerator(renderer);
	const envTexture: Texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	const keyLight = new DirectionalLight(0xffffff, 2.2);
	keyLight.position.set(28, 60, 24);
	const keyLight2 = new DirectionalLight(0xffffff, 8);
	keyLight2.position.set(-34, 18, -28);
	const fillLight = new HemisphereLight(0xffffff, 0x404048, 1.5);
	const ao = new GTAOPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
	ao.enabled = false;
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

	return { setEnabled, styleMesh, dispose, material, ao, keyLight, keyLight2, fillLight };
}
