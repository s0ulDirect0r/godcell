// ============================================
// Data Tree Mesh - Digital Jungle Tree Geometry
// Simple placeholder geometry: glowing cylinder + sphere
// Stage 3+ environment obstacle
// ============================================

import * as THREE from 'three';

/**
 * Configuration for tree appearance
 * All values tunable for visual iteration
 */
const CONFIG = {
  // Trunk properties
  TRUNK_SEGMENTS: 8,           // Cylinder segments (low for stylized look)
  TRUNK_HEIGHT_RATIO: 0.6,     // Height proportion used for trunk
  TRUNK_TAPER: 0.7,            // Top radius ratio (0 = cone, 1 = cylinder)

  // Canopy properties
  CANOPY_RADIUS_RATIO: 1.8,    // Canopy radius relative to trunk radius
  CANOPY_SEGMENTS: 12,         // Icosahedron detail level

  // Colors and materials
  TRUNK_BASE_COLOR: 0x2a2a4a,  // Dark blue-gray base
  TRUNK_GLOW_COLOR: 0x00ffff,  // Cyan glow (matching jungle grid)
  CANOPY_GLOW_COLOR: 0x00ff88, // Green-cyan glow

  // Glow intensity (emissive strength)
  TRUNK_GLOW_INTENSITY: 1.5,   // Subtle trunk glow
  CANOPY_GLOW_INTENSITY: 3.0,  // Brighter canopy glow

  // Animation parameters
  GLOW_PULSE_SPEED: 0.5,       // Pulse frequency (Hz)
  GLOW_PULSE_RANGE: 0.3,       // Intensity variation (±30%)
  SWAY_AMPLITUDE: 0.02,        // Subtle sway amount
  SWAY_SPEED: 0.3,             // Sway frequency (Hz)
};

/**
 * Create a data tree mesh
 * Simple stylized geometry: glowing cylinder trunk + sphere canopy
 *
 * @param radius - Trunk collision radius (determines overall size)
 * @param height - Visual height of the tree
 * @param variant - Random seed (0-1) for variation in color/animation
 * @returns THREE.Group containing the tree mesh
 */
export function createDataTree(radius: number, height: number, variant: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'dataTree';

  // Store parameters for animation updates
  group.userData.radius = radius;
  group.userData.height = height;
  group.userData.variant = variant;
  group.userData.phase = variant * Math.PI * 2; // Phase offset for animation

  // Calculate dimensions
  const trunkHeight = height * CONFIG.TRUNK_HEIGHT_RATIO;
  const trunkRadiusTop = radius * CONFIG.TRUNK_TAPER;
  const trunkRadiusBottom = radius;
  const canopyRadius = radius * CONFIG.CANOPY_RADIUS_RATIO;

  // Vary colors slightly based on variant for visual interest
  const hueShift = (variant - 0.5) * 0.1; // ±5% hue variation
  const trunkGlowColor = shiftHue(CONFIG.TRUNK_GLOW_COLOR, hueShift);
  const canopyGlowColor = shiftHue(CONFIG.CANOPY_GLOW_COLOR, hueShift);

  // === TRUNK ===
  // Cylinder with slight taper, standing vertically (Y-up in world space)
  // In our game, Z is up (toward camera), so we'll rotate after creation
  const trunkGeo = new THREE.CylinderGeometry(
    trunkRadiusTop,
    trunkRadiusBottom,
    trunkHeight,
    CONFIG.TRUNK_SEGMENTS
  );

  const trunkMat = new THREE.MeshStandardMaterial({
    color: CONFIG.TRUNK_BASE_COLOR,
    emissive: trunkGlowColor,
    emissiveIntensity: CONFIG.TRUNK_GLOW_INTENSITY,
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });

  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  // Position trunk base at origin (trunk center is at half height)
  trunk.position.y = trunkHeight / 2;
  trunk.name = 'trunk';
  group.add(trunk);

  // === CANOPY ===
  // Icosahedron for a low-poly stylized look
  const canopyGeo = new THREE.IcosahedronGeometry(canopyRadius, CONFIG.CANOPY_SEGMENTS);

  const canopyMat = new THREE.MeshStandardMaterial({
    color: canopyGlowColor,
    emissive: canopyGlowColor,
    emissiveIntensity: CONFIG.CANOPY_GLOW_INTENSITY,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85, // Slightly translucent for ethereal effect
    side: THREE.DoubleSide,
  });

  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  // Position canopy on top of trunk
  canopy.position.y = trunkHeight + canopyRadius * 0.7; // Slightly overlap trunk
  canopy.name = 'canopy';
  group.add(canopy);

  // Add point light inside canopy for glow effect
  const canopyLight = new THREE.PointLight(canopyGlowColor, 2, radius * 4);
  canopyLight.position.y = trunkHeight + canopyRadius * 0.5;
  canopyLight.name = 'canopyLight';
  group.add(canopyLight);

  // Rotate entire group so Y-up becomes Z-up (for top-down view)
  // In our game: +Z is up (toward camera), +X is right, +Y is forward
  group.rotation.x = -Math.PI / 2;

  return group;
}

/**
 * Update tree animation (glow pulse and subtle sway)
 *
 * @param group - The tree group to animate
 * @param dt - Delta time in milliseconds
 */
export function updateDataTreeAnimation(group: THREE.Group, _dt: number): void {
  const phase = group.userData.phase || 0;
  const time = performance.now() / 1000;

  // Calculate glow pulse (sinusoidal intensity variation)
  const pulsePhase = time * CONFIG.GLOW_PULSE_SPEED * Math.PI * 2 + phase;
  const pulseFactor = 1 + Math.sin(pulsePhase) * CONFIG.GLOW_PULSE_RANGE;

  // Update trunk glow
  const trunk = group.getObjectByName('trunk') as THREE.Mesh;
  if (trunk) {
    const trunkMat = trunk.material as THREE.MeshStandardMaterial;
    trunkMat.emissiveIntensity = CONFIG.TRUNK_GLOW_INTENSITY * pulseFactor;
  }

  // Update canopy glow
  const canopy = group.getObjectByName('canopy') as THREE.Mesh;
  if (canopy) {
    const canopyMat = canopy.material as THREE.MeshStandardMaterial;
    canopyMat.emissiveIntensity = CONFIG.CANOPY_GLOW_INTENSITY * pulseFactor;
  }

  // Update point light intensity
  const light = group.getObjectByName('canopyLight') as THREE.PointLight;
  if (light) {
    light.intensity = 2 * pulseFactor;
  }

  // Subtle sway animation (only for canopy)
  if (canopy) {
    const swayPhase = time * CONFIG.SWAY_SPEED * Math.PI * 2 + phase;
    // Since we rotated the group, local Z is now world Y (height axis)
    // Sway in local X (world X after rotation)
    canopy.position.x = Math.sin(swayPhase) * CONFIG.SWAY_AMPLITUDE * (group.userData.radius || 50);
  }
}

/**
 * Dispose tree mesh and materials
 */
export function disposeDataTree(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) {
        obj.material.dispose();
      }
    }
  });
}

/**
 * Shift hue of a hex color
 * Simple approximation for color variation
 */
function shiftHue(color: number, amount: number): number {
  // Convert to HSL, shift hue, convert back
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  // Simple RGB to HSL
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  let h = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    if (max === r / 255) h = ((g / 255 - b / 255) / d) % 6;
    else if (max === g / 255) h = (b / 255 - r / 255) / d + 2;
    else h = (r / 255 - g / 255) / d + 4;
    h /= 6;
  }

  // Shift hue
  h = (h + amount + 1) % 1;

  // HSL to RGB
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const newR = Math.round(hue2rgb(h + 1 / 3) * 255);
  const newG = Math.round(hue2rgb(h) * 255);
  const newB = Math.round(hue2rgb(h - 1 / 3) * 255);

  return (newR << 16) | (newG << 8) | newB;
}
