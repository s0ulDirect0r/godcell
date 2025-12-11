// ============================================
// EffectsSystem - Manages all particle effects and animations
// Owns death bursts, evolution particles, EMP pulses, spawn animations, etc.
// Stage-filtered: clears soup-specific effects when entering jungle mode
// ============================================

import * as THREE from 'three';
import {
  type DeathAnimation,
  type EvolutionAnimation,
  type EMPEffect,
  type SwarmDeathAnimation,
  type SpawnAnimation,
  type EnergyTransferAnimation,
  type MeleeArcAnimation,
  type EnergyWhipAnimation,
  type ClawSlashAnimation,
  spawnDeathParticles,
  spawnHitSparks,
  spawnEvolutionParticles,
  spawnEMPPulse,
  spawnMaterializeParticles,
  spawnSwarmDeathExplosion,
  spawnEnergyTransferParticles,
  spawnMeleeArc,
  spawnEnergyWhipStrike,
  spawnClawSlash,
} from '../effects/ParticleEffects';
import {
  updateDeathAnimations,
  updateEvolutionAnimations,
  updateEMPEffects,
  updateSwarmDeathAnimations,
  updateSpawnAnimations,
  updateEnergyTransferAnimations,
  updateMeleeArcAnimations,
  updateEnergyWhipAnimations,
  updateClawSlashAnimations,
} from '../three/AnimationUpdater';

/**
 * Result of effects update - contains data needed by other systems
 */
export interface EffectsUpdateResult {
  /** Map of entityId → spawn animation progress (0-1) for scale/opacity */
  spawnProgress: Map<string, number>;
  /** Set of player IDs receiving energy this frame (for gain aura trigger) */
  receivingEnergy: Set<string>;
}

/**
 * EffectsSystem - Single source of truth for all particle effects
 *
 * Manages:
 * - Death particle bursts (player death, pseudopod hits)
 * - Evolution orbital particles
 * - EMP pulse expanding rings
 * - Swarm death explosions
 * - Spawn materialization particles
 * - Energy transfer particles (nutrient collection, swarm consumption)
 */
export class EffectsSystem {
  private scene!: THREE.Scene;

  // Animation arrays
  private deathAnimations: DeathAnimation[] = [];
  private evolutionAnimations: EvolutionAnimation[] = [];
  private empEffects: EMPEffect[] = [];
  private swarmDeathAnimations: SwarmDeathAnimation[] = [];
  private spawnAnimations: SpawnAnimation[] = [];
  private energyTransferAnimations: EnergyTransferAnimation[] = [];
  private meleeArcAnimations: MeleeArcAnimation[] = [];
  private energyWhipAnimations: EnergyWhipAnimation[] = [];
  private clawSlashAnimations: ClawSlashAnimation[] = [];

  // Track entities that are currently spawning
  private spawningEntities: Set<string> = new Set();

  /**
   * Initialize effects system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  // ============================================
  // Spawn Methods (called by ThreeRenderer event handlers)
  // ============================================

  /**
   * Spawn death particles - radial burst when entity dies
   */
  spawnDeathBurst(x: number, y: number, colorHex: number): void {
    this.deathAnimations.push(spawnDeathParticles(this.scene, x, y, colorHex));
  }

  /**
   * Spawn hit sparks - red burst when pseudopod hits target
   */
  spawnHitBurst(x: number, y: number): void {
    this.deathAnimations.push(spawnHitSparks(this.scene, x, y));
  }

  /**
   * Spawn evolution particles - orbital particles during stage transition
   */
  spawnEvolution(x: number, y: number, colorHex: number, duration: number): void {
    this.evolutionAnimations.push(spawnEvolutionParticles(this.scene, x, y, colorHex, duration));
  }

  /**
   * Spawn EMP pulse - expanding electromagnetic ring
   */
  spawnEMP(x: number, y: number): void {
    this.empEffects.push(spawnEMPPulse(this.scene, x, y));
  }

  /**
   * Spawn swarm death explosion - particles burst outward
   */
  spawnSwarmDeath(x: number, y: number): void {
    this.swarmDeathAnimations.push(spawnSwarmDeathExplosion(this.scene, x, y));
  }

  /**
   * Spawn entity materialization - converging particles as entity appears
   */
  spawnMaterialize(
    entityId: string,
    entityType: 'player' | 'nutrient' | 'swarm',
    x: number,
    y: number,
    colorHex: number,
    radius: number = 40
  ): void {
    // Skip if already spawning
    if (this.spawningEntities.has(entityId)) return;

    this.spawningEntities.add(entityId);
    this.spawnAnimations.push(
      spawnMaterializeParticles(this.scene, entityId, entityType, x, y, colorHex, radius)
    );
  }

  /**
   * Spawn energy transfer - particles fly from source to target
   * @param gravityPull - If true, particles accelerate with wobble (for gravity drain)
   */
  spawnEnergyTransfer(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    targetId: string,
    colorHex: number = 0x00ffff,
    particleCount: number = 15,
    gravityPull: boolean = false
  ): void {
    this.energyTransferAnimations.push(
      spawnEnergyTransferParticles(
        this.scene,
        sourceX,
        sourceY,
        targetX,
        targetY,
        targetId,
        colorHex,
        particleCount,
        gravityPull
      )
    );
  }

  /**
   * Spawn melee arc attack effect - particles sweep in arc pattern
   * @param attackType - 'swipe' for wide arc (180°), 'thrust' for narrow cone (30°)
   * @param directionX - X component of attack direction
   * @param directionY - Y component of attack direction
   */
  spawnMeleeAttack(
    x: number,
    y: number,
    attackType: 'swipe' | 'thrust',
    directionX: number,
    directionY: number,
    colorHex: number = 0xff6666
  ): void {
    this.meleeArcAnimations.push(
      spawnMeleeArc(this.scene, x, y, attackType, directionX, directionY, colorHex)
    );
  }

  /**
   * Spawn energy whip strike - lightning bolt from attacker to target with AoE impact
   * Used for multi-cell pseudopod attack
   */
  spawnEnergyWhipStrike(
    strikerX: number,
    strikerY: number,
    targetX: number,
    targetY: number,
    aoeRadius: number,
    colorHex: number,
    totalDrained: number
  ): void {
    this.energyWhipAnimations.push(
      spawnEnergyWhipStrike(
        this.scene,
        strikerX,
        strikerY,
        targetX,
        targetY,
        aoeRadius,
        colorHex,
        totalDrained
      )
    );
  }

  /**
   * Spawn claw slash trail - arc sweep effect for entropy serpent attack
   * @param x - Center X position (serpent location)
   * @param y - Center Y position (serpent location)
   * @param direction - Attack direction (radians)
   */
  spawnClawSlash(x: number, y: number, direction: number): void {
    this.clawSlashAnimations.push(
      spawnClawSlash(this.scene, x, y, direction, 0xff6600)
    );
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Check if an entity is currently spawning (for scale/opacity animation)
   */
  isSpawning(entityId: string): boolean {
    return this.spawningEntities.has(entityId);
  }

  // ============================================
  // Update (called each frame)
  // ============================================

  /**
   * Update all particle effects
   * @param dt - Delta time in milliseconds
   * @returns EffectsUpdateResult with spawn progress and energy receivers
   */
  update(dt: number): EffectsUpdateResult {
    // Update death animations
    updateDeathAnimations(this.scene, this.deathAnimations, dt);

    // Update evolution animations
    updateEvolutionAnimations(this.scene, this.evolutionAnimations, dt);

    // Update EMP pulse animations
    updateEMPEffects(this.scene, this.empEffects);

    // Update swarm death explosions
    updateSwarmDeathAnimations(this.scene, this.swarmDeathAnimations, dt);

    // Update spawn materialization animations
    const spawnProgress = updateSpawnAnimations(this.scene, this.spawnAnimations, dt);

    // Clean up finished spawn animations from tracking set
    this.spawningEntities.forEach(entityId => {
      if (!spawnProgress.has(entityId)) {
        this.spawningEntities.delete(entityId);
      }
    });

    // Update energy transfer animations
    const receivingEnergy = updateEnergyTransferAnimations(this.scene, this.energyTransferAnimations, dt);

    // Update melee arc animations
    updateMeleeArcAnimations(this.scene, this.meleeArcAnimations, dt);

    // Update energy whip strike animations
    updateEnergyWhipAnimations(this.scene, this.energyWhipAnimations, dt);

    // Update claw slash trail animations
    updateClawSlashAnimations(this.scene, this.clawSlashAnimations, dt);

    return { spawnProgress, receivingEnergy };
  }

  // ============================================
  // Render Mode Filtering
  // ============================================

  /**
   * Clear soup-specific effects when transitioning to jungle mode
   * Soup effects (death bursts, spawn particles, energy transfers) shouldn't
   * persist when viewing the jungle world
   */
  clearSoupEffects(): void {
    // Clear death animations (soup entity deaths)
    this.deathAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.deathAnimations = [];

    // Clear spawn animations (soup entity spawns)
    this.spawnAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.spawnAnimations = [];

    // Clear energy transfer animations (soup energy flows)
    this.energyTransferAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.energyTransferAnimations = [];

    // Clear swarm death animations (soup enemies)
    this.swarmDeathAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.swarmDeathAnimations = [];

    // Clear EMP effects (multi-cell ability visual)
    this.empEffects.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.empEffects = [];

    // Clear energy whip animations (multi-cell pseudopod attack)
    this.energyWhipAnimations.forEach(anim => {
      this.scene.remove(anim.boltLine);
      anim.boltLine.geometry.dispose();
      (anim.boltLine.material as THREE.Material).dispose();
      this.scene.remove(anim.boltParticles);
      anim.boltParticles.geometry.dispose();
      (anim.boltParticles.material as THREE.Material).dispose();
      this.scene.remove(anim.impactParticles);
      anim.impactParticles.geometry.dispose();
      (anim.impactParticles.material as THREE.Material).dispose();
    });
    this.energyWhipAnimations = [];

    this.spawningEntities.clear();
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Dispose all effects resources
   */
  dispose(): void {
    // Clean up death animations
    this.deathAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.deathAnimations = [];

    // Clean up evolution animations
    this.evolutionAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.evolutionAnimations = [];

    // Clean up EMP effects
    this.empEffects.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.empEffects = [];

    // Clean up swarm death animations
    this.swarmDeathAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.swarmDeathAnimations = [];

    // Clean up spawn animations
    this.spawnAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.spawnAnimations = [];

    // Clean up energy transfer animations
    this.energyTransferAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.energyTransferAnimations = [];

    // Clean up melee arc animations
    this.meleeArcAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.meleeArcAnimations = [];

    // Clean up energy whip animations
    this.energyWhipAnimations.forEach(anim => {
      this.scene.remove(anim.boltLine);
      anim.boltLine.geometry.dispose();
      (anim.boltLine.material as THREE.Material).dispose();
      this.scene.remove(anim.boltParticles);
      anim.boltParticles.geometry.dispose();
      (anim.boltParticles.material as THREE.Material).dispose();
      this.scene.remove(anim.impactParticles);
      anim.impactParticles.geometry.dispose();
      (anim.impactParticles.material as THREE.Material).dispose();
    });
    this.energyWhipAnimations = [];

    // Clean up claw slash animations
    this.clawSlashAnimations.forEach(anim => {
      this.scene.remove(anim.arcLine);
      anim.arcLine.geometry.dispose();
      (anim.arcLine.material as THREE.Material).dispose();
      this.scene.remove(anim.sparkParticles);
      anim.sparkParticles.geometry.dispose();
      (anim.sparkParticles.material as THREE.Material).dispose();
    });
    this.clawSlashAnimations = [];

    this.spawningEntities.clear();
  }
}
