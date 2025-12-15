// ============================================
// Shared Math Helpers
// Pure math functions for geometry and spatial algorithms
// Used by both client and server
// ============================================

import type { Position } from './index';

// Type for 3D vectors (always has z)
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Calculate distance between two positions (2D, ignores z)
 */
export function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate 3D distance between two positions
 */
export function distance3D(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z ?? 0) - (p2.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ============================================
// Spherical World Math
// Functions for constraining movement to sphere surface
// ============================================

/**
 * Calculate magnitude (length) of a 3D vector
 */
export function magnitude(p: Position): number {
  const z = p.z ?? 0;
  return Math.sqrt(p.x * p.x + p.y * p.y + z * z);
}

/**
 * Normalize a 3D vector to unit length
 * Returns {x: 1, y: 0, z: 0} for zero vector (default direction)
 */
export function normalize(p: Position): Vec3 {
  const z = p.z ?? 0;
  const mag = Math.sqrt(p.x * p.x + p.y * p.y + z * z);
  if (mag === 0) {
    return { x: 1, y: 0, z: 0 }; // Default direction for zero vector
  }
  return { x: p.x / mag, y: p.y / mag, z: z / mag };
}

/**
 * Project a point onto a sphere surface
 * Moves any point to lie exactly on the sphere at given radius
 *
 * @param pos - Point to project (can be inside or outside sphere)
 * @param radius - Sphere radius
 * @returns Position on sphere surface in same direction from origin
 */
export function projectToSphere(pos: Position, radius: number): Vec3 {
  const z = pos.z ?? 0;
  const mag = Math.sqrt(pos.x * pos.x + pos.y * pos.y + z * z);

  // Handle origin edge case - project to default direction (+X)
  if (mag === 0) {
    return { x: radius, y: 0, z: 0 };
  }

  const scale = radius / mag;
  return {
    x: pos.x * scale,
    y: pos.y * scale,
    z: z * scale,
  };
}

/**
 * Remove radial component from velocity, keeping only tangent component
 * This makes velocity tangent to sphere surface at given position
 *
 * @param pos - Position on (or near) sphere surface
 * @param vel - Velocity vector to make tangent
 * @returns Velocity with radial component removed
 */
export function tangentVelocity(pos: Position, vel: Position): Vec3 {
  const pz = pos.z ?? 0;
  const vz = vel.z ?? 0;
  const mag = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pz * pz);

  // Handle origin - can't determine normal, return velocity unchanged
  if (mag === 0) {
    return { x: vel.x, y: vel.y, z: vz };
  }

  // Unit normal (radial direction, pointing outward from center)
  const nx = pos.x / mag;
  const ny = pos.y / mag;
  const nz = pz / mag;

  // Dot product of velocity with normal (radial component magnitude)
  const dot = vel.x * nx + vel.y * ny + vz * nz;

  // Subtract radial component from velocity
  return {
    x: vel.x - dot * nx,
    y: vel.y - dot * ny,
    z: vz - dot * nz,
  };
}

/**
 * Get the surface normal (unit vector pointing outward) at a position
 * Used for mesh orientation - "up" direction on sphere surface
 *
 * @param pos - Position on (or near) sphere surface
 * @returns Unit vector pointing away from sphere center
 */
export function getSurfaceNormal(pos: Position): Vec3 {
  const z = pos.z ?? 0;
  const mag = Math.sqrt(pos.x * pos.x + pos.y * pos.y + z * z);

  // Handle origin - return default direction
  if (mag === 0) {
    return { x: 1, y: 0, z: 0 };
  }

  return {
    x: pos.x / mag,
    y: pos.y / mag,
    z: z / mag,
  };
}

/**
 * Poisson disc sampling for spatial distribution
 * Guarantees minimum separation between points while efficiently filling space
 * Returns array of positions with guaranteed minDist separation
 *
 * @param width - Area width
 * @param height - Area height
 * @param minDist - Minimum distance between any two points
 * @param maxPoints - Maximum number of points to generate
 * @param existingPoints - Points from previous runs to maintain distance from
 * @param avoidanceZones - Circular zones where points cannot be placed
 * @param seedPoint - Optional seed point to start from (instead of random)
 */
export function poissonDiscSampling(
  width: number,
  height: number,
  minDist: number,
  maxPoints: number,
  existingPoints: Position[] = [],
  avoidanceZones: Array<{ position: Position; radius: number }> = [],
  seedPoint?: Position
): Position[] {
  const k = 30; // Candidates to try per active point
  const cellSize = minDist / Math.sqrt(2);
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);

  // Grid for O(1) neighbor lookups
  const grid: (Position | null)[][] = Array(gridWidth)
    .fill(null)
    .map(() => Array(gridHeight).fill(null));

  const points: Position[] = [];
  const active: Position[] = [];

  // Helper: Check if point is valid (far enough from all existing points and avoidance zones)
  const isValid = (point: Position): boolean => {
    // Check bounds
    if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) {
      return false;
    }

    // Check avoidance zones
    for (const zone of avoidanceZones) {
      if (distance(point, zone.position) < zone.radius) {
        return false;
      }
    }

    // Check existing points (from previous runs)
    for (const existing of existingPoints) {
      if (distance(point, existing) < minDist) {
        return false;
      }
    }

    // Check grid neighbors
    const gridX = Math.floor(point.x / cellSize);
    const gridY = Math.floor(point.y / cellSize);

    const searchRadius = 2; // Check 5x5 grid around point
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const nx = gridX + dx;
        const ny = gridY + dy;
        if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
          const neighbor = grid[nx][ny];
          if (neighbor && distance(point, neighbor) < minDist) {
            return false;
          }
        }
      }
    }

    return true;
  };

  // Start with seed point if provided, otherwise random initial point
  let initial: Position | null = null;

  if (seedPoint && isValid(seedPoint)) {
    // Use provided seed point
    initial = seedPoint;
    points.push(initial);
    active.push(initial);
    const gridX = Math.floor(initial.x / cellSize);
    const gridY = Math.floor(initial.y / cellSize);
    grid[gridX][gridY] = initial;
  } else {
    // Fall back to random initial point (retry if invalid)
    let initialAttempts = 0;
    const maxInitialAttempts = 100;

    while (initialAttempts < maxInitialAttempts && !initial) {
      const candidate = {
        x: Math.random() * width,
        y: Math.random() * height,
      };

      if (isValid(candidate)) {
        initial = candidate;
        points.push(initial);
        active.push(initial);
        const gridX = Math.floor(initial.x / cellSize);
        const gridY = Math.floor(initial.y / cellSize);
        grid[gridX][gridY] = initial;
      }

      initialAttempts++;
    }
  }

  // If we can't find a valid initial point, the constraints are too tight
  if (!initial) {
    return points; // Return empty array
  }

  // Generate points
  while (active.length > 0 && points.length < maxPoints) {
    const randomIndex = Math.floor(Math.random() * active.length);
    const point = active[randomIndex];
    let found = false;

    // Try k candidates in annulus around this point
    for (let i = 0; i < k; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = minDist * (1 + Math.random()); // Between minDist and 2*minDist

      const candidate = {
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      };

      if (isValid(candidate)) {
        points.push(candidate);
        active.push(candidate);
        const gridX = Math.floor(candidate.x / cellSize);
        const gridY = Math.floor(candidate.y / cellSize);
        grid[gridX][gridY] = candidate;
        found = true;
        break;
      }
    }

    // Remove from active list if no valid candidates found
    if (!found) {
      active.splice(randomIndex, 1);
    }
  }

  return points;
}
