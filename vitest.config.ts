import { defineConfig } from 'vitest/config';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    // Include only .test.ts files (excludes .spec.ts which are Playwright)
    include: ['**/*.test.ts'],
    // Exclude node_modules and Playwright tests
    exclude: ['**/node_modules/**', '**/*.spec.ts', '**/dist/**'],
    // Shared setup for server system tests (mocks modules with side effects)
    setupFiles: ['./server/src/ecs/systems/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '#shared': path.resolve(__dirname, 'shared/index.ts'),
    },
  },
});
