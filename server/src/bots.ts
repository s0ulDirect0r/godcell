import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { Player, Position, Nutrient, Obstacle, EntropySwarm, PlayerJoinedMessage, PlayerRespawnedMessage, DeathCause, NutrientComponent } from '@godcell/shared';
import type { Server } from 'socket.io';
import { logBotsSpawned, logBotDeath, logBotRespawn, logger, recordSpawn, clearSpawnTime } from './logger';
import { getConfig } from './dev';
import type { AbilitySystem } from './abilities';
import {
  createBot as ecsCreateBot,
  getPlayerBySocketId,
  getEnergyBySocketId,
  getPositionBySocketId,
  getStageBySocketId,
  getVelocityBySocketId,
  getInputBySocketId,
  deletePlayerBySocketId,
  forEachPlayer,
  getStringIdByEntity,
  Components,
  Tags,
  type World,
} from './ecs';
import type { EnergyComponent, PositionComponent, StageComponent, VelocityComponent, InputComponent } from '@godcell/shared';
import { randomSpawnPosition as helperRandomSpawnPosition } from './helpers';

// ============================================
// Bot System - AI-controlled players for testing multiplayer dynamics
// ============================================

// Bot controller - manages AI state for each bot
export interface BotController {
  player: Player; // Reference to player object built from ECS components
  inputDirection: { x: number; y: number }; // Reference to InputComponent.direction (ECS)
  velocity: { x: number; y: number }; // Reference to VelocityComponent (ECS)
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

// ECS World (injected from main module for creating bot entities and obstacle queries)
let ecsWorld: World | null = null;

/**
 * Set the ECS world for bot entity creation.
 * Must be called before spawning bots.
 */
export function setBotEcsWorld(world: World): void {
  ecsWorld = world;
}

// Bot configuration
const BOT_CONFIG = {
  COUNT: 15, // Number of Stage 1 bots to spawn (tripled for stage 1 tuning)
  STAGE2_COUNT: 2, // Number of Stage 2 multi-cell bots (constant presence)
  SEARCH_RADIUS: 800, // How far bots can see nutrients (doubled from 400 to find food faster)
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
 * Generate a random spawn position using the ECS world for obstacle queries
 * Falls back to map center if ECS world not set
 */
function randomSpawnPosition(): Position {
  if (ecsWorld) {
    return helperRandomSpawnPosition(ecsWorld);
  }

  // Fallback if ECS world not injected
  logger.warn('Bot: ECS world not set, using map center fallback');
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
function spawnBot(io: Server): BotController {
  if (!ecsWorld) {
    throw new Error('ECS world not set - call setBotEcsWorld before spawning bots');
  }

  // Generate unique bot ID (distinct from socket IDs)
  const botId = `bot-${Math.random().toString(36).substr(2, 9)}`;
  const botColor = randomColor();
  const spawnPosition = randomSpawnPosition();

  // Create bot in ECS (source of truth)
  ecsCreateBot(ecsWorld, botId, botId, botColor, spawnPosition, EvolutionStage.SINGLE_CELL);

  // Get the legacy Player object from ECS for BotController reference
  const botPlayer = getPlayerBySocketId(ecsWorld, botId);
  if (!botPlayer) {
    throw new Error(`Failed to create bot ${botId} in ECS`);
  }

  // Get ECS components for direct mutation by bot AI
  const inputComponent = getInputBySocketId(ecsWorld, botId);
  const velocityComponent = getVelocityBySocketId(ecsWorld, botId);
  if (!inputComponent || !velocityComponent) {
    throw new Error(`Failed to get ECS components for bot ${botId}`);
  }

  // Create bot controller with AI state - stores references to ECS components
  const bot: BotController = {
    player: botPlayer,
    inputDirection: inputComponent.direction, // Reference to ECS InputComponent.direction
    velocity: velocityComponent, // Reference to ECS VelocityComponent
    ai: {
      state: 'wander',
      wanderDirection: { x: 0, y: 0 },
      nextWanderChange: Date.now(),
    },
  };

  singleCellBots.set(botId, bot);

  // Broadcast to all clients (bots appear as regular players)
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: botPlayer,
  };
  io.emit('playerJoined', joinMessage);

  // Track spawn time for evolution rate tracking
  recordSpawn(botId, EvolutionStage.SINGLE_CELL);

  return bot;
}

/**
 * Spawn a multi-cell bot (Stage 2)
 */
function spawnMultiCellBot(io: Server): BotController {
  if (!ecsWorld) {
    throw new Error('ECS world not set - call setBotEcsWorld before spawning bots');
  }

  // Generate unique bot ID
  const botId = `bot-multicell-${Math.random().toString(36).substr(2, 9)}`;
  const botColor = randomColor();
  const spawnPosition = randomSpawnPosition();

  // Create bot in ECS (source of truth)
  ecsCreateBot(ecsWorld, botId, botId, botColor, spawnPosition, EvolutionStage.MULTI_CELL);

  // Get the legacy Player object from ECS for BotController reference
  const botPlayer = getPlayerBySocketId(ecsWorld, botId);
  if (!botPlayer) {
    throw new Error(`Failed to create multi-cell bot ${botId} in ECS`);
  }

  // Get ECS components for direct mutation by bot AI
  const inputComponent = getInputBySocketId(ecsWorld, botId);
  const velocityComponent = getVelocityBySocketId(ecsWorld, botId);
  if (!inputComponent || !velocityComponent) {
    throw new Error(`Failed to get ECS components for multi-cell bot ${botId}`);
  }

  // Create bot controller with AI state - stores references to ECS components
  const bot: BotController = {
    player: botPlayer,
    inputDirection: inputComponent.direction, // Reference to ECS InputComponent.direction
    velocity: velocityComponent, // Reference to ECS VelocityComponent
    ai: {
      state: 'wander',
      wanderDirection: { x: 0, y: 0 },
      nextWanderChange: Date.now(),
    },
  };

  multiCellBots.set(botId, bot);

  // Broadcast to all clients
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: botPlayer,
  };
  io.emit('playerJoined', joinMessage);

  // Track spawn time for evolution rate tracking (Stage 2 spawns directly at multi-cell)
  recordSpawn(botId, EvolutionStage.MULTI_CELL);

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
 * Uses ECS as source of truth for nutrients
 */
function findNearestNutrient(botPosition: Position, world: World): Nutrient | null {
  let nearest: Nutrient | null = null;
  let nearestDist = BOT_CONFIG.SEARCH_RADIUS;

  // Query nutrients from ECS
  world.forEachWithTag(Tags.Nutrient, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const nutrientComp = world.getComponent<NutrientComponent>(entity, Components.Nutrient);
    const id = getStringIdByEntity(entity);
    if (!pos || !nutrientComp || !id) return;

    const dist = distance(botPosition, { x: pos.x, y: pos.y });
    if (dist < nearestDist) {
      nearest = {
        id,
        position: { x: pos.x, y: pos.y },
        value: nutrientComp.value,
        capacityIncrease: nutrientComp.capacityIncrease,
        valueMultiplier: nutrientComp.valueMultiplier,
        isHighValue: nutrientComp.isHighValue,
      };
      nearestDist = dist;
    }
  });

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
 * Bots start avoiding shortly before the event horizon and ramp up to
 * full-thrust escape as they cross it. Multi-cells use a larger caution
 * radius (350px) than single-cells (265px) because they're bigger/slower.
 */
function avoidObstacles(
  botPosition: Position,
  obstacles: Map<string, Obstacle>,
  stage: EvolutionStage = EvolutionStage.SINGLE_CELL
): { x: number; y: number } {
  let avoidanceForce = { x: 0, y: 0 };

  for (const obstacle of obstacles.values()) {
    const dist = distance(botPosition, obstacle.position);

    // Danger zones - tight buffer outside event horizon
    // coreRadius (60px) = instant death
    // eventHorizon (180px) = very strong gravity, hard to escape
    // cautionRadius = where bots start avoiding (stage-dependent)
    const eventHorizon = getConfig('OBSTACLE_EVENT_HORIZON');
    // Multi-cells are bigger/slower - need more reaction distance
    const cautionRadius = stage === EvolutionStage.SINGLE_CELL ? 265 : 350;

    // Only avoid when actually close to the danger zone
    if (dist > cautionRadius) continue;

    // Graduated avoidance strength based on distance
    // - Inside event horizon: FULL THRUST (1.0) - this is escape-or-die
    // - Outside event horizon: Graduated (0.3-1.0)
    let avoidanceStrength: number;
    if (dist < eventHorizon) {
      avoidanceStrength = 1.0; // Full panic inside event horizon
    } else {
      // Graduated 0.3 to 1.0 based on distance to event horizon
      const t = (cautionRadius - dist) / (cautionRadius - eventHorizon);
      avoidanceStrength = 0.3 + 0.7 * t;
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
 * Emergency-only swarm avoidance for single-cell bots
 * Only triggers when PROPERLY CAUGHT (inside 80px) - the "oh shit" reflex
 *
 * Single-cells are faster than swarms (403 vs 290 px/s) so they can usually
 * pass through. But once caught (slowed to 241 px/s), they need to juke
 * to break contact before they can escape.
 */
const EMERGENCY_SWARM_RADIUS = 80; // contactRadius (47) + buffer - only react when caught

function avoidSwarmsEmergencyOnly(
  botPosition: Position,
  swarms: EntropySwarm[]
): { x: number; y: number } {
  let avoidanceForce = { x: 0, y: 0 };

  for (const swarm of swarms) {
    const dist = distance(botPosition, swarm.position);

    // Only avoid when properly caught - ignore swarms beyond emergency radius
    if (dist > EMERGENCY_SWARM_RADIUS) continue;

    // Strong avoidance to break contact (0.6-0.8 based on how deep we are)
    const t = (EMERGENCY_SWARM_RADIUS - dist) / EMERGENCY_SWARM_RADIUS;
    const avoidanceStrength = 0.6 + 0.2 * t;

    // Direction AWAY from swarm
    const dx = botPosition.x - swarm.position.x;
    const dy = botPosition.y - swarm.position.y;
    const dirLength = Math.sqrt(dx * dx + dy * dy);

    if (dirLength > 0) {
      avoidanceForce.x += (dx / dirLength) * avoidanceStrength;
      avoidanceForce.y += (dy / dirLength) * avoidanceStrength;
    }
  }

  return avoidanceForce;
}

/**
 * Calculate avoidance force away from dangerous entropy swarms
 * Swarms deal damage on contact and chase players, so bots should avoid them
 *
 * FIX 4: PREDICTIVE AVOIDANCE
 * Instead of avoiding swarm's current position, avoid where it's HEADING.
 * This prevents bots from getting cut off by chasing swarms - they dodge
 * the swarm's trajectory instead of running into its path.
 *
 * Look-ahead time: 0.5 seconds (how far ahead to predict)
 * - Too short: Still get hit by fast-moving swarms
 * - Too long: Over-react to swarms that might change direction
 */
const SWARM_PREDICTION_TIME = 0.5; // seconds

function avoidSwarms(
  botPosition: Position,
  swarms: EntropySwarm[]
): { x: number; y: number } {
  let avoidanceForce = { x: 0, y: 0 };

  for (const swarm of swarms) {
    // PREDICTIVE: Calculate where swarm will be in 0.5 seconds
    // This helps bots avoid running INTO the swarm's path
    const predictedPosition = {
      x: swarm.position.x + swarm.velocity.x * SWARM_PREDICTION_TIME,
      y: swarm.position.y + swarm.velocity.y * SWARM_PREDICTION_TIME,
    };

    // Use BOTH current and predicted positions for threat assessment
    // - Current position: immediate danger (are we being hit right now?)
    // - Predicted position: trajectory danger (are we running into its path?)
    const currentDist = distance(botPosition, swarm.position);
    const predictedDist = distance(botPosition, predictedPosition);

    // Use the MORE THREATENING of the two distances
    // If predicted is closer, swarm is heading toward us - react to that
    const effectiveDist = Math.min(currentDist, predictedDist);

    // Danger zones
    const contactRadius = swarm.size; // Direct contact - taking damage
    const threatRadius = getConfig('SWARM_DETECTION_RADIUS') * 0.5; // 350px - swarm might detect us
    const cautionRadius = getConfig('SWARM_DETECTION_RADIUS'); // 700px - full detection range

    // If bot is outside caution radius for BOTH positions, no avoidance needed
    if (effectiveDist > cautionRadius) continue;

    // Calculate avoidance strength (stronger when closer)
    let avoidanceStrength = 0;
    if (effectiveDist < contactRadius) {
      avoidanceStrength = 1.0; // Maximum panic - we're being damaged or about to be!
    } else if (effectiveDist < threatRadius) {
      // High avoidance when within half detection range
      avoidanceStrength = 0.6 + (0.4 * (threatRadius - effectiveDist) / (threatRadius - contactRadius));
    } else {
      // Gentle avoidance at edge of detection range
      avoidanceStrength = 0.3 * (cautionRadius - effectiveDist) / (cautionRadius - threatRadius);
    }

    // PREDICTIVE: Steer away from PREDICTED position, not current
    // This makes bots dodge the swarm's trajectory instead of current position
    const avoidPoint = predictedDist < currentDist ? predictedPosition : swarm.position;
    const dx = botPosition.x - avoidPoint.x;
    const dy = botPosition.y - avoidPoint.y;
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
  world: World,
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

  // Single-cell bots: ONLY avoid singularities, NO swarm avoidance
  // They gotta EAT - swarms are a risk they accept for food
  const obstacleAvoidance = avoidObstacles(player.position, obstacles);
  const avoidance = obstacleAvoidance;

  // PRIORITIZED STEERING - but HUNGRY by default
  // Only pure escape when REALLY close to singularity (> 0.8)
  // Otherwise blend avoidance with seeking - bots gotta eat!
  const avoidanceMag = Math.sqrt(avoidance.x * avoidance.x + avoidance.y * avoidance.y);
  const AVOIDANCE_PRIORITY_THRESHOLD = 0.8; // Only escape when in REAL danger
  const AVOIDANCE_BLEND_THRESHOLD = 0.1;    // Below this = pure seeking

  if (avoidanceMag > AVOIDANCE_PRIORITY_THRESHOLD) {
    // HIGH DANGER - pure escape mode, ignore seeking
    bot.ai.state = 'wander';
    bot.ai.targetNutrient = undefined;
    bot.inputDirection.x = avoidance.x / avoidanceMag;
    bot.inputDirection.y = avoidance.y / avoidanceMag;
  } else if (avoidanceMag > AVOIDANCE_BLEND_THRESHOLD) {
    // MODERATE DANGER - blend avoidance with seeking (SEEKING weighted higher - hungry bots!)
    const nearestNutrient = findNearestNutrient(player.position, world);
    if (nearestNutrient) {
      bot.ai.state = 'seek_nutrient';
      bot.ai.targetNutrient = nearestNutrient.id;
      const seekDirection = steerTowards(player.position, nearestNutrient.position, bot.inputDirection);
      // Blend: 60% seek, 40% avoid - hungry bots prioritize food!
      const seekWeight = 0.6;
      const avoidWeight = 0.4;
      const normAvoid = { x: avoidance.x / avoidanceMag, y: avoidance.y / avoidanceMag };
      bot.inputDirection.x = seekDirection.x * seekWeight + normAvoid.x * avoidWeight;
      bot.inputDirection.y = seekDirection.y * seekWeight + normAvoid.y * avoidWeight;
    } else {
      bot.ai.state = 'wander';
      bot.ai.targetNutrient = undefined;
      bot.inputDirection.x = avoidance.x / avoidanceMag;
      bot.inputDirection.y = avoidance.y / avoidanceMag;
    }
  } else {
    // Safe zone - normal seeking/wandering behavior
    const nearestNutrient = findNearestNutrient(player.position, world);

    if (nearestNutrient) {
      // SEEK state - move towards nutrient
      bot.ai.state = 'seek_nutrient';
      bot.ai.targetNutrient = nearestNutrient.id;

      // Steer towards target (returns direction vector, not velocity)
      const seekDirection = steerTowards(player.position, nearestNutrient.position, bot.inputDirection);

      // No avoidance needed, just seek
      bot.inputDirection.x = seekDirection.x;
      bot.inputDirection.y = seekDirection.y;
    } else {
      // WANDER state - random exploration
      bot.ai.state = 'wander';
      bot.ai.targetNutrient = undefined;
      updateBotWander(bot, currentTime);
    }
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
 * Spawn a bot at a specific position (for dev tools)
 * Returns the spawned bot's player ID
 */
export function spawnBotAt(
  io: Server,
  position: Position,
  stage: EvolutionStage
): string {
  if (!ecsWorld) {
    throw new Error('ECS world not set - call setBotEcsWorld before spawning bots');
  }

  const isMultiCell = stage >= EvolutionStage.MULTI_CELL;
  const botId = isMultiCell
    ? `bot-multicell-${Math.random().toString(36).substr(2, 9)}`
    : `bot-${Math.random().toString(36).substr(2, 9)}`;
  const botColor = randomColor();

  // Create bot in ECS (source of truth)
  ecsCreateBot(ecsWorld, botId, botId, botColor, { x: position.x, y: position.y }, stage);

  // Get the legacy Player object from ECS for BotController reference
  const botPlayer = getPlayerBySocketId(ecsWorld, botId);
  if (!botPlayer) {
    throw new Error(`Failed to create bot ${botId} in ECS`);
  }

  // Get ECS components for direct mutation by bot AI
  const inputComponent = getInputBySocketId(ecsWorld, botId);
  const velocityComponent = getVelocityBySocketId(ecsWorld, botId);
  if (!inputComponent || !velocityComponent) {
    throw new Error(`Failed to get ECS components for bot ${botId}`);
  }

  // Create bot controller with AI state - stores references to ECS components
  const bot: BotController = {
    player: botPlayer,
    inputDirection: inputComponent.direction, // Reference to ECS InputComponent.direction
    velocity: velocityComponent, // Reference to ECS VelocityComponent
    ai: {
      state: 'wander',
      wanderDirection: { x: 0, y: 0 },
      nextWanderChange: Date.now(),
    },
  };

  // Track in appropriate bot map
  if (isMultiCell) {
    multiCellBots.set(botId, bot);
  } else {
    singleCellBots.set(botId, bot);
  }

  // Broadcast to clients
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: botPlayer,
  };
  io.emit('playerJoined', joinMessage);

  // Track spawn time for evolution rate tracking
  recordSpawn(botId, stage);

  logger.info({ event: 'dev_spawn_bot', botId, position, stage });

  return botId;
}

/**
 * Initialize AI bots on server start
 * Uses ECS world (set via setBotEcsWorld) for spawn position queries
 */
export function initializeBots(io: Server) {
  // Spawn Stage 1 bots
  for (let i = 0; i < BOT_CONFIG.COUNT; i++) {
    spawnBot(io);
  }

  // Spawn multi-cell bots
  for (let i = 0; i < BOT_CONFIG.STAGE2_COUNT; i++) {
    spawnMultiCellBot(io);
  }

  logBotsSpawned(BOT_CONFIG.COUNT + BOT_CONFIG.STAGE2_COUNT);
}

/**
 * Update multi-cell bot AI - hunts single-cells, uses EMP, devours swarms
 */
function updateMultiCellBotAI(
  bot: BotController,
  currentTime: number,
  world: World,
  obstacles: Map<string, Obstacle>,
  swarms: EntropySwarm[],
  abilitySystem: AbilitySystem
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

  // Count active (non-disabled) swarms nearby for EMP decision
  const empRange = getConfig('EMP_RANGE');
  let nearbyActiveSwarmCount = 0;
  for (const swarm of swarms) {
    const isDisabled = swarm.disabledUntil && swarm.disabledUntil > Date.now();
    if (!isDisabled) {
      const dist = distance(player.position, swarm.position);
      if (dist < empRange) {
        nearbyActiveSwarmCount++;
      }
    }
  }

  // Find nearest single-cell (prey)
  // Using object wrapper to help TypeScript track mutations inside callback
  const preyResult: {
    target: { id: string; position: { x: number; y: number }; energy: number; maxEnergy: number } | null;
    dist: number;
  } = { target: null, dist: 800 }; // Hunting range
  forEachPlayer(world, (entity, otherId) => {
    if (otherId === player.id) return; // Don't hunt self

    const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
    if (!stageComp || stageComp.stage !== EvolutionStage.SINGLE_CELL) return; // Only hunt Stage 1

    const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
    if (!energyComp || energyComp.current <= 0) return; // Skip dead

    const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
    if (!posComp) return;

    const dist = distance(player.position, { x: posComp.x, y: posComp.y });
    if (dist < preyResult.dist) {
      preyResult.target = { id: otherId, position: { x: posComp.x, y: posComp.y }, energy: energyComp.current, maxEnergy: energyComp.max };
      preyResult.dist = dist;
    }
  });
  const nearestPrey = preyResult.target;
  const nearestPreyDist = preyResult.dist;

  // Find nearest enemy multi-cell (for pseudopod attacks)
  // Using object wrapper to help TypeScript track mutations inside callback
  const enemyResult: {
    target: { id: string; position: { x: number; y: number } } | null;
    dist: number;
  } = { target: null, dist: 500 }; // Pseudopod range
  forEachPlayer(world, (entity, otherId) => {
    if (otherId === player.id) return;

    const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
    if (!stageComp || stageComp.stage !== EvolutionStage.MULTI_CELL) return;

    const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
    if (!energyComp || energyComp.current <= 0) return;

    const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
    if (!posComp) return;

    const dist = distance(player.position, { x: posComp.x, y: posComp.y });
    if (dist < enemyResult.dist) {
      enemyResult.target = { id: otherId, position: { x: posComp.x, y: posComp.y } };
      enemyResult.dist = dist;
    }
  });
  const nearestEnemyMultiCell = enemyResult.target;
  const nearestEnemyMultiCellDist = enemyResult.dist;

  // ============================================
  // Ability Usage Decision Logic
  // ============================================

  // EMP: Fire when 2+ active swarms are nearby (disables them for easy consumption)
  if (nearbyActiveSwarmCount >= 2 && abilitySystem.canFireEMP(player.id)) {
    const success = abilitySystem.fireEMP(player.id);
    logger.info({
      event: 'bot_emp_decision',
      botId: player.id,
      triggered: success,
      context: {
        nearbyActiveSwarms: nearbyActiveSwarmCount,
        botEnergy: player.energy,
        reason: 'swarm_cluster',
      },
    });
  }

  // Pseudopod: Fire at nearby enemy multi-cells (territorial control)
  // Or at nearby single-cells that are just out of contact range
  if (abilitySystem.canFirePseudopod(player.id)) {
    if (nearestEnemyMultiCell) {
      // Attack rival multi-cell
      const success = abilitySystem.firePseudopod(
        player.id,
        nearestEnemyMultiCell.position.x,
        nearestEnemyMultiCell.position.y
      );
      logger.info({
        event: 'bot_pseudopod_decision',
        botId: player.id,
        triggered: success,
        context: {
          targetType: 'enemy_multicell',
          targetId: nearestEnemyMultiCell.id,
          targetDistance: nearestEnemyMultiCellDist.toFixed(0),
          botEnergy: player.energy,
          reason: 'territorial_attack',
        },
      });
    } else if (
      nearestPrey &&
      !nearestEnemyMultiCell && // No bigger threats to save pseudopod for
      player.energy > player.maxEnergy * 0.5 && // Plenty of energy to spare
      nearestPreyDist > 200 && // Too far to catch on contact
      nearestPreyDist < 400 // But within pseudopod range
    ) {
      // Low-priority: snipe escaping single-cell only when conditions are favorable
      const success = abilitySystem.firePseudopod(
        player.id,
        nearestPrey.position.x,
        nearestPrey.position.y
      );
      logger.info({
        event: 'bot_pseudopod_decision',
        botId: player.id,
        triggered: success,
        context: {
          targetType: 'single_cell_prey',
          targetId: nearestPrey.id,
          targetDistance: nearestPreyDist.toFixed(0),
          botEnergy: player.energy,
          botEnergyPercent: ((player.energy / player.maxEnergy) * 100).toFixed(0),
          reason: 'opportunistic_snipe',
        },
      });
    }
  }

  // ============================================
  // Movement Decision Logic
  // ============================================

  // Calculate obstacle AND swarm avoidance (multi-cells get larger caution radius)
  const obstacleAvoidance = avoidObstacles(player.position, obstacles, player.stage);
  // Filter out disabled swarms from avoidance - we WANT to approach those to consume them!
  const now = Date.now();
  const activeSwarms = swarms.filter(s => !s.disabledUntil || s.disabledUntil <= now);
  const swarmAvoidance = avoidSwarms(player.position, activeSwarms);
  const avoidance = {
    x: obstacleAvoidance.x + swarmAvoidance.x,
    y: obstacleAvoidance.y + swarmAvoidance.y,
  };

  // PRIORITIZED STEERING: If avoiding, ONLY avoid - don't blend with hunting
  const avoidanceMag = Math.sqrt(avoidance.x * avoidance.x + avoidance.y * avoidance.y);
  const AVOIDANCE_THRESHOLD = 0.1;

  if (avoidanceMag > AVOIDANCE_THRESHOLD) {
    // ESCAPE state - pure avoidance, even multi-cells prioritize survival
    bot.inputDirection.x = avoidance.x / avoidanceMag;
    bot.inputDirection.y = avoidance.y / avoidanceMag;
  } else {
    // Safe zone - decision tree: disabled swarm > prey > nutrient
    if (nearestDisabledSwarm) {
      // Hunt disabled swarm (easy energy)
      const seekDirection = steerTowards(player.position, nearestDisabledSwarm.position, bot.inputDirection);
      bot.inputDirection.x = seekDirection.x;
      bot.inputDirection.y = seekDirection.y;
    } else if (nearestPrey) {
      // Hunt single-cell prey
      const seekDirection = steerTowards(player.position, nearestPrey.position, bot.inputDirection);
      bot.inputDirection.x = seekDirection.x;
      bot.inputDirection.y = seekDirection.y;
    } else {
      // Seek nutrients (fallback behavior)
      const nearestNutrient = findNearestNutrient(player.position, world);
      if (nearestNutrient) {
        const seekDirection = steerTowards(player.position, nearestNutrient.position, bot.inputDirection);
        bot.inputDirection.x = seekDirection.x;
        bot.inputDirection.y = seekDirection.y;
      } else {
        // Wander if nothing to hunt
        updateBotWander(bot, currentTime);
      }
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
}

/**
 * Update all bots' AI decision-making
 * Call this before the movement loop in the game tick
 */
export function updateBots(
  currentTime: number,
  world: World,
  obstacles: Map<string, Obstacle>,
  swarms: EntropySwarm[],
  abilitySystem: AbilitySystem
) {
  // Update single-cell bots (no abilities)
  for (const [botId, bot] of singleCellBots) {
    // Refresh bot.player from ECS (the cached reference goes stale each tick)
    const freshPlayer = getPlayerBySocketId(world, botId);
    if (freshPlayer) {
      bot.player = freshPlayer;
    }
    updateBotAI(bot, currentTime, world, obstacles, swarms);
  }

  // Update multi-cell bots (hunter AI with EMP and pseudopod abilities)
  for (const [botId, bot] of multiCellBots) {
    // Refresh bot.player from ECS (the cached reference goes stale each tick)
    const freshPlayer = getPlayerBySocketId(world, botId);
    if (freshPlayer) {
      bot.player = freshPlayer;
    }
    updateMultiCellBotAI(bot, currentTime, world, obstacles, swarms, abilitySystem);
  }
}

/**
 * Check if a player ID is a bot
 */
export function isBot(playerId: string): boolean {
  return playerId.startsWith('bot-');
}

/**
 * Permanently remove a bot (no respawn) - for dev tools
 */
export function removeBotPermanently(botId: string, io: Server): boolean {
  // Remove from bot tracking (prevents respawn)
  const wasSingleCell = singleCellBots.delete(botId);
  const wasMultiCell = multiCellBots.delete(botId);

  if (!wasSingleCell && !wasMultiCell) {
    return false; // Not a tracked bot
  }

  // Remove from ECS (source of truth) - this removes all components including Input and Velocity
  if (ecsWorld) {
    deletePlayerBySocketId(ecsWorld, botId);
  }

  // Notify clients so they remove the bot immediately
  io.emit('playerLeft', { type: 'playerLeft', playerId: botId });

  logger.info({ event: 'bot_removed_permanently', botId });
  return true;
}

/**
 * Get bot count for debugging
 */
export function getBotCount(): number {
  return singleCellBots.size + multiCellBots.size;
}

/**
 * Handle bot death - schedule auto-respawn after delay
 * @param cause - What killed the bot (for death rate tracking)
 */
export function handleBotDeath(
  botId: string,
  cause: DeathCause,
  io: Server
) {
  if (!ecsWorld) {
    logger.warn({ event: 'bot_death_no_ecs', botId });
    return;
  }

  // Check if it's a single-cell bot
  const singleCellBot = singleCellBots.get(botId);
  if (singleCellBot) {
    logBotDeath(botId, cause, EvolutionStage.SINGLE_CELL);
    clearSpawnTime(botId); // Clear evolution tracking on death

    // Schedule single-cell bot respawn
    setTimeout(() => {
      if (!ecsWorld) return;

      // Get ECS components
      const posComp = getPositionBySocketId(ecsWorld, botId);
      const energyComp = getEnergyBySocketId(ecsWorld, botId);
      const stageComp = getStageBySocketId(ecsWorld, botId);

      if (!posComp || !energyComp || !stageComp) return; // Bot was removed from game

      // Reset to single-cell at random spawn (energy-only system) via ECS
      const newPos = randomSpawnPosition();
      posComp.x = newPos.x;
      posComp.y = newPos.y;
      energyComp.current = GAME_CONFIG.SINGLE_CELL_ENERGY;
      energyComp.max = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
      stageComp.stage = EvolutionStage.SINGLE_CELL;
      stageComp.isEvolving = false;

      // Reset input direction and velocity
      singleCellBot.inputDirection.x = 0;
      singleCellBot.inputDirection.y = 0;
      singleCellBot.velocity.x = 0;
      singleCellBot.velocity.y = 0;

      // Reset AI state
      singleCellBot.ai.state = 'wander';
      singleCellBot.ai.targetNutrient = undefined;
      singleCellBot.ai.nextWanderChange = Date.now();

      // Get fresh Player object from ECS for broadcast
      const player = getPlayerBySocketId(ecsWorld, botId);
      if (!player) return;

      // Update BotController's player reference
      singleCellBot.player = player;

      // Broadcast respawn to all clients
      const respawnMessage: PlayerRespawnedMessage = {
        type: 'playerRespawned',
        player: { ...player },
      };
      io.emit('playerRespawned', respawnMessage);

      // Track new spawn time for evolution rate tracking
      recordSpawn(botId, EvolutionStage.SINGLE_CELL);

      logBotRespawn(botId);
    }, BOT_CONFIG.RESPAWN_DELAY);
    return;
  }

  // Check if it's a multi-cell bot
  const multiCellBot = multiCellBots.get(botId);
  if (multiCellBot) {
    logBotDeath(botId, cause, EvolutionStage.MULTI_CELL);
    clearSpawnTime(botId); // Clear evolution tracking on death

    // Schedule multi-cell bot respawn (longer delay)
    setTimeout(() => {
      if (!ecsWorld) return;

      // Get ECS components
      const posComp = getPositionBySocketId(ecsWorld, botId);
      const energyComp = getEnergyBySocketId(ecsWorld, botId);
      const stageComp = getStageBySocketId(ecsWorld, botId);

      if (!posComp || !energyComp || !stageComp) return; // Bot was removed from game

      // Respawn as multi-cell (Stage 2) - energy-only system via ECS
      const newPos = randomSpawnPosition();
      posComp.x = newPos.x;
      posComp.y = newPos.y;
      energyComp.current = GAME_CONFIG.MULTI_CELL_ENERGY;
      energyComp.max = GAME_CONFIG.MULTI_CELL_MAX_ENERGY;
      stageComp.stage = EvolutionStage.MULTI_CELL;
      stageComp.isEvolving = false;

      // Reset input direction and velocity
      multiCellBot.inputDirection.x = 0;
      multiCellBot.inputDirection.y = 0;
      multiCellBot.velocity.x = 0;
      multiCellBot.velocity.y = 0;

      // Reset AI state
      multiCellBot.ai.state = 'wander';
      multiCellBot.ai.targetNutrient = undefined;
      multiCellBot.ai.nextWanderChange = Date.now();

      // Get fresh Player object from ECS for broadcast
      const player = getPlayerBySocketId(ecsWorld, botId);
      if (!player) return;

      // Update BotController's player reference
      multiCellBot.player = player;

      // Broadcast respawn to all clients
      const respawnMessage: PlayerRespawnedMessage = {
        type: 'playerRespawned',
        player: { ...player },
      };
      io.emit('playerRespawned', respawnMessage);

      // Track new spawn time for evolution rate tracking
      recordSpawn(botId, EvolutionStage.MULTI_CELL);

      logBotRespawn(botId);
    }, BOT_CONFIG.STAGE2_RESPAWN_DELAY);
    return;
  }
}
