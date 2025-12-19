// ============================================
// Spawning Helpers
// Functions for spawn position and value calculations
// Query ECS for obstacle data
// ============================================

import { GAME_CONFIG, type Position, getRandomSpherePosition, distanceForMode } from '#shared';
import { getConfig } from '../dev';
import { forEachObstacle, type World } from '../ecs';

/**
 * Generate a random neon color for a new cyber-cell
 */
export function randomColor(): string {
  return GAME_CONFIG.CELL_COLORS[Math.floor(Math.random() * GAME_CONFIG.CELL_COLORS.length)];
}

/**
 * Generate a random spawn position on the sphere surface
 * Avoids spawning inside obstacle death zones
 */
export function randomSpawnPosition(world: World): Position {
  const MIN_DIST_FROM_OBSTACLE_CORE = 400;
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const position = getRandomSpherePosition(GAME_CONFIG.SPHERE_RADIUS);

    let tooClose = false;
    forEachObstacle(world, (_entity, obstaclePos) => {
      if (distanceForMode(position, obstaclePos) < MIN_DIST_FROM_OBSTACLE_CORE) {
        tooClose = true;
      }
    });

    if (!tooClose) {
      return position;
    }
  }

  // Fallback: return random position (rare case where all attempts fail)
  return getRandomSpherePosition(GAME_CONFIG.SPHERE_RADIUS);
}

/**
 * Check if nutrient spawn position is safe
 * Nutrients can spawn inside gravity well and even outer edge of event horizon (180-240px)
 * Only exclude the inner event horizon (0-180px) where escape is truly impossible
 * Queries ECS for obstacle positions.
 * Uses mode-appropriate distance (2D for flat, 3D for sphere)
 */
export function isNutrientSpawnSafe(position: Position, world: World): boolean {
  const INNER_EVENT_HORIZON = 180; // Inner 180px - truly inescapable, no nutrients

  let safe = true;
  forEachObstacle(world, (_entity, obstaclePos) => {
    // Use distanceForMode for proper sphere support
    if (distanceForMode(position, obstaclePos) < INNER_EVENT_HORIZON) {
      safe = false;
    }
  });

  return safe;
}

/**
 * Calculate nutrient value multiplier based on proximity to nearest obstacle
 * Gradient system creates risk/reward:
 * - >600px: 1x (green) - safe areas outside gravity wells
 * - 400-600px (outer gravity well): 2x (cyan)
 * - 240-400px (inner gravity well): 3x (gold)
 * - 180-240px (outer event horizon): 5x (magenta) - high risk, high reward!
 * - <180px: N/A (nutrients don't spawn here)
 * Queries ECS for obstacle positions.
 * Uses mode-appropriate distance (2D for flat, 3D for sphere)
 */
export function calculateNutrientValueMultiplier(position: Position, world: World): number {
  let closestDist = Infinity;

  forEachObstacle(world, (_entity, obstaclePos) => {
    // Use distanceForMode for proper sphere support (3D distance in sphere mode)
    const dist = distanceForMode(position, obstaclePos);
    if (dist < closestDist) {
      closestDist = dist;
    }
  });

  const GRAVITY_RADIUS = getConfig('OBSTACLE_GRAVITY_RADIUS'); // 600px

  // Not in any gravity well
  if (closestDist >= GRAVITY_RADIUS) {
    return 1; // Base value - GREEN
  }

  // Gradient system based on distance from obstacle center
  if (closestDist >= 400) {
    return 2; // Outer gravity well - CYAN
  } else if (closestDist >= 240) {
    return 3; // Inner gravity well, approaching danger - GOLD
  } else {
    return 5; // Outer event horizon - extreme risk, extreme reward! - MAGENTA
  }
}
