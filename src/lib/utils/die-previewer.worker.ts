import dice from '$lib/dice';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { Builder } from './builder';
import { deferred } from './deferred';
import { loadImmutableLegends, type SerialisedLegendSet } from './legends';
import { createGridHelper } from './scene';
import { vectorRotateX, vectorRotateY, vectorRotateZ } from './3d';

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
					builder.build(d.parameters, d.face_parameters);
					scene.add(builder.diceGroup);
					const largeFace = builder.getFaces().findLast((x) => x.isNumberFace);
					console.log(d.kind, '=>', largeFace);

					const camera = new PerspectiveCamera(30, 1, 1, 500);
					camera.position.set(0, 0, 60);
					largeFace?.transform?.applyRotationToCamera(camera)
					camera.lookAt(new Vector3(0, 0, 0));
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
