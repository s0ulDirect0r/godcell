import { defineConfig, devices } from '@playwright/test';

const PORT = 5174; // Separate from the dev client (5173) so tests can run alongside it

/**
 * Browser tests that need a real GPU (WebGPU compute parity, etc.).
 * Run with `npm run test:gpu`. Unit tests stay in vitest (`npm test`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    {
      name: 'chromium-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium (new headless) rather than the stripped headless shell, which lacks WebGPU
        channel: 'chromium',
        launchOptions: { args: ['--enable-unsafe-webgpu'] },
      },
    },
  ],
  webServer: {
    // Client only: GPU tests don't need the game server
    command: `npx vite client --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/gpu-tests.html`,
    reuseExistingServer: !process.env.CI,
  },
});
