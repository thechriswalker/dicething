# dicething

A sveltekit app for modelling and building 3d models of Dice.
A lot of geometry and math.

## Technology

- TypeScript via bun as a development runtime.
- Sveltkit builds to a static output site, all data is client side.
- Three.js for 3d rendering, geometries and STL output.
- opentype.js for font handling.
- skeleton-ui for UI components and theming
- lucide-icons for icons.

## Testing and code execution.

Always use `bun` over `node`/`npx`. 
Use `bun run vite-node ...args` to run scripts with the correct module import mappings for sveltekits `$lib/module` style imports.

Test are run via `bun run test ...args` (runs vitest) with the correct configuration.

