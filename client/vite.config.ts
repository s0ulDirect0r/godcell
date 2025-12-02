import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
    // Watch for changes in the shared package
    watch: {
      ignored: ['!**/node_modules/@godcell/**'],
    },
  },
  // Don't pre-bundle the shared package so changes are picked up immediately
  optimizeDeps: {
    exclude: ['@godcell/shared'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'model-viewer.html'),
      },
    },
  },
});
