import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname),
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '#shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../dist/client'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'model-viewer.html'),
        sphere: resolve(__dirname, 'sphere-test.html'),
      },
    },
  },
});
