// ============================================
// Jungle Creature Mesh - Single source of truth for jungle creature visuals
// Three variants: grazer (passive), stalker (aggressive), ambusher (sneaky)
// Used by: JungleCreatureRenderSystem (game), model-viewer.ts (preview)
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '#shared';

// ============================================
// VISUAL PARAMETERS - Tune these to adjust appearance
// ============================================

/**
 * Variant Color Schemes
 * - Grazer: Green tones (passive herbivore)
 * - Stalker: Red tones (aggressive hunter)
 * - Ambusher: Purple tones (sneaky predator)
 */
const VARIANT_COLORS = {
  grazer: { primary: 0x44aa44, secondary: 0x88ff88 },
  stalker: { primary: 0xaa4444, secondary: 0xff8888 },
  ambusher: { primary: 0x8844aa, secondary: 0xcc88ff },
};

/**
 * Grazer Variant (Rounded, friendly shape)
 */
const GRAZER = {
  // Body (large rounded sphere)
  bodySegments: 16,
  bodyScaleX: 1.2, // Wider
  bodyScaleY: 0.8, // Shorter
  bodyScaleZ: 1.0,
  bodyRoughness: 0.6,
  bodyMetalness: 0.2,
  emissiveIntensity: 0.2,

  // Head (smaller sphere at front)
  headSizeRatio: 0.4, // Relative to body size
  headYOffset: 0.3,
  headZOffset: 0.8,

  // Glow shell
  glowSizeRatio: 1.3,
  glowOpacity: 0.15,
};

/**
 * Stalker Variant (Angular, predatory shape)
 */
const STALKER = {
  // Body (cone shape)
  bodyRadiusRatio: 0.8, // Cone radius relative to size
  bodyLengthRatio: 2, // Cone length relative to size
  bodySegments: 6, // Hexagonal cross-section
  bodyRoughness: 0.4,
  bodyMetalness: 0.5,
  emissiveIntensity: 0.3,

  // Spikes on back
  spikeCount: 3,
  spikeRadiusRatio: 0.15,
  spikeHeightRatio: 0.5,
  spikeSegments: 4,
  spikeYOffset: 0.3,
  spikeZStart: -0.5,
  spikeZSpacing: 0.5,

  // Eyes (bright red for predatory look)
  eyeSizeRatio: 0.1,
  eyeColor: 0xff0000,
  eyeXOffset: 0.25,
  eyeYOffset: 0.1,
  eyeZOffset: 0.9,
};

/**
 * Ambusher Variant (Low, wide, spider-like)
 */
const AMBUSHER = {
  // Body (flattened sphere)
  bodySegments: 16,
  bodyScaleX: 1.5, // Very wide
  bodyScaleY: 0.4, // Very flat
  bodyScaleZ: 1.5,
  bodyRoughness: 0.7,
  bodyMetalness: 0.3,
  emissiveIntensity: 0.2,

  // Legs (simplified as spheres at edges)
  legSizeRatio: 0.15,
  legYOffset: -0.2,
  legPositions: [
    { x: 1, z: 0.7 },
    { x: -1, z: 0.7 },
    { x: 1.2, z: 0 },
    { x: -1.2, z: 0 },
    { x: 1, z: -0.7 },
    { x: -1, z: -0.7 },
  ],
  legEmissiveIntensity: 0.3,

  // Eyes (multiple small glowing dots - purple)
  eyeSizeRatio: 0.08,
  eyeColor: 0xcc00ff,
  eyeCount: 5, // -2 to +2
  eyeXSpacing: 0.15,
  eyeYOffset: 0.15,
  eyeZOffset: 0.7,
};

/**
 * Animation Parameters
 */
const ANIMATION = {
  // Breathing scale rates per variant
  breathRate: {
    grazer: 1.5,
    stalker: 2.0,
    ambusher: 1.0,
  },
  breathAmount: 0.03, // Scale variation

  // Head bob for movement feel
  bobSpeed: 3,
  bobAmount: {
    grazer: 2,
    stalker: 1,
    ambusher: 1,
  },
  baseHeight: 20, // Y position
};

/**
 * State-Based Emissive Intensities
 */
const STATE_EMISSIVE = {
  normal: 0.2,
  hunting: 0.6,
};

// ============================================
// PUBLIC TYPES
// ============================================

export type CreatureVariant = 'grazer' | 'stalker' | 'ambusher';

/**
 * Result from createJungleCreature
 */
export interface JungleCreatureResult {
  group: THREE.Group;
}

// ============================================
// PUBLIC FUNCTIONS
// ============================================

/**
 * Create a jungle creature mesh
 *
 * @param variant - Creature type: 'grazer' | 'stalker' | 'ambusher'
 * @param size - Optional override for creature size (defaults to GAME_CONFIG)
 * @returns JungleCreatureResult with the mesh group
 */
export function createJungleCreature(
  variant: CreatureVariant | string,
  size?: number
): JungleCreatureResult {
  const group = new THREE.Group();
  group.name = 'jungleCreature';
  group.userData.variant = variant;

  const creatureSize = size ?? GAME_CONFIG.JUNGLE_CREATURE_COLLISION_RADIUS;
  const colors = VARIANT_COLORS[variant as keyof typeof VARIANT_COLORS] || VARIANT_COLORS.grazer;

  if (variant === 'grazer') {
    createGrazerMesh(group, colors, creatureSize);
  } else if (variant === 'stalker') {
    createStalkerMesh(group, colors, creatureSize);
  } else if (variant === 'ambusher') {
    createAmbusherMesh(group, colors, creatureSize);
  } else {
    // Unknown variant: default to grazer (matches color fallback)
    createGrazerMesh(group, colors, creatureSize);
  }

  return { group };
}

/**
 * Update creature animation (breathing, bobbing)
 *
 * @param group - The creature THREE.Group from createJungleCreature
 * @param dt - Delta time in milliseconds (unused but kept for consistency)
 * @param phase - Phase offset for desynchronized animation
 */
export function updateJungleCreatureAnimation(
  group: THREE.Group,
  _dt: number,
  phase: number = 0
): void {
  const time = performance.now() / 1000;
  const variant = (group.userData.variant as CreatureVariant) || 'grazer';

  // Breathing scale
  const breathRate =
    ANIMATION.breathRate[variant as keyof typeof ANIMATION.breathRate] ||
    ANIMATION.breathRate.grazer;
  const breathScale = 1 + Math.sin(time * breathRate + phase) * ANIMATION.breathAmount;
  group.scale.setScalar(breathScale);

  // Head bob for movement feel
  const bobAmount =
    ANIMATION.bobAmount[variant as keyof typeof ANIMATION.bobAmount] || ANIMATION.bobAmount.grazer;
  group.position.y = ANIMATION.baseHeight + Math.sin(time * ANIMATION.bobSpeed + phase) * bobAmount;
}

/**
 * Update creature visual based on state (idle, patrol, hunt)
 *
 * @param group - The creature THREE.Group
 * @param state - New state: 'idle' | 'patrol' | 'hunt'
 */
export function updateJungleCreatureState(group: THREE.Group, state: string): void {
  const isHunting = state === 'hunt';
  const intensity = isHunting ? STATE_EMISSIVE.hunting : STATE_EMISSIVE.normal;

  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial) {
      child.material.emissiveIntensity = intensity;
    }
  });

  group.userData.state = state;
}

/**
 * Dispose of jungle creature mesh resources
 *
 * @param group - The creature THREE.Group to dispose
 */
export function disposeJungleCreature(group: THREE.Group): void {
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

// ============================================
// PRIVATE HELPERS - Variant-specific mesh creation
// ============================================

/**
 * Create grazer mesh (rounded, friendly shape)
 */
function createGrazerMesh(
  group: THREE.Group,
  colors: { primary: number; secondary: number },
  size: number
): void {
  // Body: Large rounded sphere
  const bodyGeometry = new THREE.SphereGeometry(size, GRAZER.bodySegments, GRAZER.bodySegments);
  bodyGeometry.scale(GRAZER.bodyScaleX, GRAZER.bodyScaleY, GRAZER.bodyScaleZ);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.primary,
    emissive: colors.secondary,
    emissiveIntensity: GRAZER.emissiveIntensity,
    roughness: GRAZER.bodyRoughness,
    metalness: GRAZER.bodyMetalness,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'body';
  group.add(body);

  // Head: Smaller sphere at front (shares body material)
  const headGeometry = new THREE.SphereGeometry(
    size * GRAZER.headSizeRatio,
    GRAZER.bodySegments - 4,
    GRAZER.bodySegments - 4
  );
  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, size * GRAZER.headYOffset, size * GRAZER.headZOffset);
  head.name = 'head';
  group.add(head);

  // Glow effect
  const glowGeometry = new THREE.SphereGeometry(
    size * GRAZER.glowSizeRatio,
    GRAZER.bodySegments - 4,
    GRAZER.bodySegments - 4
  );
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: colors.secondary,
    transparent: true,
    opacity: GRAZER.glowOpacity,
    side: THREE.BackSide,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.name = 'glow';
  group.add(glow);
}

/**
 * Create stalker mesh (angular, predatory shape)
 */
function createStalkerMesh(
  group: THREE.Group,
  colors: { primary: number; secondary: number },
  size: number
): void {
  // Body: Angular, sleek cone shape
  const bodyGeometry = new THREE.ConeGeometry(
    size * STALKER.bodyRadiusRatio,
    size * STALKER.bodyLengthRatio,
    STALKER.bodySegments
  );
  bodyGeometry.rotateX(Math.PI / 2); // Point forward
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.primary,
    emissive: colors.secondary,
    emissiveIntensity: STALKER.emissiveIntensity,
    roughness: STALKER.bodyRoughness,
    metalness: STALKER.bodyMetalness,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'body';
  group.add(body);

  // Spikes/fins on back (share body material)
  for (let i = 0; i < STALKER.spikeCount; i++) {
    const spikeGeometry = new THREE.ConeGeometry(
      size * STALKER.spikeRadiusRatio,
      size * STALKER.spikeHeightRatio,
      STALKER.spikeSegments
    );
    const spike = new THREE.Mesh(spikeGeometry, bodyMaterial);
    spike.position.set(
      0,
      size * STALKER.spikeYOffset,
      size * STALKER.spikeZStart + i * size * STALKER.spikeZSpacing
    );
    spike.name = `spike_${i}`;
    group.add(spike);
  }

  // Glowing eyes - bright red for predatory look
  const eyeGeometry = new THREE.SphereGeometry(size * STALKER.eyeSizeRatio, 6, 6);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: STALKER.eyeColor });

  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(
    -size * STALKER.eyeXOffset,
    size * STALKER.eyeYOffset,
    size * STALKER.eyeZOffset
  );
  leftEye.name = 'leftEye';
  group.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(
    size * STALKER.eyeXOffset,
    size * STALKER.eyeYOffset,
    size * STALKER.eyeZOffset
  );
  rightEye.name = 'rightEye';
  group.add(rightEye);
}

/**
 * Create ambusher mesh (low, wide, spider-like)
 */
function createAmbusherMesh(
  group: THREE.Group,
  colors: { primary: number; secondary: number },
  size: number
): void {
  // Body: Low, wide, spider-like
  const bodyGeometry = new THREE.SphereGeometry(size, AMBUSHER.bodySegments, AMBUSHER.bodySegments);
  bodyGeometry.scale(AMBUSHER.bodyScaleX, AMBUSHER.bodyScaleY, AMBUSHER.bodyScaleZ);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.primary,
    emissive: colors.secondary,
    emissiveIntensity: AMBUSHER.emissiveIntensity,
    roughness: AMBUSHER.bodyRoughness,
    metalness: AMBUSHER.bodyMetalness,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'body';
  group.add(body);

  // Multiple "legs" (simplified as spheres at edges)
  const legGeometry = new THREE.SphereGeometry(size * AMBUSHER.legSizeRatio, 6, 6);
  const legMaterial = new THREE.MeshPhysicalMaterial({
    color: colors.primary,
    emissive: colors.secondary,
    emissiveIntensity: AMBUSHER.legEmissiveIntensity,
  });

  AMBUSHER.legPositions.forEach((pos, i) => {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(pos.x * size, size * AMBUSHER.legYOffset, pos.z * size);
    leg.name = `leg_${i}`;
    group.add(leg);
  });

  // Eyes: Multiple small glowing dots - bright purple
  const eyeGeometry = new THREE.SphereGeometry(size * AMBUSHER.eyeSizeRatio, 4, 4);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: AMBUSHER.eyeColor });

  for (let i = -Math.floor(AMBUSHER.eyeCount / 2); i <= Math.floor(AMBUSHER.eyeCount / 2); i++) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(
      i * size * AMBUSHER.eyeXSpacing,
      size * AMBUSHER.eyeYOffset,
      size * AMBUSHER.eyeZOffset
    );
    eye.name = `eye_${i + Math.floor(AMBUSHER.eyeCount / 2)}`;
    group.add(eye);
  }
}
