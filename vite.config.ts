import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide'
		})
	],
	test: {
		workspace: [
			{
				extends: './vite.config.ts',
				plugins: [svelteTesting()],
				test: {
					name: 'client',
					environment: 'jsdom',
					clearMocks: true,
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**', 'src/**/*.slow.{test,spec}.{js,ts}'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/**/*.slow.{test,spec}.{js,ts}'
					]
				}
			},
			{
				// the "slow" suite: exhaustive 3D audits (every glyph on every die's
				// face shapes, etc.). Excluded from the default run; invoke explicitly
				// with `bun run test:slow` after any 3D work. jsdom so the coin's
				// SVGLoader-based path parsing works.
				extends: './vite.config.ts',
				test: {
					name: 'slow',
					environment: 'jsdom',
					include: ['src/**/*.slow.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
