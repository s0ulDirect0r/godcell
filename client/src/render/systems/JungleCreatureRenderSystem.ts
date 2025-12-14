// ============================================
// JungleCreatureRenderSystem - Manages jungle creature rendering
// Renders variant-specific creature meshes (grazer, stalker, ambusher)
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type JungleCreatureComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';
import { frameLerp } from '../../utils/math';
import {
  createJungleCreature,
  updateJungleCreatureAnimation,
  updateJungleCreatureState,
  disposeJungleCreature,
} from '../meshes/JungleCreatureMesh';

/**
 * JungleCreatureRenderSystem - Manages jungle creature rendering
 *
 * Owns:
 * - Creature meshes (variant-specific shapes and colors)
 * - State-based visual updates (idle, patrol, hunt)
 */
export class JungleCreatureRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Creature meshes
  private creatureMeshes: Map<string, THREE.Group> = new Map();

  // Creature variants for visual updates
  private creatureVariants: Map<string, string> = new Map();

  // Interpolation targets for smooth movement
  private creatureTargets: Map<string, { x: number; y: number }> = new Map();

  // Animation data
  private animationPhase: Map<string, number> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync creatures by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode
    if (renderMode !== 'jungle') return;

    // Track which creatures exist in ECS
    const currentCreatureIds = new Set<string>();

    // Query ECS World for all jungle creatures
    this.world.forEachWithTag(Tags.JungleCreature, (entity) => {
      const creatureId = getStringIdByEntity(entity);
      if (!creatureId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const creature = this.world.getComponent<JungleCreatureComponent>(
        entity,
        Components.JungleCreature
      );
      const interp = this.world.getComponent<InterpolationTargetComponent>(
        entity,
        Components.InterpolationTarget
      );
      if (!pos || !creature) return;

      currentCreatureIds.add(creatureId);

      let group = this.creatureMeshes.get(creatureId);

      if (!group) {
        // Create creature visual based on variant
        const result = createJungleCreature(creature.variant);
        group = result.group;
        group.position.set(pos.x, 20, -pos.y); // Y=20 for ground level
        this.scene.add(group);
        this.creatureMeshes.set(creatureId, group);
        this.creatureVariants.set(creatureId, creature.variant);
        this.creatureTargets.set(creatureId, { x: pos.x, y: pos.y });
        this.animationPhase.set(creatureId, Math.random() * Math.PI * 2);
      }

      // Update target position
      const targetX = interp ? interp.targetX : pos.x;
      const targetY = interp ? interp.targetY : pos.y;
      this.creatureTargets.set(creatureId, { x: targetX, y: targetY });

      // Update state-based visuals
      updateJungleCreatureState(group, creature.state);
    });

    // Remove creatures that no longer exist in ECS
    this.creatureMeshes.forEach((group, id) => {
      if (!currentCreatureIds.has(id)) {
        this.scene.remove(group);
        disposeJungleCreature(group);
        this.creatureMeshes.delete(id);
        this.creatureVariants.delete(id);
        this.creatureTargets.delete(id);
        this.animationPhase.delete(id);
      }
    });
  }

  /**
   * Interpolate creature positions for smooth movement
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  interpolate(dt: number = 16.67): void {
    // Creatures use 0.25 (slower than default) because they're larger/heavier
    const lerpFactor = frameLerp(0.25, dt);
    const rotLerpFactor = frameLerp(0.1, dt);

    this.creatureMeshes.forEach((group, id) => {
      const target = this.creatureTargets.get(id);
      if (target) {
        // Calculate movement direction for rotation
        const dx = target.x - group.position.x;
        const dz = -target.y - group.position.z;

        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;

        // Face movement direction (smooth rotation)
        if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
          const targetRotation = Math.atan2(dx, dz);
          const rotDiff = targetRotation - group.rotation.y;
          // Normalize rotation difference
          const normalizedDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff));
          group.rotation.y += normalizedDiff * rotLerpFactor;
        }
      }
    });
  }

  /**
   * Update creature animations (breathing, movement wobble)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.creatureMeshes.forEach((group, id) => {
      const phase = this.animationPhase.get(id) || 0;
      updateJungleCreatureAnimation(group, dt, phase);
    });
  }

  /**
   * Clear all creature meshes
   */
  clearAll(): void {
    this.creatureMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeJungleCreature(group);
    });
    this.creatureMeshes.clear();
    this.creatureVariants.clear();
    this.creatureTargets.clear();
    this.animationPhase.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.creatureMeshes.size;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
