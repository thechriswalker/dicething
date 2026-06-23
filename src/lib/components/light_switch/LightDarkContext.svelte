<script lang="ts">
	import { browser } from '$app/environment';
	import { getRGB, RGB } from '$lib/utils/color';
	import { type LightDarkContextValue, setLightDarkContext } from './light_dark_context';

	const ctx = $state<LightDarkContextValue>({
		fgColor: new RGB(255, 255, 255),
		bgColor: new RGB(0, 0, 0),
		isLight: false,
		isDark: true,
		mode: 'system'
	});

	// need to set an initial value.
	function darkModeListener() {
		const mode = (localStorage.getItem('light-dark') || 'system') as 'light' | 'dark' | 'system';
		const isDark = document.documentElement.classList.contains('dark');
		const style = window.getComputedStyle(document.body);
		const bgColorCss = style.getPropertyValue('background-color');
		const fgColorCss = style.getPropertyValue('color');

		ctx.fgColor = getRGB(fgColorCss);
		ctx.bgColor = getRGB(bgColorCss);
		ctx.isLight = !isDark;
		ctx.isDark = isDark;
		ctx.mode = mode;
		console.log("light dark context updated", {
			bgColorCss,
			bgColor: ctx.bgColor,
			fgColorCss,
			fgColor: ctx.fgColor,
		});
	}
	if (browser) {
		darkModeListener();
	}
	setLightDarkContext(ctx);

	$effect(() => {
		window.addEventListener('light-dark', darkModeListener);
		return () => {
			window.removeEventListener('light-dark', darkModeListener);
		};
	});

	let { children } = $props();
</script>

{@render children?.()}
