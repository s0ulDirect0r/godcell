// ============================================
// GPU test page - runs compute checks for Playwright (e2e/gpu.spec.ts)
// ============================================

import { WebGPURenderer } from 'three/webgpu';
import {
  checkSoupCurrentsParity,
  type ParityResult,
} from './render/effects/SoupCurrentsDiagnostics';

export interface GpuTestResults {
  backend: 'webgpu' | 'webgl';
  short?: ParityResult; // 4k particles x 120 steps
  long?: ParityResult; // 8k particles x 1200 steps (exercises core respawns)
  error?: string;
}

declare global {
  interface Window {
    __gpuTests?: GpuTestResults;
  }
}

async function run(): Promise<GpuTestResults> {
  const renderer = new WebGPURenderer();
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl';
  try {
    const short = await checkSoupCurrentsParity(renderer);
    const long = await checkSoupCurrentsParity(renderer, { particles: 8192, steps: 1200 });
    return { backend, short, long };
  } finally {
    renderer.dispose();
  }
}

run()
  .catch((err: unknown) => ({ backend: 'webgl' as const, error: String(err) }))
  .then((results) => {
    window.__gpuTests = results;
    document.getElementById('results')!.textContent = JSON.stringify(results, null, 2);
  });
