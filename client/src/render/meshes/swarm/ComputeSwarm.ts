// ============================================
// Compute Swarms - GPU particle styles for entropy swarms
// ============================================
//
// Three experimental replacements for the swarm's CPU internal storm and
// orbiting squares, each simulated in a compute shader in the swarm group's
// local space (local XY = game XY, local +Z = up toward the camera):
//
//   maelstrom - churning vortex of streaks rolling inside the shell
//   glitch    - corrupted voxels snapping between grid cells
//   corona    - plasma flowing over the shell, flares + comet tail when moving
//   glitch-corona - corona built from glitch voxels, with a CRT-shutdown EMP state
//
// The outer shell sphere stays (see SwarmMesh). Pick a style in game with
// ?swarm=<style> or in the model viewer's Swarm Style dropdown.

import * as THREE from 'three/webgpu';
import type { ComputeNode, Node, StorageBufferNode } from 'three/webgpu';
import {
  Fn,
  clamp,
  cos,
  cross,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  mix,
  normalize,
  positionGeometry,
  pow,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

export const COMPUTE_SWARM_STYLES = ['glitch-corona', 'maelstrom', 'glitch', 'corona'] as const;
export type ComputeSwarmStyle = (typeof COMPUTE_SWARM_STYLES)[number];
export type SwarmStyle = 'classic' | ComputeSwarmStyle;

/** Read a swarm style from a query value (e.g. ?swarm=corona); anything else is classic */
export function parseSwarmStyle(value: string | null | undefined): SwarmStyle {
  return COMPUTE_SWARM_STYLES.includes(value as ComputeSwarmStyle)
    ? (value as ComputeSwarmStyle)
    : 'classic';
}

/** Shared palette, matching the classic swarm's states */
const PALETTE = {
  ORANGE: 0xff4400, // Classic shell orange
  AMBER: 0xffaa00, // Classic internal storm (patrol)
  HOT_ORANGE: 0xff6600, // Classic internal storm (chase)
  RED: 0xff0044, // Classic chase red
  PINK: 0xff0088, // Classic orbiting squares
  WHITE_HOT: 0xfff0d0, // Fastest/hottest particles
  FROZEN: 0x777777, // EMP-disabled gray
  DEAD_CYAN: 0x33ffdd, // EMP afterglow (glitch-corona's crashed state)
};

const CHASE_BLEND_RATE = 3; // Per second: how fast visuals ramp into/out of chase
const FROZEN_BLEND_RATE = 10; // Per second: EMP gray-out is near-instant

function rgb(hex: number) {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** Random unit-cube triple from a seed (three decorrelated hashes) */
function hash3(n: Node<'float'>) {
  return vec3(hash(n), hash(n.add(17.31)), hash(n.add(41.77)));
}

/** Uniform random point inside a sphere of the given radius, from three [0,1) numbers */
function pointInSphere(r: ReturnType<typeof hash3>, radius: number) {
  const z = r.x.mul(2).sub(1);
  const phi = r.y.mul(Math.PI * 2);
  const ring = max(float(1).sub(z.mul(z)), 0).sqrt();
  const dist = pow(r.z, 1 / 3).mul(radius);
  return vec3(ring.mul(cos(phi)), ring.mul(sin(phi)), z).mul(dist);
}

interface StreakOptions {
  minLength: number; // Px; equal to width -> squares when idle
  maxLength: number; // Px
  lengthPerSpeed: number; // Px of streak per px/s of speed
  width: number; // Px
  fadeTail: boolean; // Fade opacity from head to tail
  blending: THREE.Blending;
  customInert?: boolean; // Style handles EMP visuals itself (skip the default gray-out)
}

/**
 * Base class: storage buffers, state uniforms, velocity tracking and a shared
 * velocity-aligned quad renderer. Subclasses build their compute pass and
 * colors, then call finish().
 */
export abstract class ComputeSwarmFX {
  object!: THREE.InstancedMesh;
  computeNode!: ComputeNode;
  /** Multiplier the shell uses for its opacity, so a style can recede the sphere */
  abstract readonly shellOpacity: number;
  /** Scale the shell follows on top of its pulse (styles can squash it, e.g. on EMP) */
  readonly shellScale = new THREE.Vector3(1, 1, 1);

  protected readonly positions: StorageBufferNode<'vec3'>;
  protected readonly velocities: StorageBufferNode<'vec3'>;
  protected readonly uTime = uniform(0); // Seconds; stops advancing while frozen
  protected readonly uDt = uniform(0); // Seconds; 0 while frozen
  protected readonly uChase = uniform(0); // 0 patrol .. 1 chase (eased)
  protected readonly uFrozen = uniform(0); // 0 active .. 1 EMP-disabled (eased)
  protected readonly uMove = uniform(new THREE.Vector2()); // Swarm velocity, game px/s (local XY)
  protected readonly uClock = uniform(0); // Seconds; always advances (for inert-state animation)

  private chaseTarget = 0;
  protected frozen = false;
  private lastPosition: THREE.Vector3 | null = null;

  constructor(
    protected readonly count: number,
    protected readonly radius: number
  ) {
    this.positions = instancedArray(count, 'vec3');
    this.velocities = instancedArray(count, 'vec3');
  }

  protected finish(
    compute: ComputeNode,
    color: Node<'vec3'>,
    opacity: Node<'float'>,
    streak: StreakOptions
  ) {
    this.computeNode = compute;
    this.object = this.buildStreaks(color, opacity, streak);
  }

  /** Quads in the local XY (view) plane, stretched along each particle's velocity */
  private buildStreaks(
    color: Node<'vec3'>,
    opacity: Node<'float'>,
    o: StreakOptions
  ): THREE.InstancedMesh {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false, // Matches the shell: swarms draw over soup obstacles
      blending: o.blending,
      side: THREE.DoubleSide,
    });
    const center = this.positions.element(instanceIndex);
    const velocity = this.velocities.element(instanceIndex);
    const speed = length(velocity.xy);
    const dir = select(speed.greaterThan(0.001), velocity.xy.div(speed), vec2(1, 0));
    const perp = vec2(dir.y.negate(), dir.x);
    const streakLength = clamp(speed.mul(o.lengthPerSpeed), o.minLength, o.maxLength);
    // Head on the particle, tail trailing behind
    const along = positionGeometry.x.sub(0.5).mul(streakLength);
    const across = positionGeometry.y.mul(o.width);
    const offset = dir.mul(along).add(perp.mul(across));
    material.positionNode = center.add(vec3(offset, 0));

    const frozenColor = o.customInert ? color : mix(color, rgb(PALETTE.FROZEN), this.uFrozen);
    material.colorNode = frozenColor;
    const frozenOpacity = o.customInert ? opacity : mix(opacity, opacity.mul(0.35), this.uFrozen);
    material.opacityNode = o.fadeTail ? frozenOpacity.mul(uv().x) : frozenOpacity;

    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, this.count);
    mesh.frustumCulled = false; // Bounds are one unit quad; the particles fill the swarm
    mesh.renderOrder = 1; // Over the shell
    return mesh;
  }

  /** Swarm behavior state, from the server (patrol/chase) and EMP status */
  setState(state: string, disabled: boolean): void {
    this.chaseTarget = state === 'chase' ? 1 : 0;
    this.frozen = disabled;
  }

  /**
   * Advance uniforms for this frame; dispatch `computeNode` afterwards.
   * @param worldPosition - The swarm group's world position (for movement/tails)
   */
  update(dtSeconds: number, worldPosition?: THREE.Vector3): void {
    const dt = Math.min(dtSeconds, 0.1);
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    this.uChase.value += (this.chaseTarget - this.uChase.value) * ease(CHASE_BLEND_RATE);
    this.uFrozen.value += ((this.frozen ? 1 : 0) - this.uFrozen.value) * ease(FROZEN_BLEND_RATE);
    this.uDt.value = this.frozen ? 0 : dt;
    if (!this.frozen) this.uTime.value += dt;
    this.uClock.value += dt;

    if (worldPosition && dt > 0) {
      if (this.lastPosition) {
        // World X = game X, world Z = -game Y; smoothed so interpolation jitter doesn't flicker tails
        const vx = (worldPosition.x - this.lastPosition.x) / dt;
        const vy = -(worldPosition.z - this.lastPosition.z) / dt;
        this.uMove.value.lerp(new THREE.Vector2(vx, vy), ease(6));
      }
      this.lastPosition = (this.lastPosition ?? new THREE.Vector3()).copy(worldPosition);
    }
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.computeNode.dispose();
  }
}

// ============================================
// Maelstrom: rolling vortex inside the shell
// ============================================

const MAELSTROM = {
  COUNT: 4000,
  SWIRL_SPEED: [70, 150], // Px/s around the vertical axis [patrol, chase]
  ROLL_SPEED: [35, 90], // Px/s rolling around the vortex ring (smoke-ring motion)
  RING_RADIUS: 0.55, // Vortex ring radius as a fraction of the swarm radius
  TURBULENCE: [20, 55], // Px/s of wobble from a sine flow field
  CONTAIN: 0.85, // Particles are pushed back inside this fraction of the radius
  GLOW_SPEED: [130, 280], // Px/s where streaks go toward white-hot (chase swirl alone stays below, so it reads red)
};

class MaelstromSwarm extends ComputeSwarmFX {
  readonly shellOpacity = 0.8;

  constructor(radius: number) {
    super(MAELSTROM.COUNT, radius);
    const { positions, velocities, uDt, uTime, uChase } = this;

    const compute = Fn(() => {
      const position = positions.element(instanceIndex);
      const n = float(instanceIndex);
      // First frame: positions start at the origin, so scatter them through the sphere
      const p = select(
        length(position).lessThan(0.001),
        pointInSphere(hash3(n), radius * MAELSTROM.CONTAIN),
        position
      ).toVar();

      const xy = p.xy;
      const rho = max(length(xy), 0.001);
      const around = vec2(xy.y.negate(), xy.x).div(rho); // Azimuthal unit vector
      const swirl = mix(float(MAELSTROM.SWIRL_SPEED[0]), float(MAELSTROM.SWIRL_SPEED[1]), uChase);

      // Roll around the ring at RING_RADIUS in the (rho, z) plane
      const outward = xy.div(rho);
      const ringR = radius * MAELSTROM.RING_RADIUS;
      const fromRing = vec2(rho.sub(ringR), p.z); // (radial, vertical) offset from ring center
      const rollDir = normalize(vec2(fromRing.y.negate(), fromRing.x).add(vec2(0.0001, 0)));
      const roll = mix(float(MAELSTROM.ROLL_SPEED[0]), float(MAELSTROM.ROLL_SPEED[1]), uChase);
      const rollVel = vec3(outward.mul(rollDir.x), rollDir.y).mul(roll);

      const k = 0.09;
      const wobble = vec3(
        sin(p.y.mul(k).add(uTime.mul(1.3))),
        sin(p.z.mul(k).add(uTime.mul(1.7))),
        sin(p.x.mul(k).add(uTime.mul(1.1)))
      ).mul(mix(float(MAELSTROM.TURBULENCE[0]), float(MAELSTROM.TURBULENCE[1]), uChase));

      const v = vec3(around.mul(swirl), 0).add(rollVel).add(wobble).toVar();

      // Soft containment: spring back inside the shell
      const dist = length(p);
      const limit = radius * MAELSTROM.CONTAIN;
      v.subAssign(p.div(max(dist, 0.001)).mul(max(dist.sub(limit), 0).mul(12)));

      p.addAssign(v.mul(uDt));
      position.assign(p);
      velocities.element(instanceIndex).assign(v);
    })().compute(MAELSTROM.COUNT);

    const speed = length(velocities.element(instanceIndex));
    const heat = smoothstep(MAELSTROM.GLOW_SPEED[0], MAELSTROM.GLOW_SPEED[1], speed);
    // Chase reads angrier (redder), not just brighter
    const base = mix(rgb(PALETTE.AMBER), rgb(PALETTE.RED), uChase.mul(0.7));
    const color = mix(base, rgb(PALETTE.WHITE_HOT), heat.mul(0.8));
    const opacity = mix(float(0.2), float(0.5), heat); // Additive: low base so 4k streaks don't blow out

    this.finish(compute, color, opacity, {
      minLength: 1.5,
      maxLength: 10,
      lengthPerSpeed: 0.06,
      width: 0.7,
      fadeTail: true,
      blending: THREE.AdditiveBlending,
    });
  }
}

// ============================================
// Glitch: corrupted voxels snapping between cells
// ============================================

const GLITCH = {
  COUNT: 3000,
  GRID: 4.5, // Px voxel size; particles snap to this lattice
  HOP_PERIOD: [1.1, 0.3], // Seconds between hops [patrol, chase] (per particle, +/- 50%)
  HOP_FRACTION: 0.12, // Portion of each period spent smearing to the new cell
  CONTAIN: 0.85, // Cells are picked inside this fraction of the radius
  BLINK_RATE: 14, // Hz at which corrupted pixels drop out
  BLINK_CHANCE: [0.06, 0.18], // Fraction of pixels dark at any instant [patrol, chase]
  SCANLINE_SPEED: 1.7, // Rad/s of the sweeping scanline
  SCANLINE_WIDTH: 2.5, // Px half-width of the scanline band
};

const GLITCH_SMEAR_PER_SPEED = 0.05; // Shared by compute (encodes distance) and the renderer

class GlitchSwarm extends ComputeSwarmFX {
  readonly shellOpacity = 0.55;

  constructor(radius: number) {
    super(GLITCH.COUNT, radius);
    const { positions, velocities, uTime, uChase } = this;
    const grid = GLITCH.GRID;

    // Lattice cell for particle `n` during hop slot `slot`
    const cellFor = (n: Node<'float'>, slot: Node<'float'>) => {
      const raw = pointInSphere(hash3(n.mul(7.13).add(slot.mul(131.7))), radius * GLITCH.CONTAIN);
      return floor(raw.div(grid)).add(0.5).mul(grid);
    };

    const compute = Fn(() => {
      const n = float(instanceIndex);
      const period = mix(float(GLITCH.HOP_PERIOD[0]), float(GLITCH.HOP_PERIOD[1]), uChase).mul(
        hash(n.add(3.3)).add(0.5)
      );
      const clock = uTime.div(period).add(hash(n.add(9.1)).mul(10));
      const slot = floor(clock);
      const t = smoothstep(0, GLITCH.HOP_FRACTION, fract(clock));
      const from = cellFor(n, slot.sub(1));
      const to = cellFor(n, slot);
      const p = mix(from, to, t);
      // Velocity only during the smear, so idle voxels render as squares. Its magnitude
      // encodes the distance traveled so far, so the smear never reaches behind the old cell.
      const hopping = step(t, 0.999).mul(step(0.001, t));
      const travel = to.sub(from);
      const traveled = length(travel).mul(t);
      const v = normalize(travel.add(vec3(0.0001, 0, 0)))
        .mul(traveled.div(GLITCH_SMEAR_PER_SPEED))
        .mul(hopping);
      positions.element(instanceIndex).assign(p);
      velocities.element(instanceIndex).assign(v);
    })().compute(GLITCH.COUNT);

    const n = float(instanceIndex);
    const pick = hash(n.add(5.5));
    const palette = select(
      pick.lessThan(0.6),
      rgb(PALETTE.PINK),
      select(pick.lessThan(0.9), rgb(PALETTE.ORANGE), rgb(PALETTE.WHITE_HOT))
    );
    const tinted = mix(palette, rgb(PALETTE.RED), uChase.mul(0.35));
    // Sweeping scanline flashes voxels it passes through white
    const p = positions.element(instanceIndex);
    const scanY = sin(uTime.mul(GLITCH.SCANLINE_SPEED)).mul(radius * GLITCH.CONTAIN);
    const onScan = float(1).sub(smoothstep(0, GLITCH.SCANLINE_WIDTH, p.y.sub(scanY).abs()));
    const color = mix(tinted, rgb(0xffffff), onScan);

    const blinkChance = mix(float(GLITCH.BLINK_CHANCE[0]), float(GLITCH.BLINK_CHANCE[1]), uChase);
    const blink = step(blinkChance, hash(n.add(floor(uTime.mul(GLITCH.BLINK_RATE)).mul(97.1))));
    const opacity = blink.mul(0.9);

    this.finish(compute, color, opacity, {
      minLength: grid * 0.55,
      maxLength: 26,
      lengthPerSpeed: GLITCH_SMEAR_PER_SPEED,
      width: grid * 0.55,
      fadeTail: false,
      blending: THREE.NormalBlending,
    });
  }
}

// ============================================
// Corona: plasma over the shell, flares, comet tail
// ============================================

const CORONA = {
  COUNT: 4000,
  SURFACE: 1.02, // Resting altitude as a fraction of the radius (just outside the shell)
  FLOW_SPEED: [0.9, 2.0], // Rad/s along the surface [patrol, chase]
  FLARE_CHANCE: 0.18, // Fraction of particles riding flare loops
  FLARE_HEIGHT: [0.3, 0.7], // Loop height as a fraction of the radius [patrol, chase]
  FLARE_PERIOD: [2.6, 1.4], // Seconds per flare loop [patrol, chase]
  TAIL_CHANCE: 0.35, // Fraction of particles that stream into the comet tail
  TAIL_SECONDS: [0.5, 0.9], // Tail length = swarm speed * this * per-particle lag [patrol, chase]
  GLOW_ALTITUDE: [0.05, 0.5], // Altitude range over which color shifts gold -> pink
};

/**
 * Point on (or arcing off) the corona shell for particle n at `time`. Stateless,
 * so freezing is just stopping the clock. Shared by corona and glitch-corona.
 */
function coronaSurface(
  n: Node<'float'>,
  time: Node<'float'>,
  radius: number,
  chase: Node<'float'>
) {
  const r = hash3(n);
  // Each particle flows around its own tilted axis (field lines in many orientations)
  const axis = normalize(
    hash3(n.add(77.7))
      .sub(0.5)
      .add(vec3(0, 0, 0.0001))
  );
  const start = normalize(r.sub(0.5).add(vec3(0.0001, 0, 0)));
  const side = normalize(cross(axis, start).add(vec3(0, 0.0001, 0)));
  const flow = mix(float(CORONA.FLOW_SPEED[0]), float(CORONA.FLOW_SPEED[1]), chase);
  const angle = time.mul(flow).mul(r.z.mul(0.8).add(0.6)).add(r.x.mul(6.283));
  const onSphere = start.mul(cos(angle)).add(side.mul(sin(angle)));

  // Flares: a subset arcs out and back in a loop
  const isFlare = step(hash(n.add(12.9)), CORONA.FLARE_CHANCE);
  const flarePeriod = mix(float(CORONA.FLARE_PERIOD[0]), float(CORONA.FLARE_PERIOD[1]), chase);
  const flarePhase = fract(time.div(flarePeriod).add(hash(n.add(4.2))));
  const flareHeight = mix(float(CORONA.FLARE_HEIGHT[0]), float(CORONA.FLARE_HEIGHT[1]), chase);
  const altitude = sin(flarePhase.mul(Math.PI)).mul(flareHeight).mul(isFlare);

  return onSphere.mul(altitude.add(CORONA.SURFACE).mul(radius));
}

/** Comet tail lag for particle n: 0 = attached, 1 = farthest back */
function coronaTailLag(n: Node<'float'>) {
  return hash(n.add(8.8)).mul(step(hash(n.add(31.4)), CORONA.TAIL_CHANCE));
}

class CoronaSwarm extends ComputeSwarmFX {
  readonly shellOpacity = 0.45;

  constructor(radius: number) {
    super(CORONA.COUNT, radius);
    const { positions, velocities, uTime, uDt, uChase, uMove } = this;

    const positionAt = (n: Node<'float'>, time: Node<'float'>) =>
      coronaSurface(n, time, radius, uChase);
    const tailLag = coronaTailLag;

    const compute = Fn(() => {
      const n = float(instanceIndex);
      const lag = tailLag(n);
      const tailSeconds = mix(float(CORONA.TAIL_SECONDS[0]), float(CORONA.TAIL_SECONDS[1]), uChase);
      const tail = vec3(uMove.mul(lag).mul(tailSeconds).negate(), 0);
      const p = positionAt(n, uTime).add(tail);
      // Finite-difference surface velocity (fixed small step when frozen), plus the tail's
      // apparent backward drift so tail streaks point along the tail
      const h = max(uDt, 1 / 120);
      const surfaceVel = positionAt(n, uTime)
        .sub(positionAt(n, uTime.sub(h)))
        .div(h);
      const v = surfaceVel.add(vec3(uMove.mul(lag).negate(), 0));
      positions.element(instanceIndex).assign(p);
      velocities.element(instanceIndex).assign(v);
    })().compute(CORONA.COUNT);

    const p = positions.element(instanceIndex);
    const altitude = length(p).div(radius).sub(CORONA.SURFACE);
    const lift = smoothstep(CORONA.GLOW_ALTITUDE[0], CORONA.GLOW_ALTITUDE[1], altitude);
    const base = mix(rgb(PALETTE.AMBER), rgb(PALETTE.RED), uChase.mul(0.6));
    const color = mix(base, rgb(PALETTE.PINK), lift);
    const opacity = mix(float(0.4), float(0.35), lift); // Additive: surface stays translucent

    this.finish(compute, color, opacity, {
      minLength: 1.5,
      maxLength: 14,
      lengthPerSpeed: 0.08,
      width: 0.8,
      fadeTail: true,
      blending: THREE.AdditiveBlending,
    });
  }
}

// ============================================
// Glitch-corona: corona made of corrupted voxels, CRT-shutdown inert state
// ============================================

const GLITCH_CORONA = {
  COUNT: 3200, // Fewer than corona: opaque voxels fill the surface faster than additive streaks
  GRID: 3.5, // Px voxel size; everything snaps to this lattice
  STEP_RATE: [7, 15], // Stutter steps/s along the flow [patrol, chase] (per particle, x0.6-1.4)
  SMEAR_FRACTION: 0.3, // Portion of each step spent smearing to the next position
  BLINK_RATE: 14, // Hz at which corrupted voxels drop out
  BLINK_CHANCE: [0.08, 0.2], // Fraction of voxels dark at any instant [patrol, chase]
  SCANLINE_SPEED: 1.7, // Rad/s of the sweeping scanline
  SCANLINE_WIDTH: 2.5, // Px half-width of the scanline band
  // EMP "system crash"
  SHOCK_SECONDS: 0.35, // Impact: voxels blast outward and flash white/cyan
  SHOCK_DISTANCE: 30, // Px of outward blast at the moment of impact
  COLLAPSE_SECONDS: 0.9, // CRT power-off: squash to a horizontal line, then to a dot
  REBOOT_SECONDS: 0.5, // Power-on when the EMP wears off (reverse collapse + flash)
  RETRY_PERIOD: 1.3, // Seconds between failed reboot attempts while disabled
  RETRY_CHANCE: 0.55, // Chance a given period attempts a reboot
  RETRY_SECONDS: 0.14, // How long an attempt flickers back open
};

class GlitchCoronaSwarm extends ComputeSwarmFX {
  readonly shellOpacity = 0.45;

  private readonly uShock = uniform(0); // 1 at EMP impact, decaying to 0
  private readonly uCollapse = uniform(0); // 0 normal .. 1 collapsed to a dot (before retries)
  private readonly uPowerOn = uniform(0); // Flash while rebooting after the EMP ends
  private inertTime = 0; // Seconds since the EMP hit (0 when active)
  private rebootTime = -1; // Seconds into power-on (-1 when not rebooting)

  constructor(radius: number) {
    super(GLITCH_CORONA.COUNT, radius);
    const { positions, velocities, uTime, uClock, uChase, uMove, uShock, uCollapse } = this;
    const grid = GLITCH_CORONA.GRID;
    const snap = (p: Node<'vec3'>) => floor(p.div(grid)).add(0.5).mul(grid);

    // Collapse with failed reboot attempts: while fully collapsed, some periods briefly reopen
    const retrySlot = floor(uClock.div(GLITCH_CORONA.RETRY_PERIOD));
    const retrying = step(hash(retrySlot.add(5.1)), GLITCH_CORONA.RETRY_CHANCE).mul(
      step(
        fract(uClock.div(GLITCH_CORONA.RETRY_PERIOD)),
        GLITCH_CORONA.RETRY_SECONDS / GLITCH_CORONA.RETRY_PERIOD
      )
    );
    const collapse = uCollapse.sub(retrying.mul(step(0.99, uCollapse)).mul(0.45));

    const compute = Fn(() => {
      const n = float(instanceIndex);
      const rate = mix(
        float(GLITCH_CORONA.STEP_RATE[0]),
        float(GLITCH_CORONA.STEP_RATE[1]),
        uChase
      ).mul(hash(n.add(2.7)).mul(0.8).add(0.6));
      const clock = uTime.mul(rate).add(hash(n.add(9.1)).mul(10));
      const stepIndex = floor(clock);
      const t = smoothstep(0, GLITCH_CORONA.SMEAR_FRACTION, fract(clock));
      // Stutter along the corona flow: hold, then smear to the next step
      const from = coronaSurface(n, stepIndex.sub(1).div(rate), radius, uChase);
      const to = coronaSurface(n, stepIndex.div(rate), radius, uChase);

      // Comet tail of corrupted pixels (lag behind the swarm's motion)
      const lag = coronaTailLag(n);
      const tailSeconds = mix(float(CORONA.TAIL_SECONDS[0]), float(CORONA.TAIL_SECONDS[1]), uChase);
      const tail = vec3(uMove.mul(lag).mul(tailSeconds).negate(), 0);
      const p = snap(mix(from, to, t).add(tail)).toVar();

      // Smear velocity encodes distance traveled this step (see glitch)
      const hopping = step(t, 0.999).mul(step(0.001, t));
      const travel = to.sub(from);
      const v = normalize(travel.add(vec3(0.0001, 0, 0)))
        .mul(length(travel).mul(t).div(GLITCH_SMEAR_PER_SPEED))
        .mul(hopping)
        .toVar();

      // EMP impact: blast outward with per-frame jitter
      const outward = normalize(p.add(vec3(0.0001, 0, 0)));
      const jitter = hash3(n.add(floor(uClock.mul(30)).mul(13.7))).sub(0.5);
      p.addAssign(
        outward.mul(uShock.mul(GLITCH_CORONA.SHOCK_DISTANCE)).add(jitter.mul(uShock.mul(12)))
      );

      // CRT power-off: squash Y (screen vertical) to a line, then X to a dot
      const squashY = float(1).sub(smoothstep(0, 0.5, collapse).mul(0.97));
      const squashX = float(1).sub(smoothstep(0.5, 1, collapse).mul(0.97));
      p.assign(vec3(p.x.mul(squashX), p.y.mul(squashY), p.z.mul(squashY)));
      v.mulAssign(float(1).sub(step(0.01, collapse))); // No smears while crashed

      positions.element(instanceIndex).assign(p);
      velocities.element(instanceIndex).assign(v);
    })().compute(GLITCH_CORONA.COUNT);

    // --- Color: glitch palette, pinker with altitude/tail, scanline, dropouts ---
    const n = float(instanceIndex);
    const pick = hash(n.add(5.5));
    const palette = select(
      pick.lessThan(0.55),
      rgb(PALETTE.PINK),
      select(pick.lessThan(0.92), rgb(PALETTE.AMBER), rgb(PALETTE.WHITE_HOT))
    );
    const p = positions.element(instanceIndex);
    const altitude = length(p).div(radius).sub(CORONA.SURFACE);
    const lift = smoothstep(CORONA.GLOW_ALTITUDE[0], CORONA.GLOW_ALTITUDE[1], altitude);
    const tinted = mix(
      mix(palette, rgb(PALETTE.PINK), lift.mul(0.6)),
      rgb(PALETTE.RED),
      uChase.mul(0.3)
    );
    const scanY = sin(uTime.mul(GLITCH_CORONA.SCANLINE_SPEED)).mul(radius);
    const onScan = float(1).sub(smoothstep(0, GLITCH_CORONA.SCANLINE_WIDTH, p.y.sub(scanY).abs()));
    const active = mix(tinted, rgb(0xffffff), onScan);

    // --- Inert: white/cyan flash on impact, dead-pixel cyan afterglow, power-on flash ---
    // Partial flash so the scattering voxels stay readable instead of a solid white blob
    const crashed = mix(rgb(PALETTE.DEAD_CYAN), rgb(0xffffff), uShock.mul(0.55));
    const inertMix = max(this.uFrozen, uShock);
    const color = mix(mix(active, crashed, inertMix), rgb(0xffffff), this.uPowerOn);

    const blinkChance = mix(
      float(GLITCH_CORONA.BLINK_CHANCE[0]),
      float(GLITCH_CORONA.BLINK_CHANCE[1]),
      uChase
    );
    const blink = step(
      blinkChance,
      hash(n.add(floor(uTime.mul(GLITCH_CORONA.BLINK_RATE)).mul(97.1)))
    );
    // Crashed: a flickering dot, mostly dim with occasional surges
    const flicker = hash(floor(uClock.mul(18)).add(3.3))
      .mul(0.6)
      .add(0.25);
    const opacity = mix(blink.mul(0.9), flicker, this.uFrozen.mul(step(0.99, uCollapse)));

    this.finish(compute, color, opacity, {
      minLength: grid * 0.6,
      maxLength: 22,
      lengthPerSpeed: GLITCH_SMEAR_PER_SPEED,
      width: grid * 0.6,
      fadeTail: false,
      blending: THREE.NormalBlending,
      customInert: true,
    });
  }

  update(dtSeconds: number, worldPosition?: THREE.Vector3): void {
    super.update(dtSeconds, worldPosition);
    const dt = Math.min(dtSeconds, 0.1);
    const G = GLITCH_CORONA;

    if (this.frozen) {
      this.inertTime += dt;
      this.rebootTime = -1;
    } else if (this.inertTime > 0) {
      // EMP just wore off: run power-on, then return to normal
      if (this.rebootTime < 0) this.rebootTime = 0;
      this.rebootTime += dt;
      if (this.rebootTime >= G.REBOOT_SECONDS) {
        this.inertTime = 0;
        this.rebootTime = -1;
      }
    }

    const smooth = (x: number) => x * x * (3 - 2 * x);
    const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
    this.uShock.value = this.frozen ? clamp01(1 - this.inertTime / G.SHOCK_SECONDS) : 0;
    if (this.frozen) {
      // Collapse starts as the shock fades
      this.uCollapse.value = smooth(
        clamp01((this.inertTime - G.SHOCK_SECONDS * 0.5) / G.COLLAPSE_SECONDS)
      );
      this.uPowerOn.value = 0;
    } else if (this.rebootTime >= 0) {
      const k = clamp01(this.rebootTime / G.REBOOT_SECONDS);
      this.uCollapse.value = 1 - smooth(k);
      this.uPowerOn.value = 1 - k;
    } else {
      this.uCollapse.value = 0;
      this.uPowerOn.value = 0;
    }

    // Shell follows the CRT collapse (Y first, then X)
    const c = this.uCollapse.value;
    const sy = 1 - smooth(clamp01(c / 0.5)) * 0.97;
    const sx = 1 - smooth(clamp01((c - 0.5) / 0.5)) * 0.97;
    this.shellScale.set(sx, sy, sy);
  }
}

/** Create the compute particle effect for a swarm of the given radius */
export function createComputeSwarmFX(style: ComputeSwarmStyle, radius: number): ComputeSwarmFX {
  switch (style) {
    case 'maelstrom':
      return new MaelstromSwarm(radius);
    case 'glitch':
      return new GlitchSwarm(radius);
    case 'corona':
      return new CoronaSwarm(radius);
    case 'glitch-corona':
      return new GlitchCoronaSwarm(radius);
  }
}
