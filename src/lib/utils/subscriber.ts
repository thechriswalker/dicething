type EmitterWithStop<T> = (fn: (t: T) => void) => () => void;
type EmitterWithout<T> = (fn: (t: T) => void) => void;

type Emitter<T> = EmitterWithStop<T> | EmitterWithout<T>;

const noop = () => {};

export class Subscriber<T> {
	private _listeners: Array<(t: T) => void> = [];
	private _unsub: () => void = noop;

	constructor(private emitter: Emitter<T>) {}

	subscribe(listener: (t: T) => void): () => void {
		this._listeners.push(listener);
		if (this._listeners.length === 1) {
			this._unsub = this.emitter((ev) => this.emit(ev)) ?? noop;
		}
		return () => {
			const index = this._listeners.indexOf(listener);
			this._listeners.splice(index, 1);
			if (this._listeners.length === 0) {
				this._unsub();
				this._unsub = noop;
			}
		};
	}

	private emit(ev: T) {
		this._listeners.forEach((fn) => {
			try {
				fn(ev);
			} catch (e) {
				console.error('error handling event', { event: ev, listener: fn, error: e });
			}
		});
	}
}
