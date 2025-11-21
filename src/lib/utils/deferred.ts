export type Deferral<T = undefined> = PromiseWithResolvers<T>;

export function deferred<T>(): Deferral<T> {
	// TIL this exists! (mostly)
	return withResolvers<T>();
}

const withResolvers =
	typeof Promise.withResolvers === 'undefined'
		? // so we polyfill it.
			(console.warn('polyfilling Promise.withResolvers'),
			function <T>(): Deferral<T> {
				let resolve: Deferral<T>['resolve'];
				let reject: Deferral<T>['reject'];
				const promise = new Promise<T>((res, rej) => {
					resolve = res;
					reject = rej;
				});
				return { promise, resolve: resolve!, reject: reject! };
			})
		: Promise.withResolvers.bind(Promise);
