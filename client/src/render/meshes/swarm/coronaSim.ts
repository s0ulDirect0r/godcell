// ============================================
// Corona Swarm Simulation - constants + CPU reference
// ============================================
//
// The swarm's particles are simulated on the GPU (CoronaSwarm.ts). This file
// holds their tuning constants and a CPU mirror of the compute pass, so the
// behavior can be unit tested in Node and compared against GPU readback (see
// checkCoronaParity in coronaDiagnostics.ts). Keep coronaStepCPU in sync with
// CoronaSwarm's compute shader.
//
// Space: the swarm group's local frame (local XY = game XY, +Z = up toward the camera).

import { tslHash } from '../../effects/soupCurrentsSim';

/** Plasma flowing over the shell, with flare loops */
export const CORONA = {
  COUNT: 4000,
  SURFACE: 1.02, // Resting altitude as a fraction of the radius (just outside the shell)
  FLOW_SPEED: [0.9, 2.0], // Rad/s along the surface [patrol, chase]
  FLARE_CHANCE: 0.18, // Fraction of particles riding flare loops
  FLARE_HEIGHT: [0.3, 0.7], // Loop height as a fraction of the radius [patrol, chase]
  FLARE_PERIOD: [2.6, 1.4], // Seconds per flare loop [patrol, chase]
  GLOW_ALTITUDE: [0.05, 0.5], // Altitude range over which color shifts gold -> pink
};

/** Comet tail: particles stream along the swarm's recent path */
export const CORONA_TRAIL = {
  CHANCE: 0.6, // Fraction of particles that can join the tail (only trailing-side ones do)
  HISTORY: 64, // Path samples sent to the shader
  SAMPLE_INTERVAL: 0.025, // Seconds between samples (64 x 0.025 = 1.6s of path)
  SECONDS: [1.0, 1.4], // How far back along the path the tail reaches [patrol, chase] (<= 1.6)
  FLOW_RATE: [0.5, 0.85], // Tail cycles/s: how fast particles stream from surface to tail end
  TAPER: 0.55, // Tail particles keep their offset from the swarm center, scaled to this at the tail end
  BACK_FACING: [-0.1, 0.5], // Only particles on the trailing side shed (dot with the backward direction)
  SPREAD: [2, 16], // Px extra sideways scatter at the tail's head and end (widens like smoke)
  WAVE_AMP: 7, // Px of traveling sideways wave at the tail end
  WAVE_FREQ: 9, // Wave cycles along the tail (radians per unit tail length)
  WAVE_SPEED: 6, // Rad/s the wave travels down the tail
  FADE_START: 0.7, // Fraction of the trip where tail particles start fading out
  OPACITY: 0.6, // Tail particle opacity (surface plasma is 0.35-0.4)
  MOVE_SPEED: [6, 45], // Swarm px/s over which the tail grows from none to full
  JUMP_RESET: 300, // Px; a bigger single-frame jump (respawn/teleport) clears the path
};

/** Smallest finite-difference step for velocities (also used while frozen) */
export const MIN_VELOCITY_STEP = 1 / 120;

// --- Path history (CPU only; feeds the shader's trail uniform) ---

export interface PathSample {
  t: number; // Seconds (the swarm's always-running clock)
  x: number; // Game X
  y: number; // Game Y
}

/**
 * Sample the recent path at fixed time steps back from `now` (frame-rate independent).
 * Writes offsets from the newest position into `out` as (x, y) pairs:
 * out[k] = where the swarm was k * SAMPLE_INTERVAL ago, relative to where it is now.
 * Times older than the recorded path clamp to its oldest sample.
 */
export function samplePath(
  path: readonly PathSample[],
  now: number,
  out: Float32Array,
  history = CORONA_TRAIL.HISTORY,
  interval = CORONA_TRAIL.SAMPLE_INTERVAL
): void {
  if (path.length === 0) {
    out.fill(0);
    return;
  }
  const newest = path[path.length - 1];
  let j = path.length - 1;
  for (let k = 0; k < history; k++) {
    const target = now - k * interval;
    while (j > 0 && path[j - 1].t >= target) j--;
    const a = path[Math.max(j - 1, 0)];
    const b = path[j];
    let px = b.x;
    let py = b.y;
    if (a !== b && b.t > a.t && target < b.t) {
      const f = Math.min(Math.max((target - a.t) / (b.t - a.t), 0), 1);
      px = a.x + (b.x - a.x) * f;
      py = a.y + (b.y - a.y) * f;
    }
    out[k * 2] = px - newest.x;
    out[k * 2 + 1] = py - newest.y;
  }
}

// --- CPU mirror of the compute shader ---

/** Uniform values for one compute dispatch */
export interface CoronaParams {
  count: number;
  radius: number;
  time: number; // uTime
  dt: number; // uDt (0 while frozen)
  chase: number; // uChase, 0..1
  move: [number, number]; // uMove, game px/s
  trail: Float32Array; // uTrail offsets as (x, y) pairs, HISTORY long
}

type V2 = [number, number];
type V3 = [number, number, number];

const fract = (x: number) => x - Math.floor(x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** TSL step(edge, x): 1 when x >= edge */
const step = (edge: number, x: number) => (x >= edge ? 1 : 0);
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const norm2 = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};
const hash3 = (n: number): V3 => [tslHash(n), tslHash(n + 17.31), tslHash(n + 41.77)];

/** Point on (or arcing off) the shell for particle n at `time` (mirrors coronaSurface) */
export function coronaSurfaceCPU(n: number, time: number, radius: number, chase: number): V3 {
  const r = hash3(n);
  const a = hash3(n + 77.7);
  const axis = norm3([a[0] - 0.5, a[1] - 0.5, a[2] - 0.5 + 0.0001]);
  const start = norm3([r[0] - 0.5 + 0.0001, r[1] - 0.5, r[2] - 0.5]);
  const c: V3 = [
    axis[1] * start[2] - axis[2] * start[1],
    axis[2] * start[0] - axis[0] * start[2],
    axis[0] * start[1] - axis[1] * start[0],
  ];
  const side = norm3([c[0], c[1] + 0.0001, c[2]]);
  const flow = mix(CORONA.FLOW_SPEED[0], CORONA.FLOW_SPEED[1], chase);
  const angle = time * flow * (r[2] * 0.8 + 0.6) + r[0] * 6.283;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);

  const isFlare = step(tslHash(n + 12.9), CORONA.FLARE_CHANCE);
  const period = mix(CORONA.FLARE_PERIOD[0], CORONA.FLARE_PERIOD[1], chase);
  const phase = fract(time / period + tslHash(n + 4.2));
  const height = mix(CORONA.FLARE_HEIGHT[0], CORONA.FLARE_HEIGHT[1], chase);
  const altitude = Math.sin(phase * Math.PI) * height * isFlare;
  const scale = (altitude + CORONA.SURFACE) * radius;
  return [
    (start[0] * cs + side[0] * sn) * scale,
    (start[1] * cs + side[1] * sn) * scale,
    (start[2] * cs + side[2] * sn) * scale,
  ];
}

/** Trip along the tail (0 surface .. 1 tail end) and tail weight (mirrors tailState) */
export function coronaTailStateCPU(
  n: number,
  time: number,
  surface: V3,
  chase: number,
  move: V2
): { trip: number; weight: number } {
  const T = CORONA_TRAIL;
  const isTail = step(tslHash(n + 31.4), T.CHANCE);
  const rate = mix(T.FLOW_RATE[0], T.FLOW_RATE[1], chase) * (tslHash(n + 2.2) * 0.6 + 0.7);
  const trip = fract(tslHash(n + 8.8) + time * rate);
  const moving = smoothstep(T.MOVE_SPEED[0], T.MOVE_SPEED[1], Math.hypot(move[0], move[1]));
  const backward = norm2([-move[0] + 0.0001, -move[1]]);
  const outward = norm2([surface[0] + 0.0001, surface[1]]);
  const facing = outward[0] * backward[0] + outward[1] * backward[1];
  const trailing = smoothstep(T.BACK_FACING[0], T.BACK_FACING[1], facing);
  return { trip, weight: isTail * moving * trailing };
}

/** Trail offset `back` seconds ago, interpolated between samples (mirrors trailAt) */
function trailAt(trail: Float32Array, back: number): V2 {
  const T = CORONA_TRAIL;
  const idx = clamp(back / T.SAMPLE_INTERVAL, 0, T.HISTORY - 1.001);
  const i0 = Math.floor(idx);
  const f = idx - i0;
  return [
    mix(trail[i0 * 2], trail[(i0 + 1) * 2], f),
    mix(trail[i0 * 2 + 1], trail[(i0 + 1) * 2 + 1], f),
  ];
}

/** Final particle position: surface plasma blended into the tail (mirrors positionAt) */
export function coronaPositionCPU(n: number, time: number, p: CoronaParams): V3 {
  const T = CORONA_TRAIL;
  const surface = coronaSurfaceCPU(n, time, p.radius, p.chase);
  const { trip, weight } = coronaTailStateCPU(n, time, surface, p.chase, p.move);
  const back = trip * mix(T.SECONDS[0], T.SECONDS[1], p.chase);
  const center = trailAt(p.trail, back);
  const ahead = trailAt(p.trail, back + 0.03);
  const along = norm2([ahead[0] - center[0] + 0.0001, ahead[1] - center[1]]);
  const side: V2 = [-along[1], along[0]];
  const spread = (tslHash(n + 5.1) - 0.5) * 2 * mix(T.SPREAD[0], T.SPREAD[1], trip);
  const wave =
    Math.sin(trip * T.WAVE_FREQ - time * T.WAVE_SPEED + tslHash(n + 6.6) * 6.283) *
    T.WAVE_AMP *
    trip;
  const taper = mix(1, T.TAPER, trip);
  const lateral = spread + wave;
  const trailPoint: V3 = [
    center[0] + surface[0] * taper + side[0] * lateral,
    center[1] + surface[1] * taper + side[1] * lateral,
    surface[2] * (1 - trip),
  ];
  return [
    mix(surface[0], trailPoint[0], weight),
    mix(surface[1], trailPoint[1], weight),
    mix(surface[2], trailPoint[2], weight),
  ];
}

/**
 * One compute dispatch on the CPU: positions and finite-difference velocities for
 * every particle, as interleaved (x, y, z). Mirrors CoronaSwarm's compute shader.
 */
export function coronaStepCPU(p: CoronaParams): {
  positions: Float32Array;
  velocities: Float32Array;
} {
  const positions = new Float32Array(p.count * 3);
  const velocities = new Float32Array(p.count * 3);
  const h = Math.max(p.dt, MIN_VELOCITY_STEP);
  for (let i = 0; i < p.count; i++) {
    const now = coronaPositionCPU(i, p.time, p);
    const then = coronaPositionCPU(i, p.time - h, p);
    const surfaceNow = coronaSurfaceCPU(i, p.time, p.radius, p.chase);
    const surfaceThen = coronaSurfaceCPU(i, p.time - h, p.radius, p.chase);
    // A tail particle wrapping from the tail end back to the surface uses surface flow
    const tripNow = coronaTailStateCPU(i, p.time, surfaceNow, p.chase, p.move).trip;
    const tripThen = coronaTailStateCPU(i, p.time - h, surfaceThen, p.chase, p.move).trip;
    const [a, b] = tripNow < tripThen ? [surfaceNow, surfaceThen] : [now, then];
    for (let c = 0; c < 3; c++) {
      positions[i * 3 + c] = now[c];
      velocities[i * 3 + c] = (a[c] - b[c]) / h;
    }
  }
  return { positions, velocities };
}
