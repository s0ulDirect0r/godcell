import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@godcell/shared': path.resolve(__dirname, '../shared/index.ts'),
    },
  },
});
