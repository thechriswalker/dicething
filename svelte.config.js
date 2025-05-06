import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isSplashPage = process.env.BUILD_SPLASH_PAGE === 'true';

const buildDir = isSplashPage ? 'build_splash' : 'build_app';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: isSplashPage ? undefined : 'app.html',
			pages: buildDir,
			assets: buildDir
		}),
		files: {
			// THIS IS THE IMPORTANT BIT, change the routes to render based on the
			// the ENV
			routes: isSplashPage ? 'src/routes/splash' : 'src/routes/app'
		}
	}
};

export default config;
