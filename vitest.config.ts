import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Include only .test.ts files (excludes .spec.ts which are Playwright)
    include: ['**/*.test.ts'],
    // Exclude node_modules and Playwright tests
    exclude: ['**/node_modules/**', '**/*.spec.ts', '**/dist/**'],
  },
  resolve: {
    alias: {
      '#shared': path.resolve(__dirname, 'shared/index.ts'),
    },
  },
});
