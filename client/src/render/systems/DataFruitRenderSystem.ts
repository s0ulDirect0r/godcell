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
  GAME_CONFIG,
  type PositionComponent,
  type DataFruitComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

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
        group = this.createFruitMesh(fruit.ripeness);
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
      this.updateFruitRipeness(group, fruit.ripeness);
    });

    // Remove fruits that no longer exist in ECS
    this.fruitMeshes.forEach((group, id) => {
      if (!currentFruitIds.has(id)) {
        this.scene.remove(group);
        this.disposeGroup(group);
        this.fruitMeshes.delete(id);
        this.fruitTargets.delete(id);
        this.animationPhase.delete(id);
      }
    });
  }

  /**
   * Interpolate fruit positions for smooth movement
   */
  interpolate(): void {
    const lerpFactor = 0.3;

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
    const time = performance.now() / 1000;

    this.fruitMeshes.forEach((group, id) => {
      const phase = this.animationPhase.get(id) || 0;

      // Gentle pulsing scale
      const pulse = 1 + Math.sin(time * 2 + phase) * 0.1;
      group.scale.setScalar(pulse);

      // Rotate slowly for visual interest
      group.rotation.y += dt * 0.001;
    });
  }

  /**
   * Create a fruit mesh (glowing orb)
   */
  private createFruitMesh(ripeness: number): THREE.Group {
    const group = new THREE.Group();

    // Fruit size based on config
    const radius = GAME_CONFIG.DATAFRUIT_COLLISION_RADIUS;

    // Core sphere
    const coreGeometry = new THREE.SphereGeometry(radius, 16, 16);
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: this.getRipenessColor(ripeness),
      emissive: this.getRipenessColor(ripeness),
      emissiveIntensity: 0.3 + ripeness * 0.7,
      transparent: true,
      opacity: 0.9,
      roughness: 0.2,
      metalness: 0.5,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);

    // Outer glow shell
    const glowGeometry = new THREE.SphereGeometry(radius * 1.5, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.getRipenessColor(ripeness),
      transparent: true,
      opacity: 0.2 + ripeness * 0.3,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    group.add(glow);

    return group;
  }

  /**
   * Update fruit visual based on ripeness (0-1)
   */
  private updateFruitRipeness(group: THREE.Group, ripeness: number): void {
    const color = this.getRipenessColor(ripeness);

    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial;
        material.color.set(color);
        if ('emissive' in material) {
          (material as THREE.MeshPhysicalMaterial).emissive.set(color);
          (material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.3 + ripeness * 0.7;
        }
        if ('opacity' in material) {
          // Glow shell gets more opaque as fruit ripens
          if (material instanceof THREE.MeshBasicMaterial) {
            material.opacity = 0.2 + ripeness * 0.3;
          }
        }
      }
    });
  }

  /**
   * Get color based on ripeness (green → yellow → orange/gold when ripe)
   */
  private getRipenessColor(ripeness: number): number {
    // Unripe: cyan/green (#00ff88)
    // Ripe: gold (#ffcc00)
    const r = Math.floor(ripeness * 255);
    const g = Math.floor(255 - ripeness * 51); // 255 → 204
    const b = Math.floor((1 - ripeness) * 136);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Clear all fruit meshes
   */
  clearAll(): void {
    this.fruitMeshes.forEach((group) => {
      this.scene.remove(group);
      this.disposeGroup(group);
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
   * Dispose group resources
   */
  private disposeGroup(group: THREE.Group): void {
    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
