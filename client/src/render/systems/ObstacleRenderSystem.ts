// ============================================
// ObstacleRenderSystem - Manages gravity well obstacle rendering
// Owns obstacle meshes (influence rings, event horizon, vortex, accretion disk)
// ============================================

import * as THREE from 'three';
import {
  createObstacle,
  updateObstacleAnimation,
  disposeObstacle,
  type AccretionParticle,
} from '../three/ObstacleRenderer';
import type { RenderMode } from './EnvironmentSystem';

/**
 * Obstacle data needed for rendering
 */
export interface ObstacleData {
  id: string;
  position: { x: number; y: number };
  radius: number;
}

/**
 * ObstacleRenderSystem - Manages gravity well obstacle rendering
 *
 * Owns:
 * - Obstacle meshes (influence rings, event horizon, vortex, singularity)
 * - Accretion disk particle data
 * - Animation state (pulse phases)
 */
export class ObstacleRenderSystem {
  private scene!: THREE.Scene;

  // Obstacle meshes (gravity wells)
  private obstacleMeshes: Map<string, THREE.Group> = new Map();

  // Accretion disk particle animation data
  private obstacleParticles: Map<string, AccretionParticle[]> = new Map();

  // Phase offset for core pulsing animation (so obstacles don't pulse in sync)
  private obstaclePulsePhase: Map<string, number> = new Map();

  /**
   * Initialize obstacle system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Sync obstacles from game state
   * Creates new meshes for new obstacles, removes meshes for despawned obstacles
   * Obstacles don't move, so only create once
   * @param obstacles - Map of obstacle ID to obstacle data
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(obstacles: Map<string, ObstacleData>, renderMode: RenderMode): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (renderMode === 'jungle') return;

    // Remove obstacles that no longer exist
    this.obstacleMeshes.forEach((group, id) => {
      if (!obstacles.has(id)) {
        disposeObstacle(group);
        this.scene.remove(group);
        this.obstacleMeshes.delete(id);
        this.obstacleParticles.delete(id);
        this.obstaclePulsePhase.delete(id);
      }
    });

    // Add obstacles (they don't move, so only create once)
    obstacles.forEach((obstacle, id) => {
      if (!this.obstacleMeshes.has(id)) {
        const { group, particles } = createObstacle(obstacle.position, obstacle.radius);

        // Store particle data for animation
        this.obstacleParticles.set(id, particles);

        // Random phase offset for pulsing animation
        this.obstaclePulsePhase.set(id, Math.random() * Math.PI * 2);

        this.scene.add(group);
        this.obstacleMeshes.set(id, group);
      }
    });
  }

  /**
   * Update obstacle animations (pulsing, vortex rotation, accretion disk particles)
   * @param obstacles - Map of obstacle ID to obstacle data
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(obstacles: Map<string, ObstacleData>, dt: number): void {
    this.obstacleMeshes.forEach((group, id) => {
      const obstacle = obstacles.get(id);
      if (!obstacle) return;

      const particleData = this.obstacleParticles.get(id);
      const pulsePhase = this.obstaclePulsePhase.get(id) || 0;

      if (particleData) {
        updateObstacleAnimation(group, particleData, obstacle.radius, pulsePhase, dt);
      }
    });
  }

  /**
   * Clear all obstacle meshes
   * Called when transitioning from soup to jungle mode
   */
  clearAll(): void {
    this.obstacleMeshes.forEach((group) => {
      disposeObstacle(group);
      this.scene.remove(group);
    });
    this.obstacleMeshes.clear();
    this.obstacleParticles.clear();
    this.obstaclePulsePhase.clear();
  }

  /**
   * Get count of obstacle meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.obstacleMeshes.size;
  }

  /**
   * Dispose all obstacle resources
   */
  dispose(): void {
    this.obstacleMeshes.forEach(group => {
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.obstacleMeshes.clear();
    this.obstacleParticles.clear();
    this.obstaclePulsePhase.clear();
  }
}
