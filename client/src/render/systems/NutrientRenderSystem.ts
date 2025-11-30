// ============================================
// NutrientRenderSystem - Manages nutrient entity rendering
// Owns nutrient meshes (3D icosahedron crystals)
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';
import type { RenderMode } from './EnvironmentSystem';

/**
 * Nutrient data needed for rendering
 */
export interface NutrientData {
  id: string;
  position: { x: number; y: number };
  valueMultiplier: number;
}

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

  // Nutrient meshes (icosahedron crystal + inner glow)
  private nutrientMeshes: Map<string, THREE.Group> = new Map();

  // Position cache for energy transfer effect (used when nutrient is collected)
  private nutrientPositionCache: Map<string, { x: number; y: number }> = new Map();

  /**
   * Initialize nutrient system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Sync nutrients from game state
   * Creates new meshes for new nutrients, removes meshes for despawned nutrients
   * @param nutrients - Map of nutrient ID to nutrient data
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(nutrients: Map<string, NutrientData>, renderMode: RenderMode): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (renderMode === 'jungle') return;

    // Remove nutrients that no longer exist
    this.nutrientMeshes.forEach((group, id) => {
      if (!nutrients.has(id)) {
        this.scene.remove(group);
        // Dispose non-cached materials from group children
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh && child.material) {
            (child.material as THREE.Material).dispose();
          }
        });
        this.nutrientMeshes.delete(id);
      }
    });

    // Add or update nutrients
    nutrients.forEach((nutrient, id) => {
      let group = this.nutrientMeshes.get(id);

      if (!group) {
        group = this.createNutrient3D(nutrient);
        this.scene.add(group);
        this.nutrientMeshes.set(id, group);
      }

      // Update base position (bobbing animation added in updateAnimations)
      // XZ plane: X=game X, Y=height, Z=-game Y
      group.userData.baseX = nutrient.position.x;
      group.userData.baseZ = -nutrient.position.y;
      group.position.set(nutrient.position.x, 0, -nutrient.position.y);

      // Cache position for energy transfer effect (used when nutrient is collected)
      this.nutrientPositionCache.set(id, { x: nutrient.position.x, y: nutrient.position.y });
    });

    // Note: Position cache is cleaned up when nutrientCollected event handler
    // calls getNutrientPosition() and then clearNutrientPosition()
  }

  /**
   * Update nutrient animations (rotation, bobbing, core pulsing)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    const now = Date.now();

    this.nutrientMeshes.forEach((group) => {
      const { rotationSpeed, bobPhase, baseX, baseZ } = group.userData;

      // Rotate around Y axis (tumbling effect)
      group.rotation.y += rotationSpeed * dt;
      // Slight wobble on X axis
      group.rotation.x = Math.sin(now * 0.0005 + bobPhase) * 0.3;

      // Gentle bobbing on Y axis (height - floating in digital ocean)
      const bobAmount = Math.sin(now * 0.002 + bobPhase) * 2;
      if (baseX !== undefined && baseZ !== undefined) {
        group.position.set(baseX, bobAmount, baseZ);
      }

      // Pulse the inner core brightness
      const core = group.children.find(c => c.name === 'core') as THREE.Mesh | undefined;
      if (core && core.material instanceof THREE.MeshBasicMaterial) {
        const pulse = 0.7 + Math.sin(now * 0.004 + bobPhase) * 0.3;
        core.material.opacity = pulse;
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
      this.setGroupOpacity(group, opacity);
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
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material) {
          (child.material as THREE.Material).dispose();
        }
      });
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
   * Create a 3D nutrient with icosahedron crystal + inner glow core
   */
  private createNutrient3D(nutrient: NutrientData): THREE.Group {
    const group = new THREE.Group();

    // Determine color based on value multiplier
    let color: number;
    if (nutrient.valueMultiplier >= 5) {
      color = GAME_CONFIG.NUTRIENT_5X_COLOR; // Magenta (5x)
    } else if (nutrient.valueMultiplier >= 3) {
      color = GAME_CONFIG.NUTRIENT_3X_COLOR; // Gold (3x)
    } else if (nutrient.valueMultiplier >= 2) {
      color = GAME_CONFIG.NUTRIENT_2X_COLOR; // Cyan (2x)
    } else {
      color = GAME_CONFIG.NUTRIENT_COLOR; // Green (1x)
    }

    // Outer icosahedron crystal (main shape)
    // Size scales slightly with value: 1x=12, 2x=13, 3x=14, 5x=16
    const sizeMultiplier = 1 + (nutrient.valueMultiplier - 1) * 0.1;
    const crystalSize = GAME_CONFIG.NUTRIENT_SIZE * sizeMultiplier;
    const outerGeometry = new THREE.IcosahedronGeometry(crystalSize, 0);
    const outerMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.85,
      flatShading: true, // Sharp faceted look
    });
    const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
    group.add(outerMesh);

    // Inner glow core (bright point at center)
    const coreGeometry = new THREE.SphereGeometry(crystalSize * 0.35, 8, 8);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.name = 'core';
    group.add(coreMesh);

    // Store animation data
    group.userData = {
      color,
      crystalSize,
      spawnTime: Date.now(),
      rotationSpeed: 0.0008 + Math.random() * 0.0004, // Slight variation per nutrient
      bobPhase: Math.random() * Math.PI * 2, // Random starting phase for bobbing
    };

    return group;
  }

  /**
   * Set opacity for all materials in a group
   */
  private setGroupOpacity(group: THREE.Group, opacity: number): void {
    group.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.Material;
        if ('opacity' in material) {
          (material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial).opacity = opacity;
        }
      }
    });
  }

  /**
   * Dispose all nutrient resources
   */
  dispose(): void {
    this.clearAll();
  }
}
