import { test, expect } from '@playwright/test';
import type { GpuTestResults } from '../client/src/gpu-tests';

test('soup currents compute shader matches its CPU reference', async ({ page }) => {
  await page.goto('/gpu-tests.html');
  const handle = await page.waitForFunction(() => window.__gpuTests, null, { timeout: 90_000 });
  const results = (await handle.jsonValue()) as GpuTestResults;

  expect(results.error).toBeUndefined();
  // A WebGL fallback would still run, but wouldn't be testing the WebGPU path
  expect(results.backend).toBe('webgpu');

  for (const run of [results.short!, results.long!]) {
    expect(run.gpuNonFinite).toBe(0);
    // A handful may diverge when float noise flips a swallow at a core's edge
    expect(run.matchedPct).toBeGreaterThanOrEqual(99.9);
    expect(run.maxError).toBeLessThan(0.05);
  }
  // The long run must actually exercise the respawn (hash) path
  expect(results.long!.respawns).toBeGreaterThan(0);
});
