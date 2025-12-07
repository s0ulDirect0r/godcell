// ============================================
// DataFruitRenderSystem - Manages data fruit rendering
// Renders glowing digital fruit orbs at tree bases
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type DataFruitComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';
import { frameLerp } from '../../utils/math';
import {
  createDataFruit,
  updateDataFruitAnimation,
  updateDataFruitRipeness,
  disposeDataFruit,
} from '../meshes/DataFruitMesh';

/**
 * DataFruitRenderSystem - Manages data fruit rendering
 *
 * Owns:
 * - Fruit meshes (glowing orbs with pulsing effect)
 * - Ripeness-based visual updates
 */
export class DataFruitRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Fruit meshes (sphere with glow)
  private fruitMeshes: Map<string, THREE.Group> = new Map();

  // Interpolation targets for smooth movement
  private fruitTargets: Map<string, { x: number; y: number }> = new Map();

  // Animation phase for pulsing
  private animationPhase: Map<string, number> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync fruits by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode - fruits are Stage 3+ entities
    if (renderMode !== 'jungle') return;

    // Track which fruits exist in ECS
    const currentFruitIds = new Set<string>();

    // Query ECS World for all data fruits
    this.world.forEachWithTag(Tags.DataFruit, (entity) => {
      const fruitId = getStringIdByEntity(entity);
      if (!fruitId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const fruit = this.world.getComponent<DataFruitComponent>(entity, Components.DataFruit);
      const interp = this.world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
      if (!pos || !fruit) return;

      currentFruitIds.add(fruitId);

      let group = this.fruitMeshes.get(fruitId);

      if (!group) {
        // Create fruit visual
        const result = createDataFruit(fruit.ripeness);
        group = result.group;
        group.position.set(pos.x, 10, -pos.y); // Y=10 for slight elevation
        this.scene.add(group);
        this.fruitMeshes.set(fruitId, group);
        this.fruitTargets.set(fruitId, { x: pos.x, y: pos.y });
        this.animationPhase.set(fruitId, Math.random() * Math.PI * 2);
      }

      // Update target position
      const targetX = interp ? interp.targetX : pos.x;
      const targetY = interp ? interp.targetY : pos.y;
      this.fruitTargets.set(fruitId, { x: targetX, y: targetY });

      // Update ripeness visual (color intensity)
      updateDataFruitRipeness(group, fruit.ripeness);
    });

    // Remove fruits that no longer exist in ECS
    this.fruitMeshes.forEach((group, id) => {
      if (!currentFruitIds.has(id)) {
        this.scene.remove(group);
        disposeDataFruit(group);
        this.fruitMeshes.delete(id);
        this.fruitTargets.delete(id);
        this.animationPhase.delete(id);
      }
    });
  }

  /**
   * Interpolate fruit positions for smooth movement
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  interpolate(dt: number = 16.67): void {
    const lerpFactor = frameLerp(0.3, dt);

    this.fruitMeshes.forEach((group, id) => {
      const target = this.fruitTargets.get(id);
      if (target) {
        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;
      }
    });
  }

  /**
   * Update fruit animations (pulsing glow based on ripeness)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.fruitMeshes.forEach((group, id) => {
      const phase = this.animationPhase.get(id) || 0;
      updateDataFruitAnimation(group, dt, phase);
    });
  }

  /**
   * Clear all fruit meshes
   */
  clearAll(): void {
    this.fruitMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeDataFruit(group);
    });
    this.fruitMeshes.clear();
    this.fruitTargets.clear();
    this.animationPhase.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.fruitMeshes.size;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
