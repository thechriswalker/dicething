export function event(
	node: HTMLElement,
	{ name, handler }: { name: string; handler: (e: Event) => void }
) {
	node.addEventListener(name, handler);
	return { destroy: () => node.removeEventListener(name, handler) };
}
