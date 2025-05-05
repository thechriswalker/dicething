// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	// added by LightMode.svelte
	interface Window {
		updateLightDark(mode: 'light' | 'dark' | '');
		getLightDark(): { mode: 'light' | 'dark' | ''; isDark: boolean; isLight: boolean };
	}
}

export {};
