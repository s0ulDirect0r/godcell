// ============================================
// Physics Helpers
// Pure math functions for geometry and spatial algorithms
// ============================================

import type { Position } from '@godcell/shared';

/**
 * Calculate distance between two positions
 */
export function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a line segment (ray) intersects a circle
 * Returns the distance along the ray to the intersection, or null if no intersection
 */
export function rayCircleIntersection(
  rayStart: Position,
  rayEnd: Position,
  circleCenter: Position,
  circleRadius: number
): number | null {
  // Ray direction vector
  const dx = rayEnd.x - rayStart.x;
  const dy = rayEnd.y - rayStart.y;
  const rayLength = Math.sqrt(dx * dx + dy * dy);

  if (rayLength < 0.001) return null; // Degenerate ray

  // Normalized ray direction
  const dirX = dx / rayLength;
  const dirY = dy / rayLength;

  // Vector from ray start to circle center
  const toCircleX = circleCenter.x - rayStart.x;
  const toCircleY = circleCenter.y - rayStart.y;

  // Project circle center onto ray
  const projection = toCircleX * dirX + toCircleY * dirY;

  // Find closest point on ray to circle center
  const closestT = Math.max(0, Math.min(rayLength, projection));
  const closestX = rayStart.x + dirX * closestT;
  const closestY = rayStart.y + dirY * closestT;

  // Distance from closest point to circle center
  const distToCenter = distance({ x: closestX, y: closestY }, circleCenter);

  // Check if intersection occurs
  if (distToCenter <= circleRadius) {
    return closestT; // Return distance along ray to intersection
  }

  return null;
}

/**
 * Check if a line segment intersects a circle
 * Returns true if line segment intersects circle
 */
export function lineCircleIntersection(
  lineStart: Position,
  lineEnd: Position,
  circleCenter: Position,
  circleRadius: number,
  currentLength: number
): boolean {
  // Calculate actual end position based on current extension
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const totalLength = Math.sqrt(dx * dx + dy * dy);
  if (totalLength === 0) return false;

  const progress = currentLength / totalLength;
  const actualEndX = lineStart.x + dx * progress;
  const actualEndY = lineStart.y + dy * progress;

  // Vector from line start to circle center
  const fx = circleCenter.x - lineStart.x;
  const fy = circleCenter.y - lineStart.y;

  // Vector from line start to actual end
  const lx = actualEndX - lineStart.x;
  const ly = actualEndY - lineStart.y;

  // Project circle center onto line segment
  const lineLengthSq = lx * lx + ly * ly;
  if (lineLengthSq === 0) return false;

  const t = Math.max(0, Math.min(1, (fx * lx + fy * ly) / lineLengthSq));

  // Closest point on line to circle center
  const closestX = lineStart.x + t * lx;
  const closestY = lineStart.y + t * ly;

  // Distance from closest point to circle center
  const distX = circleCenter.x - closestX;
  const distY = circleCenter.y - closestY;
  const distSq = distX * distX + distY * distY;

  return distSq <= circleRadius * circleRadius;
}

/**
 * Poisson disc sampling for spatial distribution
 * Guarantees minimum separation between points while efficiently filling space
 * Returns array of positions with guaranteed minDist separation
 */
export function poissonDiscSampling(
  width: number,
  height: number,
  minDist: number,
  maxPoints: number,
  existingPoints: Position[] = [],
  avoidanceZones: Array<{ position: Position; radius: number }> = [],
  seedPoint?: Position // Optional seed point to start from (instead of random)
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

/**
 * Grid-based distribution with random jitter
 * Guarantees even coverage across the entire area (unlike Poisson disc which clusters)
 * Each cell gets one point with random offset within the cell
 *
 * @param width - Area width
 * @param height - Area height
 * @param targetCount - Approximate number of points to generate
 * @param avoidanceZones - Circular zones where points cannot be placed
 * @param jitterAmount - How much to randomize within cell (0-1, default 0.7)
 * @returns Array of evenly distributed positions
 */
export function gridJitterDistribution(
  width: number,
  height: number,
  targetCount: number,
  avoidanceZones: Array<{ position: Position; radius: number }> = [],
  jitterAmount: number = 0.7
): Position[] {
  // Calculate grid dimensions maintaining aspect ratio
  const aspectRatio = width / height;
  const rows = Math.round(Math.sqrt(targetCount / aspectRatio));
  const cols = Math.round(rows * aspectRatio);

  const cellWidth = width / cols;
  const cellHeight = height / rows;

  const points: Position[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Base position at cell center
      const baseX = (col + 0.5) * cellWidth;
      const baseY = (row + 0.5) * cellHeight;

      // Add random jitter within cell (controlled by jitterAmount)
      const jitterX = (Math.random() - 0.5) * cellWidth * jitterAmount;
      const jitterY = (Math.random() - 0.5) * cellHeight * jitterAmount;

      const point = {
        x: baseX + jitterX,
        y: baseY + jitterY,
      };

      // Check avoidance zones
      let isValid = true;
      for (const zone of avoidanceZones) {
        if (distance(point, zone.position) < zone.radius) {
          isValid = false;
          break;
        }
      }

      if (isValid) {
        points.push(point);
      }
    }
  }

  return points;
}
