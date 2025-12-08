import { createContext } from 'svelte';
import type { RGB } from '$lib/utils/color';

export type LightDarkContextValue = {
	fgColor: RGB;
	bgColor: RGB;
	isDark: boolean;
	isLight: boolean;
	mode: 'light' | 'dark' | 'system';
};

export const [getLightDarkContext, setLightDarkContext] = createContext<LightDarkContextValue>();
