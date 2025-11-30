// ============================================
// Godcell Renderer (Stage 5)
// Creates a glowing sphere for 3D flight testing
// Simple placeholder for eventual alien-angel procedural model
// ============================================

import * as THREE from 'three';

// Module-level geometry cache for performance
const geometryCache = new Map<string, THREE.BufferGeometry>();

function getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometryCache.has(key)) {
    geometryCache.set(key, factory());
  }
  return geometryCache.get(key)!;
}

/**
 * Create a godcell mesh - simple glowing sphere for Stage 5 skeleton
 * This is a placeholder for the eventual procedural alien-angel model.
 *
 * Structure:
 * - Outer sphere: Large semi-transparent shell (player color)
 * - Inner nucleus: Bright emissive core for bloom effect
 * - Point light: Dynamic lighting around the godcell
 *
 * @param radius - Godcell radius in world units (typically 288 for 28.8x scale)
 * @param colorHex - Base color as hex number (e.g., 0x00ff88)
 * @returns THREE.Group containing the complete godcell mesh
 */
export function createGodcell(radius: number, colorHex: number): THREE.Group {
  const godcellGroup = new THREE.Group();

  // === OUTER SPHERE (Semi-transparent shell) ===
  // Large ethereal shell with god-like glow
  const outerGeometry = getGeometry(`godcell-outer-${radius}`, () =>
    new THREE.SphereGeometry(radius, 64, 64) // High detail for large sphere
  );

  const outerMaterial = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.2,                // Semi-transparent ethereal shell
    roughness: 0.05,             // Very smooth for god-like sheen
    metalness: 0.1,              // Slight metallic for otherworldly look
    clearcoat: 1.0,              // Maximum clearcoat for pristine surface
    clearcoatRoughness: 0.1,     // Smooth clearcoat
    emissive: colorHex,
    emissiveIntensity: 0.3,      // Subtle outer glow (contributes to bloom)
    side: THREE.DoubleSide,      // Visible from inside (for third-person camera)
    depthWrite: false,           // Proper transparency blending
  });

  const outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
  godcellGroup.add(outerSphere);

  // === INNER NUCLEUS (Bright glowing core) ===
  // Concentrated energy at the center - main source of light
  const nucleusRadius = radius * 0.4; // 40% of outer radius
  const nucleusGeometry = getGeometry(`godcell-nucleus-${nucleusRadius}`, () =>
    new THREE.SphereGeometry(nucleusRadius, 32, 32)
  );

  const nucleusMaterial = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 4.0,      // Very bright for bloom (2x single-cell intensity)
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
  godcellGroup.add(nucleus);

  // === POINT LIGHT (Dynamic lighting) ===
  // Illuminates nearby environment for dramatic effect
  const godcellLight = new THREE.PointLight(colorHex, 5, radius * 4);
  godcellLight.name = 'godcellLight';
  godcellGroup.add(godcellLight);

  // Store metadata for updates
  godcellGroup.userData.radius = radius;
  godcellGroup.userData.colorHex = colorHex;
  godcellGroup.name = 'godcell';

  return godcellGroup;
}

/**
 * Update godcell visual state based on energy level
 * Affects nucleus glow intensity and outer shell opacity
 *
 * @param godcellGroup - The godcell group created by createGodcell
 * @param energyRatio - Current energy ratio (0-1)
 */
export function updateGodcellEnergy(godcellGroup: THREE.Group, energyRatio: number): void {
  const ratio = Math.max(0, Math.min(1, energyRatio));

  // Get components (outer, nucleus, light)
  const outerSphere = godcellGroup.children[0] as THREE.Mesh;
  const nucleus = godcellGroup.children[1] as THREE.Mesh;
  const light = godcellGroup.children[2] as THREE.PointLight;

  if (!outerSphere || !nucleus || !light) return;

  const outerMaterial = outerSphere.material as THREE.MeshPhysicalMaterial;
  const nucleusMaterial = nucleus.material as THREE.MeshStandardMaterial;

  // Scale glow based on energy
  // High energy: brilliant glow, Low energy: dim but still visible
  const glowIntensity = 1.0 + ratio * 3.0; // Range: 1.0 to 4.0
  nucleusMaterial.emissiveIntensity = glowIntensity;

  // Outer shell opacity scales with energy
  outerMaterial.opacity = 0.1 + ratio * 0.15; // Range: 0.1 to 0.25
  outerMaterial.emissiveIntensity = 0.1 + ratio * 0.3; // Range: 0.1 to 0.4

  // Light intensity scales with energy
  light.intensity = 2 + ratio * 4; // Range: 2 to 6

  // Pulsing effect at low energy (death warning)
  if (ratio < 0.2) {
    const time = Date.now() * 0.015;
    const pulse = Math.sin(time) * 0.5 + 0.5;
    nucleusMaterial.emissiveIntensity = 0.5 + pulse * 1.5;
    outerMaterial.opacity = 0.05 + pulse * 0.15;
  }
}

/**
 * Animate the godcell (subtle rotation for visual interest)
 * Call this each frame with delta time
 *
 * @param godcellGroup - The godcell group
 * @param delta - Frame delta time in seconds
 */
export function animateGodcell(godcellGroup: THREE.Group, delta: number): void {
  // Slow gentle rotation for visual interest
  // Godcells don't face any particular direction - they're spherical
  godcellGroup.rotation.y += delta * 0.1; // Very slow spin (0.1 rad/sec)
  godcellGroup.rotation.x += delta * 0.05; // Slight wobble
}

/**
 * Dispose godcell resources
 */
export function disposeGodcell(godcellGroup: THREE.Group): void {
  godcellGroup.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Don't dispose cached geometry (will be reused)
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

/**
 * Dispose cached geometries (call on renderer cleanup)
 */
export function disposeGodcellCache(): void {
  geometryCache.forEach((geometry) => geometry.dispose());
  geometryCache.clear();
}
