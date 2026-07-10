import { Camera, Object3D, Raycaster, Vector2, type Mesh } from 'three';
import type { EnginePointerEvent, EngineSelectionState } from './die_engine_protocol';

export type PickTarget = {
	dieId: string;
	root: Object3D;
	onSelection: (state: EngineSelectionState) => void;
};

export class EnginePicker {
	private pointer = new Vector2();
	private raycaster = new Raycaster();
	private clickTimer = 0;
	private readonly clickThreshold = 300;
	private lastHover: { dieId: string; face: number } | null = null;
	private target: PickTarget | undefined;

	setTarget(target: PickTarget | undefined) {
		this.target = target;
	}

	handlePointer(ev: EnginePointerEvent) {
		if (!this.target) {
			return;
		}
		const { clientWidth, clientHeight } = ev;
		if (clientWidth <= 0 || clientHeight <= 0) {
			return;
		}
		this.pointer.x = (ev.offsetX / clientWidth) * 2 - 1;
		this.pointer.y = -(ev.offsetY / clientHeight) * 2 + 1;

		if (ev.type === 'pointerdown') {
			this.clickTimer = Date.now();
		} else if (ev.type === 'pointermove') {
			this.emitHover();
		} else if (ev.type === 'pointerup') {
			if (Date.now() - this.clickTimer < this.clickThreshold) {
				const hit = this.intersect();
				if (hit) {
					this.target.onSelection({
						dieId: hit.dice,
						hoverFace: hit.face,
						clickFace: hit.face,
						shiftKey: ev.shiftKey,
						altKey: ev.altKey,
						ctrlKey: ev.ctrlKey,
						metaKey: ev.metaKey
					});
				}
			}
			this.clickTimer = 0;
		} else if (ev.type === 'pointerleave') {
			if (this.lastHover) {
				this.target.onSelection({
					dieId: this.lastHover.dieId,
					hoverFace: -1
				});
				this.lastHover = null;
			}
		}
	}

	private intersect(): { dice: string; face: number } | null {
		if (!this.target) {
			return null;
		}
		this.raycaster.setFromCamera(this.pointer, this.getCamera());
		const hits = this.raycaster.intersectObject(this.target.root, true);
		for (const hit of hits) {
			const o = hit.object;
			if ((o as Mesh).isMesh && 'diceThingId' in o.userData) {
				return { dice: o.userData.diceThingId as string, face: o.userData.diceThingFace as number };
			}
		}
		return null;
	}

	private getCamera(): Camera {
		return (this as unknown as { _camera: Camera })._camera;
	}

	setCamera(camera: Camera) {
		(this as unknown as { _camera: Camera })._camera = camera;
	}

	private emitHover() {
		if (!this.target) {
			return;
		}
		const next = this.intersect();
		if (!next) {
			if (this.lastHover) {
				this.target.onSelection({ dieId: this.lastHover.dieId, hoverFace: -1 });
				this.lastHover = null;
			}
			return;
		}
		if (!this.lastHover || this.lastHover.face !== next.face || this.lastHover.dieId !== next.dice) {
			this.target.onSelection({ dieId: next.dice, hoverFace: next.face });
			this.lastHover = { dieId: next.dice, face: next.face };
		}
	}
}
