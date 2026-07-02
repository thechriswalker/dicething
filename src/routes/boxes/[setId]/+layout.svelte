<script lang="ts">
    import Layout from '$lib/components/layout/Layout.svelte';
    let { children } = $props();
</script>

<Layout>
    {@render children()}
</Layout>