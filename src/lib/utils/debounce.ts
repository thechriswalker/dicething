export type Debounced<T> = ((arg: T) => void) & {
	// run any pending call immediately (with the most recent argument).
	flush: () => void;
	// drop any pending call without running it.
	cancel: () => void;
};

export function debounce<T>(wait: number, fn: (arg: T) => void): Debounced<T> {
	let timeout: NodeJS.Timeout | null = null;
	let pending: { arg: T } | null = null;

	const debounced = function (arg: T): void {
		pending = { arg };
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			timeout = null;
			const p = pending;
			pending = null;
			if (p) {
				fn(p.arg);
			}
		}, wait);
	} as Debounced<T>;

	debounced.flush = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		const p = pending;
		pending = null;
		if (p) {
			fn(p.arg);
		}
	};

	debounced.cancel = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		pending = null;
	};

	return debounced;
}
