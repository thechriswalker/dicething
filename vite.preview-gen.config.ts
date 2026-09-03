import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// Headless catalogue rasteriser: no HMR / file watching so long Playwright
// evaluate calls are not killed by a spurious full reload.
export default mergeConfig(
	base,
	defineConfig({
		server: {
			hmr: false,
			watch: null
		}
	})
);
