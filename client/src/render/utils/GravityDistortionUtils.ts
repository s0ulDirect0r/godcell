// ============================================
// GravityDistortionUtils - Spacetime distortion effects around gravity wells
// Provides calculations for grid warping and entity stretching
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  type PositionComponent,
  type ObstacleComponent,
} from '../../ecs';

/**
 * Cached gravity well data for spatial queries
 * Wells don't move, so we cache positions and radii at init/sync time
 */
export interface GravityWellCache {
  x: number;        // Game X position
  y: number;        // Game Y position
  radius: number;   // Gravity influence radius
  strength: number; // Gravity strength multiplier
}

/**
 * Distortion result for a point in space
 */
export interface DistortionResult {
  // Displacement vector (how much to move the point toward wells)
  dx: number;
  dy: number;
  // Total distortion intensity (0-1, for effects like stretching)
  intensity: number;
  // Direction toward strongest well (for entity stretching)
  directionX: number;
  directionY: number;
}

/**
 * Entity warp transform data
 * Used to stretch/skew entities toward gravity wells
 */
export interface EntityWarpTransform {
  // Scale factors (stretch toward gravity)
  scaleX: number;
  scaleY: number;
  // Skew angle (radians) - rotation toward gravity center
  skewAngle: number;
  // Overall warp intensity (0-1)
  intensity: number;
}

// ============================================
// Configuration
// ============================================

// *** MASTER INTENSITY CONTROL ***
// Scale all distortion effects with one value
// 0.0 = no effect, 1.0 = full effect, >1.0 = exaggerated
const DISTORTION_INTENSITY = 0.7;

// Base values (what you get at DISTORTION_INTENSITY = 1.0)
// These define the "full" effect - intensity scales them proportionally
const BASE_GRID_MAX_DISPLACEMENT = 120;  // Max pixels grid bends toward wells
const BASE_INNER_ZONE_BOOST = 2.0;       // Extra multiplier inside event horizon (1.0 = no boost)
const BASE_ENTITY_MAX_STRETCH = 1.8;     // Max stretch toward gravity (1.0 = no stretch)
const BASE_ENTITY_MIN_SQUASH = 0.48;     // Min squash perpendicular (1.0 = no squash)
const BASE_ROTATION_INTENSITY = 0.48;    // How much entities lean toward gravity
const BASE_EFFECT_RADIUS = 1.24;         // Effect radius as multiplier of physics radius

// Derived values (scaled by DISTORTION_INTENSITY)
// Linear values scale directly
const GRID_MAX_DISPLACEMENT = BASE_GRID_MAX_DISPLACEMENT * DISTORTION_INTENSITY;
const ROTATION_INTENSITY = BASE_ROTATION_INTENSITY * DISTORTION_INTENSITY;

// "Above 1.0" values: scale the excess, then add back to 1.0
// e.g., stretch of 1.8 at intensity 0.5 → 1 + (0.8 * 0.5) = 1.4
const INNER_ZONE_BOOST = 1 + (BASE_INNER_ZONE_BOOST - 1) * DISTORTION_INTENSITY;
const ENTITY_MAX_STRETCH = 1 + (BASE_ENTITY_MAX_STRETCH - 1) * DISTORTION_INTENSITY;
const EFFECT_RADIUS_MULTIPLIER = 1 + (BASE_EFFECT_RADIUS - 1) * DISTORTION_INTENSITY;

// "Below 1.0" values: scale the deficit, then subtract from 1.0
// e.g., squash of 0.48 at intensity 0.5 → 1 - (0.52 * 0.5) = 0.74
const ENTITY_MIN_SQUASH = 1 - (1 - BASE_ENTITY_MIN_SQUASH) * DISTORTION_INTENSITY;

// Falloff exponents (shape of the curve, not intensity - don't scale these)
const GRID_FALLOFF_EXPONENT = 2.5;
const ENTITY_WARP_FALLOFF_EXPONENT = 2.5;

// Event horizon threshold (structural, not intensity-related)
const INNER_ZONE_THRESHOLD = 0.3;

// ============================================
// Gravity Well Cache Management
// ============================================

// Cached gravity well data (updated when wells sync)
let gravityWellCache: GravityWellCache[] = [];

/**
 * Update the gravity well cache from ECS World
 * Call this when obstacles are synced (they don't move, so infrequent updates are fine)
 */
export function updateGravityWellCache(world: World): void {
  gravityWellCache = [];

  world.forEachWithTag(Tags.Obstacle, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const obstacle = world.getComponent<ObstacleComponent>(entity, Components.Obstacle);

    if (pos && obstacle) {
      gravityWellCache.push({
        x: pos.x,
        y: pos.y,
        radius: obstacle.radius * EFFECT_RADIUS_MULTIPLIER,
        strength: obstacle.strength,
      });
    }
  });
}

/**
 * Get current gravity well cache (read-only)
 * Used by grid system to iterate wells for distortion
 */
export function getGravityWellCache(): readonly GravityWellCache[] {
  return gravityWellCache;
}

/**
 * Clear gravity well cache
 * Call when transitioning to jungle mode (no obstacles there)
 */
export function clearGravityWellCache(): void {
  gravityWellCache = [];
}

// ============================================
// Distortion Calculations
// ============================================

/**
 * Calculate distortion at a point in game space
 * Accumulates pull from all nearby gravity wells
 *
 * @param gameX - Game X coordinate
 * @param gameY - Game Y coordinate
 * @returns DistortionResult with displacement and intensity
 */
export function calculateDistortion(gameX: number, gameY: number): DistortionResult {
  let totalDx = 0;
  let totalDy = 0;
  let totalIntensity = 0;
  let strongestIntensity = 0;
  let strongestDirX = 0;
  let strongestDirY = 0;

  for (const well of gravityWellCache) {
    const dx = well.x - gameX;
    const dy = well.y - gameY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Skip if outside influence radius
    if (distance >= well.radius || distance < 0.001) continue;

    // Normalize direction toward well
    const dirX = dx / distance;
    const dirY = dy / distance;

    // Calculate intensity with exponential falloff (stronger near center)
    // t=0 at edge, t=1 at center
    const t = 1 - (distance / well.radius);
    let intensity = Math.pow(t, GRID_FALLOFF_EXPONENT) * well.strength;

    // INNER ZONE BOOST: dramatically increase effect inside event horizon
    // This makes the effect REALLY ramp up as you approach the spark
    if (t > (1 - INNER_ZONE_THRESHOLD)) {
      // Inside the inner zone - apply exponential boost
      const innerT = (t - (1 - INNER_ZONE_THRESHOLD)) / INNER_ZONE_THRESHOLD; // 0 at threshold, 1 at center
      intensity *= 1 + (INNER_ZONE_BOOST - 1) * innerT * innerT; // Quadratic ramp-up of boost
    }

    // Accumulate displacement toward this well
    const displacement = intensity * GRID_MAX_DISPLACEMENT;
    totalDx += dirX * displacement;
    totalDy += dirY * displacement;
    totalIntensity += intensity;

    // Track strongest influence for entity warp direction
    if (intensity > strongestIntensity) {
      strongestIntensity = intensity;
      strongestDirX = dirX;
      strongestDirY = dirY;
    }
  }

  // Clamp total intensity to 0-1 range
  totalIntensity = Math.min(totalIntensity, 1.0);

  return {
    dx: totalDx,
    dy: totalDy,
    intensity: totalIntensity,
    directionX: strongestDirX,
    directionY: strongestDirY,
  };
}

/**
 * Calculate entity warp transform at a position
 * Returns scale/skew values to stretch entity toward gravity wells
 *
 * @param gameX - Entity game X coordinate
 * @param gameY - Entity game Y coordinate
 * @returns EntityWarpTransform for applying to mesh
 */
export function calculateEntityWarp(gameX: number, gameY: number): EntityWarpTransform {
  let maxIntensity = 0;
  let warpDirX = 0;
  let warpDirY = 0;

  for (const well of gravityWellCache) {
    const dx = well.x - gameX;
    const dy = well.y - gameY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Skip if outside influence radius
    if (distance >= well.radius || distance < 0.001) continue;

    // Calculate intensity with falloff
    const t = 1 - (distance / well.radius);
    let intensity = Math.pow(t, ENTITY_WARP_FALLOFF_EXPONENT) * well.strength;

    // INNER ZONE BOOST: dramatically increase effect inside event horizon
    // Entities get EXTREMELY stretched as they approach the spark
    if (t > (1 - INNER_ZONE_THRESHOLD)) {
      const innerT = (t - (1 - INNER_ZONE_THRESHOLD)) / INNER_ZONE_THRESHOLD;
      intensity *= 1 + (INNER_ZONE_BOOST - 1) * innerT * innerT;
    }

    // Use strongest well for warp direction
    if (intensity > maxIntensity) {
      maxIntensity = intensity;
      warpDirX = dx / distance;
      warpDirY = dy / distance;
    }
  }

  // Clamp intensity (allow slightly over 1 for extreme effect near center)
  maxIntensity = Math.min(maxIntensity, 1.5);

  if (maxIntensity < 0.01) {
    // No significant warp - return identity transform
    return {
      scaleX: 1,
      scaleY: 1,
      skewAngle: 0,
      intensity: 0,
    };
  }

  // Calculate stretch/squash based on intensity
  // Stretch in direction of gravity, squash perpendicular
  const stretchAmount = 1 + (ENTITY_MAX_STRETCH - 1) * maxIntensity;
  const squashAmount = 1 - (1 - ENTITY_MIN_SQUASH) * maxIntensity;

  // Calculate angle toward gravity well
  const skewAngle = Math.atan2(warpDirY, warpDirX);

  return {
    scaleX: stretchAmount,
    scaleY: squashAmount,
    skewAngle,
    intensity: maxIntensity,
  };
}

/**
 * Apply entity warp transform to a Three.js Object3D
 * Stretches the object toward the nearest gravity well
 *
 * @param object - Three.js object to warp
 * @param warp - Warp transform from calculateEntityWarp
 */
export function applyEntityWarp(object: THREE.Object3D, warp: EntityWarpTransform): void {
  if (warp.intensity < 0.01) {
    // Reset to no warp
    object.scale.set(1, 1, 1);
    object.rotation.z = object.userData.baseRotationZ ?? 0;
    return;
  }

  // Store base rotation if not already stored
  if (object.userData.baseRotationZ === undefined) {
    object.userData.baseRotationZ = object.rotation.z;
  }

  // The warp effect:
  // 1. Rotate to align stretch axis with gravity direction
  // 2. Apply non-uniform scale (stretch toward gravity, squash perpendicular)
  // 3. We work in XZ plane (Y is up), so stretch is along X, squash along Z

  // For 2D top-down view on XZ plane:
  // - Game X maps to Three.js X
  // - Game Y maps to Three.js -Z
  // - skewAngle is in game coordinates (atan2 of game dy, game dx)

  // Convert game angle to Three.js rotation around Y axis
  // Game angle 0 = +X direction, which in Three.js XZ plane is also +X
  // But Three.js rotation.y rotates around Y axis (vertical)
  // Actually, for XZ plane sprites/meshes, we often use rotation.z

  // For a mesh lying in XZ plane (rotated -90 on X to face up):
  // We want to stretch along the direction toward gravity
  // This means scaling along a rotated axis

  // Apply scale directly with rotation hint
  // This creates a "leaning toward gravity" effect

  // Apply non-uniform scale
  object.scale.set(
    warp.scaleX,  // Stretch along X (will be rotated)
    1,            // Y (height) unchanged
    warp.scaleY   // Squash along Z (perpendicular)
  );

  // Apply rotation to align stretch with gravity direction
  // Add skew rotation on top of base rotation
  const baseRotZ = object.userData.baseRotationZ ?? 0;
  object.rotation.z = baseRotZ + warp.skewAngle * warp.intensity * ROTATION_INTENSITY; // Lean toward gravity
}

/**
 * Reset entity warp on an object
 * Call when entity leaves gravity influence or is removed
 */
export function resetEntityWarp(object: THREE.Object3D): void {
  object.scale.set(1, 1, 1);
  if (object.userData.baseRotationZ !== undefined) {
    object.rotation.z = object.userData.baseRotationZ;
    delete object.userData.baseRotationZ;
  }
}

// ============================================
// Grid Distortion Helpers
// ============================================

/**
 * Create a subdivided line geometry for grid distortion
 * Returns both the geometry and the original positions array for updates
 *
 * @param startX - Line start X (Three.js coordinates)
 * @param startZ - Line start Z (Three.js coordinates)
 * @param endX - Line end X
 * @param endZ - Line end Z
 * @param segments - Number of segments (more = smoother curves)
 * @param height - Y position (height above ground)
 * @returns Object with geometry and original positions
 */
export function createSubdividedLine(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  segments: number,
  height: number
): { geometry: THREE.BufferGeometry; originalPositions: Float32Array } {
  const positions = new Float32Array((segments + 1) * 3);
  const originalPositions = new Float32Array((segments + 1) * 3);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = startX + (endX - startX) * t;
    const z = startZ + (endZ - startZ) * t;

    positions[i * 3] = x;
    positions[i * 3 + 1] = height;
    positions[i * 3 + 2] = z;

    // Store original positions for distortion calculation
    originalPositions[i * 3] = x;
    originalPositions[i * 3 + 1] = height;
    originalPositions[i * 3 + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return { geometry, originalPositions };
}

/**
 * Update grid line vertices with distortion toward gravity wells
 * Modifies the geometry's position attribute in place
 *
 * @param geometry - Line geometry to update
 * @param originalPositions - Original undistorted positions
 */
export function updateGridLineDistortion(
  geometry: THREE.BufferGeometry,
  originalPositions: Float32Array
): void {
  const positions = geometry.attributes.position.array as Float32Array;
  const count = originalPositions.length / 3;

  for (let i = 0; i < count; i++) {
    const origX = originalPositions[i * 3];
    const origZ = originalPositions[i * 3 + 2];

    // Convert Three.js coords to game coords for distortion calculation
    // Three.js X = game X, Three.js Z = -game Y
    const gameX = origX;
    const gameY = -origZ;

    const distortion = calculateDistortion(gameX, gameY);

    // Apply distortion (convert back to Three.js coords)
    // dx is game X displacement, dy is game Y displacement
    // In Three.js: X stays X, Y displacement becomes -Z displacement
    positions[i * 3] = origX + distortion.dx;
    positions[i * 3 + 2] = origZ - distortion.dy; // Note: -dy because Z = -gameY
  }

  geometry.attributes.position.needsUpdate = true;
}
