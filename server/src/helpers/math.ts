// ============================================
// Physics Helpers
// Pure math functions for geometry and spatial algorithms
// ============================================

import type { Position } from '@shared';
import { distance, poissonDiscSampling } from '@shared';

// Re-export shared math functions
export { distance, poissonDiscSampling };

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
 * Grid-based distribution with random jitter
 * Guarantees even coverage across the entire area
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
  // Guard against degenerate inputs
  if (targetCount <= 0 || width <= 0 || height <= 0) {
    return [];
  }

  // Calculate grid dimensions maintaining aspect ratio
  const aspectRatio = width / height;
  const rows = Math.max(1, Math.round(Math.sqrt(targetCount / aspectRatio)));
  const cols = Math.max(1, Math.round(rows * aspectRatio));

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
