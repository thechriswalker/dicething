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
		value = $bindable(undefined),
		defaultValue = null,
		collapsible = true
	}: {
		children?: Snippet;
		// optional controlled value: bind:value to drive which section is open from
		// the parent (and to read the currently open one).
		value?: string | null;
		defaultValue?: string | null;
		collapsible?: boolean;
	} = $props();

	let openValue = $state<string | null>(value ?? defaultValue);

	// mirror external (bound) value changes into the internal open state.
	$effect(() => {
		if (value !== undefined && value !== openValue) {
			openValue = value;
		}
	});

	setContext<CollapsibleGroupContext>(COLLAPSIBLE_GROUP_KEY, {
		get open() {
			return openValue;
		},
		setOpen(next) {
			openValue = next;
			// propagate to the bound parent value (no-op when uncontrolled).
			value = next;
		},
		collapsible
	});
</script>

{@render children?.()}
