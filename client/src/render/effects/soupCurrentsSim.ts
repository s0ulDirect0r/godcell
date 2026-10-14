// ============================================
// Soup Currents Simulation - constants + CPU reference
// ============================================
//
// The GPU compute shader in SoupCurrents.ts is the real simulation. This file
// holds its tuning constants and a CPU mirror of one simulation step, so the
// behavior can be unit tested in Node and compared against GPU readback
// (see checkSoupCurrentsParity in SoupCurrentsDiagnostics.ts). Keep
// stepCurrentsCPU in sync with SoupCurrents.buildCompute.

import { GAME_CONFIG } from '#shared';

/** A gravity well as the current sees it (game space) */
export interface CurrentWell {
  x: number;
  y: number;
  radius: number;
}

/** Visual tuning for the Stage 1 background current */
export const SOUP_CURRENTS = {
  COUNT: 50_000, // Particle count. Range: 20k-200k; the CPU path topped out around 600
  STREAK_SECONDS: 0.3, // Streak length = speed * this (a motion trail). Higher = longer comet tails
  STREAK_MIN_LENGTH: 3, // Game px; slow drift still reads as a short dash
  STREAK_MAX_LENGTH: 40, // Game px cap so core-diving particles don't become long lines
  STREAK_WIDTH: 0.9, // Game px (~2 screen px at Stage 1 zoom). Range: 0.5-1.5
  OPACITY: 0.55, // Head opacity of slow particles; the tail fades to 0. Range: 0.3-0.8
  HEIGHT: -0.8, // World Y, below entities (same as the old particles)
  WRAP_MARGIN: 10, // Px past the soup edge before a particle wraps to the other side
  PULL_SPEED: 70, // Px/s toward a well at its center, fading to 0 at its edge (squared falloff)
  SWIRL_RATIO: 1.0, // Tangential speed as a fraction of pull; higher = particles orbit longer before the core takes them
  GLOW_SPEED_MIN: 45, // Px/s where speed tinting starts (drift alone is 10-40, so only pulled particles glow)
  GLOW_SPEED_MAX: 140, // Px/s where particles reach full glow color/opacity
  GLOW_COLOR: 0xccffee, // Near-white mint: fast particles read as bright streaks in the spiral arms
  MAX_WELLS: 16, // Wells beyond this are ignored by the current (a soup has a handful)
  MAX_DT: 0.1, // Seconds; clamps long frames (tab switch) so particles don't jump across the soup
  SEED_PERIOD: 100_000, // Respawn seed counter wraps here (stays exact in float32)
};

/** Wrap bounds shared by GPU and CPU (soup plus margin) */
export const CURRENT_BOUNDS = {
  minX: GAME_CONFIG.SOUP_ORIGIN_X - SOUP_CURRENTS.WRAP_MARGIN,
  minY: GAME_CONFIG.SOUP_ORIGIN_Y - SOUP_CURRENTS.WRAP_MARGIN,
  spanX: GAME_CONFIG.SOUP_WIDTH + SOUP_CURRENTS.WRAP_MARGIN * 2,
  spanY: GAME_CONFIG.SOUP_HEIGHT + SOUP_CURRENTS.WRAP_MARGIN * 2,
};

/** Seed positions across the soup and the diagonal drift the old CPU particles used */
export function seedCurrentParticles(count: number, random: () => number = Math.random) {
  const positions = new Float32Array(count * 2);
  const velocities = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    positions[i * 2] = GAME_CONFIG.SOUP_ORIGIN_X + random() * GAME_CONFIG.SOUP_WIDTH;
    positions[i * 2 + 1] = GAME_CONFIG.SOUP_ORIGIN_Y + random() * GAME_CONFIG.SOUP_HEIGHT;
    // 45 degrees +/- 45 degrees, same speed range as before
    const angle = Math.PI / 4 + ((random() - 0.5) * Math.PI) / 2;
    const speed =
      GAME_CONFIG.PARTICLE_SPEED_MIN +
      random() * (GAME_CONFIG.PARTICLE_SPEED_MAX - GAME_CONFIG.PARTICLE_SPEED_MIN);
    velocities[i * 2] = Math.cos(angle) * speed;
    velocities[i * 2 + 1] = Math.sin(angle) * speed;
  }
  return { positions, velocities };
}

/** Small seeded PRNG (mulberry32) for reproducible seeding in tests and parity checks */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mirror of TSL `hash(seed)` (PCG; three/src/nodes/math/Hash.js), including its float32 output */
export function tslHash(seed: number): number {
  const state = (Math.imul(Math.trunc(seed) >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
  const result = ((word >>> 22) ^ word) >>> 0;
  return Math.fround(Math.fround(result) * Math.fround(1 / 2 ** 32));
}

/** GLSL-style mod (always non-negative for positive y), as TSL `mod` behaves */
function floorMod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

/**
 * Advance every particle one step: drift + pull/swirl toward wells, respawn if a
 * core swallowed it, wrap at the soup edges. Writes the step's flow velocity
 * into `flows`. Mirrors SoupCurrents.buildCompute.
 *
 * @param seed - The respawn seed for this step (the GPU's uSeed value)
 * @returns How many particles a core swallowed (and respawned) this step
 */
export function stepCurrentsCPU(
  positions: Float32Array,
  velocities: Float32Array,
  flows: Float32Array,
  wells: readonly CurrentWell[],
  dt: number,
  seed: number
): number {
  const count = positions.length / 2;
  let respawned = 0;
  const wellCount = Math.min(wells.length, SOUP_CURRENTS.MAX_WELLS);
  const coreRadius = GAME_CONFIG.OBSTACLE_CORE_RADIUS;
  const { minX, minY, spanX, spanY } = CURRENT_BOUNDS;

  for (let i = 0; i < count; i++) {
    let px = positions[i * 2];
    let py = positions[i * 2 + 1];
    let fx = velocities[i * 2];
    let fy = velocities[i * 2 + 1];
    let swallowed = false;

    for (let w = 0; w < wellCount; w++) {
      const well = wells[w];
      const tx = well.x - px;
      const ty = well.y - py;
      const dist = Math.max(Math.hypot(tx, ty), 1);
      if (dist < well.radius) {
        const falloff = 1 - dist / well.radius;
        const dx = tx / dist;
        const dy = ty / dist;
        const strength = falloff * falloff * SOUP_CURRENTS.PULL_SPEED;
        // Swirl: the pull direction rotated +90 degrees, (-dy, dx)
        fx += (dx - dy * SOUP_CURRENTS.SWIRL_RATIO) * strength;
        fy += (dy + dx * SOUP_CURRENTS.SWIRL_RATIO) * strength;
        if (dist < coreRadius) swallowed = true;
      }
    }

    px += fx * dt;
    py += fy * dt;

    if (swallowed) {
      respawned++;
      const n = i + seed;
      px = tslHash(n) * GAME_CONFIG.SOUP_WIDTH + GAME_CONFIG.SOUP_ORIGIN_X;
      py = tslHash(n + 7.13) * GAME_CONFIG.SOUP_HEIGHT + GAME_CONFIG.SOUP_ORIGIN_Y;
    }

    positions[i * 2] = floorMod(px - minX, spanX) + minX;
    positions[i * 2 + 1] = floorMod(py - minY, spanY) + minY;
    flows[i * 2] = fx;
    flows[i * 2 + 1] = fy;
  }
  return respawned;
}
