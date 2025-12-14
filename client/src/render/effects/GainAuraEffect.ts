// ============================================
// Gain Aura Renderer
// Visual feedback for entities gaining energy
// Blue/cyan glow when collecting nutrients or draining enemies
// ============================================

import * as THREE from 'three';

/**
 * Create a gain aura for a cell
 * Blue/cyan glow for nutrients, gold for fruit collection
 *
 * @param cellRadius - Radius of the cell to create aura around
 * @param color - THREE.Color hex value (default 0x00ffff cyan)
 * @returns Group containing glow sphere mesh
 */
export function createGainAura(cellRadius: number, color: number = 0x00ffff): THREE.Group {
  const auraGroup = new THREE.Group();

  const glowRadius = cellRadius * 1.15; // Slightly larger than cell

  // Create outer glow sphere
  const geometry = new THREE.SphereGeometry(glowRadius, 32, 32);
  const material = new THREE.MeshStandardMaterial({
    color: color, // Configurable color
    emissive: color, // Matching glow
    emissiveIntensity: 2.0, // Strong glow
    transparent: true,
    opacity: 0.0, // Starts invisible
    side: THREE.BackSide, // Render inside
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  auraGroup.add(mesh);

  // Store animation data
  auraGroup.userData = {
    triggerTime: 0,
    duration: 500, // 500ms flash duration
    active: false,
    color: color, // Store for color changes
  };

  return auraGroup;
}

/**
 * Trigger a gain aura flash (call when entity gains energy)
 * @param aura - The gain aura group
 * @param intensity - Energy gain intensity (0-1, affects brightness)
 * @param color - Optional color override (hex value like 0xffd700 for gold)
 */
export function triggerGainFlash(aura: THREE.Group, intensity: number = 0.5, color?: number): void {
  aura.userData.triggerTime = Date.now();
  aura.userData.active = true;
  aura.userData.intensity = Math.min(1.0, Math.max(0.2, intensity));

  // Update color if provided
  if (color !== undefined && color !== aura.userData.color) {
    aura.userData.color = color;
    setAuraColor(aura, color);
  }
}

/**
 * Set the color of a gain aura
 */
function setAuraColor(aura: THREE.Group, color: number): void {
  aura.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      mat.color.setHex(color);
      mat.emissive.setHex(color);
    }
  });
}

/**
 * Update gain aura animation (call each frame)
 * @param aura - The gain aura group
 * @returns true if still animating, false if finished
 */
export function updateGainAura(aura: THREE.Group): boolean {
  if (!aura.userData.active) {
    return false;
  }

  const elapsed = Date.now() - aura.userData.triggerTime;
  const duration = aura.userData.duration;
  const intensity = aura.userData.intensity || 0.5;

  if (elapsed >= duration) {
    // Animation finished
    aura.userData.active = false;
    setAuraOpacity(aura, 0);
    return false;
  }

  // Ease-out animation (fast start, slow fade)
  const progress = elapsed / duration;
  const easeOut = 1 - Math.pow(progress, 2);

  // Opacity fades from intensity to 0
  const opacity = easeOut * intensity * 0.6;

  // Emissive pulses
  const emissive = 2.0 + easeOut * intensity * 3.0;

  // Scale pulses outward slightly
  const scale = 1.0 + easeOut * 0.1;

  aura.scale.setScalar(scale);
  setAuraOpacity(aura, opacity);
  setAuraEmissive(aura, emissive);

  return true;
}

function setAuraOpacity(aura: THREE.Group, opacity: number): void {
  aura.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      (child.material as THREE.MeshStandardMaterial).opacity = opacity;
    }
  });
}

function setAuraEmissive(aura: THREE.Group, intensity: number): void {
  aura.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      (child.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
    }
  });
}
