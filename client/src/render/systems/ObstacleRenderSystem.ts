// ============================================
// ObstacleRenderSystem - Manages gravity well obstacle rendering
// Owns obstacle meshes (influence rings, event horizon, vortex, accretion disk)
// Queries ECS World directly for obstacle entities
// ============================================

import * as THREE from 'three';
import {
  createObstacle,
  updateObstacleAnimation,
  disposeObstacle,
  type AccretionParticle,
} from '../three/ObstacleRenderer';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type ObstacleComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

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
  private world!: World;

  // Obstacle meshes (gravity wells)
  private obstacleMeshes: Map<string, THREE.Group> = new Map();

  // Accretion disk particle animation data
  private obstacleParticles: Map<string, AccretionParticle[]> = new Map();

  // Phase offset for core pulsing animation (so obstacles don't pulse in sync)
  private obstaclePulsePhase: Map<string, number> = new Map();

  // Cache obstacle radii for animation (obstacles don't move/change)
  private obstacleRadii: Map<string, number> = new Map();

  /**
   * Initialize obstacle system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync obstacles by querying ECS World directly
   * Creates new meshes for new obstacles, removes meshes for despawned obstacles
   * Obstacles don't move, so only create once
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (renderMode === 'jungle') return;

    // Track which obstacles exist in ECS
    const currentObstacleIds = new Set<string>();

    // Query ECS World for all obstacles
    this.world.forEachWithTag(Tags.Obstacle, (entity) => {
      const obstacleId = getStringIdByEntity(entity);
      if (!obstacleId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const obstacle = this.world.getComponent<ObstacleComponent>(entity, Components.Obstacle);
      if (!pos || !obstacle) return;

      currentObstacleIds.add(obstacleId);

      // Add obstacles (they don't move, so only create once)
      if (!this.obstacleMeshes.has(obstacleId)) {
        const { group, particles } = createObstacle({ x: pos.x, y: pos.y }, obstacle.radius);

        // Store particle data for animation
        this.obstacleParticles.set(obstacleId, particles);

        // Random phase offset for pulsing animation
        this.obstaclePulsePhase.set(obstacleId, Math.random() * Math.PI * 2);

        // Cache radius for animation
        this.obstacleRadii.set(obstacleId, obstacle.radius);

        this.scene.add(group);
        this.obstacleMeshes.set(obstacleId, group);
      }
    });

    // Remove obstacles that no longer exist in ECS
    this.obstacleMeshes.forEach((group, id) => {
      if (!currentObstacleIds.has(id)) {
        disposeObstacle(group);
        this.scene.remove(group);
        this.obstacleMeshes.delete(id);
        this.obstacleParticles.delete(id);
        this.obstaclePulsePhase.delete(id);
        this.obstacleRadii.delete(id);
      }
    });
  }

  /**
   * Update obstacle animations (pulsing, vortex rotation, accretion disk particles)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.obstacleMeshes.forEach((group, id) => {
      const particleData = this.obstacleParticles.get(id);
      const pulsePhase = this.obstaclePulsePhase.get(id) || 0;
      const radius = this.obstacleRadii.get(id) || 100;

      if (particleData) {
        updateObstacleAnimation(group, particleData, radius, pulsePhase, dt);
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
    this.obstacleRadii.clear();
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
    this.clearAll();
  }
}
