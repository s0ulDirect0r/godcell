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
  isSphereMode,
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
  // Includes z for sphere mode
  private nutrientPositionCache: Map<string, { x: number; y: number; z?: number }> = new Map();

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
      if (isSphereMode()) {
        // Sphere mode: use 3D coordinates directly
        group.userData.baseX = pos.x;
        group.userData.baseY = pos.y;
        group.userData.baseZ = pos.z ?? 0;
        group.userData.isSphere = true;
        group.position.set(pos.x, pos.y, pos.z ?? 0);

        // Cache 3D position for energy transfer effect
        this.nutrientPositionCache.set(nutrientId, { x: pos.x, y: pos.y, z: pos.z });
      } else {
        // Flat mode: XZ plane (X=game X, Y=height, Z=-game Y)
        group.userData.baseX = pos.x;
        group.userData.baseZ = -pos.y;
        group.userData.isSphere = false;
        group.position.set(pos.x, 0, -pos.y);

        // Apply gravity well distortion effect (flat world only)
        const warp = calculateEntityWarp(pos.x, pos.y);
        applyEntityWarp(group, warp);

        // Cache 2D position for energy transfer effect
        this.nutrientPositionCache.set(nutrientId, { x: pos.x, y: pos.y });
      }
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
      if (group.userData.isSphere) {
        // Sphere mode: bob along surface normal (radial direction)
        const { baseX, baseY, baseZ, bobPhase, rotationSpeed } = group.userData;
        const now = Date.now();

        // Tumble rotation
        group.rotation.y += (rotationSpeed ?? 0.0008) * dt;

        // Calculate surface normal (points outward from sphere center)
        const len = Math.sqrt(baseX * baseX + baseY * baseY + baseZ * baseZ);
        if (len > 0) {
          const nx = baseX / len;
          const ny = baseY / len;
          const nz = baseZ / len;

          // Bob along the surface normal
          const bobAmount = Math.sin(now * 0.003 + (bobPhase ?? 0)) * 5;
          group.position.set(
            baseX + nx * bobAmount,
            baseY + ny * bobAmount,
            baseZ + nz * bobAmount
          );
        }

        // Pulse core (reuse existing logic)
        const core = group.children.find((c) => c.name === 'core') as THREE.Mesh | undefined;
        if (core && core.material instanceof THREE.MeshBasicMaterial) {
          const pulse = 0.7 + Math.sin(now * 0.004 + (bobPhase ?? 0)) * 0.3;
          core.material.opacity = pulse;
        }
      } else {
        // Flat mode: use standard animation
        const { baseX, baseZ } = group.userData;
        updateNutrientAnimation(group, dt, baseX, baseZ);
      }
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
   * @returns Position or undefined if not cached (includes z for sphere mode)
   */
  getNutrientPosition(nutrientId: string): { x: number; y: number; z?: number } | undefined {
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
