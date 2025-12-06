// ============================================
// Drain Aura Renderer
// Visual feedback for entities taking damage
// Shows variable-intensity auras based on damage rate
// ============================================

import * as THREE from 'three';
import type { DamageSource } from '#shared';

/**
 * Create a dual-sphere shell aura for a single cell
 * Consists of an outer and inner sphere to create a "shell" effect
 *
 * @param cellRadius - Radius of the cell to create aura around
 * @returns Group containing inner and outer sphere meshes
 */
export function createCellAura(cellRadius: number): THREE.Group {
  const auraGroup = new THREE.Group();

  const innerRadius = cellRadius * 1.0;  // Inner edge at cell boundary
  const outerRadius = cellRadius * 1.03;  // Outer edge = 3% beyond boundary (thin shell)

  // Create outer sphere (viewed from inside)
  const outerGeometry = new THREE.SphereGeometry(outerRadius, 32, 32);
  const outerMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,              // Base red color
    emissive: 0xff0000,           // Red glow for bloom effect
    emissiveIntensity: 1.0,       // Base bloom (will be scaled by applyAuraIntensity)
    transparent: true,
    opacity: 0.3,                 // Base visibility (will be animated by applyAuraIntensity)
    side: THREE.BackSide,         // Render inside of outer sphere
    depthWrite: false,
    depthTest: false,
  });

  const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
  auraGroup.add(outerMesh);

  // Create inner sphere to carve out hollow (viewed from outside)
  const innerGeometry = new THREE.SphereGeometry(innerRadius, 32, 32);
  const innerMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 1.0,       // Base bloom (will be scaled by applyAuraIntensity)
    transparent: true,
    opacity: 0.3,                 // Base visibility (will be animated by applyAuraIntensity)
    side: THREE.FrontSide,        // Render outside of inner sphere
    depthWrite: false,
    depthTest: false,
  });

  const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);
  auraGroup.add(innerMesh);

  return auraGroup;
}

/**
 * Calculate aura intensity from damage rate (maps DPS to 0-1 scale)
 * Uses piecewise linear mapping for nuanced visual feedback:
 * - 0-30 dps   → 0.0-0.3 (subtle)
 * - 30-80 dps  → 0.3-0.6 (moderate)
 * - 80-150 dps → 0.6-0.9 (intense)
 * - 150+ dps   → 0.9-1.0 (critical)
 *
 * @param damageRate - Damage per second being dealt
 * @returns Intensity value from 0.0-1.0
 */
export function calculateAuraIntensity(damageRate: number): number {
  // Guard against negative damage rates
  if (damageRate <= 0) {
    return 0;
  }
  if (damageRate <= 30) {
    return (damageRate / 30) * 0.3; // 0.0-0.3
  } else if (damageRate <= 80) {
    return 0.3 + ((damageRate - 30) / 50) * 0.3; // 0.3-0.6
  } else if (damageRate <= 150) {
    return 0.6 + ((damageRate - 80) / 70) * 0.3; // 0.6-0.9
  } else {
    return Math.min(1.0, 0.9 + ((damageRate - 150) / 150) * 0.1); // 0.9-1.0
  }
}

/**
 * Get aura color based on damage source
 * Different damage types use different colors for visual distinction
 *
 * @param source - The type of damage being dealt
 * @returns Hex color value
 */
export function getAuraColor(source: DamageSource): number {
  switch (source) {
    case 'starvation':
      return 0xffaa00; // Orange/yellow for self-inflicted damage
    case 'predation':
    case 'swarm':
    case 'beam':
    case 'gravity':
    default:
      return 0xff0000; // Red for external threats
  }
}

/**
 * Apply intensity-based visuals to drain aura
 * Updates scale, opacity, and emissive glow based on damage intensity
 * Includes pulsing animation and optional hit flash effect
 *
 * @param auraMesh - The aura group to update
 * @param intensity - Damage intensity from 0.0-1.0
 * @param color - Color to apply (from getAuraColor)
 * @param time - Current time in seconds (for animation)
 * @param proximityFactor - Optional 0-1 factor for distance-based fading (used by gravity wells)
 */
export function applyAuraIntensity(
  auraMesh: THREE.Group,
  intensity: number,
  color: number,
  time: number,
  proximityFactor?: number
): void {
  // Gentle pulsing (much slower and subtler)
  const pulseSpeed = 1.0 + intensity * 1.5;  // 1-2.5 cycles/sec (slow even at high intensity)
  const pulseAmount = 0.03 + intensity * 0.05; // ±3-8% scale variation (very subtle)
  const scale = 1.0 + Math.sin(time * pulseSpeed) * pulseAmount;
  auraMesh.scale.set(scale, scale, scale);

  // Opacity scales with intensity
  const baseOpacity = 0.2 + intensity * 0.4; // 0.2-0.6 base (subtle to moderate)
  const flickerAmount = 0.05 + intensity * 0.1; // ±5-15% flicker (reduced)
  let opacity = baseOpacity + Math.sin(time * 3) * flickerAmount; // Slower flicker

  // Emissive (bloom) scales with intensity
  const baseEmissive = 1.0 + intensity * 2.0; // 1.0-3.0 base (moderate range)
  const emissiveFlicker = 0.2 + intensity * 0.4; // ±0.2-0.6 variation (reduced)
  let emissive = baseEmissive + Math.sin(time * 2.5) * emissiveFlicker; // Slower flicker

  // Apply proximity gradient for gravity wells (fades at edges)
  if (proximityFactor !== undefined) {
    opacity *= (0.5 + proximityFactor * 0.5); // Fade out at edges
    emissive *= (0.5 + proximityFactor * 0.5);
  }

  // Check for hit flash (brief intense brightness boost from pseudopod hit)
  if (auraMesh.userData.flashTime) {
    const flashAge = performance.now() - auraMesh.userData.flashTime;
    const flashDuration = 200; // 200ms flash

    if (flashAge < flashDuration) {
      // Add extra brightness during flash (fades out over duration)
      const flashProgress = flashAge / flashDuration; // 0 to 1
      const flashIntensity = 1.0 - flashProgress; // 1 to 0 (fade out)
      emissive += 4.0 * flashIntensity; // Boost by up to 4.0 (makes it very bright)
      opacity = Math.min(1.0, opacity + 0.3 * flashIntensity); // Also boost opacity
    } else {
      // Flash expired, clear it
      delete auraMesh.userData.flashTime;
    }
  }

  // Apply to all spheres (handles both single-cell and multi-cell auras)
  // For multi-cell: auraMesh is a group containing multiple cell aura groups
  // For single-cell: auraMesh is a group containing one cell aura group
  const applyToMeshes = (obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh) {
      const material = obj.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.emissive.setHex(color);
      material.opacity = opacity;
      material.emissiveIntensity = emissive;
    } else if (obj instanceof THREE.Group) {
      // Recursively apply to nested groups
      obj.children.forEach(applyToMeshes);
    }
  };

  applyToMeshes(auraMesh);
}
