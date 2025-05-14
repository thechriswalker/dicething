export type Deferral<T = undefined> = {
	promise: Promise<T>;
	reject: (reason?: any) => void;
	resolve: (value: T | PromiseLike<T>) => void;
};

export function deferred<T>(): Deferral<T> {
	let resolve: Deferral<T>['resolve'];
	let reject: Deferral<T>['reject'];
	const promise = new Promise<T>((_rs, _rj) => {
		resolve = _rs;
		reject = _rj;
	});
	return { promise, resolve: resolve!, reject: reject! };
}
