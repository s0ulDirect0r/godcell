// ============================================
// Nutrient Management
// Handles nutrient spawning, respawning, and lifecycle
// ============================================

import type { Server } from 'socket.io';
import type { Nutrient, Position, Obstacle, World, NutrientSpawnedMessage } from '@godcell/shared';
import { GAME_CONFIG } from '@godcell/shared';
import { createNutrient as ecsCreateNutrient } from './ecs';
import { isNutrientSpawnSafe, calculateNutrientValueMultiplier, poissonDiscSampling } from './helpers';
import { getConfig } from './dev';
import { logger, logNutrientsSpawned } from './logger';

// ============================================
// Module State
// ============================================

const nutrients: Map<string, Nutrient> = new Map();
const nutrientRespawnTimers: Map<string, NodeJS.Timeout> = new Map();
let nutrientIdCounter = 0;

// References set during initialization
let world: World;
let io: Server;

/**
 * Initialize module with required references
 * Must be called before using nutrient functions
 */
export function initNutrientModule(ecsWorld: World, socketIo: Server): void {
  world = ecsWorld;
  io = socketIo;
}

/**
 * Guard function to ensure module is initialized before use
 */
function assertInitialized(): void {
  if (!world || !io) {
    throw new Error('Nutrient module not initialized. Call initNutrientModule first.');
  }
}

/**
 * Get the nutrients Map (for GameContext and other modules)
 */
export function getNutrients(): Map<string, Nutrient> {
  return nutrients;
}

// ============================================
// Nutrient Spawning
// ============================================

/**
 * Spawn a nutrient at a random location within the soup region
 * Nutrients near obstacles get enhanced value based on gradient system (2x/3x/5x multipliers)
 * Note: "Respawn" creates a NEW nutrient with a new ID, not reusing the old one
 */
export function spawnNutrient(emitEvent: boolean = false): Nutrient {
  assertInitialized();
  const padding = 100;
  const maxAttempts = 20;
  let attempts = 0;

  // Spawn within soup region (nutrients are soup-scale resources)
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X + padding;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y + padding;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH - padding;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT - padding;

  // Default fallback position (center of soup)
  let position: Position = {
    x: GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2,
    y: GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2,
  };

  // Find a safe position (not inside event horizon)
  while (attempts < maxAttempts) {
    const candidate = {
      x: soupMinX + Math.random() * (soupMaxX - soupMinX),
      y: soupMinY + Math.random() * (soupMaxY - soupMinY),
    };

    if (isNutrientSpawnSafe(candidate, world)) {
      position = candidate;
      break; // Found safe position
    }

    attempts++;
  }

  // Log warning if we had to use fallback
  if (attempts >= maxAttempts) {
    logger.warn({ event: 'nutrient_spawn_fallback', attempts: maxAttempts }, 'Could not find safe nutrient spawn position after max attempts, using fallback');
  }

  return spawnNutrientAt(position, undefined, emitEvent);
}

/**
 * Spawn a nutrient at a specific position
 * Used for prey drops and specific spawn locations
 * @param position - Where to spawn the nutrient
 * @param overrideMultiplier - Optional multiplier override (1/2/3/5) for dev tools
 */
export function spawnNutrientAt(position: Position, overrideMultiplier?: number, emitEvent: boolean = false): Nutrient {
  assertInitialized();
  // Calculate nutrient value based on proximity to obstacles (gradient system)
  // Or use override multiplier if provided (dev tool)
  const valueMultiplier = overrideMultiplier ?? calculateNutrientValueMultiplier(position, world);
  const isHighValue = valueMultiplier > 1; // Any multiplier > 1 is "high value"

  const nutrient: Nutrient = {
    id: `nutrient-${nutrientIdCounter++}`,
    position,
    value: getConfig('NUTRIENT_ENERGY_VALUE') * valueMultiplier,
    capacityIncrease: getConfig('NUTRIENT_CAPACITY_INCREASE') * valueMultiplier,
    valueMultiplier, // Store multiplier for client color rendering
    isHighValue,
  };

  nutrients.set(nutrient.id, nutrient);

  // Add to ECS (dual-write during migration)
  ecsCreateNutrient(
    world,
    nutrient.id,
    position,
    nutrient.value,
    nutrient.capacityIncrease,
    valueMultiplier,
    isHighValue
  );

  // Emit spawn event for client-side spawn animations (only after initial load)
  if (emitEvent && io) {
    const spawnMessage: NutrientSpawnedMessage = {
      type: 'nutrientSpawned',
      nutrient,
    };
    io.emit('nutrientSpawned', spawnMessage);
  }

  return nutrient;
}

/**
 * Schedule a nutrient to respawn after delay
 */
export function respawnNutrient(nutrientId: string): void {
  // Clear any existing timer for this nutrient to prevent leaks
  const existingTimer = nutrientRespawnTimers.get(nutrientId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    spawnNutrient(true); // emitEvent=true for spawn animations
    nutrientRespawnTimers.delete(nutrientId);
  }, getConfig('NUTRIENT_RESPAWN_TIME'));

  nutrientRespawnTimers.set(nutrientId, timer);
}

/**
 * Initialize nutrients on server start using Bridson's algorithm
 * Ensures even distribution while allowing clustering near obstacles for risk/reward
 */
export function initializeNutrients(obstacles: Map<string, Obstacle>): void {
  assertInitialized();
  const MIN_NUTRIENT_SEPARATION = 200; // Good visual spacing across the map
  const INNER_EVENT_HORIZON = 180; // Don't spawn in inescapable zones

  // Create avoidance zones for obstacle inner event horizons only
  // Obstacles are in soup-world coordinates, so offset them back to local space for sampling
  const avoidanceZones = Array.from(obstacles.values()).map(obstacle => ({
    position: {
      x: obstacle.position.x - GAME_CONFIG.SOUP_ORIGIN_X,
      y: obstacle.position.y - GAME_CONFIG.SOUP_ORIGIN_Y,
    },
    radius: INNER_EVENT_HORIZON,
  }));

  // Generate nutrient positions using Bridson's (in local soup space 0-4800, 0-3200)
  const nutrientPositions = poissonDiscSampling(
    GAME_CONFIG.SOUP_WIDTH,
    GAME_CONFIG.SOUP_HEIGHT,
    MIN_NUTRIENT_SEPARATION,
    GAME_CONFIG.NUTRIENT_COUNT,
    [], // No existing points
    avoidanceZones // Avoid inner event horizons only
  );

  // Create nutrients from generated positions (offset to soup-world coordinates)
  for (const position of nutrientPositions) {
    spawnNutrientAt({
      x: position.x + GAME_CONFIG.SOUP_ORIGIN_X,
      y: position.y + GAME_CONFIG.SOUP_ORIGIN_Y,
    });
  }

  logNutrientsSpawned(nutrients.size);

  if (nutrients.size < GAME_CONFIG.NUTRIENT_COUNT) {
    logger.warn({
      event: 'nutrient_init_incomplete',
      placed: nutrients.size,
      target: GAME_CONFIG.NUTRIENT_COUNT,
    }, `Only placed ${nutrients.size}/${GAME_CONFIG.NUTRIENT_COUNT} nutrients (space constraints)`);
  }
}
