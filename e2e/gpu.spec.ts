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

test('swarm corona compute shader matches its CPU reference', async ({ page }) => {
  await page.goto('/gpu-tests.html');
  const handle = await page.waitForFunction(() => window.__gpuTests, null, { timeout: 90_000 });
  const results = (await handle.jsonValue()) as GpuTestResults;

  expect(results.error).toBeUndefined();
  expect(results.backend).toBe('webgpu');
  const scenarios = results.corona!.scenarios;
  expect(scenarios.map((s) => s.name)).toEqual(['idle', 'moving-arc', 'chase-arc']);

  for (const s of scenarios) {
    expect(s.gpuNonFinite, s.name).toBe(0);
    expect(s.positionMatchedPct, s.name).toBeGreaterThanOrEqual(99.9);
    expect(s.velocityMatchedPct, s.name).toBeGreaterThanOrEqual(99.5);
  }
  // Idle has no tail; moving scenarios must actually exercise the path-following tail
  expect(scenarios[0].tailParticles).toBe(0);
  expect(scenarios[1].tailParticles).toBeGreaterThan(100);
  expect(scenarios[2].tailParticles).toBeGreaterThan(100);
});
