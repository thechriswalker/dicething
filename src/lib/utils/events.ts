import { on } from 'svelte/events';
import { Camera, Object3D, Raycaster, Vector2, Mesh } from 'three';

export function hoverAndClickEvents(
	el: HTMLElement,
	camera: Camera,
	object: Object3D,
	hoverHandler: (ev: SceneMouseEvent) => void = () => {},
	clickHandler: (ev: SceneMouseEvent) => void = () => {}
): () => void {
	const pointer = new Vector2();
	let moved = false;
	const mouseWatcher = (ev: PointerEvent) => {
		pointer.x = (ev.offsetX / el.clientWidth) * 2 - 1;
		pointer.y = -(ev.offsetY / el.clientHeight) * 2 + 1;
		moved = true;
	};
	const mouseMove = on(el, 'pointermove', mouseWatcher);
	// we can't just use "click" as the semantics are pressed and released in the same dom element
	// but we want click to be a short click, as a long press is used for camera controls.
	let clickTimer = 0;
	const clickThreshold = 300; // ms
	const mouseDown = on(el, 'pointerdown', (ev: MouseEvent) => {
		clickTimer = Date.now();
	});
	const mouseUp = on(el, 'pointerup', (ev: MouseEvent) => {
		if (Date.now() - clickTimer < clickThreshold) {
			const res = getIntersection(pointer);
			if (res) {
				clickHandler(res);
			}
		}
		clickTimer = 0;
	});
	const removeListeners = () => {
		mouseDown();
		mouseUp();
		mouseMove();
	};
	const raycaster = new Raycaster();

	const getIntersection = (v: Vector2): SceneMouseEvent | null => {
		raycaster.setFromCamera(v, camera);
		const intersections = raycaster.intersectObject(object, true);
		//console.log(v, intersections);
		// get the first intersection with a "named" object.
		for (let i = 0; i < intersections.length; i++) {
			const o = intersections[i].object;
			if ((o as Mesh).isMesh && 'diceThingId' in o.userData) {
				return { dice: o.userData.diceThingId, face: o.userData.diceThingFace };
			}
		}
		return null;
	};
	// ideally we would hook into the render loop, but because this is external, we have to make our own loop.
	let running = true;
	let last: SceneMouseEvent | null = null;
	const tick = () => {
		if (!running) {
			return;
		}
		if (!moved) {
			requestAnimationFrame(tick);
			return;
		}
		const next = getIntersection(pointer);
		// we do something clever here.
		if (next === null) {
			// "use" the "last" to emit a -1 face on the last dice we saw.
			if (last !== null && last.dice) {
				hoverHandler({ dice: last.dice, face: -1 });
			}
			last = null;
		} else {
			if (last === null) {
				// just emit
				hoverHandler(next);
			} else {
				// has the "dice" changed, if so, emit both the "-1" for the old dice and the event for the new dice
				if (last.dice !== next.dice) {
					hoverHandler({ dice: last.dice, face: -1 });
					hoverHandler(next);
				} else if (last.face !== next.face) {
					// new face on the same die.
					hoverHandler(next);
				}
			}
			last = next;
		}
		moved = false;
		requestAnimationFrame(tick);
	};
	tick();

	return () => {
		removeListeners();
		running = false;
	};
}

// for raycaster events, we do "raycaster" "intersectsObject/s" with an object3d  or array of them.
// so we can use the "faces of the dice as the objects" and go non-recursive?
// either way, it returns by distance, so we can find the "closest" which is what we usually want.
// so for example, our common case will be a "Group" from the builder object.
// and we need to find the face, which will be marked in userData.

export type SceneMouseEvent = {
	dice: string;
	face: number;
};

function clickEvents(
	el: HTMLElement,
	camera: Camera,
	object: Object3D,
	handler: (ev: SceneMouseEvent) => void
): () => void {
	return () => {
		//
	};
}
