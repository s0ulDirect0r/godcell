// ============================================
// Data Fruit Mesh - Single source of truth for data fruit visuals
// Glowing digital orbs that grow on trees in the jungle stage
// Used by: DataFruitRenderSystem (game), model-viewer.ts (preview)
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '#shared';

// ============================================
// VISUAL PARAMETERS - Tune these to adjust appearance
// ============================================

/**
 * Core Sphere (Main glowing orb)
 * - The primary fruit shape
 */
const CORE = {
  segments: 16, // Sphere detail level

  // Material properties
  opacity: 0.9,
  roughness: 0.2,
  metalness: 0.5,

  // Emissive intensity varies with ripeness
  // Range: emissiveBase to emissiveBase + emissiveRipenessBonus
  emissiveBase: 0.3,
  emissiveRipenessBonus: 0.7, // Added when fully ripe
};

/**
 * Outer Glow Shell (Volumetric glow effect)
 * - Makes fruit visible from distance
 * - More pronounced when ripe
 */
const GLOW_SHELL = {
  sizeRatio: 1.5, // Multiplied by core radius

  // Opacity varies with ripeness
  opacityBase: 0.2,
  opacityRipenessBonus: 0.3, // Added when fully ripe
};

/**
 * Color Gradient (Ripeness-based coloring)
 * - Unripe: Cyan-green (#00ff88)
 * - Ripe: Gold (#ffcc00)
 */
const RIPENESS_COLORS = {
  // Unripe RGB components
  unripeR: 0,
  unripeG: 255,
  unripeB: 136, // Cyan-green

  // Ripe RGB components
  ripeR: 255,
  ripeG: 204,
  ripeB: 0, // Gold
};

/**
 * Animation Parameters
 */
const ANIMATION = {
  // Pulsing scale effect
  pulseAmount: 0.1, // Scale variation (0.9 to 1.1)
  pulseSpeed: 2.0, // Oscillations per second

  // Rotation
  rotationSpeed: 0.001, // Radians per ms
};

// ============================================
// PUBLIC TYPES
// ============================================

/**
 * Result from createDataFruit
 */
export interface DataFruitResult {
  group: THREE.Group;
}

// ============================================
// PUBLIC FUNCTIONS
// ============================================

/**
 * Create a data fruit mesh (glowing orb)
 *
 * @param ripeness - 0-1 ripeness level (required, varies per fruit)
 *   - 0 = unripe (cyan-green, dim glow)
 *   - 1 = ripe (gold, bright glow)
 * @param radius - Optional override for fruit radius (defaults to GAME_CONFIG)
 *   - Game uses default, model-viewer can override for preview
 * @returns DataFruitResult with the mesh group
 */
export function createDataFruit(ripeness: number, radius?: number): DataFruitResult {
  const group = new THREE.Group();
  group.name = 'dataFruit';
  group.userData.ripeness = ripeness;

  // Use provided radius or default from config
  const fruitRadius = radius ?? GAME_CONFIG.DATAFRUIT_COLLISION_RADIUS;

  // Calculate color based on ripeness
  const color = getRipenessColor(ripeness);

  // === CORE SPHERE ===
  // Main glowing orb body
  const coreGeometry = new THREE.SphereGeometry(fruitRadius, CORE.segments, CORE.segments);
  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: CORE.emissiveBase + ripeness * CORE.emissiveRipenessBonus,
    transparent: true,
    opacity: CORE.opacity,
    roughness: CORE.roughness,
    metalness: CORE.metalness,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.name = 'core';
  group.add(core);

  // === OUTER GLOW SHELL ===
  // Volumetric glow effect using BackSide rendering
  const glowGeometry = new THREE.SphereGeometry(
    fruitRadius * GLOW_SHELL.sizeRatio,
    CORE.segments,
    CORE.segments
  );
  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: GLOW_SHELL.opacityBase + ripeness * GLOW_SHELL.opacityRipenessBonus,
    side: THREE.BackSide,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.name = 'glow';
  group.add(glow);

  return { group };
}

/**
 * Update data fruit animation (pulsing, rotation)
 *
 * @param group - The fruit THREE.Group from createDataFruit
 * @param dt - Delta time in milliseconds
 * @param phase - Optional phase offset for desynchronized animation
 */
export function updateDataFruitAnimation(group: THREE.Group, dt: number, phase: number = 0): void {
  const time = performance.now() / 1000;

  // Gentle pulsing scale
  const pulse = 1 + Math.sin(time * ANIMATION.pulseSpeed + phase) * ANIMATION.pulseAmount;
  group.scale.setScalar(pulse);

  // Slow rotation for visual interest
  group.rotation.y += dt * ANIMATION.rotationSpeed;
}

/**
 * Update fruit visual based on ripeness (0-1)
 * Call when ripeness changes to update colors/glow
 *
 * @param group - The fruit THREE.Group
 * @param ripeness - New ripeness value (0-1)
 */
export function updateDataFruitRipeness(group: THREE.Group, ripeness: number): void {
  const color = getRipenessColor(ripeness);

  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      const material = child.material as THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial;
      material.color.set(color);

      if ('emissive' in material) {
        (material as THREE.MeshPhysicalMaterial).emissive.set(color);
        (material as THREE.MeshPhysicalMaterial).emissiveIntensity =
          CORE.emissiveBase + ripeness * CORE.emissiveRipenessBonus;
      }

      // Update glow shell opacity
      if (material instanceof THREE.MeshBasicMaterial && child.name === 'glow') {
        material.opacity = GLOW_SHELL.opacityBase + ripeness * GLOW_SHELL.opacityRipenessBonus;
      }
    }
  });

  group.userData.ripeness = ripeness;
}

/**
 * Dispose of data fruit mesh resources
 *
 * @param group - The fruit THREE.Group to dispose
 */
export function disposeDataFruit(group: THREE.Group): void {
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
 * Get color based on ripeness
 * Interpolates from cyan-green (unripe) to gold (ripe)
 *
 * @param ripeness - 0-1 ripeness value
 * @returns THREE.js color number
 */
export function getRipenessColor(ripeness: number): number {
  const r = Math.floor(
    RIPENESS_COLORS.unripeR + ripeness * (RIPENESS_COLORS.ripeR - RIPENESS_COLORS.unripeR)
  );
  const g = Math.floor(
    RIPENESS_COLORS.unripeG + ripeness * (RIPENESS_COLORS.ripeG - RIPENESS_COLORS.unripeG)
  );
  const b = Math.floor(
    RIPENESS_COLORS.unripeB + ripeness * (RIPENESS_COLORS.ripeB - RIPENESS_COLORS.unripeB)
  );
  return (r << 16) | (g << 8) | b;
}
