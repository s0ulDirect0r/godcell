// ============================================
// Soup Currents Diagnostics - turn GPU particle state into numbers
// ============================================

import { GAME_CONFIG } from '#shared';
import type { WebGPURenderer } from 'three/webgpu';
import { SoupCurrents } from './SoupCurrents';
import {
  CURRENT_BOUNDS,
  SOUP_CURRENTS,
  seedCurrentParticles,
  seededRandom,
  stepCurrentsCPU,
  type CurrentWell,
} from './soupCurrentsSim';

export interface WellStats {
  x: number;
  y: number;
  inside: number; // Particles within the well's radius
  densityRatio: number; // Particle density inside vs. the soup average (1 = same, < 1 = drained)
  glowing: number; // Particles inside moving fast enough to glow
}

export interface SoupCurrentStats {
  count: number;
  nonFinite: number; // NaN/Infinity positions or speeds: always a bug
  outOfBounds: number; // Outside the soup plus wrap margin: always a bug
  meanSpeed: number; // Px/s
  maxSpeed: number;
  glowing: number; // Speed >= GLOW_SPEED_MIN anywhere
  wells: WellStats[];
}

/**
 * Summarize a readback of the soup current buffers. Pure, so it can be unit
 * tested and run on CPU-reference output as well as GPU output.
 *
 * @param positions - Interleaved game-space (x, y) per particle
 * @param speeds - Speed (px/s) per particle
 */
export function summarizeCurrents(
  positions: Float32Array,
  speeds: Float32Array,
  wells: readonly CurrentWell[]
): SoupCurrentStats {
  const count = speeds.length;
  const margin = SOUP_CURRENTS.WRAP_MARGIN + 0.01;
  const minX = GAME_CONFIG.SOUP_ORIGIN_X - margin;
  const maxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH + margin;
  const minY = GAME_CONFIG.SOUP_ORIGIN_Y - margin;
  const maxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT + margin;

  const wellStats: WellStats[] = wells.map((w) => ({
    x: w.x,
    y: w.y,
    inside: 0,
    densityRatio: 0,
    glowing: 0,
  }));
  let nonFinite = 0;
  let outOfBounds = 0;
  let speedSum = 0;
  let maxSpeed = 0;
  let glowing = 0;

  for (let i = 0; i < count; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    const speed = speeds[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(speed)) {
      nonFinite++;
      continue;
    }
    if (x < minX || x > maxX || y < minY || y > maxY) outOfBounds++;
    speedSum += speed;
    if (speed > maxSpeed) maxSpeed = speed;
    const isGlowing = speed >= SOUP_CURRENTS.GLOW_SPEED_MIN;
    if (isGlowing) glowing++;

    for (let w = 0; w < wells.length; w++) {
      const dx = x - wells[w].x;
      const dy = y - wells[w].y;
      if (dx * dx + dy * dy < wells[w].radius * wells[w].radius) {
        wellStats[w].inside++;
        if (isGlowing) wellStats[w].glowing++;
      }
    }
  }

  const soupArea = GAME_CONFIG.SOUP_WIDTH * GAME_CONFIG.SOUP_HEIGHT;
  const averageDensity = count / soupArea;
  wellStats.forEach((s, w) => {
    const area = Math.PI * wells[w].radius * wells[w].radius;
    s.densityRatio = averageDensity > 0 ? s.inside / area / averageDensity : 0;
  });

  const finite = count - nonFinite;
  return {
    count,
    nonFinite,
    outOfBounds,
    meanSpeed: finite > 0 ? speedSum / finite : 0,
    maxSpeed,
    glowing,
    wells: wellStats,
  };
}

// ============================================
// GPU vs CPU parity check
// ============================================

export interface ParityResult {
  particles: number;
  steps: number;
  matched: number; // Particles whose GPU and CPU positions agree within tolerance
  matchedPct: number;
  maxError: number; // Px, among matched particles
  diverged: number; // Usually a few: float noise can flip a swallow-or-not decision at a core's edge
  gpuNonFinite: number;
  respawns: number; // Core swallows during the run (CPU side); > 0 means the hash path was exercised
}

/** Fixed well layout for parity checks (spread across the soup, cores included) */
export const PARITY_WELLS: CurrentWell[] = [
  { x: GAME_CONFIG.SOUP_ORIGIN_X + 1200, y: GAME_CONFIG.SOUP_ORIGIN_Y + 900, radius: 700 },
  { x: GAME_CONFIG.SOUP_ORIGIN_X + 3400, y: GAME_CONFIG.SOUP_ORIGIN_Y + 1200, radius: 700 },
  { x: GAME_CONFIG.SOUP_ORIGIN_X + 2300, y: GAME_CONFIG.SOUP_ORIGIN_Y + 2500, radius: 700 },
];

/**
 * Run a small seeded SoupCurrents on the GPU and the CPU reference side by side
 * for `steps` fixed steps, then compare positions. A high match rate means the
 * compute shader does what stepCurrentsCPU (and its unit tests) say it does.
 */
export async function checkSoupCurrentsParity(
  renderer: WebGPURenderer,
  { particles = 4096, steps = 120, dt = 1 / 60, tolerance = 0.05, seed = 1234 } = {}
): Promise<ParityResult> {
  await renderer.init();
  const gpu = new SoupCurrents(particles, seededRandom(seed));
  const cpu = seedCurrentParticles(particles, seededRandom(seed));
  const cpuFlows = new Float32Array(particles * 2);
  const stepDt = Math.min(dt, SOUP_CURRENTS.MAX_DT);
  let respawns = 0;

  try {
    for (let s = 0; s < steps; s++) {
      gpu.update(stepDt, PARITY_WELLS);
      renderer.compute(gpu.computeNode);
      respawns += stepCurrentsCPU(
        cpu.positions,
        cpu.velocities,
        cpuFlows,
        PARITY_WELLS,
        stepDt,
        gpu.seed
      );
    }
    const gpuPositions = new Float32Array(
      await renderer.getArrayBufferAsync(gpu.buffers.positions)
    );

    const { spanX, spanY } = CURRENT_BOUNDS;
    let matched = 0;
    let maxError = 0;
    let gpuNonFinite = 0;
    for (let i = 0; i < particles; i++) {
      const gx = gpuPositions[i * 2];
      const gy = gpuPositions[i * 2 + 1];
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
        gpuNonFinite++;
        continue;
      }
      // Wrap-aware distance: a particle on the seam may sit on opposite edges
      let dx = Math.abs(gx - cpu.positions[i * 2]);
      let dy = Math.abs(gy - cpu.positions[i * 2 + 1]);
      dx = Math.min(dx, spanX - dx);
      dy = Math.min(dy, spanY - dy);
      const error = Math.hypot(dx, dy);
      if (error <= tolerance) {
        matched++;
        if (error > maxError) maxError = error;
      }
    }
    return {
      particles,
      steps,
      matched,
      matchedPct: (100 * matched) / particles,
      maxError,
      diverged: particles - matched - gpuNonFinite,
      gpuNonFinite,
      respawns,
    };
  } finally {
    gpu.dispose();
  }
}
