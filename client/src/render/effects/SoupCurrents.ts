// ============================================
// Soup Currents - GPU compute background particles
// ============================================

import * as THREE from 'three/webgpu';
import type { StorageBufferNode, UniformArrayNode } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  float,
  hash,
  clamp,
  instanceIndex,
  instancedArray,
  positionGeometry,
  uv,
  length,
  mix,
  mod,
  smoothstep,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl';
import { GAME_CONFIG } from '#shared';
import {
  CURRENT_BOUNDS,
  SOUP_CURRENTS,
  seedCurrentParticles,
  type CurrentWell,
} from './soupCurrentsSim';

export { SOUP_CURRENTS };

/**
 * Pack gravity wells into the vec4 uniform layout the compute shader reads:
 * (x, y, radius, unused). Returns the number of wells packed.
 */
export function packWells(
  wells: readonly CurrentWell[],
  out: THREE.Vector4[],
  max = SOUP_CURRENTS.MAX_WELLS
): number {
  const count = Math.min(wells.length, max, out.length);
  for (let i = 0; i < count; i++) out[i].set(wells[i].x, wells[i].y, wells[i].radius, 0);
  return count;
}

/**
 * Background "data current" for the soup, simulated in a compute shader.
 *
 * Each particle drifts diagonally like the old CPU particles, is pulled (and
 * swirled) toward gravity wells within their radius, respawns somewhere random
 * when a well's core swallows it, and wraps at the soup edges. Positions live
 * only on the GPU; gameplay never reads them (diagnostics can, see `buffers`).
 *
 * stepCurrentsCPU in soupCurrentsSim.ts mirrors buildCompute: keep them in sync.
 */
export class SoupCurrents {
  readonly object: THREE.InstancedMesh;
  readonly computeNode: THREE.ComputeNode;
  readonly count: number;

  private readonly positions: StorageBufferNode<'vec2'>;
  private readonly flows: StorageBufferNode<'vec2'>; // Velocity written by compute; orients/tints streaks
  private readonly uDt = uniform(0);
  private readonly uSeed = uniform(0); // Changes every frame so respawn spots vary
  private readonly uWellCount = uniform(0, 'int');
  private readonly wellValues: THREE.Vector4[];
  private readonly uWells: UniformArrayNode<'vec4'>;

  /**
   * @param count - Particle count (smaller for parity checks)
   * @param random - RNG for initial positions/velocities (seeded for parity checks)
   */
  constructor(count = SOUP_CURRENTS.COUNT, random: () => number = Math.random) {
    this.count = count;
    const seed = seedCurrentParticles(count, random);
    this.positions = instancedArray(seed.positions, 'vec2');
    const velocities = instancedArray(seed.velocities, 'vec2');
    this.flows = instancedArray(count, 'vec2');

    this.wellValues = Array.from({ length: SOUP_CURRENTS.MAX_WELLS }, () => new THREE.Vector4());
    this.uWells = uniformArray(this.wellValues, 'vec4');

    this.computeNode = this.buildCompute(velocities);
    this.object = this.buildStreaks();
  }

  private buildCompute(velocities: StorageBufferNode<'vec2'>): THREE.ComputeNode {
    const { positions, flows, uDt, uSeed, uWellCount, uWells } = this;
    const { minX, minY, spanX, spanY } = CURRENT_BOUNDS;
    const coreRadius = GAME_CONFIG.OBSTACLE_CORE_RADIUS;

    return Fn(() => {
      const position = positions.element(instanceIndex);
      const p = vec2(position).toVar();
      const flow = vec2(velocities.element(instanceIndex)).toVar();
      const swallowed = float(0).toVar();

      Loop(uWellCount, ({ i }) => {
        const well = uWells.element(i);
        const toWell = well.xy.sub(p);
        const dist = length(toWell).max(1);
        If(dist.lessThan(well.z), () => {
          const falloff = float(1).sub(dist.div(well.z));
          const dir = toWell.div(dist);
          const tangent = vec2(dir.y.negate(), dir.x);
          const strength = falloff.mul(falloff).mul(SOUP_CURRENTS.PULL_SPEED);
          flow.addAssign(dir.add(tangent.mul(SOUP_CURRENTS.SWIRL_RATIO)).mul(strength));
          If(dist.lessThan(coreRadius), () => {
            swallowed.assign(1);
          });
        });
      });

      p.addAssign(flow.mul(uDt));
      flows.element(instanceIndex).assign(flow);

      // Swallowed by a core: respawn at a random spot in the soup
      If(swallowed.greaterThan(0), () => {
        const n = float(instanceIndex).add(uSeed);
        p.assign(
          vec2(
            hash(n).mul(GAME_CONFIG.SOUP_WIDTH).add(GAME_CONFIG.SOUP_ORIGIN_X),
            hash(n.add(7.13)).mul(GAME_CONFIG.SOUP_HEIGHT).add(GAME_CONFIG.SOUP_ORIGIN_Y)
          )
        );
      });

      // Wrap at the soup edges (mod stays positive)
      p.x.assign(mod(p.x.sub(minX), spanX).add(minX));
      p.y.assign(mod(p.y.sub(minY), spanY).add(minY));

      position.assign(p);
    })().compute(this.count);
  }

  private buildStreaks(): THREE.InstancedMesh {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const center = this.positions.element(instanceIndex);
    const flow = this.flows.element(instanceIndex);
    const speed = length(flow);
    const dir = flow.div(speed.max(0.001));
    const perp = vec2(dir.y.negate(), dir.x);
    const streakLength = clamp(
      speed.mul(SOUP_CURRENTS.STREAK_SECONDS),
      SOUP_CURRENTS.STREAK_MIN_LENGTH,
      SOUP_CURRENTS.STREAK_MAX_LENGTH
    );
    // Unit quad (-0.5..0.5): x runs along the streak, y across it. Shift x so the
    // head sits on the particle and the tail trails behind.
    const along = positionGeometry.x.sub(0.5).mul(streakLength);
    const across = positionGeometry.y.mul(SOUP_CURRENTS.STREAK_WIDTH);
    const p = center.add(dir.mul(along)).add(perp.mul(across));
    // Game (x, y) -> world XZ plane (Z = -game Y)
    material.positionNode = vec3(p.x, SOUP_CURRENTS.HEIGHT, p.y.negate());

    // Particles being pulled into a well glow, so the spiral arms read in a still frame
    const glow = smoothstep(SOUP_CURRENTS.GLOW_SPEED_MIN, SOUP_CURRENTS.GLOW_SPEED_MAX, speed);
    const base = new THREE.Color(GAME_CONFIG.PARTICLE_COLOR);
    const hot = new THREE.Color(SOUP_CURRENTS.GLOW_COLOR);
    material.colorNode = mix(vec3(base.r, base.g, base.b), vec3(hot.r, hot.g, hot.b), glow);
    // uv.x: 0 at the tail, 1 at the head
    material.opacityNode = mix(float(SOUP_CURRENTS.OPACITY), float(1), glow).mul(uv().x);

    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, this.count);
    mesh.frustumCulled = false; // Bounds are one unit quad; the streaks span the soup
    return mesh;
  }

  /** GPU buffers for diagnostics readback (positions and flow velocities, game-space vec2) */
  get buffers() {
    return { positions: this.positions.value, flows: this.flows.value };
  }

  /** Update uniforms for this frame. Dispatch `computeNode` afterwards. */
  update(dtSeconds: number, wells: readonly CurrentWell[]): void {
    this.uDt.value = Math.min(dtSeconds, SOUP_CURRENTS.MAX_DT);
    this.uSeed.value = (this.uSeed.value + 1) % SOUP_CURRENTS.SEED_PERIOD;
    this.uWellCount.value = packWells(wells, this.wellValues);
  }

  /** Respawn seed the next dispatch will use (for matching the CPU reference) */
  get seed(): number {
    return this.uSeed.value;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.computeNode.dispose();
  }
}
