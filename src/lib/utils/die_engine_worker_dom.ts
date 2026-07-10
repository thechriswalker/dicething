// Minimal DOM shims for three.js TrackballControls inside a dedicated worker.
// Controls.connect() registers key listeners on `window` and pointer listeners on
// the domElement; handleResize() reads getBoundingClientRect + pageXOffset.

export function installWorkerWindowPolyfill(): void {
	if (typeof window !== 'undefined') {
		return;
	}
	(globalThis as Record<string, unknown>).window = {
		addEventListener: () => {},
		removeEventListener: () => {},
		pageXOffset: 0,
		pageYOffset: 0,
		devicePixelRatio: 1
	};
}

type Listener = (ev: Event) => void;

export class WorkerControlSurface {
	private listeners = new Map<string, Set<Listener>>();
	readonly style = { touchAction: '' };
	readonly ownerDocument = {
		documentElement: { clientLeft: 0, clientTop: 0 }
	};

	constructor(
		private w: number,
		private h: number
	) {}

	setSize(width: number, height: number) {
		this.w = width;
		this.h = height;
	}

	get clientWidth() {
		return this.w;
	}

	get clientHeight() {
		return this.h;
	}

	getBoundingClientRect(): DOMRect {
		return {
			left: 0,
			top: 0,
			right: this.w,
			bottom: this.h,
			width: this.w,
			height: this.h,
			x: 0,
			y: 0,
			toJSON: () => ({})
		} as DOMRect;
	}

	addEventListener(type: string, listener: Listener, _options?: unknown) {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(listener);
	}

	removeEventListener(type: string, listener: Listener) {
		this.listeners.get(type)?.delete(listener);
	}

	dispatchEvent(event: Event): boolean {
		const set = this.listeners.get(event.type);
		if (set) {
			for (const fn of set) {
				fn(event);
			}
		}
		return true;
	}

	setPointerCapture(_pointerId: number) {}

	releasePointerCapture(_pointerId: number) {}
}

// TrackballControls reads pageX/pageY (not just clientX/Y). Worker PointerEvents
// often leave pageX at 0, which breaks rotation/zoom math.
export function syntheticPointerEvent(
	ev: {
		offsetX: number;
		offsetY: number;
		buttons: number;
		button?: number;
		pointerId?: number;
		shiftKey: boolean;
		altKey: boolean;
		ctrlKey: boolean;
		metaKey: boolean;
	},
	type: 'pointerdown' | 'pointermove' | 'pointerup'
): Event {
	const pageX = ev.offsetX;
	const pageY = ev.offsetY;
	return {
		type,
		pointerType: 'mouse',
		pointerId: ev.pointerId ?? 1,
		button: ev.button ?? 0,
		buttons: ev.buttons,
		clientX: pageX,
		clientY: pageY,
		pageX,
		pageY,
		shiftKey: ev.shiftKey,
		altKey: ev.altKey,
		ctrlKey: ev.ctrlKey,
		metaKey: ev.metaKey,
		preventDefault: () => {},
		stopPropagation: () => {}
	} as unknown as Event;
}

export function syntheticWheelEvent(deltaY: number): Event {
	return {
		type: 'wheel',
		deltaY,
		deltaMode: 0,
		preventDefault: () => {},
		stopPropagation: () => {}
	} as unknown as Event;
}
