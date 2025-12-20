// ============================================
// WakeParticleSystem - Spawns liquid wake particles behind moving entities
// Creates V-shaped particle patterns that drift outward and fade
// Gives entities the feel of swimming through cosmic liquid
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  GAME_CONFIG,
  type PositionComponent,
  type VelocityComponent,
} from '../../ecs';

// ============================================
// Configuration
// ============================================

// spawnRate: particles per second per entity at full speed
// lifetime: how long particles live (seconds)
// driftSpeed: how fast particles drift outward (units/sec)
// vAngle: half-angle of V-pattern (radians)
// minSpeed: minimum entity speed to spawn wake particles
// sizeGrowth: how much particles grow over lifetime (multiplier)
const WAKE_CONFIG = {
  spawnRate: 12,
  lifetime: 1.2,
  driftSpeed: 40,
  vAngle: Math.PI / 3, // 60 degrees half-angle for wide V
  minSpeed: 20,
  initialSize: 3, // Screen-space pixels (no attenuation)
  sizeGrowth: 2.0,
  maxParticles: 2000,
  baseColor: 0x00ffff, // Cyan to match data particles
};

// ============================================
// Types
// ============================================

interface WakeParticle {
  // Position
  x: number;
  y: number;
  z: number;
  // Drift velocity (outward from entity path)
  vx: number;
  vy: number;
  vz: number;
  // Lifecycle
  age: number;
  lifetime: number;
  // Visual
  color: THREE.Color;
}

// ============================================
// WakeParticleSystem
// ============================================

export class WakeParticleSystem {
  private scene!: THREE.Scene;
  private particles: WakeParticle[] = [];
  private points!: THREE.Points;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.PointsMaterial;

  // Track spawn timing per entity
  private spawnAccumulators: Map<number, number> = new Map();

  // Reusable vectors for calculations
  private tempVec3 = new THREE.Vector3();

  /**
   * Initialize wake particle system
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;

    // Create geometry with max particles
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(WAKE_CONFIG.maxParticles * 3);
    const colors = new Float32Array(WAKE_CONFIG.maxParticles * 3);
    const sizes = new Float32Array(WAKE_CONFIG.maxParticles);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Create material with vertex colors (no size attenuation for consistent visibility)
    this.material = new THREE.PointsMaterial({
      size: WAKE_CONFIG.initialSize,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: false, // Screen-space size, consistent regardless of camera distance
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Update wake particles - spawn new ones behind moving entities, update existing
   * @param world - ECS world to query entities
   * @param dt - Delta time in milliseconds
   */
  update(world: World, dt: number): void {
    const dtSec = dt / 1000;

    // Track which entities we've seen this frame
    const seenEntities = new Set<number>();

    // Spawn new particles behind moving players
    world.forEachWithTag(Tags.Player, (entity) => {
      seenEntities.add(entity);

      const pos = world.getComponent<PositionComponent>(entity, Components.Position);
      const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!pos || !vel) return;

      // Calculate speed
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + (vel.z ?? 0) * (vel.z ?? 0));
      if (speed < WAKE_CONFIG.minSpeed) return;

      // Get or create spawn accumulator
      let accumulator = this.spawnAccumulators.get(entity) ?? 0;

      // Spawn rate scales with speed (faster = more particles)
      const speedFactor = Math.min(speed / 150, 1.5);
      const particlesToSpawn = WAKE_CONFIG.spawnRate * speedFactor * dtSec;
      accumulator += particlesToSpawn;

      // Spawn particles
      while (accumulator >= 1 && this.particles.length < WAKE_CONFIG.maxParticles) {
        accumulator -= 1;
        this.spawnWakeParticle(pos, vel, speed);
      }

      this.spawnAccumulators.set(entity, accumulator);
    });

    // Clean up accumulators for entities that no longer exist
    this.spawnAccumulators.forEach((_, entity) => {
      if (!seenEntities.has(entity)) {
        this.spawnAccumulators.delete(entity);
      }
    });

    // Update existing particles
    this.updateParticles(dtSec);

    // Update GPU buffers
    this.updateBuffers();
  }

  /**
   * Spawn a single wake particle in V-pattern behind entity
   */
  private spawnWakeParticle(
    pos: { x: number; y: number; z?: number },
    vel: { x: number; y: number; z?: number },
    speed: number
  ): void {
    // Normalize velocity to get movement direction
    const dirX = vel.x / speed;
    const dirY = vel.y / speed;
    const dirZ = (vel.z ?? 0) / speed;

    // Random side (-1 or 1) for V-pattern
    const side = Math.random() < 0.5 ? -1 : 1;

    // Random angle within V-pattern
    const angle = (Math.random() * 0.5 + 0.5) * WAKE_CONFIG.vAngle * side;

    // Calculate perpendicular drift direction
    let driftX: number, driftY: number, driftZ: number;

    // In sphere mode, perpendicular is more complex
    // Use cross product with surface normal to get tangent perpendicular
    const surfaceNormal = new THREE.Vector3(pos.x, pos.y, pos.z ?? 0).normalize();
    const moveDir = new THREE.Vector3(dirX, dirY, dirZ);

    // Perpendicular on sphere surface (sideways direction)
    const perp = new THREE.Vector3().crossVectors(surfaceNormal, moveDir).normalize();

    // V-pattern: drift sideways (perp) with some backward component
    // angle determines how much sideways vs backward
    const sideways = Math.sin(angle); // How much to the side
    const backward = -Math.cos(angle) * 0.3; // Small backward component

    driftX = perp.x * sideways + moveDir.x * backward;
    driftY = perp.y * sideways + moveDir.y * backward;
    driftZ = perp.z * sideways + moveDir.z * backward;

    // Normalize drift direction
    const len = Math.sqrt(driftX * driftX + driftY * driftY + driftZ * driftZ);
    if (len > 0) {
      driftX /= len;
      driftY /= len;
      driftZ /= len;
    }

    // Spawn behind entity (positive offset = behind movement direction)
    const spawnOffset = 15;
    let spawnX = pos.x - dirX * spawnOffset;
    let spawnY = pos.y - dirY * spawnOffset;
    let spawnZ = (pos.z ?? 0) - dirZ * spawnOffset;

    // Re-project spawn point onto sphere surface immediately
    {
      const len = Math.sqrt(spawnX * spawnX + spawnY * spawnY + spawnZ * spawnZ);
      if (len > 0) {
        const targetRadius = GAME_CONFIG.SPHERE_RADIUS + 2; // Sphere radius + slight lift
        const scale = targetRadius / len;
        spawnX *= scale;
        spawnY *= scale;
        spawnZ *= scale;
      }
    }

    // Create particle
    const particle: WakeParticle = {
      x: spawnX,
      y: spawnY,
      z: spawnZ,
      vx: driftX * WAKE_CONFIG.driftSpeed,
      vy: driftY * WAKE_CONFIG.driftSpeed,
      vz: driftZ * WAKE_CONFIG.driftSpeed,
      age: 0,
      lifetime: WAKE_CONFIG.lifetime * (0.8 + Math.random() * 0.4), // Vary lifetime
      color: new THREE.Color(WAKE_CONFIG.baseColor),
    };

    this.particles.push(particle);
  }

  /**
   * Update all particles (position, age, cull dead)
   */
  private updateParticles(dtSec: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Age particle
      p.age += dtSec;

      // Remove dead particles
      if (p.age >= p.lifetime) {
        this.particles.splice(i, 1);
        continue;
      }

      // Update position
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.z += p.vz * dtSec;

      // Re-project onto sphere surface with slight lift
      const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      if (len > 0) {
        // Keep particles slightly above sphere surface
        const targetRadius = GAME_CONFIG.SPHERE_RADIUS + 2; // Sphere radius + lift
        const scale = targetRadius / len;
        p.x *= scale;
        p.y *= scale;
        p.z *= scale;
      }
    }
  }

  /**
   * Update GPU buffers with current particle data
   */
  private updateBuffers(): void {
    const positions = this.geometry.attributes.position.array as Float32Array;
    const colors = this.geometry.attributes.color.array as Float32Array;
    const sizes = this.geometry.attributes.size.array as Float32Array;

    for (let i = 0; i < WAKE_CONFIG.maxParticles; i++) {
      if (i < this.particles.length) {
        const p = this.particles[i];
        const progress = p.age / p.lifetime;

        // Position (sphere mode: direct 3D coords)
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;

        // Color with fade
        const opacity = 1 - progress;
        colors[i * 3] = p.color.r * opacity;
        colors[i * 3 + 1] = p.color.g * opacity;
        colors[i * 3 + 2] = p.color.b * opacity;

        // Size grows over lifetime
        sizes[i] = WAKE_CONFIG.initialSize * (1 + progress * (WAKE_CONFIG.sizeGrowth - 1));
      } else {
        // Hide unused particles
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -10000;
        positions[i * 3 + 2] = 0;
        sizes[i] = 0;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }

  /**
   * Dispose system resources
   */
  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.particles = [];
    this.spawnAccumulators.clear();
  }
}
