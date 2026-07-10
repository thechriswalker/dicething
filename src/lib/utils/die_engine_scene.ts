// Offscreen WebGL viewport for the die-engine worker. Ports the interactive
// scene from scene.ts (composer, outlines, trackball, fancy mode).
import {
	ACESFilmicToneMapping,
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	type Material,
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

const _origin = new Vector3(0, 0, 0);
const _defaultUp = new Vector3(0, 1, 0);
const _tweenTarget = new Vector3();
const _offset = new Vector3();
const _z0n = new Vector3();
const _z1n = new Vector3();
const _cross = new Vector3();
const _yAligned = new Vector3();
const _perp = new Vector3();
const _qAlign = new Quaternion();
const _qTwist = new Quaternion();
const _slerpQuat = new Quaternion();

function faceCameraPose(face: DieFaceModel): { pos: Vector3; up: Vector3 } {
	const pos = defaultCameraPosition.clone();
	const up = _defaultUp.clone();
	const q = face.transform.rotation;
	pos.applyQuaternion(q);
	up.applyQuaternion(q).normalize();
	return { pos, up };
}

// Inverse of applyRotationToCamera / faceCameraState: the rotation that maps the
// default offset and up to the current pose relative to `target`.
function extractFaceViewQuat(position: Vector3, up: Vector3, target: Vector3): Quaternion {
	_offset.copy(position).sub(target);
	const len = _offset.length();
	if (len < 1e-9) {
		return new Quaternion();
	}
	_z0n.copy(defaultCameraPosition).normalize();
	_z1n.copy(_offset).divideScalar(len);
	_cross.crossVectors(_z0n, _z1n);
	const dot = Math.max(-1, Math.min(1, _z0n.dot(_z1n)));
	if (_cross.lengthSq() < 1e-12) {
		if (dot < 0) {
			_perp.set(1, 0, 0).cross(_z0n);
			if (_perp.lengthSq() < 1e-12) {
				_perp.set(0, 1, 0).cross(_z0n);
			}
			_qAlign.setFromAxisAngle(_perp.normalize(), Math.PI);
		} else {
			_qAlign.identity();
		}
	} else {
		_qAlign.setFromAxisAngle(_cross.normalize(), Math.acos(dot));
	}
	_yAligned.copy(_defaultUp).applyQuaternion(_qAlign);
	_cross.crossVectors(_yAligned, up);
	_qTwist.setFromAxisAngle(_z1n, Math.atan2(_cross.dot(_z1n), _yAligned.dot(up)));
	return _qTwist.clone().multiply(_qAlign);
}

type FaceCameraTween = {
	kind: 'face';
	startQuat: Quaternion;
	endQuat: Quaternion;
	startTarget: Vector3;
	endTarget: Vector3;
	startZoom: number;
	endZoom: number;
	start: number;
};

type QuatDistanceTween = {
	kind: 'quatDist';
	startQuat: Quaternion;
	endQuat: Quaternion;
	startDist: number;
	endDist: number;
	startTarget: Vector3;
	endTarget: Vector3;
	startZoom: number;
	endZoom: number;
	distDelay: number;
	start: number;
};

type CameraTween = FaceCameraTween | QuatDistanceTween;

type TrackballInternals = TrackballControls & {
	_eye: Vector3;
	_lastPosition: Vector3;
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
	private exploded = false;

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
		this.controls = new TrackballControls(this.camera, this.controlSurface as unknown as HTMLElement);
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
			this.animateQuatDistanceTo(explodeCameraPosition, _defaultUp, _origin);
		}
	}

	private isExplodeCameraPose(): boolean {
		return this.camera.position.distanceToSquared(explodeCameraPosition) < 100;
	}

	private syncTrackballEye() {
		const controls = this.controls as TrackballInternals;
		controls._eye.subVectors(this.camera.position, this.controls.target);
		controls._lastPosition.copy(this.camera.position);
	}

	private animateFaceView(face: DieFaceModel) {
		const startQuat = extractFaceViewQuat(
			this.camera.position,
			this.camera.up,
			this.controls.target
		);
		let endQuat = face.transform.rotation.clone();
		if (startQuat.dot(endQuat) < 0) {
			endQuat = new Quaternion(-endQuat.x, -endQuat.y, -endQuat.z, -endQuat.w);
		}
		this.camTween = {
			kind: 'face',
			startQuat,
			endQuat,
			startTarget: this.controls.target.clone(),
			endTarget: _origin.clone(),
			startZoom: this.camera.zoom,
			endZoom: this.camera.zoom,
			start: performance.now()
		};
	}

	private animateQuatDistanceTo(
		endPos: Vector3,
		endUp: Vector3,
		endTarget: Vector3,
		endQuat?: Quaternion,
		endZoom = 1,
		distDelay = EXPLODE_CAMERA_DIST_DELAY
	) {
		const startTarget = this.controls.target;
		const startQuat = extractFaceViewQuat(
			this.camera.position,
			this.camera.up,
			startTarget
		);
		let eq = (endQuat ?? extractFaceViewQuat(endPos, endUp, endTarget)).clone();
		if (startQuat.dot(eq) < 0) {
			eq = new Quaternion(-eq.x, -eq.y, -eq.z, -eq.w);
		}
		_offset.copy(this.camera.position).sub(startTarget);
		const startDist = _offset.length();
		_offset.copy(endPos).sub(endTarget);
		const endDist = _offset.length();
		this.camTween = {
			kind: 'quatDist',
			startQuat,
			endQuat: eq,
			startDist,
			endDist,
			startTarget: startTarget.clone(),
			endTarget: endTarget.clone(),
			startZoom: this.camera.zoom,
			endZoom,
			distDelay,
			start: performance.now()
		};
	}

	private stepCameraTween() {
		if (!this.camTween) {
			return;
		}
		const t = Math.min(1, (performance.now() - this.camTween.start) / CAMERA_TRANSITION_MS);
		const e = easeInOut(t);
		const tw = this.camTween;
		if (tw.kind === 'face') {
			_tweenTarget.lerpVectors(tw.startTarget, tw.endTarget, e);
			_slerpQuat.slerpQuaternions(tw.startQuat, tw.endQuat, e);
			this.camera.position.copy(defaultCameraPosition).applyQuaternion(_slerpQuat).add(_tweenTarget);
			this.camera.up.copy(_defaultUp).applyQuaternion(_slerpQuat).normalize();
			this.controls.target.copy(_tweenTarget);
			this.camera.lookAt(_tweenTarget);
		} else {
			_tweenTarget.lerpVectors(tw.startTarget, tw.endTarget, e);
			_slerpQuat.slerpQuaternions(tw.startQuat, tw.endQuat, e);
			const distT =
				tw.distDelay > 0
					? easeInOut(Math.min(1, Math.max(0, (t - tw.distDelay) / (1 - tw.distDelay))))
					: e;
			const dist = tw.startDist + (tw.endDist - tw.startDist) * distT;
			_offset.copy(defaultCameraPosition).applyQuaternion(_slerpQuat).normalize().multiplyScalar(dist);
			this.camera.position.copy(_offset).add(_tweenTarget);
			this.camera.up.copy(_defaultUp).applyQuaternion(_slerpQuat).normalize();
			this.controls.target.copy(_tweenTarget);
			this.camera.lookAt(_tweenTarget);
		}
		this.camera.zoom = tw.startZoom + (tw.endZoom - tw.startZoom) * e;
		this.camera.updateProjectionMatrix();
		if (t >= 1) {
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
		}
		const type =
			ev.type === 'wheel'
				? 'wheel'
				: ev.type === 'pointerleave'
					? 'pointerup'
					: ev.type;
		if (type === 'wheel' && ev.deltaY !== undefined) {
			this.controlSurface.dispatchEvent(syntheticWheelEvent(ev.deltaY));
		} else if (type !== 'wheel') {
			this.controlSurface.dispatchEvent(syntheticPointerEvent(ev, type));
		}
		this.picker.handlePointer(ev);
	}

	resetCamera() {
		this.camTween = null;
		this.controls.reset();
		this.camera.position.copy(this.exploded ? explodeCameraPosition : defaultCameraPosition);
		this.camera.up.set(0, 1, 0);
		this.controls.target.set(0, 0, 0);
		this.camera.lookAt(0, 0, 0);
	}

	lookAtFace(faceIndex: number, getFace: (face: number) => DieFaceModel | undefined) {
		if (this.exploded) {
			this.animateQuatDistanceTo(explodeCameraPosition, _defaultUp, _origin);
			return;
		}
		const face = getFace(faceIndex);
		if (!face) {
			return;
		}
		if (this.isExplodeCameraPose()) {
			const { pos, up } = faceCameraPose(face);
			this.animateQuatDistanceTo(pos, up, _origin, face.transform.rotation.clone());
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
