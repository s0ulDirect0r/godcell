import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { Player, Position, Nutrient, Obstacle, PlayerJoinedMessage, PlayerRespawnedMessage } from '@godcell/shared';
import type { Server } from 'socket.io';
import { logBotsSpawned, logBotDeath, logBotRespawn, logger } from './logger';

// ============================================
// Bot System - AI-controlled players for testing multiplayer dynamics
// ============================================

// Bot controller - manages AI state for each bot
export interface BotController {
  player: Player; // Reference to player object in players Map
  inputDirection: { x: number; y: number }; // Reference to input direction in playerInputDirections Map
  velocity: { x: number; y: number }; // Reference to velocity in playerVelocities Map (for gravity)
  ai: {
    state: 'wander' | 'seek_nutrient';
    targetNutrient?: string; // ID of nutrient being pursued
    wanderDirection: { x: number; y: number }; // Current random walk direction
    nextWanderChange: number; // Timestamp when wander direction should change
  };
}

// All AI bots currently in the game
const bots: Map<string, BotController> = new Map();

// Bot configuration
const BOT_CONFIG = {
  COUNT: 15, // Number of bots to spawn (tripled for stage 1 tuning)
  SEARCH_RADIUS: 400, // How far bots can see nutrients (pixels)
  WANDER_CHANGE_MIN: 1000, // Min time between direction changes (ms)
  WANDER_CHANGE_MAX: 3000, // Max time between direction changes (ms)
  RESPAWN_DELAY: 3000, // How long to wait before respawning dead bots (ms)
};

// ============================================
// Helper Functions (from main module)
// ============================================

function randomColor(): string {
  return GAME_CONFIG.CELL_COLORS[Math.floor(Math.random() * GAME_CONFIG.CELL_COLORS.length)];
}

/**
 * Generate a random spawn position in the digital ocean
 * Ensures position is safe from gravity wells with retry logic
 */
function randomSpawnPosition(obstacles: Map<string, Obstacle>): Position {
  const padding = 100; // Keep cells away from edges
  const maxAttempts = 20; // Max retries before giving up
  let attempts = 0;

  while (attempts < maxAttempts) {
    const position = {
      x: Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2) + padding,
      y: Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2) + padding,
    };

    // If obstacles haven't been initialized yet, or position is safe, use it
    if (obstacles.size === 0 || isSpawnSafe(position, obstacles)) {
      return position;
    }

    attempts++;
  }

  // Fallback: if we couldn't find a safe position after max attempts,
  // check if map center is safe, otherwise find the furthest point from all obstacles
  logger.warn('Bot: Could not find safe spawn position after max attempts, using fallback');

  const mapCenter = {
    x: GAME_CONFIG.WORLD_WIDTH / 2,
    y: GAME_CONFIG.WORLD_HEIGHT / 2,
  };

  // If map center is safe, use it
  if (isSpawnSafe(mapCenter, obstacles)) {
    return mapCenter;
  }

  // Map center isn't safe - find the position furthest from all obstacles
  let maxMinDistance = 0;
  let safestPosition = mapCenter;

  // Check a grid of positions to find the safest spot
  const gridSize = 10; // Check 10x10 grid
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const testPos = {
        x: (GAME_CONFIG.WORLD_WIDTH / gridSize) * i + padding,
        y: (GAME_CONFIG.WORLD_HEIGHT / gridSize) * j + padding,
      };

      // Find minimum distance to any obstacle
      let minDistToObstacle = Infinity;
      for (const obstacle of obstacles.values()) {
        const dist = distance(testPos, obstacle.position);
        if (dist < minDistToObstacle) {
          minDistToObstacle = dist;
        }
      }

      // Keep the position with the maximum minimum distance (furthest from all obstacles)
      if (minDistToObstacle > maxMinDistance) {
        maxMinDistance = minDistToObstacle;
        safestPosition = testPos;
      }
    }
  }

  logger.warn(`Bot: Using safest fallback position with ${maxMinDistance.toFixed(0)}px from nearest obstacle`);
  return safestPosition;
}

function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a spawn position is safe (not inside or near gravity wells)
 * Safe distance is 1000px from obstacle center (400px buffer outside gravity influence)
 */
function isSpawnSafe(position: Position, obstacles: Map<string, Obstacle>): boolean {
  const SAFE_DISTANCE = 1000; // Gravity radius (600px) + buffer (400px)

  for (const obstacle of obstacles.values()) {
    if (distance(position, obstacle.position) < SAFE_DISTANCE) {
      return false; // Too close to a gravity well
    }
  }

  return true; // Safe from all obstacles
}

// ============================================
// Bot Spawning
// ============================================

/**
 * Spawn a single AI bot
 */
function spawnBot(
  io: Server,
  players: Map<string, Player>,
  playerInputDirections: Map<string, { x: number; y: number }>,
  playerVelocities: Map<string, { x: number; y: number }>,
  obstacles: Map<string, Obstacle>
): BotController {
  // Generate unique bot ID (distinct from socket IDs)
  const botId = `bot-${Math.random().toString(36).substr(2, 9)}`;

  // Create bot player (same as human player)
  const botPlayer: Player = {
    id: botId,
    position: randomSpawnPosition(obstacles),
    color: randomColor(),
    health: GAME_CONFIG.SINGLE_CELL_HEALTH,
    maxHealth: GAME_CONFIG.SINGLE_CELL_MAX_HEALTH,
    energy: GAME_CONFIG.SINGLE_CELL_ENERGY,
    maxEnergy: GAME_CONFIG.SINGLE_CELL_MAX_ENERGY,
    stage: EvolutionStage.SINGLE_CELL,
    isEvolving: false,
  };

  // Create input direction and velocity objects
  const botInputDirection = { x: 0, y: 0 };
  const botVelocity = { x: 0, y: 0 };

  // Create bot controller with AI state
  const bot: BotController = {
    player: botPlayer,
    inputDirection: botInputDirection,
    velocity: botVelocity,
    ai: {
      state: 'wander',
      wanderDirection: { x: 0, y: 0 },
      nextWanderChange: Date.now(),
    },
  };

  // Add to game state (bots are treated as regular players)
  players.set(botId, botPlayer);
  playerInputDirections.set(botId, botInputDirection);
  playerVelocities.set(botId, botVelocity);
  bots.set(botId, bot);

  // Broadcast to all clients (bots appear as regular players)
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: botPlayer,
  };
  io.emit('playerJoined', joinMessage);

  return bot;
}

// ============================================
// Bot AI Behaviors
// ============================================

/**
 * Update bot wander behavior - random walk with periodic direction changes
 */
function updateBotWander(bot: BotController, currentTime: number) {
  // Check if it's time to change wander direction
  if (currentTime >= bot.ai.nextWanderChange) {
    // Pick new random direction
    bot.ai.wanderDirection = {
      x: Math.random() * 2 - 1, // -1 to 1
      y: Math.random() * 2 - 1, // -1 to 1
    };

    // Schedule next direction change
    const changeDelay =
      BOT_CONFIG.WANDER_CHANGE_MIN +
      Math.random() * (BOT_CONFIG.WANDER_CHANGE_MAX - BOT_CONFIG.WANDER_CHANGE_MIN);
    bot.ai.nextWanderChange = currentTime + changeDelay;
  }

  // Apply wander direction to input (will be combined with gravity in movement loop)
  bot.inputDirection.x = bot.ai.wanderDirection.x;
  bot.inputDirection.y = bot.ai.wanderDirection.y;
}

/**
 * Find the nearest nutrient within search radius
 */
function findNearestNutrient(botPosition: Position, nutrients: Map<string, Nutrient>): Nutrient | null {
  let nearest: Nutrient | null = null;
  let nearestDist = BOT_CONFIG.SEARCH_RADIUS;

  for (const nutrient of nutrients.values()) {
    const dist = distance(botPosition, nutrient.position);
    if (dist < nearestDist) {
      nearest = nutrient;
      nearestDist = dist;
    }
  }

  return nearest;
}

/**
 * Steer bot towards target position (smooth turning)
 */
function steerTowards(
  from: Position,
  to: Position,
  currentVelocity: { x: number; y: number },
  maxForce: number = 0.15
): { x: number; y: number } {
  // Calculate direction to target
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) return currentVelocity;

  // Desired velocity (normalized direction)
  const desiredX = dx / dist;
  const desiredY = dy / dist;

  // Steering force = desired - current
  const steerX = desiredX - currentVelocity.x;
  const steerY = desiredY - currentVelocity.y;

  // Limit steering force for smooth turns
  const steerDist = Math.sqrt(steerX * steerX + steerY * steerY);
  if (steerDist > maxForce) {
    return {
      x: currentVelocity.x + (steerX / steerDist) * maxForce,
      y: currentVelocity.y + (steerY / steerDist) * maxForce,
    };
  }

  return {
    x: currentVelocity.x + steerX,
    y: currentVelocity.y + steerY,
  };
}

/**
 * Update a single bot's AI decision-making
 */
function updateBotAI(bot: BotController, currentTime: number, nutrients: Map<string, Nutrient>) {
  const player = bot.player;

  // Skip dead or evolving bots
  if (player.health <= 0 || player.isEvolving) {
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    return;
  }

  // Try to find nearby nutrient
  const nearestNutrient = findNearestNutrient(player.position, nutrients);

  if (nearestNutrient) {
    // SEEK state - move towards nutrient
    bot.ai.state = 'seek_nutrient';
    bot.ai.targetNutrient = nearestNutrient.id;

    // Steer towards target (returns direction vector, not velocity)
    const newDirection = steerTowards(player.position, nearestNutrient.position, bot.inputDirection);
    bot.inputDirection.x = newDirection.x;
    bot.inputDirection.y = newDirection.y;
  } else {
    // WANDER state - random exploration
    bot.ai.state = 'wander';
    bot.ai.targetNutrient = undefined;
    updateBotWander(bot, currentTime);
  }
}

// ============================================
// Public API
// ============================================

/**
 * Initialize AI bots on server start
 */
export function initializeBots(
  io: Server,
  players: Map<string, Player>,
  playerInputDirections: Map<string, { x: number; y: number }>,
  playerVelocities: Map<string, { x: number; y: number }>,
  obstacles: Map<string, Obstacle>
) {
  for (let i = 0; i < BOT_CONFIG.COUNT; i++) {
    spawnBot(io, players, playerInputDirections, playerVelocities, obstacles);
  }
  logBotsSpawned(BOT_CONFIG.COUNT);
}

/**
 * Update all bots' AI decision-making
 * Call this before the movement loop in the game tick
 */
export function updateBots(currentTime: number, nutrients: Map<string, Nutrient>) {
  for (const [botId, bot] of bots) {
    updateBotAI(bot, currentTime, nutrients);
  }
}

/**
 * Check if a player ID is a bot
 */
export function isBot(playerId: string): boolean {
  return playerId.startsWith('bot-');
}

/**
 * Get bot count for debugging
 */
export function getBotCount(): number {
  return bots.size;
}

/**
 * Handle bot death - schedule auto-respawn after delay
 */
export function handleBotDeath(botId: string, io: Server, players: Map<string, Player>, obstacles: Map<string, Obstacle>) {
  const bot = bots.get(botId);
  if (!bot) return;

  logBotDeath(botId);

  // Schedule respawn
  setTimeout(() => {
    const player = players.get(botId);
    if (!player) return; // Bot was removed from game

    // Reset to single-cell at random spawn
    player.position = randomSpawnPosition(obstacles);
    player.health = GAME_CONFIG.SINGLE_CELL_HEALTH;
    player.maxHealth = GAME_CONFIG.SINGLE_CELL_MAX_HEALTH;
    player.energy = GAME_CONFIG.SINGLE_CELL_ENERGY;
    player.maxEnergy = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
    player.stage = EvolutionStage.SINGLE_CELL;
    player.isEvolving = false;

    // Reset input direction and velocity
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    bot.velocity.x = 0;
    bot.velocity.y = 0;

    // Reset AI state
    bot.ai.state = 'wander';
    bot.ai.targetNutrient = undefined;
    bot.ai.nextWanderChange = Date.now();

    // Broadcast respawn to all clients
    const respawnMessage: PlayerRespawnedMessage = {
      type: 'playerRespawned',
      player: { ...player },
    };
    io.emit('playerRespawned', respawnMessage);

    logBotRespawn(botId);
  }, BOT_CONFIG.RESPAWN_DELAY);
}
