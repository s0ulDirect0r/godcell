// ============================================
// Cyber Bug Mesh - Single source of truth for cyber bug visuals
// Small glowing insect-like creatures that flee from players
// Used by: CyberBugRenderSystem (game), model-viewer.ts (preview)
// ============================================

import * as THREE from 'three';

// ============================================
// VISUAL PARAMETERS - Tune these to adjust appearance
// ============================================

/**
 * Body (Elongated ellipsoid - main bug shape)
 * - Flattened and stretched for insect look
 */
const BODY = {
  segments: 8, // Sphere detail level

  // Scale factors to create elongated shape
  scaleX: 1.0,
  scaleY: 0.5, // Flattened
  scaleZ: 1.5, // Elongated

  // Material properties
  opacity: 0.9,
  roughness: 0.3,
  metalness: 0.7, // Chitinous/metallic look

  // Colors
  normalColor: 0x00ff88, // Mint green
  fleeingColor: 0xff8800, // Orange when scared

  // Emissive intensity varies by state
  normalEmissiveIntensity: 0.5,
  fleeingEmissiveIntensity: 0.8,
};

/**
 * Glow Shell (Volumetric glow effect around body)
 */
const GLOW_SHELL = {
  sizeRatio: 1.5, // Multiplied by body size
  opacity: 0.2,
};

/**
 * Eyes (Two small dots at front)
 * - Bright white for visibility
 */
const EYES = {
  sizeRatio: 0.2, // Relative to body size
  segments: 4, // Low detail is fine for tiny spheres
  color: 0xffffff, // Bright white

  // Position offsets (relative to body size)
  xOffset: 0.3,
  yOffset: 0.2,
  zOffset: 0.8, // At front
};

/**
 * Animation Parameters
 */
const ANIMATION = {
  // Bobbing height oscillation
  bobHeight: 2, // Pixels
  bobSpeed: 4, // Oscillations per second
  baseHeight: 5, // Base Y position

  // Wing flutter (fast scale pulse)
  flutterAmount: 0.05, // Scale variation
  flutterSpeed: 20, // Very fast for insect-like movement
};

// ============================================
// PUBLIC TYPES
// ============================================

/**
 * Result from createCyberBug
 */
export interface CyberBugResult {
  group: THREE.Group;
}

// ============================================
// PUBLIC FUNCTIONS
// ============================================

/**
 * Create a cyber bug mesh (small glowing insect)
 *
 * @param size - Bug radius (from CyberBugComponent.size)
 * @param state - Initial state: 'idle' | 'patrol' | 'flee' (from CyberBugComponent.state)
 * @returns CyberBugResult with the mesh group
 */
export function createCyberBug(size: number, state: string): CyberBugResult {
  const group = new THREE.Group();
  group.name = 'cyberBug';
  group.userData.state = state;

  // Determine color based on state
  const isFleeing = state === 'flee';
  const color = isFleeing ? BODY.fleeingColor : BODY.normalColor;
  const intensity = isFleeing ? BODY.fleeingEmissiveIntensity : BODY.normalEmissiveIntensity;

  // === BODY ===
  // Elongated ellipsoid for insect-like shape
  const bodyGeometry = new THREE.SphereGeometry(size, BODY.segments, BODY.segments);
  bodyGeometry.scale(BODY.scaleX, BODY.scaleY, BODY.scaleZ);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    transparent: true,
    opacity: BODY.opacity,
    roughness: BODY.roughness,
    metalness: BODY.metalness,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'body';
  group.add(body);

  // === GLOW SHELL ===
  const glowGeometry = new THREE.SphereGeometry(size * GLOW_SHELL.sizeRatio, BODY.segments, BODY.segments);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: GLOW_SHELL.opacity,
    side: THREE.BackSide,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.name = 'glow';
  group.add(glow);

  // === EYES ===
  // Two bright white dots at front
  const eyeGeometry = new THREE.SphereGeometry(size * EYES.sizeRatio, EYES.segments, EYES.segments);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYES.color });

  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(
    -size * EYES.xOffset,
    size * EYES.yOffset,
    size * EYES.zOffset
  );
  leftEye.name = 'leftEye';
  group.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial.clone());
  rightEye.position.set(
    size * EYES.xOffset,
    size * EYES.yOffset,
    size * EYES.zOffset
  );
  rightEye.name = 'rightEye';
  group.add(rightEye);

  return { group };
}

/**
 * Update cyber bug animation (bobbing, wing flutter)
 *
 * @param group - The bug THREE.Group from createCyberBug
 * @param dt - Delta time in milliseconds
 * @param phase - Phase offset for desynchronized animation
 * @param flutter - Flutter phase offset
 */
export function updateCyberBugAnimation(
  group: THREE.Group,
  _dt: number,
  phase: number = 0,
  flutter: number = 0
): void {
  const time = performance.now() / 1000;

  // Bobbing height
  const bobHeight = Math.sin(time * ANIMATION.bobSpeed + phase) * ANIMATION.bobHeight;
  group.position.y = ANIMATION.baseHeight + bobHeight;

  // Wing flutter effect - fast oscillation for insect-like movement
  const scalePulse = 1 + Math.sin(time * ANIMATION.flutterSpeed + flutter) * ANIMATION.flutterAmount;
  group.scale.setScalar(scalePulse);
}

/**
 * Update bug visual based on state (idle, patrol, flee)
 *
 * @param group - The bug THREE.Group
 * @param state - New state: 'idle' | 'patrol' | 'flee'
 */
export function updateCyberBugState(group: THREE.Group, state: string): void {
  const isFleeing = state === 'flee';
  const color = isFleeing ? BODY.fleeingColor : BODY.normalColor;
  const intensity = isFleeing ? BODY.fleeingEmissiveIntensity : BODY.normalEmissiveIntensity;

  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.material instanceof THREE.MeshPhysicalMaterial) {
        // Body material - update emissive
        child.material.color.set(color);
        child.material.emissive.set(color);
        child.material.emissiveIntensity = intensity;
      } else if (child.material instanceof THREE.MeshBasicMaterial && child.name === 'glow') {
        // Glow shell - update color
        child.material.color.set(color);
      }
    }
  });

  group.userData.state = state;
}

/**
 * Dispose of cyber bug mesh resources
 *
 * @param group - The bug THREE.Group to dispose
 */
export function disposeCyberBug(group: THREE.Group): void {
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
