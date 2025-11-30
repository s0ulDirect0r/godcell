// ============================================
// SwarmRenderSystem - Manages entropy swarm rendering
// Owns swarm meshes (outer sphere, internal storm, orbiting particles)
// ============================================

import * as THREE from 'three';
import {
  createSwarm,
  updateSwarmState,
  updateSwarmAnimation,
  disposeSwarm,
  type SwarmInternalParticle,
  type SwarmOrbitingParticle,
} from '../three/SwarmRenderer';
import type { RenderMode } from './EnvironmentSystem';

/**
 * Swarm data needed for rendering
 */
export interface SwarmData {
  id: string;
  position: { x: number; y: number };
  size: number;
  state: string;
  disabledUntil?: number;
}

/**
 * SwarmRenderSystem - Manages entropy swarm rendering
 *
 * Owns:
 * - Swarm meshes (outer sphere + internal storm + orbiting particles)
 * - Particle animation data (internal and orbiting)
 * - Interpolation targets for smooth movement
 * - Pulse phase offsets for desynchronized animation
 */
export class SwarmRenderSystem {
  private scene!: THREE.Scene;

  // Swarm meshes (Groups containing sphere + particles)
  private swarmMeshes: Map<string, THREE.Group> = new Map();

  // Orbiting particle animation data
  private swarmParticleData: Map<string, SwarmOrbitingParticle[]> = new Map();

  // Internal storm particle animation data
  private swarmInternalParticles: Map<string, SwarmInternalParticle[]> = new Map();

  // Phase offset for pulsing animation (so swarms don't pulse in sync)
  private swarmPulsePhase: Map<string, number> = new Map();

  // Interpolation targets for smooth movement
  private swarmTargets: Map<string, { x: number; y: number }> = new Map();

  /**
   * Initialize swarm system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Sync swarms from game state
   * Creates new meshes for new swarms, removes meshes for despawned swarms
   * @param swarms - Map of swarm ID to swarm data
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(swarms: Map<string, SwarmData>, renderMode: RenderMode): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (renderMode === 'jungle') return;

    // Remove swarms that no longer exist
    this.swarmMeshes.forEach((group, id) => {
      if (!swarms.has(id)) {
        this.scene.remove(group);
        disposeSwarm(group);
        this.swarmMeshes.delete(id);
        this.swarmTargets.delete(id);
        this.swarmParticleData.delete(id);
        this.swarmInternalParticles.delete(id);
        this.swarmPulsePhase.delete(id);
      }
    });

    // Add or update swarms
    swarms.forEach((swarm, id) => {
      let group = this.swarmMeshes.get(id);

      if (!group) {
        // Create swarm visual using helper
        const result = createSwarm(swarm.position, swarm.size);
        group = result.group;

        // Store particle animation data
        this.swarmInternalParticles.set(id, result.internalParticles);
        this.swarmParticleData.set(id, result.orbitingParticles);

        // Random phase offset for pulsing (so swarms don't pulse in sync)
        this.swarmPulsePhase.set(id, Math.random() * Math.PI * 2);

        this.scene.add(group);
        this.swarmMeshes.set(id, group);
        this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });
      }

      // Update target position for interpolation
      this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });

      // Update colors and intensity based on state
      const now = Date.now();
      const isDisabled = !!(swarm.disabledUntil && now < swarm.disabledUntil);
      updateSwarmState(group, swarm.state, isDisabled);
    });
  }

  /**
   * Interpolate swarm positions for smooth movement
   */
  interpolate(): void {
    const lerpFactor = 0.3;

    this.swarmMeshes.forEach((group, id) => {
      const target = this.swarmTargets.get(id);
      if (target) {
        // XZ plane: interpolate X and Z (game Y maps to -Z)
        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;
      }
    });
  }

  /**
   * Update swarm particle animations (pulsing, internal storm, orbiting)
   * @param swarms - Map of swarm ID to swarm data (for state info)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(swarms: Map<string, SwarmData>, dt: number): void {
    this.swarmMeshes.forEach((group, id) => {
      const swarm = swarms.get(id);
      const swarmState = swarm?.state || 'patrol';
      const pulsePhase = this.swarmPulsePhase.get(id) || 0;
      const internalParticles = this.swarmInternalParticles.get(id);
      const orbitingParticles = this.swarmParticleData.get(id);

      if (internalParticles && orbitingParticles) {
        updateSwarmAnimation(group, internalParticles, orbitingParticles, swarmState, pulsePhase, dt);
      }
    });
  }

  /**
   * Apply spawn animation (scale/opacity) to swarms
   * @param spawnProgress - Map of entity ID to spawn progress (0-1)
   */
  applySpawnAnimations(spawnProgress: Map<string, number>): void {
    spawnProgress.forEach((progress, entityId) => {
      const group = this.swarmMeshes.get(entityId);
      if (!group) return;

      // Ease-out curve for smoother scale-up
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const scale = 0.1 + easeOut * 0.9;
      const opacity = 0.3 + easeOut * 0.7;

      group.scale.setScalar(scale);
      this.setGroupOpacity(group, opacity);
    });
  }

  /**
   * Get swarm mesh for external access (e.g., for aura system)
   */
  getSwarmMesh(swarmId: string): THREE.Group | undefined {
    return this.swarmMeshes.get(swarmId);
  }

  /**
   * Get all swarm meshes (for aura system)
   */
  getSwarmMeshes(): Map<string, THREE.Group> {
    return this.swarmMeshes;
  }

  /**
   * Get swarm position from mesh (for effects when swarm is consumed)
   * Returns game coordinates (converts from XZ plane)
   */
  getSwarmPosition(swarmId: string): { x: number; y: number } | undefined {
    const group = this.swarmMeshes.get(swarmId);
    if (!group) return undefined;
    // XZ plane: X=game X, Z=-game Y
    return { x: group.position.x, y: -group.position.z };
  }

  /**
   * Clear all swarm meshes
   * Called when transitioning from soup to jungle mode
   */
  clearAll(): void {
    this.swarmMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeSwarm(group);
    });
    this.swarmMeshes.clear();
    this.swarmTargets.clear();
    this.swarmParticleData.clear();
    this.swarmInternalParticles.clear();
    this.swarmPulsePhase.clear();
  }

  /**
   * Get count of swarm meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.swarmMeshes.size;
  }

  /**
   * Set opacity for all materials in a group
   */
  private setGroupOpacity(group: THREE.Group, opacity: number): void {
    group.children.forEach(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        const material = child.material as THREE.Material;
        if ('opacity' in material) {
          (material as THREE.MeshPhysicalMaterial | THREE.PointsMaterial).opacity = opacity;
        }
      }
    });
  }

  /**
   * Dispose all swarm resources
   */
  dispose(): void {
    this.swarmMeshes.forEach(group => {
      disposeSwarm(group);
    });
    this.swarmMeshes.clear();
    this.swarmParticleData.clear();
    this.swarmInternalParticles.clear();
    this.swarmPulsePhase.clear();
    this.swarmTargets.clear();
  }
}
