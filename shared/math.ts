// ============================================
// Shared Math Helpers
// Pure math functions for geometry and spatial algorithms
// Used by both client and server
// ============================================

import type { Position } from './index';

/**
 * Calculate distance between two positions
 */
export function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
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
  const grid: (Position | null)[][] = Array(gridWidth).fill(null).map(() => Array(gridHeight).fill(null));

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
