import { describe, it, expect } from 'vitest';
import { GAME_CONFIG } from '#shared';
import {
  CURRENT_BOUNDS,
  SOUP_CURRENTS,
  seedCurrentParticles,
  seededRandom,
  stepCurrentsCPU,
  tslHash,
  type CurrentWell,
} from '../soupCurrentsSim';
import { summarizeCurrents } from '../SoupCurrentsDiagnostics';

const SOUP_CENTER = {
  x: GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2,
  y: GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2,
};
const WELL: CurrentWell = { x: SOUP_CENTER.x, y: SOUP_CENTER.y, radius: 700 };

/** One particle with an explicit position and drift velocity */
function particle(x: number, y: number, vx = 0, vy = 0) {
  return {
    positions: new Float32Array([x, y]),
    velocities: new Float32Array([vx, vy]),
    flows: new Float32Array(2),
  };
}

function step(p: ReturnType<typeof particle>, wells: CurrentWell[], dt = 0.1, seed = 1) {
  return stepCurrentsCPU(p.positions, p.velocities, p.flows, wells, dt, seed);
}

describe('tslHash', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const h = tslHash(i);
      expect(h).toBe(tslHash(i));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('spreads neighbouring seeds roughly uniformly', () => {
    let sum = 0;
    for (let i = 0; i < 10_000; i++) sum += tslHash(i);
    expect(sum / 10_000).toBeCloseTo(0.5, 1);
    expect(tslHash(1)).not.toBe(tslHash(2));
  });
});

describe('seedCurrentParticles', () => {
  it('places particles in the soup with the old diagonal drift', () => {
    const { positions, velocities } = seedCurrentParticles(500, seededRandom(7));
    for (let i = 0; i < 500; i++) {
      expect(positions[i * 2]).toBeGreaterThanOrEqual(GAME_CONFIG.SOUP_ORIGIN_X);
      expect(positions[i * 2]).toBeLessThanOrEqual(
        GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH
      );
      const vx = velocities[i * 2];
      const vy = velocities[i * 2 + 1];
      const speed = Math.hypot(vx, vy);
      expect(speed).toBeGreaterThanOrEqual(GAME_CONFIG.PARTICLE_SPEED_MIN - 1e-3);
      expect(speed).toBeLessThanOrEqual(GAME_CONFIG.PARTICLE_SPEED_MAX + 1e-3);
      // 45 deg +/- 45 deg: both components non-negative
      expect(vx).toBeGreaterThanOrEqual(-1e-3);
      expect(vy).toBeGreaterThanOrEqual(-1e-3);
    }
  });

  it('is reproducible with the same seed', () => {
    const a = seedCurrentParticles(50, seededRandom(42));
    const b = seedCurrentParticles(50, seededRandom(42));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});

describe('stepCurrentsCPU', () => {
  it('drifts by velocity * dt with no wells', () => {
    const p = particle(SOUP_CENTER.x, SOUP_CENTER.y, 20, 10);
    step(p, [], 0.5);
    expect(p.positions[0]).toBeCloseTo(SOUP_CENTER.x + 10, 3);
    expect(p.positions[1]).toBeCloseTo(SOUP_CENTER.y + 5, 3);
    expect(Array.from(p.flows)).toEqual([20, 10]);
  });

  it('wraps past the soup edge to the opposite side', () => {
    const { minX, spanX } = CURRENT_BOUNDS;
    const p = particle(minX + spanX - 1, SOUP_CENTER.y, 40, 0);
    step(p, [], 0.1); // +4 px: 3 px past the far edge
    expect(p.positions[0]).toBeCloseTo(minX + 3, 3);
  });

  it('ignores wells whose radius it is outside of', () => {
    const p = particle(WELL.x + WELL.radius + 50, WELL.y);
    step(p, [WELL]);
    expect(Array.from(p.flows)).toEqual([0, 0]);
  });

  it('pulls toward a well and swirls perpendicular to the pull', () => {
    const p = particle(WELL.x + 300, WELL.y); // +x of the well
    step(p, [WELL]);
    // Pull direction (-1, 0); swirl is it rotated +90 degrees: (-dy, dx) = (0, -1)
    expect(p.flows[0]).toBeLessThan(0);
    expect(p.flows[1]).toBeLessThan(0);
    expect(Math.abs(p.flows[1])).toBeCloseTo(Math.abs(p.flows[0]) * SOUP_CURRENTS.SWIRL_RATIO, 3);
    expect(p.positions[0]).toBeLessThan(WELL.x + 300);
  });

  it('pulls harder closer to the well', () => {
    const near = particle(WELL.x + 150, WELL.y);
    const far = particle(WELL.x + 550, WELL.y);
    step(near, [WELL]);
    step(far, [WELL]);
    expect(Math.hypot(near.flows[0], near.flows[1])).toBeGreaterThan(
      Math.hypot(far.flows[0], far.flows[1])
    );
  });

  it('respawns a swallowed particle somewhere in the soup, deterministically', () => {
    const a = particle(WELL.x + 10, WELL.y);
    const b = particle(WELL.x + 10, WELL.y);
    expect(step(a, [WELL], 0.1, 99)).toBe(1);
    step(b, [WELL], 0.1, 99);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Math.hypot(a.positions[0] - WELL.x, a.positions[1] - WELL.y)).toBeGreaterThan(
      GAME_CONFIG.OBSTACLE_CORE_RADIUS
    );
  });

  it('stays finite for a particle exactly on a well center', () => {
    const p = particle(WELL.x, WELL.y);
    step(p, [WELL]);
    expect(Array.from(p.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(p.flows).every(Number.isFinite)).toBe(true);
  });

  it('ignores wells beyond MAX_WELLS', () => {
    const decoys = Array.from({ length: SOUP_CURRENTS.MAX_WELLS }, () => ({
      x: 0,
      y: 0,
      radius: 1,
    }));
    const p = particle(WELL.x + 300, WELL.y);
    step(p, [...decoys, WELL]);
    expect(Array.from(p.flows)).toEqual([0, 0]);
  });
});

describe('summarizeCurrents', () => {
  it('flags non-finite and out-of-bounds particles', () => {
    const positions = new Float32Array([SOUP_CENTER.x, SOUP_CENTER.y, NaN, 0, 0, 0]);
    const speeds = new Float32Array([10, 10, 10]);
    const stats = summarizeCurrents(positions, speeds, []);
    expect(stats.nonFinite).toBe(1);
    expect(stats.outOfBounds).toBe(1);
    expect(stats.meanSpeed).toBe(10);
  });

  it('reports ~1.0 density for a uniform spread and counts glowing particles', () => {
    const { positions } = seedCurrentParticles(20_000, seededRandom(3));
    const speeds = new Float32Array(20_000).fill(SOUP_CURRENTS.GLOW_SPEED_MIN);
    const stats = summarizeCurrents(positions, speeds, [WELL]);
    expect(stats.wells[0].densityRatio).toBeGreaterThan(0.9);
    expect(stats.wells[0].densityRatio).toBeLessThan(1.1);
    expect(stats.glowing).toBe(20_000);
  });
});
