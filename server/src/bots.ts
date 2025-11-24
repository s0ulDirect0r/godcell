import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { Player, Position, Nutrient, Obstacle, EntropySwarm, PlayerJoinedMessage, PlayerRespawnedMessage } from '@godcell/shared';
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
const singleCellBots: Map<string, BotController> = new Map();

// Multi-cell bots (separate tracking for population management)
const multiCellBots: Map<string, BotController> = new Map();

// Spawn position generator (injected from main module)
let spawnPositionGenerator: (() => Position) | null = null;

// Bot configuration
const BOT_CONFIG = {
  COUNT: 15, // Number of Stage 1 bots to spawn (tripled for stage 1 tuning)
  STAGE2_COUNT: 2, // Number of Stage 2 multi-cell bots (constant presence)
  SEARCH_RADIUS: 400, // How far bots can see nutrients (pixels)
  WANDER_CHANGE_MIN: 1000, // Min time between direction changes (ms)
  WANDER_CHANGE_MAX: 3000, // Max time between direction changes (ms)
  RESPAWN_DELAY: 3000, // How long to wait before respawning dead Stage 1 bots (ms)
  STAGE2_RESPAWN_DELAY: 5000, // How long to wait before respawning dead Stage 2 bots (ms)
};

// ============================================
// Helper Functions (from main module)
// ============================================

function randomColor(): string {
  return GAME_CONFIG.CELL_COLORS[Math.floor(Math.random() * GAME_CONFIG.CELL_COLORS.length)];
}

/**
 * Generate a random spawn position using the spawn point system from main module
 * Falls back to map center if spawn generator not set
 */
function randomSpawnPosition(): Position {
  if (spawnPositionGenerator) {
    return spawnPositionGenerator();
  }

  // Fallback if spawn generator not injected
  logger.warn('Bot: Spawn position generator not set, using map center fallback');
  return {
    x: GAME_CONFIG.WORLD_WIDTH / 2,
    y: GAME_CONFIG.WORLD_HEIGHT / 2,
  };
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
  playerVelocities: Map<string, { x: number; y: number }>
): BotController {
  // Generate unique bot ID (distinct from socket IDs)
  const botId = `bot-${Math.random().toString(36).substr(2, 9)}`;

  // Create bot player (same as human player)
  // Energy-only system: energy is the sole resource
  const botPlayer: Player = {
    id: botId,
    position: randomSpawnPosition(),
    color: randomColor(),
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
  singleCellBots.set(botId, bot);

  // Broadcast to all clients (bots appear as regular players)
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: botPlayer,
  };
  io.emit('playerJoined', joinMessage);

  return bot;
}

/**
 * Spawn a multi-cell bot (Stage 2)
 */
function spawnMultiCellBot(
  io: Server,
  players: Map<string, Player>,
  playerInputDirections: Map<string, { x: number; y: number }>,
  playerVelocities: Map<string, { x: number; y: number }>
): BotController {
  // Generate unique bot ID
  const botId = `bot-multicell-${Math.random().toString(36).substr(2, 9)}`;

  // Create multi-cell bot at Stage 2
  // Energy-only system: use stage-specific energy pool
  const botPlayer: Player = {
    id: botId,
    position: randomSpawnPosition(),
    color: randomColor(),
    energy: GAME_CONFIG.MULTI_CELL_ENERGY, // 400 energy (Stage 2 pool)
    maxEnergy: GAME_CONFIG.MULTI_CELL_MAX_ENERGY, // 400 max energy
    stage: EvolutionStage.MULTI_CELL,
    isEvolving: false,
  };

  // Create input direction and velocity objects
  const botInputDirection = { x: 0, y: 0 };
  const botVelocity = { x: 0, y: 0 };

  // Create bot controller with simple AI state (just wander for now)
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

  // Add to game state
  players.set(botId, botPlayer);
  playerInputDirections.set(botId, botInputDirection);
  playerVelocities.set(botId, botVelocity);
  multiCellBots.set(botId, bot);

  // Broadcast to all clients
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
 * Calculate avoidance force away from dangerous obstacle cores
 * Returns a steering force away from the nearest dangerous obstacle
 */
function avoidObstacles(
  botPosition: Position,
  obstacles: Map<string, Obstacle>
): { x: number; y: number } {
  let avoidanceForce = { x: 0, y: 0 };

  for (const obstacle of obstacles.values()) {
    const dist = distance(botPosition, obstacle.position);

    // Danger zones based on obstacle characteristics
    const coreRadius = GAME_CONFIG.OBSTACLE_CORE_RADIUS; // 60px - instant death
    const eventHorizon = GAME_CONFIG.OBSTACLE_EVENT_HORIZON; // 180px - inescapable
    const cautionRadius = eventHorizon * 1.5; // 270px - start avoiding

    // If bot is outside caution radius, no avoidance needed
    if (dist > cautionRadius) continue;

    // Calculate avoidance strength (stronger when closer)
    // Core: maximum avoidance (1.0)
    // Event horizon: strong avoidance (0.7)
    // Caution zone: gentle avoidance (0.3)
    let avoidanceStrength = 0;
    if (dist < coreRadius) {
      avoidanceStrength = 1.0; // Maximum panic
    } else if (dist < eventHorizon) {
      avoidanceStrength = 0.7 + (0.3 * (eventHorizon - dist) / (eventHorizon - coreRadius));
    } else {
      avoidanceStrength = 0.3 * (cautionRadius - dist) / (cautionRadius - eventHorizon);
    }

    // Direction AWAY from obstacle
    const dx = botPosition.x - obstacle.position.x;
    const dy = botPosition.y - obstacle.position.y;
    const dirLength = Math.sqrt(dx * dx + dy * dy);

    if (dirLength > 0) {
      // Normalize and scale by avoidance strength
      avoidanceForce.x += (dx / dirLength) * avoidanceStrength;
      avoidanceForce.y += (dy / dirLength) * avoidanceStrength;
    }
  }

  return avoidanceForce;
}

/**
 * Calculate avoidance force away from dangerous entropy swarms
 * Swarms deal damage on contact and chase players, so bots should avoid them
 */
function avoidSwarms(
  botPosition: Position,
  swarms: EntropySwarm[]
): { x: number; y: number } {
  let avoidanceForce = { x: 0, y: 0 };

  for (const swarm of swarms) {
    const dist = distance(botPosition, swarm.position);

    // Danger zones
    const contactRadius = swarm.size; // Direct contact - taking damage
    const threatRadius = GAME_CONFIG.SWARM_DETECTION_RADIUS * 0.5; // 350px - swarm might detect us
    const cautionRadius = GAME_CONFIG.SWARM_DETECTION_RADIUS; // 700px - full detection range

    // If bot is outside caution radius, no avoidance needed
    if (dist > cautionRadius) continue;

    // Calculate avoidance strength (stronger when closer)
    let avoidanceStrength = 0;
    if (dist < contactRadius) {
      avoidanceStrength = 1.0; // Maximum panic - we're being damaged!
    } else if (dist < threatRadius) {
      // High avoidance when within half detection range
      avoidanceStrength = 0.6 + (0.4 * (threatRadius - dist) / (threatRadius - contactRadius));
    } else {
      // Gentle avoidance at edge of detection range
      avoidanceStrength = 0.3 * (cautionRadius - dist) / (cautionRadius - threatRadius);
    }

    // Direction AWAY from swarm
    const dx = botPosition.x - swarm.position.x;
    const dy = botPosition.y - swarm.position.y;
    const dirLength = Math.sqrt(dx * dx + dy * dy);

    if (dirLength > 0) {
      // Normalize and scale by avoidance strength
      avoidanceForce.x += (dx / dirLength) * avoidanceStrength;
      avoidanceForce.y += (dy / dirLength) * avoidanceStrength;
    }
  }

  return avoidanceForce;
}

/**
 * Update a single bot's AI decision-making
 * Combines goal-seeking (nutrients/wander) with obstacle and swarm avoidance
 */
function updateBotAI(
  bot: BotController,
  currentTime: number,
  nutrients: Map<string, Nutrient>,
  obstacles: Map<string, Obstacle>,
  swarms: EntropySwarm[]
) {
  const player = bot.player;

  // Skip dead or evolving bots
  if (player.energy <= 0 || player.isEvolving) {
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    return;
  }

  // Calculate combined avoidance forces (always active)
  const obstacleAvoidance = avoidObstacles(player.position, obstacles);
  const swarmAvoidance = avoidSwarms(player.position, swarms);

  // Combine avoidance forces (both are important for survival)
  const avoidance = {
    x: obstacleAvoidance.x + swarmAvoidance.x,
    y: obstacleAvoidance.y + swarmAvoidance.y,
  };

  // Try to find nearby nutrient
  const nearestNutrient = findNearestNutrient(player.position, nutrients);

  if (nearestNutrient) {
    // SEEK state - move towards nutrient
    bot.ai.state = 'seek_nutrient';
    bot.ai.targetNutrient = nearestNutrient.id;

    // Steer towards target (returns direction vector, not velocity)
    const seekDirection = steerTowards(player.position, nearestNutrient.position, bot.inputDirection);

    // Combine seeking with obstacle avoidance (avoidance takes priority)
    bot.inputDirection.x = seekDirection.x + avoidance.x;
    bot.inputDirection.y = seekDirection.y + avoidance.y;
  } else {
    // WANDER state - random exploration
    bot.ai.state = 'wander';
    bot.ai.targetNutrient = undefined;
    updateBotWander(bot, currentTime);

    // Add obstacle avoidance to wander direction
    bot.inputDirection.x += avoidance.x;
    bot.inputDirection.y += avoidance.y;
  }

  // Normalize final direction (don't let combined forces create super-speed)
  const dirLength = Math.sqrt(
    bot.inputDirection.x * bot.inputDirection.x +
    bot.inputDirection.y * bot.inputDirection.y
  );
  if (dirLength > 1) {
    bot.inputDirection.x /= dirLength;
    bot.inputDirection.y /= dirLength;
  }
}

// ============================================
// Public API
// ============================================

/**
 * Initialize AI bots on server start
 * Accepts spawn position generator from main module for consistent spawning
 */
export function initializeBots(
  io: Server,
  players: Map<string, Player>,
  playerInputDirections: Map<string, { x: number; y: number }>,
  playerVelocities: Map<string, { x: number; y: number }>,
  getSpawnPosition: () => Position
) {
  // Store spawn position generator for bot respawns
  spawnPositionGenerator = getSpawnPosition;

  // Spawn Stage 1 bots
  for (let i = 0; i < BOT_CONFIG.COUNT; i++) {
    spawnBot(io, players, playerInputDirections, playerVelocities);
  }

  // Spawn multi-cell bots
  for (let i = 0; i < BOT_CONFIG.STAGE2_COUNT; i++) {
    spawnMultiCellBot(io, players, playerInputDirections, playerVelocities);
  }

  logBotsSpawned(BOT_CONFIG.COUNT + BOT_CONFIG.STAGE2_COUNT);
}

/**
 * Update multi-cell bot AI - hunts single-cells, uses EMP, devours swarms
 */
function updateMultiCellBotAI(
  bot: BotController,
  currentTime: number,
  nutrients: Map<string, Nutrient>,
  obstacles: Map<string, Obstacle>,
  swarms: EntropySwarm[],
  players: Map<string, Player>
) {
  const player = bot.player;

  // Skip dead or evolving bots
  if (player.energy <= 0 || player.isEvolving) {
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    return;
  }

  // Multi-cells hunt single-cells and nutrients
  // Priority: 1. Disabled swarms (easy energy), 2. Single-cells (prey), 3. Nutrients

  // Find nearest disabled swarm (from EMP or other source)
  let nearestDisabledSwarm: EntropySwarm | null = null;
  let nearestDisabledSwarmDist = 600; // Detection range
  for (const swarm of swarms) {
    if (swarm.disabledUntil && swarm.disabledUntil > Date.now()) {
      const dist = distance(player.position, swarm.position);
      if (dist < nearestDisabledSwarmDist) {
        nearestDisabledSwarm = swarm;
        nearestDisabledSwarmDist = dist;
      }
    }
  }

  // Find nearest single-cell (prey)
  let nearestPrey: Player | null = null;
  let nearestPreyDist = 800; // Hunting range
  for (const [id, otherPlayer] of players) {
    if (id === player.id) continue; // Don't hunt self
    if (otherPlayer.stage !== EvolutionStage.SINGLE_CELL) continue; // Only hunt Stage 1
    if (otherPlayer.energy <= 0) continue; // Skip dead

    const dist = distance(player.position, otherPlayer.position);
    if (dist < nearestPreyDist) {
      nearestPrey = otherPlayer;
      nearestPreyDist = dist;
    }
  }

  // Calculate obstacle avoidance (multi-cells still avoid gravity wells)
  const obstacleAvoidance = avoidObstacles(player.position, obstacles);

  // Decision tree: disabled swarm > prey > nutrient
  if (nearestDisabledSwarm) {
    // Hunt disabled swarm (easy energy)
    const seekDirection = steerTowards(player.position, nearestDisabledSwarm.position, bot.inputDirection);
    bot.inputDirection.x = seekDirection.x + obstacleAvoidance.x;
    bot.inputDirection.y = seekDirection.y + obstacleAvoidance.y;
  } else if (nearestPrey) {
    // Hunt single-cell prey
    const seekDirection = steerTowards(player.position, nearestPrey.position, bot.inputDirection);
    bot.inputDirection.x = seekDirection.x + obstacleAvoidance.x;
    bot.inputDirection.y = seekDirection.y + obstacleAvoidance.y;
  } else {
    // Seek nutrients (fallback behavior)
    const nearestNutrient = findNearestNutrient(player.position, nutrients);
    if (nearestNutrient) {
      const seekDirection = steerTowards(player.position, nearestNutrient.position, bot.inputDirection);
      bot.inputDirection.x = seekDirection.x + obstacleAvoidance.x;
      bot.inputDirection.y = seekDirection.y + obstacleAvoidance.y;
    } else {
      // Wander if nothing to hunt
      updateBotWander(bot, currentTime);
      bot.inputDirection.x += obstacleAvoidance.x;
      bot.inputDirection.y += obstacleAvoidance.y;
    }
  }

  // Normalize direction
  const dirLength = Math.sqrt(
    bot.inputDirection.x * bot.inputDirection.x +
    bot.inputDirection.y * bot.inputDirection.y
  );
  if (dirLength > 1) {
    bot.inputDirection.x /= dirLength;
    bot.inputDirection.y /= dirLength;
  }

  // TODO: Add EMP usage logic (when surrounded by swarms or near high-value targets)
  // TODO: Add pseudopod beam firing logic (when near prey)
}

/**
 * Update all bots' AI decision-making
 * Call this before the movement loop in the game tick
 */
export function updateBots(
  currentTime: number,
  nutrients: Map<string, Nutrient>,
  obstacles: Map<string, Obstacle>,
  swarms: EntropySwarm[],
  players: Map<string, Player>
) {
  // Update single-cell bots
  for (const [botId, bot] of singleCellBots) {
    updateBotAI(bot, currentTime, nutrients, obstacles, swarms);
  }

  // Update multi-cell bots (hunter AI)
  for (const [botId, bot] of multiCellBots) {
    updateMultiCellBotAI(bot, currentTime, nutrients, obstacles, swarms, players);
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
  return singleCellBots.size + multiCellBots.size;
}

/**
 * Handle bot death - schedule auto-respawn after delay
 */
export function handleBotDeath(
  botId: string,
  io: Server,
  players: Map<string, Player>,
  playerInputDirections: Map<string, { x: number; y: number }>,
  playerVelocities: Map<string, { x: number; y: number }>
) {
  // Check if it's a single-cell bot
  const singleCellBot = singleCellBots.get(botId);
  if (singleCellBot) {
    logBotDeath(botId);

    // Schedule single-cell bot respawn
    setTimeout(() => {
      const player = players.get(botId);
      if (!player) return; // Bot was removed from game

      // Reset to single-cell at random spawn (energy-only system)
      player.position = randomSpawnPosition();
      player.energy = GAME_CONFIG.SINGLE_CELL_ENERGY;
      player.maxEnergy = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
      player.stage = EvolutionStage.SINGLE_CELL;
      player.isEvolving = false;

      // Reset input direction and velocity
      singleCellBot.inputDirection.x = 0;
      singleCellBot.inputDirection.y = 0;
      singleCellBot.velocity.x = 0;
      singleCellBot.velocity.y = 0;

      // Reset AI state
      singleCellBot.ai.state = 'wander';
      singleCellBot.ai.targetNutrient = undefined;
      singleCellBot.ai.nextWanderChange = Date.now();

      // Broadcast respawn to all clients
      const respawnMessage: PlayerRespawnedMessage = {
        type: 'playerRespawned',
        player: { ...player },
      };
      io.emit('playerRespawned', respawnMessage);

      logBotRespawn(botId);
    }, BOT_CONFIG.RESPAWN_DELAY);
    return;
  }

  // Check if it's a multi-cell bot
  const multiCellBot = multiCellBots.get(botId);
  if (multiCellBot) {
    logBotDeath(botId);

    // Schedule multi-cell bot respawn (longer delay)
    setTimeout(() => {
      const player = players.get(botId);
      if (!player) return; // Bot was removed from game

      // Respawn as multi-cell (Stage 2) - energy-only system
      player.position = randomSpawnPosition();
      player.energy = GAME_CONFIG.MULTI_CELL_ENERGY;
      player.maxEnergy = GAME_CONFIG.MULTI_CELL_MAX_ENERGY;
      player.stage = EvolutionStage.MULTI_CELL;
      player.isEvolving = false;

      // Reset input direction and velocity
      multiCellBot.inputDirection.x = 0;
      multiCellBot.inputDirection.y = 0;
      multiCellBot.velocity.x = 0;
      multiCellBot.velocity.y = 0;

      // Reset AI state
      multiCellBot.ai.state = 'wander';
      multiCellBot.ai.targetNutrient = undefined;
      multiCellBot.ai.nextWanderChange = Date.now();

      // Broadcast respawn to all clients
      const respawnMessage: PlayerRespawnedMessage = {
        type: 'playerRespawned',
        player: { ...player },
      };
      io.emit('playerRespawned', respawnMessage);

      logBotRespawn(botId);
    }, BOT_CONFIG.STAGE2_RESPAWN_DELAY);
    return;
  }
}
