// ============================================
// Sphere Math Utilities
// Shared functions for spherical world physics
// Used by: server MovementSystem, client rendering
// ============================================

import { GAME_CONFIG } from './constants';

/**
 * 3D Vector type for sphere calculations
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Project a position to the sphere surface
 * Returns a new position on the sphere with the same direction from center
 */
export function projectToSphere(pos: Vec3, radius: number = GAME_CONFIG.SPHERE_RADIUS): Vec3 {
  const mag = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  if (mag === 0) {
    // Edge case: at center, project to +X
    return { x: radius, y: 0, z: 0 };
  }
  const scale = radius / mag;
  return {
    x: pos.x * scale,
    y: pos.y * scale,
    z: pos.z * scale,
  };
}

/**
 * Get the surface normal at a position (unit vector pointing outward)
 */
export function getSurfaceNormal(pos: Vec3): Vec3 {
  const mag = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  if (mag === 0) {
    return { x: 1, y: 0, z: 0 };
  }
  return {
    x: pos.x / mag,
    y: pos.y / mag,
    z: pos.z / mag,
  };
}

/**
 * Remove radial component from velocity, keeping only tangent component
 * This ensures velocity stays on the sphere surface
 */
export function makeTangent(pos: Vec3, vel: Vec3): Vec3 {
  const normal = getSurfaceNormal(pos);

  // Dot product of velocity with normal
  const dot = vel.x * normal.x + vel.y * normal.y + vel.z * normal.z;

  // Subtract the radial component
  return {
    x: vel.x - normal.x * dot,
    y: vel.y - normal.y * dot,
    z: vel.z - normal.z * dot,
  };
}

/**
 * Get normalized tangent direction from one point toward another on sphere surface.
 * Projects the 3D direction onto the tangent plane at 'from' position.
 * Used for gravity direction calculations in sphere mode.
 */
export function tangentToward(from: Vec3, to: Vec3): Vec3 {
  // Direction in 3D space
  const dir = {
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  };

  // Project onto tangent plane at 'from'
  const normal = getSurfaceNormal(from);
  const dot = dir.x * normal.x + dir.y * normal.y + dir.z * normal.z;

  const tangent = {
    x: dir.x - dot * normal.x,
    y: dir.y - dot * normal.y,
    z: dir.z - dot * normal.z,
  };

  // Normalize
  const len = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y + tangent.z * tangent.z);
  if (len < 0.0001) return { x: 0, y: 0, z: 0 };

  return { x: tangent.x / len, y: tangent.y / len, z: tangent.z / len };
}

/**
 * Transform 2D input direction to 3D world direction tangent to sphere
 *
 * @param inputX - Left/right input (-1 to 1)
 * @param inputY - Forward/back input (-1 to 1)
 * @param pos - Current position on sphere
 * @param cameraUp - Camera's "up" direction (defines what "forward" means)
 * @returns World direction vector tangent to sphere
 */
export function inputToWorldDirection(
  inputX: number,
  inputY: number,
  pos: Vec3,
  cameraUp: Vec3
): Vec3 {
  const normal = getSurfaceNormal(pos);

  // "Forward" is camera's up direction projected onto tangent plane
  // First, project cameraUp onto tangent plane
  const upDotNormal = cameraUp.x * normal.x + cameraUp.y * normal.y + cameraUp.z * normal.z;
  let forwardX = cameraUp.x - normal.x * upDotNormal;
  let forwardY = cameraUp.y - normal.y * upDotNormal;
  let forwardZ = cameraUp.z - normal.z * upDotNormal;

  // Normalize forward
  const forwardMag = Math.sqrt(forwardX * forwardX + forwardY * forwardY + forwardZ * forwardZ);
  if (forwardMag > 0.0001) {
    forwardX /= forwardMag;
    forwardY /= forwardMag;
    forwardZ /= forwardMag;
  } else {
    // Edge case: camera up is parallel to normal (at poles)
    forwardX = 0;
    forwardY = 0;
    forwardZ = 1;
  }

  // "Right" is cross product of forward and normal
  // right = forward × normal
  const rightX = forwardY * normal.z - forwardZ * normal.y;
  const rightY = forwardZ * normal.x - forwardX * normal.z;
  const rightZ = forwardX * normal.y - forwardY * normal.x;

  // Combine input with directions
  return {
    x: rightX * inputX + forwardX * inputY,
    y: rightY * inputX + forwardY * inputY,
    z: rightZ * inputX + forwardZ * inputY,
  };
}

/**
 * Calculate a stable "camera up" direction for a position on the sphere
 * This keeps the camera oriented consistently (toward north pole)
 *
 * @param pos - Position on sphere
 * @returns Camera up direction (tangent to sphere, pointing toward north)
 */
export function getCameraUp(pos: Vec3): Vec3 {
  const normal = getSurfaceNormal(pos);

  // World up is +Y (north pole direction)
  const worldUpX = 0;
  const worldUpY = 1;
  const worldUpZ = 0;

  // Calculate "right" as worldUp × normal
  let rightX = worldUpY * normal.z - worldUpZ * normal.y;
  let rightY = worldUpZ * normal.x - worldUpX * normal.z;
  let rightZ = worldUpX * normal.y - worldUpY * normal.x;

  const rightMag = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);

  if (rightMag > 0.0001) {
    rightX /= rightMag;
    rightY /= rightMag;
    rightZ /= rightMag;

    // Camera up is normal × right (tangent to sphere, pointing toward north)
    return {
      x: normal.y * rightZ - normal.z * rightY,
      y: normal.z * rightX - normal.x * rightZ,
      z: normal.x * rightY - normal.y * rightX,
    };
  } else {
    // At poles, use fallback
    return { x: 0, y: 0, z: -1 };
  }
}

/**
 * Get initial spawn position on sphere surface
 * Spawns at a random point on the sphere
 */
export function getRandomSpherePosition(radius: number = GAME_CONFIG.SPHERE_RADIUS): Vec3 {
  // Use spherical coordinates for uniform distribution
  const theta = Math.random() * Math.PI * 2; // Longitude: 0 to 2π
  const phi = Math.acos(2 * Math.random() - 1); // Latitude: 0 to π (uniform on sphere)

  return {
    x: radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

/**
 * Calculate distance along sphere surface (great circle distance)
 */
export function sphereDistance(
  pos1: Vec3,
  pos2: Vec3,
  radius: number = GAME_CONFIG.SPHERE_RADIUS
): number {
  // Normalize positions to unit sphere
  const n1 = getSurfaceNormal(pos1);
  const n2 = getSurfaceNormal(pos2);

  // Dot product gives cos(angle)
  const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;

  // Clamp to avoid floating point issues with acos
  const clampedDot = Math.max(-1, Math.min(1, dot));

  // Arc length = radius * angle
  return radius * Math.acos(clampedDot);
}

/**
 * Check if sphere mode is enabled
 */
export function isSphereMode(): boolean {
  return GAME_CONFIG.SPHERE_MODE;
}
