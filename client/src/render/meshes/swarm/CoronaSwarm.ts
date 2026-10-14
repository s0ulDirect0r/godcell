// ============================================
// Corona Swarm - GPU particle effect for entropy swarms
// ============================================
//
// Plasma flowing over the swarm's shell, with flare loops and a comet tail that
// streams along the swarm's recent path. Simulated in a compute shader in the
// swarm group's local space (local XY = game XY, local +Z = up toward the camera).
// The outer shell sphere is SwarmMesh's.
//
// coronaSim.ts holds the tuning constants and a CPU mirror of the compute pass
// (coronaStepCPU); keep the two in sync. `npm run test:gpu` checks they agree.

import * as THREE from 'three/webgpu';
import type { ComputeNode, Node, StorageBufferNode, UniformArrayNode } from 'three/webgpu';
import {
  Fn,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  int,
  length,
  max,
  mix,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import {
  CORONA,
  CORONA_TRAIL,
  MIN_VELOCITY_STEP,
  samplePath,
  type CoronaParams,
  type PathSample,
} from './coronaSim';

/** Palette, matching the swarm's classic states */
const PALETTE = {
  AMBER: 0xffaa00, // Surface plasma (patrol)
  RED: 0xff0044, // Chase tint
  PINK: 0xff0088, // Flares and tail
  FROZEN: 0x777777, // EMP-disabled gray
};

const CHASE_BLEND_RATE = 3; // Per second: how fast visuals ramp into/out of chase
const FROZEN_BLEND_RATE = 10; // Per second: EMP gray-out is near-instant
const MOVE_SMOOTHING = 6; // Per second: smooths swarm velocity so interpolation jitter doesn't flicker the tail

/** Streak rendering: quads stretched along each particle's velocity */
const STREAK = {
  MIN_LENGTH: 1.5, // Px; slow particles still read as short dashes
  MAX_LENGTH: 14, // Px
  LENGTH_PER_SPEED: 0.08, // Px of streak per px/s of speed
  WIDTH: 0.8, // Px
};

/** Opacity of the shell relative to its classic values, so the plasma reads over it */
const SHELL_OPACITY = 0.45;

function rgb(hex: number) {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

/** Random unit-cube triple from a seed (three decorrelated hashes) */
function hash3(n: Node<'float'>) {
  return vec3(hash(n), hash(n.add(17.31)), hash(n.add(41.77)));
}

/**
 * Point on (or arcing off) the corona shell for particle n at `time`. Stateless,
 * so freezing is just stopping the clock. Mirrored by coronaSurfaceCPU.
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

export class CoronaSwarm {
  readonly object: THREE.InstancedMesh;
  readonly computeNode: ComputeNode;
  readonly count = CORONA.COUNT;
  readonly shellOpacity = SHELL_OPACITY;

  private readonly positions: StorageBufferNode<'vec3'>;
  private readonly velocities: StorageBufferNode<'vec3'>;
  private readonly uTime = uniform(0); // Seconds; stops advancing while frozen
  private readonly uDt = uniform(0); // Seconds; 0 while frozen
  private readonly uChase = uniform(0); // 0 patrol .. 1 chase (eased)
  private readonly uFrozen = uniform(0); // 0 active .. 1 EMP-disabled (eased)
  private readonly uMove = uniform(new THREE.Vector2()); // Swarm velocity, game px/s (local XY)
  // Offsets (xy) from the current position to where the swarm was k * SAMPLE_INTERVAL ago.
  // vec4 rather than vec2: uniform arrays pad elements to 16 bytes
  private readonly trailValues = Array.from(
    { length: CORONA_TRAIL.HISTORY },
    () => new THREE.Vector4()
  );
  private readonly uTrail: UniformArrayNode<'vec4'>;

  private chaseTarget = 0;
  private frozen = false;
  private clock = 0; // Seconds; always advances (path timestamps)
  private lastPosition: THREE.Vector3 | null = null;
  private readonly path: PathSample[] = []; // Recent path, game coords, newest last
  private readonly trailScratch = new Float32Array(CORONA_TRAIL.HISTORY * 2);

  constructor(readonly radius: number) {
    this.positions = instancedArray(this.count, 'vec3');
    this.velocities = instancedArray(this.count, 'vec3');
    this.uTrail = uniformArray(this.trailValues, 'vec4');
    this.computeNode = this.buildCompute();
    this.object = this.buildStreaks();
  }

  // Trip progress along the tail (0 = on the surface, 1 = tail end) and tail weight.
  // Only particles on the swarm's trailing side shed, and only while it's moving.
  private tailState(n: Node<'float'>, time: Node<'float'>, surface: Node<'vec3'>) {
    const T = CORONA_TRAIL;
    const { uChase, uMove } = this;
    const isTail = step(hash(n.add(31.4)), T.CHANCE);
    const rate = mix(float(T.FLOW_RATE[0]), float(T.FLOW_RATE[1]), uChase).mul(
      hash(n.add(2.2)).mul(0.6).add(0.7)
    );
    const trip = fract(hash(n.add(8.8)).add(time.mul(rate)));
    const moving = smoothstep(T.MOVE_SPEED[0], T.MOVE_SPEED[1], length(uMove));
    const backward = normalize(uMove.negate().add(vec2(0.0001, 0)));
    const facing = dot(normalize(surface.xy.add(vec2(0.0001, 0))), backward);
    const trailing = smoothstep(T.BACK_FACING[0], T.BACK_FACING[1], facing);
    return { trip, weight: isTail.mul(moving).mul(trailing) };
  }

  // Path offset `back` seconds ago, interpolated between samples
  private trailAt(back: Node<'float'>) {
    const T = CORONA_TRAIL;
    const idx = clamp(back.div(T.SAMPLE_INTERVAL), 0, T.HISTORY - 1.001);
    const i0 = floor(idx);
    return mix(
      this.uTrail.element(int(i0)).xy,
      this.uTrail.element(int(i0).add(1)).xy,
      idx.sub(i0)
    );
  }

  private positionAt(n: Node<'float'>, time: Node<'float'>) {
    const T = CORONA_TRAIL;
    const surface = coronaSurface(n, time, this.radius, this.uChase);
    const { trip, weight } = this.tailState(n, time, surface);
    const back = trip.mul(mix(float(T.SECONDS[0]), float(T.SECONDS[1]), this.uChase));
    const center = this.trailAt(back);
    // Local direction of the path, for spreading sideways
    const along = normalize(this.trailAt(back.add(0.03)).sub(center).add(vec2(0.0001, 0)));
    const side = vec2(along.y.negate(), along.x);
    const spread = hash(n.add(5.1))
      .sub(0.5)
      .mul(2)
      .mul(mix(float(T.SPREAD[0]), float(T.SPREAD[1]), trip));
    const wave = sin(
      trip
        .mul(T.WAVE_FREQ)
        .sub(time.mul(T.WAVE_SPEED))
        .add(hash(n.add(6.6)).mul(6.283))
    )
      .mul(T.WAVE_AMP)
      .mul(trip);
    // Keep the particle's offset from the swarm center (tapering), so the tail starts as
    // the sphere's silhouette and stretches back along the path with no jump at the surface
    const offset = surface.xy.mul(mix(float(1), float(T.TAPER), trip));
    const trailPoint = vec3(
      center.add(offset).add(side.mul(spread.add(wave))),
      surface.z.mul(float(1).sub(trip))
    );
    return mix(surface, trailPoint, weight);
  }

  private buildCompute(): ComputeNode {
    const { positions, velocities, uTime, uDt, uChase, radius } = this;
    return Fn(() => {
      const n = float(instanceIndex);
      const p = this.positionAt(n, uTime);
      // Finite-difference velocity (fixed small step when frozen). When a tail particle
      // wraps from the tail end back to the surface, use the surface flow instead of the jump.
      const h = max(uDt, MIN_VELOCITY_STEP);
      const fullVel = p.sub(this.positionAt(n, uTime.sub(h))).div(h);
      const surfaceNow = coronaSurface(n, uTime, radius, uChase);
      const surfaceThen = coronaSurface(n, uTime.sub(h), radius, uChase);
      const surfaceVel = surfaceNow.sub(surfaceThen).div(h);
      const wrapped = this.tailState(n, uTime, surfaceNow).trip.lessThan(
        this.tailState(n, uTime.sub(h), surfaceThen).trip
      );
      positions.element(instanceIndex).assign(p);
      velocities.element(instanceIndex).assign(select(wrapped, surfaceVel, fullVel));
    })().compute(this.count);
  }

  /** Quads in the local XY (view) plane, stretched along each particle's velocity */
  private buildStreaks(): THREE.InstancedMesh {
    const T = CORONA_TRAIL;
    const { uTime, uChase, uFrozen, radius } = this;
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false, // Matches the shell: swarms draw over soup obstacles
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const n = float(instanceIndex);
    const center = this.positions.element(instanceIndex);
    const velocity = this.velocities.element(instanceIndex);
    const speed = length(velocity.xy);
    const dir = select(speed.greaterThan(0.001), velocity.xy.div(speed), vec2(1, 0));
    const perp = vec2(dir.y.negate(), dir.x);
    const streakLength = clamp(
      speed.mul(STREAK.LENGTH_PER_SPEED),
      STREAK.MIN_LENGTH,
      STREAK.MAX_LENGTH
    );
    // Head on the particle, tail trailing behind
    const along = positionGeometry.x.sub(0.5).mul(streakLength);
    const across = positionGeometry.y.mul(STREAK.WIDTH);
    material.positionNode = center.add(vec3(dir.mul(along).add(perp.mul(across)), 0));

    // Gold surface, pinker with altitude (flares) and along the tail; redder when chasing
    const { trip, weight } = this.tailState(n, uTime, coronaSurface(n, uTime, radius, uChase));
    const altitude = length(center).div(radius).sub(CORONA.SURFACE);
    const lift = max(
      smoothstep(CORONA.GLOW_ALTITUDE[0], CORONA.GLOW_ALTITUDE[1], altitude),
      trip.mul(weight)
    );
    const base = mix(rgb(PALETTE.AMBER), rgb(PALETTE.RED), uChase.mul(0.6));
    const color = mix(base, rgb(PALETTE.PINK), lift);
    // Additive: surface stays translucent; tail particles fade out toward the end
    const fade = float(1).sub(smoothstep(T.FADE_START, 1, trip).mul(weight));
    const surfaceOpacity = mix(float(0.4), float(0.35), lift);
    const opacity = mix(surfaceOpacity, float(T.OPACITY), weight).mul(fade);

    // EMP: gray out and dim
    material.colorNode = mix(color, rgb(PALETTE.FROZEN), uFrozen);
    material.opacityNode = mix(opacity, opacity.mul(0.35), uFrozen).mul(uv().x);

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
   * @param worldPosition - The swarm group's world position (drives the tail)
   */
  update(dtSeconds: number, worldPosition?: THREE.Vector3): void {
    const dt = Math.min(dtSeconds, 0.1);
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    this.uChase.value += (this.chaseTarget - this.uChase.value) * ease(CHASE_BLEND_RATE);
    this.uFrozen.value += ((this.frozen ? 1 : 0) - this.uFrozen.value) * ease(FROZEN_BLEND_RATE);
    this.uDt.value = this.frozen ? 0 : dt;
    if (!this.frozen) this.uTime.value += dt;
    this.clock += dt;
    if (!worldPosition) return;

    // World X = game X, world Z = -game Y
    const x = worldPosition.x;
    const y = -worldPosition.z;
    if (this.lastPosition && dt > 0) {
      const lastY = -this.lastPosition.z;
      const vx = (x - this.lastPosition.x) / dt;
      const vy = (y - lastY) / dt;
      this.uMove.value.lerp(new THREE.Vector2(vx, vy), ease(MOVE_SMOOTHING));
    }
    this.lastPosition = (this.lastPosition ?? new THREE.Vector3()).copy(worldPosition);

    // Record the path (reset on teleport-sized jumps) and sample it for the tail
    const T = CORONA_TRAIL;
    const last = this.path[this.path.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) > T.JUMP_RESET) this.path.length = 0;
    this.path.push({ t: this.clock, x, y });
    const keep = T.HISTORY * T.SAMPLE_INTERVAL + 0.2; // A little more than the sampled window
    while (this.path.length > 2 && this.path[0].t < this.clock - keep) this.path.shift();
    samplePath(this.path, this.clock, this.trailScratch);
    for (let k = 0; k < T.HISTORY; k++) {
      this.trailValues[k].set(this.trailScratch[k * 2], this.trailScratch[k * 2 + 1], 0, 0);
    }
  }

  /** GPU buffers for diagnostics readback (local-space vec3 per particle) */
  get buffers() {
    return { positions: this.positions.value, velocities: this.velocities.value };
  }

  /** The uniform values the next dispatch will use, for the CPU reference (coronaStepCPU) */
  get params(): CoronaParams {
    return {
      count: this.count,
      radius: this.radius,
      time: this.uTime.value,
      dt: this.uDt.value,
      chase: this.uChase.value,
      move: [this.uMove.value.x, this.uMove.value.y],
      trail: Float32Array.from(this.trailValues.flatMap((v) => [v.x, v.y])),
    };
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.computeNode.dispose();
  }
}
