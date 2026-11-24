import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths keep both the root page and /lab/ usable on GitHub Pages.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        lab: 'lab/index.html',
      },
    },
  },
});
