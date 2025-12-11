export function debounce<T>(wait: number, fn: (arg: T) => void): (arg: T) => void {
	let timeout: NodeJS.Timeout | null = null;
	return function (arg: T): void {
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => fn(arg), wait);
	};
}
