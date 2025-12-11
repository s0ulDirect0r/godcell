// ============================================
// EntropySerpentRenderSystem - Manages entropy serpent rendering
// Renders aggressive apex predator serpents in the jungle
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  GAME_CONFIG,
  type PositionComponent,
  type EntropySerpentComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';
import { frameLerp } from '../../utils/math';
import {
  createEntropySerpent,
  updateEntropySerpentAnimation,
  updateEntropySerpentState,
  disposeEntropySerpent,
} from '../meshes/EntropySerpentMesh';

/**
 * EntropySerpentRenderSystem - Manages entropy serpent rendering
 *
 * Owns:
 * - Serpent meshes (swarm-style body with clawed arms)
 * - State-based visual updates (patrol, chase, attack)
 * - Smooth interpolation and rotation toward targets
 */
export class EntropySerpentRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Serpent meshes
  private serpentMeshes: Map<string, THREE.Group> = new Map();

  // Interpolation targets for smooth movement
  private serpentTargets: Map<string, { x: number; y: number }> = new Map();

  // Current heading for smooth rotation
  private serpentHeadings: Map<string, number> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync serpents by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode
    if (renderMode !== 'jungle') return;

    // Track which serpents exist in ECS
    const currentSerpentIds = new Set<string>();

    // Query ECS World for all entropy serpents
    this.world.forEachWithTag(Tags.EntropySerpent, (entity) => {
      const serpentId = getStringIdByEntity(entity);
      if (!serpentId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const serpent = this.world.getComponent<EntropySerpentComponent>(entity, Components.EntropySerpent);
      const interp = this.world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
      if (!pos || !serpent) return;

      currentSerpentIds.add(serpentId);

      let group = this.serpentMeshes.get(serpentId);

      if (!group) {
        // Create serpent visual
        const radius = serpent.size || GAME_CONFIG.ENTROPY_SERPENT_SIZE;
        group = createEntropySerpent(radius);
        group.position.set(pos.x, 40, -pos.y); // Y=40 for proper ground level
        this.scene.add(group);
        this.serpentMeshes.set(serpentId, group);
        this.serpentTargets.set(serpentId, { x: pos.x, y: pos.y });
        this.serpentHeadings.set(serpentId, serpent.heading || 0);
      }

      // Update target position
      const targetX = interp ? interp.targetX : pos.x;
      const targetY = interp ? interp.targetY : pos.y;
      this.serpentTargets.set(serpentId, { x: targetX, y: targetY });

      // Update heading
      this.serpentHeadings.set(serpentId, serpent.heading || 0);

      // Update state-based visuals (patrol/chase/attack colors)
      updateEntropySerpentState(group, serpent.state);
    });

    // Remove serpents that no longer exist in ECS
    this.serpentMeshes.forEach((group, id) => {
      if (!currentSerpentIds.has(id)) {
        this.scene.remove(group);
        disposeEntropySerpent(group);
        this.serpentMeshes.delete(id);
        this.serpentTargets.delete(id);
        this.serpentHeadings.delete(id);
      }
    });
  }

  /**
   * Interpolate serpent positions for smooth movement
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  interpolate(dt: number = 16.67): void {
    // Serpents move fast - use moderate lerp factor
    const lerpFactor = frameLerp(0.2, dt);
    const rotLerpFactor = frameLerp(0.15, dt);

    this.serpentMeshes.forEach((group, id) => {
      const target = this.serpentTargets.get(id);
      const targetHeading = this.serpentHeadings.get(id) ?? 0;

      if (target) {
        // Smooth position interpolation
        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;

        // Smooth rotation toward heading
        // heading is in radians from server (atan2 of dy, dx)
        // Convert to Three.js rotation (Y-axis rotation in XZ plane)
        const targetRotation = -targetHeading + Math.PI / 2;
        const rotDiff = targetRotation - group.rotation.y;
        // Normalize rotation difference
        const normalizedDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff));
        group.rotation.y += normalizedDiff * rotLerpFactor;
      }
    });
  }

  /**
   * Update serpent animations (slithering, breathing, arm sway, particle storm)
   * @param dt - Delta time in seconds
   */
  updateAnimations(dt: number): void {
    this.serpentMeshes.forEach((group, id) => {
      const target = this.serpentTargets.get(id);
      // Determine if moving based on distance to target
      let isMoving = false;
      if (target) {
        const dx = target.x - group.position.x;
        const dz = -target.y - group.position.z;
        isMoving = Math.sqrt(dx * dx + dz * dz) > 5;
      }
      updateEntropySerpentAnimation(group, dt, isMoving);
    });
  }

  /**
   * Clear all serpent meshes
   */
  clearAll(): void {
    this.serpentMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeEntropySerpent(group);
    });
    this.serpentMeshes.clear();
    this.serpentTargets.clear();
    this.serpentHeadings.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.serpentMeshes.size;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
