<script lang="ts">
	let { children, class: classes = '' } = $props();
</script>

<div class={'h-full overflow-y-auto p-2 ' + classes}>
	{@render children?.()}
</div>
