// ============================================
// Data Tree Mesh - Digital Jungle Tree Geometry
// Procedural data-trees with fiber-optic bark and crystalline canopy
// Stage 3+ environment obstacle
// ============================================

import * as THREE from 'three';

/**
 * Configuration for tree appearance
 * All values tunable for visual iteration
 *
 * Visual vocabulary (from design doc):
 * - Fiber-optic bark: glowing vertical energy lines on trunk
 * - Crystalline canopy: layered, translucent data-foliage
 * - Energy roots: glowing tendrils at base
 */
const CONFIG = {
  // Trunk properties
  TRUNK_SEGMENTS: 12,          // Cylinder segments (enough for fiber lines)
  TRUNK_HEIGHT_RATIO: 0.55,    // Height proportion used for trunk (shorter for taller canopy)
  TRUNK_TAPER: 0.6,            // Top radius ratio (more tapered for organic feel)

  // Fiber-optic bark (vertical glowing lines on trunk)
  FIBER_LINE_COUNT: 6,         // Number of glowing vertical lines
  FIBER_LINE_WIDTH: 0.08,      // Width as ratio of trunk radius
  FIBER_LINE_COLOR: 0x00ffff,  // Cyan fiber glow
  FIBER_LINE_INTENSITY: 0.8,   // Fiber emissive strength

  // Canopy properties - now multi-layered crystalline structure
  CANOPY_LAYERS: 3,            // Number of canopy layers (inner, mid, outer)
  CANOPY_RADIUS_RATIO: 2.0,    // Outer canopy radius relative to trunk radius
  CANOPY_LAYER_SCALE: [0.5, 0.75, 1.0],  // Scale of each layer (inner to outer)
  CANOPY_LAYER_OPACITY: [0.9, 0.6, 0.3], // Opacity of each layer
  CANOPY_SEGMENTS: 2,          // Icosahedron detail (lower = more crystalline)

  // Colors and materials
  TRUNK_BASE_COLOR: 0x1a1a2e,  // Darker blue-black base (more contrast for fibers)
  TRUNK_GLOW_COLOR: 0x00ffff,  // Cyan glow (matching jungle grid)
  CANOPY_CORE_COLOR: 0x00ff88, // Green-cyan inner glow
  CANOPY_OUTER_COLOR: 0x00ffaa, // Slightly different outer tint

  // Glow intensity (emissive strength)
  TRUNK_GLOW_INTENSITY: 0.1,   // Very subtle trunk base glow
  CANOPY_GLOW_INTENSITY: 0.4,  // Brighter canopy glow

  // Energy roots at base
  ROOT_COUNT: 4,               // Number of root tendrils
  ROOT_LENGTH_RATIO: 0.6,      // Root length as ratio of trunk radius
  ROOT_COLOR: 0x00ffff,        // Cyan root glow
  ROOT_INTENSITY: 0.5,         // Root emissive strength

  // Animation parameters
  GLOW_PULSE_SPEED: 0.4,       // Pulse frequency (Hz) - slightly slower for majesty
  GLOW_PULSE_RANGE: 0.25,      // Intensity variation (±25%)
  FIBER_PULSE_OFFSET: 0.3,     // Phase offset between fiber lines
  SWAY_AMPLITUDE: 0.015,       // Subtle sway amount
  SWAY_SPEED: 0.25,            // Sway frequency (Hz)
};

/**
 * Create a data tree mesh
 * Procedural data-tree with fiber-optic bark and crystalline canopy
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
  group.userData.fiberMeshes = []; // Store fiber line meshes for animation

  // Calculate dimensions
  const trunkHeight = height * CONFIG.TRUNK_HEIGHT_RATIO;
  const trunkRadiusTop = radius * CONFIG.TRUNK_TAPER;
  const trunkRadiusBottom = radius;
  const canopyRadius = radius * CONFIG.CANOPY_RADIUS_RATIO;

  // Vary colors slightly based on variant for visual interest
  const hueShift = (variant - 0.5) * 0.1; // ±5% hue variation
  const trunkGlowColor = shiftHue(CONFIG.TRUNK_GLOW_COLOR, hueShift);
  const canopyCoreColor = shiftHue(CONFIG.CANOPY_CORE_COLOR, hueShift);
  const canopyOuterColor = shiftHue(CONFIG.CANOPY_OUTER_COLOR, hueShift);
  const fiberColor = shiftHue(CONFIG.FIBER_LINE_COLOR, hueShift);
  const rootColor = shiftHue(CONFIG.ROOT_COLOR, hueShift);

  // === TRUNK (dark base) ===
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
    roughness: 0.7,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });

  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = trunkHeight / 2;
  trunk.name = 'trunk';
  group.add(trunk);

  // === FIBER-OPTIC BARK (vertical glowing lines) ===
  const fiberLines: THREE.Mesh[] = [];
  for (let i = 0; i < CONFIG.FIBER_LINE_COUNT; i++) {
    // Angle around trunk (evenly spaced with slight random offset)
    const baseAngle = (i / CONFIG.FIBER_LINE_COUNT) * Math.PI * 2;
    const angleOffset = (variant - 0.5) * 0.3; // Slight per-tree variation
    const angle = baseAngle + angleOffset;

    // Fiber line is a thin box stretched along trunk height
    const fiberWidth = radius * CONFIG.FIBER_LINE_WIDTH;
    const fiberDepth = fiberWidth * 0.3; // Thin depth for line effect
    const fiberGeo = new THREE.BoxGeometry(fiberWidth, trunkHeight * 0.95, fiberDepth);

    const fiberMat = new THREE.MeshStandardMaterial({
      color: fiberColor,
      emissive: fiberColor,
      emissiveIntensity: CONFIG.FIBER_LINE_INTENSITY,
      roughness: 0.2,
      metalness: 0.5,
      transparent: true,
      opacity: 0.9,
    });

    const fiber = new THREE.Mesh(fiberGeo, fiberMat);

    // Position on trunk surface (interpolate radius for taper)
    const avgRadius = (trunkRadiusBottom + trunkRadiusTop) / 2;
    fiber.position.x = Math.cos(angle) * avgRadius * 0.95;
    fiber.position.z = Math.sin(angle) * avgRadius * 0.95;
    fiber.position.y = trunkHeight / 2;

    // Rotate to face outward from trunk center
    fiber.rotation.y = -angle;

    fiber.name = `fiber_${i}`;
    fiber.userData.fiberIndex = i;
    group.add(fiber);
    fiberLines.push(fiber);
  }
  group.userData.fiberMeshes = fiberLines;

  // === CRYSTALLINE CANOPY (multi-layered) ===
  const canopyLayers: THREE.Mesh[] = [];
  for (let layer = 0; layer < CONFIG.CANOPY_LAYERS; layer++) {
    const layerScale = CONFIG.CANOPY_LAYER_SCALE[layer];
    const layerOpacity = CONFIG.CANOPY_LAYER_OPACITY[layer];
    const layerRadius = canopyRadius * layerScale;

    // Use different segment counts for variety
    const segments = CONFIG.CANOPY_SEGMENTS + (layer === 0 ? 1 : 0);
    const canopyGeo = new THREE.IcosahedronGeometry(layerRadius, segments);

    // Blend color from core to outer
    const layerColor = layer === 0 ? canopyCoreColor : canopyOuterColor;

    const canopyMat = new THREE.MeshStandardMaterial({
      color: layerColor,
      emissive: layerColor,
      emissiveIntensity: CONFIG.CANOPY_GLOW_INTENSITY * (1 - layer * 0.2),
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: layerOpacity,
      side: layer === CONFIG.CANOPY_LAYERS - 1 ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: layer === 0, // Only inner layer writes depth
    });

    const canopy = new THREE.Mesh(canopyGeo, canopyMat);

    // Slight rotation variation per layer for crystalline effect
    canopy.rotation.x = layer * 0.2 + variant * 0.5;
    canopy.rotation.y = layer * 0.3 + variant * 0.7;
    canopy.rotation.z = layer * 0.1;

    // Position canopy on top of trunk
    canopy.position.y = trunkHeight + canopyRadius * 0.6;
    canopy.name = `canopy_${layer}`;
    group.add(canopy);
    canopyLayers.push(canopy);
  }
  group.userData.canopyLayers = canopyLayers;

  // === ENERGY ROOTS (glowing tendrils at base) ===
  for (let i = 0; i < CONFIG.ROOT_COUNT; i++) {
    // Angle around base (offset from fiber lines for visual interest)
    const angle = ((i + 0.5) / CONFIG.ROOT_COUNT) * Math.PI * 2 + variant * 0.5;
    const rootLength = radius * CONFIG.ROOT_LENGTH_RATIO;

    // Root is a tapered cylinder lying on ground, pointing outward
    const rootGeo = new THREE.CylinderGeometry(
      radius * 0.02, // Thin tip
      radius * 0.08, // Thicker at trunk
      rootLength,
      6
    );

    const rootMat = new THREE.MeshStandardMaterial({
      color: rootColor,
      emissive: rootColor,
      emissiveIntensity: CONFIG.ROOT_INTENSITY,
      roughness: 0.3,
      metalness: 0.4,
      transparent: true,
      opacity: 0.7,
    });

    const root = new THREE.Mesh(rootGeo, rootMat);

    // Position at base of trunk, pointing outward
    // Cylinder is Y-aligned by default, rotate to lie flat and point outward
    root.rotation.z = Math.PI / 2; // Rotate to horizontal
    root.rotation.y = angle; // Point outward

    // Position: start at trunk base, extend outward
    root.position.x = Math.cos(angle) * (trunkRadiusBottom * 0.8 + rootLength / 2);
    root.position.z = Math.sin(angle) * (trunkRadiusBottom * 0.8 + rootLength / 2);
    root.position.y = 0; // Ground level

    root.name = `root_${i}`;
    group.add(root);
  }

  // Trees stand upright with Y-axis as vertical (no rotation needed)
  // Trunk extends along +Y, canopy on top

  return group;
}

/**
 * Update tree animation (glow pulse, fiber wave, and subtle sway)
 *
 * @param group - The tree group to animate
 * @param dt - Delta time in milliseconds
 */
export function updateDataTreeAnimation(group: THREE.Group, _dt: number): void {
  const phase = group.userData.phase || 0;
  const time = performance.now() / 1000;

  // Calculate base glow pulse (sinusoidal intensity variation)
  const pulsePhase = time * CONFIG.GLOW_PULSE_SPEED * Math.PI * 2 + phase;
  const pulseFactor = 1 + Math.sin(pulsePhase) * CONFIG.GLOW_PULSE_RANGE;

  // Update trunk glow
  const trunk = group.getObjectByName('trunk') as THREE.Mesh;
  if (trunk) {
    const trunkMat = trunk.material as THREE.MeshStandardMaterial;
    trunkMat.emissiveIntensity = CONFIG.TRUNK_GLOW_INTENSITY * pulseFactor;
  }

  // === FIBER LINE ANIMATION (wave effect up the trunk) ===
  const fiberMeshes = group.userData.fiberMeshes as THREE.Mesh[] | undefined;
  if (fiberMeshes) {
    for (let i = 0; i < fiberMeshes.length; i++) {
      const fiber = fiberMeshes[i];
      const fiberMat = fiber.material as THREE.MeshStandardMaterial;

      // Each fiber pulses with offset for traveling wave effect
      const fiberPhase = pulsePhase + i * CONFIG.FIBER_PULSE_OFFSET;
      const fiberPulse = 1 + Math.sin(fiberPhase) * 0.4; // ±40% intensity variation

      fiberMat.emissiveIntensity = CONFIG.FIBER_LINE_INTENSITY * fiberPulse;
    }
  }

  // === CANOPY LAYER ANIMATION (each layer pulses and rotates slightly) ===
  const canopyLayers = group.userData.canopyLayers as THREE.Mesh[] | undefined;
  if (canopyLayers) {
    for (let i = 0; i < canopyLayers.length; i++) {
      const canopy = canopyLayers[i];
      const canopyMat = canopy.material as THREE.MeshStandardMaterial;

      // Each layer has offset pulse for depth effect
      const layerPhase = pulsePhase + i * 0.5;
      const layerPulse = 1 + Math.sin(layerPhase) * CONFIG.GLOW_PULSE_RANGE;

      canopyMat.emissiveIntensity = CONFIG.CANOPY_GLOW_INTENSITY * (1 - i * 0.2) * layerPulse;

      // Slow rotation for crystalline shimmer (outer layers rotate faster)
      canopy.rotation.y += 0.0003 * (i + 1);
    }
  }

  // === SWAY ANIMATION (canopy moves gently) ===
  if (canopyLayers && canopyLayers.length > 0) {
    const swayPhase = time * CONFIG.SWAY_SPEED * Math.PI * 2 + phase;
    const swayAmount = Math.sin(swayPhase) * CONFIG.SWAY_AMPLITUDE * (group.userData.radius || 50);

    // All canopy layers sway together
    for (const canopy of canopyLayers) {
      canopy.position.x = swayAmount;
    }
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
