<script lang="ts" module>
	export const COLLAPSIBLE_GROUP_KEY = Symbol('collapsible-group');

	export type CollapsibleGroupContext = {
		get open(): string | null;
		setOpen: (value: string | null) => void;
		collapsible: boolean;
	};
</script>

<script lang="ts">
	import { setContext, type Snippet } from 'svelte';

	let {
		children,
		defaultValue = null,
		collapsible = true
	}: {
		children?: Snippet;
		defaultValue?: string | null;
		collapsible?: boolean;
	} = $props();

	let openValue = $state<string | null>(defaultValue);

	setContext<CollapsibleGroupContext>(COLLAPSIBLE_GROUP_KEY, {
		get open() {
			return openValue;
		},
		setOpen(value) {
			openValue = value;
		},
		collapsible
	});
</script>

{@render children?.()}
