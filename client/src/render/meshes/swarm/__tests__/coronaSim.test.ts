import { describe, it, expect } from 'vitest';
import {
  CORONA,
  CORONA_TRAIL,
  coronaPositionCPU,
  coronaStepCPU,
  coronaSurfaceCPU,
  coronaTailStateCPU,
  samplePath,
  type CoronaParams,
  type PathSample,
} from '../coronaSim';
import { tslHash } from '../../../effects/soupCurrentsSim';

const RADIUS = 47;
const H = CORONA_TRAIL.HISTORY;

/** Params for a swarm moving at `move` px/s in a straight line for a while */
function movingParams(move: [number, number], overrides: Partial<CoronaParams> = {}): CoronaParams {
  const trail = new Float32Array(H * 2);
  for (let k = 0; k < H; k++) {
    const back = k * CORONA_TRAIL.SAMPLE_INTERVAL;
    trail[k * 2] = -move[0] * back;
    trail[k * 2 + 1] = -move[1] * back;
  }
  return { count: 200, radius: RADIUS, time: 3.7, dt: 1 / 60, chase: 0, move, trail, ...overrides };
}

const isFlare = (n: number) => tslHash(n + 12.9) <= CORONA.FLARE_CHANCE;
const isTailCandidate = (n: number) => tslHash(n + 31.4) <= CORONA_TRAIL.CHANCE;

describe('samplePath', () => {
  it('writes zeros for an empty path', () => {
    const out = new Float32Array(H * 2).fill(7);
    samplePath([], 1, out);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('gives offsets back along a straight path, relative to the newest point', () => {
    // 2s of motion at (100, 50) px/s, sampled every frame
    const path: PathSample[] = [];
    for (let i = 0; i <= 120; i++) path.push({ t: i / 60, x: 100 * (i / 60), y: 50 * (i / 60) });
    const out = new Float32Array(H * 2);
    samplePath(path, 2, out);
    for (const k of [0, 10, 40, 63]) {
      const back = k * CORONA_TRAIL.SAMPLE_INTERVAL;
      expect(out[k * 2]).toBeCloseTo(-100 * back, 3);
      expect(out[k * 2 + 1]).toBeCloseTo(-50 * back, 3);
    }
  });

  it('clamps times older than the recorded path to its oldest sample', () => {
    const path: PathSample[] = [
      { t: 0.9, x: 10, y: 0 },
      { t: 1.0, x: 20, y: 0 },
    ];
    const out = new Float32Array(H * 2);
    samplePath(path, 1.0, out);
    expect(out[0]).toBe(0);
    expect(out[2 * 2]).toBeCloseTo(-5, 5); // 0.05s back: halfway between samples
    expect(out[(H - 1) * 2]).toBe(-10); // Far past the start: the oldest point
  });
});

describe('coronaSurfaceCPU', () => {
  it('keeps non-flare particles on the shell and flares above it', () => {
    for (let n = 0; n < 300; n++) {
      const [x, y, z] = coronaSurfaceCPU(n, 2.3, RADIUS, 0);
      const r = Math.hypot(x, y, z) / RADIUS;
      if (isFlare(n)) {
        expect(r).toBeGreaterThanOrEqual(CORONA.SURFACE - 1e-3);
        expect(r).toBeLessThanOrEqual(CORONA.SURFACE + CORONA.FLARE_HEIGHT[0] + 1e-3);
      } else {
        // Not exact: the shader's epsilons leave the flow basis very slightly non-orthogonal
        expect(r).toBeCloseTo(CORONA.SURFACE, 3);
      }
    }
  });

  it('flows over time', () => {
    const a = coronaSurfaceCPU(5, 1, RADIUS, 0);
    const b = coronaSurfaceCPU(5, 1.5, RADIUS, 0);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1);
  });
});

describe('coronaTailStateCPU', () => {
  it('has no tail while the swarm is still', () => {
    for (let n = 0; n < 200; n++) {
      const surface = coronaSurfaceCPU(n, 1, RADIUS, 0);
      expect(coronaTailStateCPU(n, 1, surface, 0, [0, 0]).weight).toBe(0);
    }
  });

  it('only sheds particles on the trailing side', () => {
    const move: [number, number] = [120, 0]; // Moving +x: trailing side is -x
    let shedding = 0;
    for (let n = 0; n < 400; n++) {
      const surface = coronaSurfaceCPU(n, 1, RADIUS, 0);
      const { trip, weight } = coronaTailStateCPU(n, 1, surface, 0, move);
      expect(trip).toBeGreaterThanOrEqual(0);
      expect(trip).toBeLessThan(1);
      // Facing = dot(outward, backward) = -x / |xy|; shedding starts at BACK_FACING[0]
      const facing = -surface[0] / Math.hypot(surface[0], surface[1]);
      if (!isTailCandidate(n) || facing <= CORONA_TRAIL.BACK_FACING[0]) expect(weight).toBe(0);
      if (weight > 0.99) shedding++;
    }
    expect(shedding).toBeGreaterThan(20);
  });
});

describe('coronaPositionCPU', () => {
  it('matches the surface when idle', () => {
    const params = movingParams([0, 0]);
    for (let n = 0; n < 100; n++) {
      expect(coronaPositionCPU(n, params.time, params)).toEqual(
        coronaSurfaceCPU(n, params.time, RADIUS, 0)
      );
    }
  });

  it('streams tail particles behind the swarm', () => {
    const params = movingParams([120, 0]);
    let behind = 0;
    for (let n = 0; n < 4000 && behind < 20; n++) {
      const surface = coronaSurfaceCPU(n, params.time, RADIUS, 0);
      const { trip, weight } = coronaTailStateCPU(n, params.time, surface, 0, params.move);
      if (weight < 0.99 || trip < 0.5) continue;
      // Well down the tail: behind the swarm and beyond the shell
      const [x] = coronaPositionCPU(n, params.time, params);
      expect(x).toBeLessThan(-RADIUS);
      behind++;
    }
    expect(behind).toBe(20);
  });
});

describe('coronaStepCPU', () => {
  it('is deterministic and finite, with surface flow velocities when idle', () => {
    const params = movingParams([0, 0]);
    const a = coronaStepCPU(params);
    const b = coronaStepCPU(params);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.velocities).every(Number.isFinite)).toBe(true);
    const speed0 = Math.hypot(a.velocities[0], a.velocities[1], a.velocities[2]);
    expect(speed0).toBeGreaterThan(0);
  });
});
