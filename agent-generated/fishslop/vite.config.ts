import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  // three.js alone is ~600 kB minified; that's expected for a 3D game.
  build: { chunkSizeWarningLimit: 900 },
});
