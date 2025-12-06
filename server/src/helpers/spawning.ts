// ============================================
// Spawning Helpers
// Functions for spawn position and value calculations
// Query ECS for obstacle data
// ============================================

import { GAME_CONFIG, type Position } from '#shared';
import { getConfig } from '../dev';
import { distance } from './math';
import { forEachObstacle, type World } from '../ecs';

/**
 * Generate a random neon color for a new cyber-cell
 */
export function randomColor(): string {
  return GAME_CONFIG.CELL_COLORS[Math.floor(Math.random() * GAME_CONFIG.CELL_COLORS.length)];
}

/**
 * Generate a random spawn position in the soup region
 * Avoids spawning directly in obstacle death zones (200px safety radius)
 * Queries ECS for obstacle positions.
 * Note: Players always spawn in soup (Stage 1). Soup is now a region within the jungle.
 */
export function randomSpawnPosition(world: World): Position {
  const padding = 100;
  const MIN_DIST_FROM_OBSTACLE_CORE = 400; // Stay outside inner gravity well
  const maxAttempts = 20;

  // Spawn within soup region (which is centered in the jungle world)
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X + padding;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y + padding;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH - padding;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT - padding;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const position = {
      x: soupMinX + Math.random() * (soupMaxX - soupMinX),
      y: soupMinY + Math.random() * (soupMaxY - soupMinY),
    };

    // Check distance from all obstacle cores via ECS
    let tooClose = false;
    forEachObstacle(world, (_entity, obstaclePos) => {
      if (distance(position, obstaclePos) < MIN_DIST_FROM_OBSTACLE_CORE) {
        tooClose = true;
      }
    });

    if (!tooClose) {
      return position;
    }
  }

  // If we can't find a safe spot after maxAttempts, spawn anyway
  // (extremely unlikely with 12 obstacles on the soup map)
  return {
    x: soupMinX + Math.random() * (soupMaxX - soupMinX),
    y: soupMinY + Math.random() * (soupMaxY - soupMinY),
  };
}

/**
 * Check if nutrient spawn position is safe
 * Nutrients can spawn inside gravity well and even outer edge of event horizon (180-240px)
 * Only exclude the inner event horizon (0-180px) where escape is truly impossible
 * Queries ECS for obstacle positions.
 */
export function isNutrientSpawnSafe(position: Position, world: World): boolean {
  const INNER_EVENT_HORIZON = 180; // Inner 180px - truly inescapable, no nutrients

  let safe = true;
  forEachObstacle(world, (_entity, obstaclePos) => {
    if (distance(position, obstaclePos) < INNER_EVENT_HORIZON) {
      safe = false;
    }
  });

  return safe;
}

/**
 * Calculate nutrient value multiplier based on proximity to nearest obstacle
 * Gradient system creates risk/reward:
 * - 400-600px (outer gravity well): 2x
 * - 240-400px (inner gravity well): 3x
 * - 180-240px (outer event horizon): 5x - high risk, high reward!
 * - <180px: N/A (nutrients don't spawn here)
 * Queries ECS for obstacle positions.
 */
export function calculateNutrientValueMultiplier(position: Position, world: World): number {
  let closestDist = Infinity;

  forEachObstacle(world, (_entity, obstaclePos) => {
    const dist = distance(position, obstaclePos);
    if (dist < closestDist) {
      closestDist = dist;
    }
  });

  const GRAVITY_RADIUS = getConfig('OBSTACLE_GRAVITY_RADIUS'); // 600px

  // Not in any gravity well
  if (closestDist >= GRAVITY_RADIUS) {
    return 1; // Base value
  }

  // Gradient system
  if (closestDist >= 400) {
    return 2; // Outer gravity well
  } else if (closestDist >= 240) {
    return 3; // Inner gravity well, approaching danger
  } else {
    return 5; // Outer event horizon - extreme risk, extreme reward!
  }
}
