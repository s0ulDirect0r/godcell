// ============================================
// NutrientRenderSystem - Manages nutrient entity rendering
// Owns nutrient meshes (3D icosahedron crystals)
// Queries ECS World directly for nutrient entities
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type NutrientComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';
import {
  createNutrient,
  updateNutrientAnimation,
  disposeNutrient,
  setNutrientOpacity,
} from '../meshes/NutrientMesh';
import { calculateEntityWarp, applyEntityWarp } from '../utils/GravityDistortionUtils';

/**
 * NutrientRenderSystem - Manages nutrient entity rendering
 *
 * Owns:
 * - Nutrient meshes (3D icosahedron crystals with inner glow)
 * - Nutrient position cache (for energy transfer effects)
 * - Nutrient animations (rotation, bobbing, core pulsing)
 */
export class NutrientRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Nutrient meshes (icosahedron crystal + inner glow)
  private nutrientMeshes: Map<string, THREE.Group> = new Map();

  // Position cache for energy transfer effect (used when nutrient is collected)
  private nutrientPositionCache: Map<string, { x: number; y: number }> = new Map();

  /**
   * Initialize nutrient system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync nutrients by querying ECS World directly
   * Creates new meshes for new nutrients, removes meshes for despawned nutrients
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (renderMode === 'jungle') return;

    // Track which nutrients exist in ECS
    const currentNutrientIds = new Set<string>();

    // Query ECS World for all nutrients
    this.world.forEachWithTag(Tags.Nutrient, (entity) => {
      const nutrientId = getStringIdByEntity(entity);
      if (!nutrientId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const nutrient = this.world.getComponent<NutrientComponent>(entity, Components.Nutrient);
      if (!pos || !nutrient) return;

      currentNutrientIds.add(nutrientId);

      let group = this.nutrientMeshes.get(nutrientId);

      if (!group) {
        const result = createNutrient(nutrient.valueMultiplier);
        group = result.group;
        this.scene.add(group);
        this.nutrientMeshes.set(nutrientId, group);
      }

      // Update base position (bobbing animation added in updateAnimations)
      // XZ plane: X=game X, Y=height, Z=-game Y
      group.userData.baseX = pos.x;
      group.userData.baseZ = -pos.y;
      group.position.set(pos.x, 0, -pos.y);

      // Apply gravity well distortion effect
      // Creates visual "spaghettification" when nutrients are near gravity wells
      const warp = calculateEntityWarp(pos.x, pos.y);
      applyEntityWarp(group, warp);

      // Cache position for energy transfer effect (used when nutrient is collected)
      this.nutrientPositionCache.set(nutrientId, { x: pos.x, y: pos.y });
    });

    // Remove nutrients that no longer exist in ECS
    this.nutrientMeshes.forEach((group, id) => {
      if (!currentNutrientIds.has(id)) {
        this.scene.remove(group);
        disposeNutrient(group);
        this.nutrientMeshes.delete(id);
      }
    });

    // Note: Position cache is cleaned up when nutrientCollected event handler
    // calls getNutrientPosition() and then clearNutrientPosition()
  }

  /**
   * Update nutrient animations (rotation, bobbing, core pulsing)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.nutrientMeshes.forEach((group) => {
      const { baseX, baseZ } = group.userData;
      updateNutrientAnimation(group, dt, baseX, baseZ);
    });
  }

  /**
   * Apply spawn animation (scale/opacity) to nutrients
   * @param spawnProgress - Map of entity ID to spawn progress (0-1)
   */
  applySpawnAnimations(spawnProgress: Map<string, number>): void {
    spawnProgress.forEach((progress, entityId) => {
      const group = this.nutrientMeshes.get(entityId);
      if (!group) return;

      // Ease-out curve for smoother scale-up
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const scale = 0.1 + easeOut * 0.9;
      const opacity = 0.3 + easeOut * 0.7;

      group.scale.setScalar(scale);
      setNutrientOpacity(group, opacity);
    });
  }

  /**
   * Get nutrient position from cache (for energy transfer effects)
   * @returns Position or undefined if not cached
   */
  getNutrientPosition(nutrientId: string): { x: number; y: number } | undefined {
    return this.nutrientPositionCache.get(nutrientId);
  }

  /**
   * Clear nutrient position from cache after use
   * Called after energy transfer effect is spawned
   */
  clearNutrientPosition(nutrientId: string): void {
    this.nutrientPositionCache.delete(nutrientId);
  }

  /**
   * Clear all nutrient meshes and cache
   * Called when transitioning from soup to jungle mode
   */
  clearAll(): void {
    this.nutrientMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeNutrient(group);
    });
    this.nutrientMeshes.clear();
    this.nutrientPositionCache.clear();
  }

  /**
   * Get count of nutrient meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.nutrientMeshes.size;
  }

  /**
   * Dispose all nutrient resources
   */
  dispose(): void {
    this.clearAll();
  }
}
