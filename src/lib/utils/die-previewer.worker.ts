// Web Workers have no DOM, so `DOMParser` (used by three's SVGLoader, which the
// custom-path coin parses through) is undefined here. Polyfill it with xmldom so
// custom coin paths render in the offscreen preview exactly as they do on the
// main thread (mirrors the test setup in path_resolve.spec.ts).
import { DOMParser } from 'xmldom';
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
	(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
}

import dice from '$lib/dice';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { Box3, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { Builder } from './builder';
import { deferred } from './deferred';
import { loadImmutableLegends, type SerialisedLegendSet } from './legends';

// Fraction of the frame left empty around the die so tips don't touch the edge.
const PREVIEW_MARGIN = 1.08;

// Position the camera so the entire die fits in frame, keeping whatever view
// direction/up the caller has already set on it. Tall dice (long
// trapezohedrons, crystals, shards) overran the old fixed distance and had
// their tips clipped; this solves for the exact distance instead.
//
// The view axis is fixed by the caller's `applyRotationToCamera` + the unit
// `position` it starts from. We take the die's world bounding box, express each
// of its 8 corners in the camera basis (right/up/viewDir) relative to the box
// centre, and find the smallest distance D (camera back from the centre along
// the view axis) at which every corner still falls inside the frustum: a point
// at forward depth `d` is visible iff |lateral| <= d * tan(fov/2) on each axis
// (aspect is 1). Solving |lateral| <= (D - w) * tan for the worst corner gives
// D; lookAt then recentres on the box.
function fitCamera(camera: PerspectiveCamera, object: import('three').Object3D): void {
	const box = new Box3().setFromObject(object);
	if (box.isEmpty()) {
		camera.position.set(0, 0, 60);
		camera.lookAt(0, 0, 0);
		return;
	}
	const center = box.getCenter(new Vector3());

	// camera basis from the orientation already applied by the caller. `dir`
	// points from the scene toward the camera (camera looks back along -dir).
	const dir = camera.position.clone().normalize();
	const right = new Vector3().crossVectors(dir, camera.up).normalize();
	const up = new Vector3().crossVectors(right, dir).normalize();

	const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);

	let distance = 0;
	let maxDepth = 0;
	const corner = new Vector3();
	for (let xi = 0; xi < 2; xi++) {
		for (let yi = 0; yi < 2; yi++) {
			for (let zi = 0; zi < 2; zi++) {
				corner.set(
					xi ? box.max.x : box.min.x,
					yi ? box.max.y : box.min.y,
					zi ? box.max.z : box.min.z
				);
				corner.sub(center);
				const w = corner.dot(dir); // toward-camera offset from centre
				const lateral = Math.max(Math.abs(corner.dot(right)), Math.abs(corner.dot(up)));
				// camera at center + dir*D sees this corner at depth (D - w); it fits
				// when lateral <= (D - w) * tan, i.e. D >= lateral / tan + w.
				distance = Math.max(distance, (lateral * PREVIEW_MARGIN) / tan + w);
				maxDepth = Math.max(maxDepth, Math.abs(w));
			}
		}
	}

	camera.position.copy(center).addScaledVector(dir, distance);
	// pad the clip planes off the geometry: placing `near` flush at the closest
	// corner clips the front-most face (you'd "see into" the die).
	const pad = maxDepth * 0.1 + 1;
	camera.near = Math.max(0.1, distance - maxDepth - pad);
	camera.far = distance + maxDepth + pad;
	camera.updateProjectionMatrix();
	camera.lookAt(center);
}

type Defined<T> = T extends undefined ? never : T;

const reviver: Defined<Parameters<typeof JSON.parse>[1]> = (key, value) => {
	if (typeof value === 'object' && value && value._ === 'v2') {
		return new Vector2(value.x, value.y);
	}
	return value;
};

// let's do them one by one
let queue = Promise.resolve();

let render: (d: Dice, l: SerialisedLegendSet) => Promise<string>;
function getRenderFunction() {
	if (!render) {
		const boxSize = 256;
		// import code to render die to canvas.
		const scene = new Scene();
		const canvas = new OffscreenCanvas(boxSize, boxSize);
		const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas: canvas });
		renderer.setPixelRatio(1);
		// renderer.setSize(boxSize, boxSize);

		render = function (d: Dice, l: SerialisedLegendSet): Promise<string> {
			const deferral = deferred<string>();
			queue = queue.then(async () => {
				try {
					const legends = loadImmutableLegends(l);
					const builder = new Builder(dice[d.kind], legends, d.id);
					builder.build(
						d.parameters,
						d.face_parameters,
						{ explode: false, ordering: d.legend_ordering },
						d.string_parameters ?? {}
					);
					scene.add(builder.diceGroup);
					const largeFace = builder.getFaces().findLast((x) => x.isNumberFace);
					const camera = new PerspectiveCamera(30, 1, 1, 500);
					// a unit direction; the rotations below only steer the view axis, the
					// distance is solved for afterwards so nothing clips (see fitCamera).
					camera.position.set(0, 0, 1);
					// optional per-model tilt, applied in the face's local frame (before
					// the face orientation) so flat dice show more than a single face.
					builder.getPreviewTransform()?.applyRotationToCamera(camera);
					largeFace?.transform?.applyRotationToCamera(camera);
					fitCamera(camera, builder.diceGroup);
					renderer.render(scene, camera);
					scene.remove(builder.diceGroup);
					const blob = await (renderer.domElement as unknown as OffscreenCanvas).convertToBlob();
					deferral.resolve(URL.createObjectURL(blob));
				} catch (err) {
					deferral.reject(err);
				}
			});
			return deferral.promise;
		};
	}
	return render;
}

self.onmessage = function (event) {
	console.log('worker:recv', event);
	if ((event.data.msg = 'die-preview')) {
		const d = JSON.parse(event.data.die, reviver);
		const l = JSON.parse(event.data.legends);
		getRenderFunction()(d, l)
			.then((url) => {
				console.log('worker:send', { id: d.id, url });
				postMessage({ id: d.id, url });
			})
			.catch((err) => {
				console.error('worker:error rendering die!', err);
			});
	}
};
