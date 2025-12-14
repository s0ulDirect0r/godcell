// ============================================
// Nutrient Mesh - Single source of truth for nutrient visuals
// 3D Icosahedron crystal with inner glow core
// Used by: NutrientRenderSystem (game), model-viewer.ts (preview)
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '#shared';

// ============================================
// VISUAL PARAMETERS - Tune these to adjust appearance
// ============================================

/**
 * Outer Crystal (Icosahedron shell)
 * - The main visible shape - a faceted icosahedron
 * - flatShading gives it a crystalline, low-poly look
 */
const OUTER_CRYSTAL = {
  // Detail level: 0 = sharp 20-face icosahedron, higher = more spherical
  detail: 0,

  // Emissive glow intensity - how much the crystal glows
  // Range: 0.5 (subtle) to 2.0 (very bright)
  emissiveIntensity: 1.2,

  // Transparency - lets inner core show through
  // Range: 0.0 (invisible) to 1.0 (opaque)
  opacity: 0.85,
};

/**
 * Inner Core (Glowing sphere at center)
 * - Creates the "energy inside" effect
 * - Pulses in animation for liveliness
 */
const INNER_CORE = {
  // Size relative to crystal size
  // Range: 0.2 (small dot) to 0.6 (fills crystal)
  sizeRatio: 0.35,

  // Sphere segments (8 is plenty for small core)
  segments: 8,

  // Core color - white gives neutral glow that works with any crystal color
  color: 0xffffff,

  // Base opacity before pulsing
  // Range: 0.5 (subtle) to 1.0 (solid)
  opacity: 0.9,

  // Pulse animation: how much opacity varies
  // Final opacity = pulseBase + sin(time) * pulseAmplitude
  pulseBase: 0.7,
  pulseAmplitude: 0.3,
  pulseSpeed: 0.004, // Higher = faster pulse
};

/**
 * Size Scaling based on value multiplier
 * - Higher value nutrients are slightly larger
 * - Makes them visually distinct and more desirable
 */
const SIZE_SCALING = {
  // Multiplier formula: 1 + (valueMultiplier - 1) * scaleFactor
  // e.g., 5x nutrient: 1 + (5 - 1) * 0.1 = 1.4x size
  scaleFactor: 0.1,
};

/**
 * Animation Parameters
 * - Nutrients tumble and bob to feel alive
 * - Each nutrient gets random variation for organic feel
 */
const ANIMATION = {
  // Y-axis rotation (tumbling)
  // Base rotation speed (radians per ms) + random variation
  rotationSpeedBase: 0.0008,
  rotationSpeedVariation: 0.0004,

  // X-axis wobble (tilting back and forth)
  wobbleAmount: 0.3, // radians
  wobbleSpeed: 0.0005, // Higher = faster wobble

  // Y-axis bobbing (floating up and down)
  bobAmount: 2, // pixels
  bobSpeed: 0.002, // Higher = faster bob
};

// ============================================
// PUBLIC TYPES
// ============================================

/**
 * Result from createNutrient
 * Contains the mesh group and animation update function
 */
export interface NutrientResult {
  group: THREE.Group;
}

// ============================================
// PUBLIC FUNCTIONS
// ============================================

/**
 * Create a 3D nutrient mesh (icosahedron crystal with inner glow)
 *
 * @param valueMultiplier - Nutrient value multiplier (1, 2, 3, or 5)
 *   - 1x = Green (standard)
 *   - 2x = Cyan (uncommon)
 *   - 3x = Gold (rare)
 *   - 5x = Magenta (legendary, near obstacles)
 * @returns NutrientResult with the mesh group
 */
export function createNutrient(valueMultiplier: number = 1): NutrientResult {
  const group = new THREE.Group();

  // Determine color based on value multiplier
  const color = getNutrientColor(valueMultiplier);

  // Size scales with value: 1x=base, 2x=1.1x, 3x=1.2x, 5x=1.4x
  const sizeMultiplier = 1 + (valueMultiplier - 1) * SIZE_SCALING.scaleFactor;
  const crystalSize = GAME_CONFIG.NUTRIENT_SIZE * sizeMultiplier;

  // === OUTER ICOSAHEDRON CRYSTAL ===
  // Sharp faceted look like a data crystal
  const outerGeometry = new THREE.IcosahedronGeometry(crystalSize, OUTER_CRYSTAL.detail);
  const outerMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: OUTER_CRYSTAL.emissiveIntensity,
    transparent: true,
    opacity: OUTER_CRYSTAL.opacity,
    flatShading: true, // Sharp faceted look
    depthWrite: false, // Allow inner core to show through when viewed from any angle
  });
  const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
  group.add(outerMesh);

  // === INNER GLOW CORE ===
  // Bright center point that pulses
  const coreGeometry = new THREE.SphereGeometry(
    crystalSize * INNER_CORE.sizeRatio,
    INNER_CORE.segments,
    INNER_CORE.segments
  );
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: INNER_CORE.color,
    transparent: true,
    opacity: INNER_CORE.opacity,
  });
  const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
  coreMesh.name = 'core'; // Used by animation system to find core
  group.add(coreMesh);

  // Store animation data in userData
  group.userData = {
    color,
    crystalSize,
    valueMultiplier,
    spawnTime: Date.now(),
    // Random variation per nutrient for organic feel
    rotationSpeed: ANIMATION.rotationSpeedBase + Math.random() * ANIMATION.rotationSpeedVariation,
    bobPhase: Math.random() * Math.PI * 2, // Random starting phase
  };

  return { group };
}

/**
 * Update nutrient animation (rotation, bobbing, core pulsing)
 * Call this every frame for each nutrient mesh
 *
 * @param group - The nutrient THREE.Group from createNutrient
 * @param dt - Delta time in milliseconds
 * @param baseX - Base X position (for bobbing offset)
 * @param baseZ - Base Z position (for bobbing offset)
 */
export function updateNutrientAnimation(
  group: THREE.Group,
  dt: number,
  baseX?: number,
  baseZ?: number
): void {
  const now = Date.now();
  const { rotationSpeed, bobPhase } = group.userData;

  // Tumble rotation around Y axis
  group.rotation.y += rotationSpeed * dt;

  // Slight wobble on X axis
  group.rotation.x = Math.sin(now * ANIMATION.wobbleSpeed + bobPhase) * ANIMATION.wobbleAmount;

  // Gentle bobbing on Y axis (floating effect)
  if (baseX !== undefined && baseZ !== undefined) {
    const bobAmount = Math.sin(now * ANIMATION.bobSpeed + bobPhase) * ANIMATION.bobAmount;
    group.position.set(baseX, bobAmount, baseZ);
  }

  // Pulse the inner core brightness
  const core = group.children.find((c) => c.name === 'core') as THREE.Mesh | undefined;
  if (core && core.material instanceof THREE.MeshBasicMaterial) {
    const pulse =
      INNER_CORE.pulseBase +
      Math.sin(now * INNER_CORE.pulseSpeed + bobPhase) * INNER_CORE.pulseAmplitude;
    core.material.opacity = pulse;
  }
}

/**
 * Dispose of nutrient mesh resources
 * Call when removing a nutrient from the scene
 *
 * @param group - The nutrient THREE.Group to dispose
 */
export function disposeNutrient(group: THREE.Group): void {
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
 * Get color for a nutrient based on its value multiplier
 * Exported for use by other systems that need nutrient colors
 */
export function getNutrientColor(valueMultiplier: number): number {
  if (valueMultiplier >= 5) {
    return GAME_CONFIG.NUTRIENT_5X_COLOR; // Magenta (legendary)
  } else if (valueMultiplier >= 3) {
    return GAME_CONFIG.NUTRIENT_3X_COLOR; // Gold (rare)
  } else if (valueMultiplier >= 2) {
    return GAME_CONFIG.NUTRIENT_2X_COLOR; // Cyan (uncommon)
  } else {
    return GAME_CONFIG.NUTRIENT_COLOR; // Green (standard)
  }
}

/**
 * Set opacity for all materials in a nutrient group
 * Used for spawn animations
 */
export function setNutrientOpacity(group: THREE.Group, opacity: number): void {
  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      const material = child.material as THREE.Material;
      if ('opacity' in material) {
        (material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial).opacity = opacity;
      }
    }
  });
}
