// ============================================
// Nutrient Management
// Handles nutrient spawning, respawning, and lifecycle
// ============================================
//
// ECS is the source of truth for nutrients.
// This module handles spawning/respawning and timers only.
// ============================================

import type { Server } from 'socket.io';
import type { Nutrient, Position, World, NutrientSpawnedMessage } from '#shared';
import { GAME_CONFIG } from '#shared';
import { createNutrient, getNutrientCount, getAllObstacleSnapshots } from './ecs';
import {
  isNutrientSpawnSafe,
  calculateNutrientValueMultiplier,
  poissonDiscSampling,
} from './helpers';
import { getConfig } from './dev';
import { logger, logNutrientsSpawned } from './logger';

// ============================================
// Module State
// ============================================

// Respawn timers (keyed by old nutrient ID, spawns new nutrient with new ID)
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
    logger.warn(
      { event: 'nutrient_spawn_fallback', attempts: maxAttempts },
      'Could not find safe nutrient spawn position after max attempts, using fallback'
    );
  }

  return spawnNutrientAt(position, undefined, emitEvent);
}

/**
 * Spawn a nutrient at a specific position
 * Used for prey drops and specific spawn locations
 * @param position - Where to spawn the nutrient
 * @param overrideMultiplier - Optional multiplier override (1/2/3/5) for dev tools
 * @returns Nutrient data (for network messages)
 */
export function spawnNutrientAt(
  position: Position,
  overrideMultiplier?: number,
  emitEvent: boolean = false
): Nutrient {
  assertInitialized();
  // Calculate nutrient value based on proximity to obstacles (gradient system)
  // Or use override multiplier if provided (dev tool)
  const valueMultiplier = overrideMultiplier ?? calculateNutrientValueMultiplier(position, world);
  const isHighValue = valueMultiplier > 1; // Any multiplier > 1 is "high value"

  const id = `nutrient-${nutrientIdCounter++}`;
  const value = getConfig('NUTRIENT_ENERGY_VALUE') * valueMultiplier;
  const capacityIncrease = getConfig('NUTRIENT_CAPACITY_INCREASE') * valueMultiplier;

  // Create in ECS (source of truth)
  createNutrient(world, id, position, value, capacityIncrease, valueMultiplier, isHighValue);

  // Build nutrient data for return/broadcast
  const nutrient: Nutrient = {
    id,
    position: { x: position.x, y: position.y },
    value,
    capacityIncrease,
    valueMultiplier,
    isHighValue,
  };

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
export function initializeNutrients(): void {
  assertInitialized();
  const MIN_NUTRIENT_SEPARATION = 200; // Good visual spacing across the map
  const INNER_EVENT_HORIZON = 180; // Don't spawn in inescapable zones

  // Create avoidance zones for obstacle inner event horizons only
  // Query obstacles from ECS (source of truth)
  // Obstacles are in soup-world coordinates, so offset them back to local space for sampling
  const obstacles = getAllObstacleSnapshots(world);
  const avoidanceZones = obstacles.map((obstacle) => ({
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

  const count = getNutrientCount(world);
  logNutrientsSpawned(count);

  if (count < GAME_CONFIG.NUTRIENT_COUNT) {
    logger.warn(
      {
        event: 'nutrient_init_incomplete',
        placed: count,
        target: GAME_CONFIG.NUTRIENT_COUNT,
      },
      `Only placed ${count}/${GAME_CONFIG.NUTRIENT_COUNT} nutrients (space constraints)`
    );
  }
}
