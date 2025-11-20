/**
 * Shared Three.js materials for entities.
 * Reuse materials to avoid recreating them for every entity.
 */

import * as THREE from 'three';

/**
 * Material cache - reuse materials across entities
 */
class MaterialCache {
  private materials = new Map<string, THREE.Material>();

  get(key: string, factory: () => THREE.Material): THREE.Material {
    if (!this.materials.has(key)) {
      this.materials.set(key, factory());
    }
    return this.materials.get(key)!;
  }

  dispose(): void {
    this.materials.forEach((material) => material.dispose());
    this.materials.clear();
  }
}

const cache = new MaterialCache();

/**
 * Get player material (glowing circle with color)
 */
export function getPlayerMaterial(color: string): THREE.MeshBasicMaterial {
  const key = `player-${color}`;
  return cache.get(key, () => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.9,
    });
  }) as THREE.MeshBasicMaterial;
}

/**
 * Get nutrient material (glowing hex color)
 */
export function getNutrientMaterial(color: number): THREE.MeshBasicMaterial {
  const key = `nutrient-${color}`;
  return cache.get(key, () => {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
    });
  }) as THREE.MeshBasicMaterial;
}

/**
 * Get obstacle material (gravity well)
 */
export function getObstacleMaterial(): THREE.MeshBasicMaterial {
  return cache.get('obstacle', () => {
    return new THREE.MeshBasicMaterial({
      color: 0x6600cc, // Purple
      transparent: true,
      opacity: 0.3,
    });
  }) as THREE.MeshBasicMaterial;
}

/**
 * Get obstacle core material (singularity)
 */
export function getObstacleCoreMaterial(): THREE.MeshBasicMaterial {
  return cache.get('obstacle-core', () => {
    return new THREE.MeshBasicMaterial({
      color: 0xff00ff, // Magenta
      transparent: true,
      opacity: 0.8,
    });
  }) as THREE.MeshBasicMaterial;
}

/**
 * Get grid line material
 */
export function getGridMaterial(): THREE.LineBasicMaterial {
  return cache.get('grid', () => {
    return new THREE.LineBasicMaterial({
      color: 0x1a1a3e,
      transparent: true,
      opacity: 0.3,
    });
  }) as THREE.LineBasicMaterial;
}

/**
 * Get trail material
 */
export function getTrailMaterial(color: string): THREE.LineBasicMaterial {
  const key = `trail-${color}`;
  return cache.get(key, () => {
    return new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.5,
    });
  }) as THREE.LineBasicMaterial;
}

/**
 * Dispose all cached materials
 */
export function disposeAllMaterials(): void {
  cache.dispose();
}
