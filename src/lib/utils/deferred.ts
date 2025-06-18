export type Deferral<T = undefined> = {
	promise: Promise<T>;
	reject: (reason?: any) => void;
	resolve: (value: T | PromiseLike<T>) => void;
};

export function deferred<T>(): Deferral<T> {
	// TIL this exists!
	return Promise.withResolvers<T>();
}
