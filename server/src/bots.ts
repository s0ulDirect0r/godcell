import { GAME_CONFIG, EvolutionStage, distanceForMode } from '#shared';
import type {
  Player,
  Position,
  EntropySwarm,
  PlayerJoinedMessage,
  PlayerRespawnedMessage,
  DeathCause,
  NutrientComponent,
  MeleeAttackType,
} from '#shared';
import type { Server } from 'socket.io';
import {
  logBotsSpawned,
  logBotDeath,
  logBotRespawn,
  logger,
  recordSpawn,
  clearSpawnTime,
} from './logger';
import { getConfig } from './dev';
import {
  createBot as ecsCreateBot,
  getPlayerBySocketId,
  getEnergyBySocketId,
  getPositionBySocketId,
  getStageBySocketId,
  getVelocityBySocketId,
  getInputBySocketId,
  deletePlayerBySocketId,
  getEntityBySocketId,
  forEachPlayer,
  getStringIdByEntity,
  getAllObstacleSnapshots,
  tryAddAbilityIntent,
  Components,
  Tags,
  type World,
  type ObstacleSnapshot,
} from './ecs';
import type { EnergyComponent, PositionComponent, StageComponent } from '#shared';
import { randomSpawnPosition as helperRandomSpawnPosition } from './helpers';
import {
  canFireEMP,
  canFirePseudopod,
  canFireProjectile,
  canFireMeleeAttack,
  canPlaceTrap,
} from './abilities';

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
    lastSampleTime: number; // Last telemetry sample time for this bot
  };
}

// All AI bots currently in the game
const singleCellBots: Map<string, BotController> = new Map();

// Multi-cell bots (separate tracking for population management)
const multiCellBots: Map<string, BotController> = new Map();

// Cyber-organism bots (Stage 3 - jungle hunters with combat specialization)
const cyberOrganismBots: Map<string, BotController> = new Map();

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
  STAGE3_COUNT: 2, // Number of Stage 3 cyber-organism bots (jungle hunters)
  SEARCH_RADIUS: 800, // How far bots can see nutrients (doubled from 400 to find food faster)
  JUNGLE_SEARCH_RADIUS: 1200, // How far Stage 3 bots can see fauna (larger jungle scale)
  WANDER_CHANGE_MIN: 1000, // Min time between direction changes (ms)
  WANDER_CHANGE_MAX: 3000, // Max time between direction changes (ms)
  RESPAWN_DELAY: 3000, // How long to wait before respawning dead Stage 1 bots (ms)
  STAGE2_RESPAWN_DELAY: 5000, // How long to wait before respawning dead Stage 2 bots (ms)
  STAGE3_RESPAWN_DELAY: 8000, // How long to wait before respawning dead Stage 3 bots (ms)
};

// ============================================
// Bot Decision Sampling (for telemetry)
// ============================================
// Log ~1 decision per bot per second
const BOT_SAMPLE_INTERVAL_MS = 1000;
const shouldSampleDecision = (bot: BotController, currentTime: number): boolean => {
  if (currentTime - bot.ai.lastSampleTime >= BOT_SAMPLE_INTERVAL_MS) {
    bot.ai.lastSampleTime = currentTime;
    return true;
  }
  return false;
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

// NOTE: isSpawnSafe removed - spawn safety is handled by randomSpawnPosition via ECS getObstacleZones

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
      lastSampleTime: 0,
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
      lastSampleTime: 0,
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

/**
 * Generate a random spawn position in the jungle (outside the soup)
 * For Stage 3+ bots that live in the larger jungle world
 */
function randomJungleSpawnPosition(): Position {
  const padding = 500;

  // Soup region to avoid (Stage 3 bots don't belong in the soup)
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X - 200;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH + 200;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y - 200;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT + 200;

  let x: number;
  let y: number;
  let attempts = 0;

  do {
    x = padding + Math.random() * (GAME_CONFIG.JUNGLE_WIDTH - 2 * padding);
    y = padding + Math.random() * (GAME_CONFIG.JUNGLE_HEIGHT - 2 * padding);
    attempts++;

    // Check if in soup region
    const inSoup = x > soupMinX && x < soupMaxX && y > soupMinY && y < soupMaxY;
    if (!inSoup) break;
  } while (attempts < 50);

  return { x, y };
}

/**
 * Spawn a cyber-organism bot (Stage 3) with ranged specialization
 * These bots hunt in the jungle using projectiles
 */
function spawnCyberOrganismBot(io: Server): BotController {
  if (!ecsWorld) {
    throw new Error('ECS world not set - call setBotEcsWorld before spawning bots');
  }

  // Generate unique bot ID
  const botId = `bot-cyber-${Math.random().toString(36).substr(2, 9)}`;
  const botColor = randomColor();
  const spawnPosition = randomJungleSpawnPosition();

  // Create bot in ECS at Stage 3 (cyber-organism)
  ecsCreateBot(ecsWorld, botId, botId, botColor, spawnPosition, EvolutionStage.CYBER_ORGANISM);

  // Randomly choose combat specialization (like a real player would)
  const specializations: Array<'melee' | 'ranged' | 'traps'> = ['melee', 'ranged', 'traps'];
  const chosenSpec = specializations[Math.floor(Math.random() * specializations.length)];

  const entity = ecsWorld.query(Components.Player).find((e) => {
    const p = ecsWorld!.getComponent<{ socketId: string }>(e, Components.Player);
    return p?.socketId === botId;
  });
  if (entity !== undefined) {
    ecsWorld.addComponent(entity, Components.CombatSpecialization, {
      specialization: chosenSpec,
      selectionPending: false,
      selectionDeadline: 0,
    });
  }

  // Get the legacy Player object from ECS for BotController reference
  const botPlayer = getPlayerBySocketId(ecsWorld, botId);
  if (!botPlayer) {
    throw new Error(`Failed to create cyber-organism bot ${botId} in ECS`);
  }

  // Get ECS components for direct mutation by bot AI
  const inputComponent = getInputBySocketId(ecsWorld, botId);
  const velocityComponent = getVelocityBySocketId(ecsWorld, botId);
  if (!inputComponent || !velocityComponent) {
    throw new Error(`Failed to get ECS components for cyber-organism bot ${botId}`);
  }

  // Create bot controller with AI state
  const bot: BotController = {
    player: botPlayer,
    inputDirection: inputComponent.direction,
    velocity: velocityComponent,
    ai: {
      state: 'wander',
      wanderDirection: { x: 0, y: 0 },
      nextWanderChange: Date.now(),
      lastSampleTime: 0,
    },
  };

  cyberOrganismBots.set(botId, bot);

  // Broadcast to all clients
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: botPlayer,
  };
  io.emit('playerJoined', joinMessage);

  // Track spawn time
  recordSpawn(botId, EvolutionStage.CYBER_ORGANISM);

  logger.info({
    event: 'bot_cyber_organism_spawned',
    botId,
    position: spawnPosition,
    specialization: chosenSpec,
  });

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
 * Fast nutrient lookup from pre-collected array (avoids ECS queries per bot)
 * Uses squared distance to avoid sqrt in hot loop
 */
function findNearestNutrientFast(
  botPosition: Position,
  nutrients: NutrientSnapshot[]
): NutrientSnapshot | null {
  let nearest: NutrientSnapshot | null = null;
  let nearestDistSq = BOT_CONFIG.SEARCH_RADIUS * BOT_CONFIG.SEARCH_RADIUS;

  for (const nutrient of nutrients) {
    const dx = botPosition.x - nutrient.x;
    const dy = botPosition.y - nutrient.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearest = nutrient;
      nearestDistSq = distSq;
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
 * Bots start avoiding shortly before the event horizon and ramp up to
 * full-thrust escape as they cross it. Multi-cells use a larger caution
 * radius (350px) than single-cells (265px) because they're bigger/slower.
 * NOTE: obstacles migrated to ECS - uses ObstacleSnapshot array
 */
function avoidObstacles(
  botPosition: Position,
  obstacles: ObstacleSnapshot[],
  stage: EvolutionStage = EvolutionStage.SINGLE_CELL
): { x: number; y: number } {
  const avoidanceForce = { x: 0, y: 0 };

  for (const obstacle of obstacles) {
    const dist = distanceForMode(botPosition, obstacle.position);

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
  const avoidanceForce = { x: 0, y: 0 };

  for (const swarm of swarms) {
    const dist = distanceForMode(botPosition, swarm.position);

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

function avoidSwarms(botPosition: Position, swarms: EntropySwarm[]): { x: number; y: number } {
  const avoidanceForce = { x: 0, y: 0 };

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
    const currentDist = distanceForMode(botPosition, swarm.position);
    const predictedDist = distanceForMode(botPosition, predictedPosition);

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
      avoidanceStrength =
        0.6 + (0.4 * (threatRadius - effectiveDist)) / (threatRadius - contactRadius);
    } else {
      // Gentle avoidance at edge of detection range
      avoidanceStrength = (0.3 * (cautionRadius - effectiveDist)) / (cautionRadius - threatRadius);
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
 * NOTE: obstacles migrated to ECS - receives ObstacleSnapshot array
 */
function updateBotAI(
  bot: BotController,
  currentTime: number,
  obstacles: ObstacleSnapshot[],
  swarms: EntropySwarm[],
  nutrients: NutrientSnapshot[]
) {
  const player = bot.player;

  // Skip dead or evolving bots
  if (player.energy <= 0 || player.isEvolving) {
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    return;
  }

  // Single-cell bots: Avoid singularities + emergency swarm escape
  // They're hungry and accept swarm risk, but will juke to break contact when caught
  const obstacleAvoidance = avoidObstacles(player.position, obstacles);
  const emergencySwarmAvoidance = avoidSwarmsEmergencyOnly(player.position, swarms);
  const avoidance = {
    x: obstacleAvoidance.x + emergencySwarmAvoidance.x,
    y: obstacleAvoidance.y + emergencySwarmAvoidance.y,
  };

  // PRIORITIZED STEERING - but HUNGRY by default
  // Only pure escape when REALLY close to singularity (> 0.8)
  // Otherwise blend avoidance with seeking - bots gotta eat!
  const avoidanceMag = Math.sqrt(avoidance.x * avoidance.x + avoidance.y * avoidance.y);
  const AVOIDANCE_PRIORITY_THRESHOLD = 0.8; // Only escape when in REAL danger
  const AVOIDANCE_BLEND_THRESHOLD = 0.1; // Below this = pure seeking

  if (avoidanceMag > AVOIDANCE_PRIORITY_THRESHOLD) {
    // HIGH DANGER - pure escape mode, ignore seeking
    bot.ai.state = 'wander';
    bot.ai.targetNutrient = undefined;
    bot.inputDirection.x = avoidance.x / avoidanceMag;
    bot.inputDirection.y = avoidance.y / avoidanceMag;
  } else if (avoidanceMag > AVOIDANCE_BLEND_THRESHOLD) {
    // MODERATE DANGER - blend avoidance with seeking (SEEKING weighted higher - hungry bots!)
    const nearestNutrient = findNearestNutrientFast(player.position, nutrients);
    if (nearestNutrient) {
      bot.ai.state = 'seek_nutrient';
      bot.ai.targetNutrient = nearestNutrient.id;
      const seekDirection = steerTowards(
        player.position,
        { x: nearestNutrient.x, y: nearestNutrient.y },
        bot.inputDirection
      );
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
    const nearestNutrient = findNearestNutrientFast(player.position, nutrients);

    if (nearestNutrient) {
      // SEEK state - move towards nutrient
      bot.ai.state = 'seek_nutrient';
      bot.ai.targetNutrient = nearestNutrient.id;

      // Steer towards target (returns direction vector, not velocity)
      const seekDirection = steerTowards(
        player.position,
        { x: nearestNutrient.x, y: nearestNutrient.y },
        bot.inputDirection
      );

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

  // Sample bot decisions for telemetry (~1/sec per bot)
  if (shouldSampleDecision(bot, currentTime)) {
    // Compute nearest nutrient distance for logging
    const nearestNutrient = findNearestNutrientFast(player.position, nutrients);
    const nearestNutrientDist = nearestNutrient
      ? distanceForMode(player.position, { x: nearestNutrient.x, y: nearestNutrient.y })
      : null;

    logger.info({
      event: 'bot_decision',
      botId: player.id,
      stage: 'single-cell',
      state: bot.ai.state,
      target: bot.ai.targetNutrient ?? null,
      avoidanceMag: avoidanceMag.toFixed(2),
      energy: player.energy,
      nearestNutrientDist: nearestNutrientDist ? nearestNutrientDist.toFixed(0) : null,
    });
  }

  // Normalize final direction (don't let combined forces create super-speed)
  const dirLength = Math.sqrt(
    bot.inputDirection.x * bot.inputDirection.x + bot.inputDirection.y * bot.inputDirection.y
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
export function spawnBotAt(io: Server, position: Position, stage: EvolutionStage): string {
  if (!ecsWorld) {
    throw new Error('ECS world not set - call setBotEcsWorld before spawning bots');
  }

  const isCyber = stage >= EvolutionStage.CYBER_ORGANISM;
  const isMultiCell = stage === EvolutionStage.MULTI_CELL;
  const botId = isCyber
    ? `bot-cyber-${Math.random().toString(36).substr(2, 9)}`
    : isMultiCell
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
      lastSampleTime: 0,
    },
  };

  // Track in appropriate bot map and assign specialization for cyber bots
  if (isCyber) {
    cyberOrganismBots.set(botId, bot);
    // Assign combat specialization for cyber bots
    const entity = ecsWorld.query(Components.Player).find((e) => {
      const p = ecsWorld!.getComponent<{ socketId: string }>(e, Components.Player);
      return p?.socketId === botId;
    });
    if (entity !== undefined) {
      const specializations: Array<'melee' | 'ranged' | 'traps'> = ['melee', 'ranged', 'traps'];
      const chosenSpec = specializations[Math.floor(Math.random() * specializations.length)];
      ecsWorld.addComponent(entity, Components.CombatSpecialization, {
        specialization: chosenSpec,
        selectionPending: false,
        selectionDeadline: 0,
      });
    }
  } else if (isMultiCell) {
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

  // Spawn multi-cell bots (Stage 2)
  for (let i = 0; i < BOT_CONFIG.STAGE2_COUNT; i++) {
    spawnMultiCellBot(io);
  }

  // Spawn cyber-organism bots (Stage 3 - jungle hunters)
  for (let i = 0; i < BOT_CONFIG.STAGE3_COUNT; i++) {
    spawnCyberOrganismBot(io);
  }

  logBotsSpawned(BOT_CONFIG.COUNT + BOT_CONFIG.STAGE2_COUNT + BOT_CONFIG.STAGE3_COUNT);
}

/**
 * Update multi-cell bot AI - hunts single-cells, uses EMP, devours swarms
 * NOTE: obstacles migrated to ECS - receives ObstacleSnapshot array
 */
function updateMultiCellBotAI(
  bot: BotController,
  currentTime: number,
  world: World,
  obstacles: ObstacleSnapshot[],
  swarms: EntropySwarm[],
  nutrients: NutrientSnapshot[]
) {
  const player = bot.player;

  // Skip dead or evolving bots
  if (player.energy <= 0 || player.isEvolving) {
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    return;
  }

  // Look up entity at start for ability calls
  const botEntity = getEntityBySocketId(player.id);
  if (botEntity === undefined) return;

  // Multi-cells hunt single-cells and nutrients
  // Priority: 1. Disabled swarms (easy energy), 2. Single-cells (prey), 3. Nutrients

  // Find best disabled swarm target (prioritize high-energy swarms for max reward)
  // Swarms with 500+ energy give 375+ maxEnergy when consumed - extremely valuable!
  let bestDisabledSwarm: EntropySwarm | null = null;
  let bestDisabledSwarmScore = 0; // Score = energy / distance (fat + close = best)
  const SWARM_HUNT_RANGE = 900; // Increased range - worth traveling for fat swarms
  for (const swarm of swarms) {
    if (swarm.disabledUntil && swarm.disabledUntil > Date.now()) {
      const dist = distanceForMode(player.position, swarm.position);
      if (dist < SWARM_HUNT_RANGE) {
        // Score: energy matters more than distance (fat swarms are VERY valuable)
        const score = (swarm.energy || 100) / Math.max(dist, 100);
        if (score > bestDisabledSwarmScore) {
          bestDisabledSwarm = swarm;
          bestDisabledSwarmScore = score;
        }
      }
    }
  }

  // Find nearby active swarms and their total energy for EMP decision
  const empRange = getConfig('EMP_RANGE');
  let nearbyActiveSwarmCount = 0;
  let nearbyActiveSwarmTotalEnergy = 0;
  let fatSwarmNearby: EntropySwarm | null = null;
  for (const swarm of swarms) {
    const isDisabled = swarm.disabledUntil && swarm.disabledUntil > Date.now();
    if (!isDisabled) {
      const dist = distanceForMode(player.position, swarm.position);
      if (dist < empRange) {
        nearbyActiveSwarmCount++;
        nearbyActiveSwarmTotalEnergy += swarm.energy || 100;
        // Track if any single fat swarm is worth an EMP
        if ((swarm.energy || 100) >= 400 && !fatSwarmNearby) {
          fatSwarmNearby = swarm;
        }
      }
    }
  }

  // Find nearest single-cell (prey)
  // Using object wrapper to help TypeScript track mutations inside callback
  const preyResult: {
    target: {
      id: string;
      position: { x: number; y: number };
      energy: number;
      maxEnergy: number;
    } | null;
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

    const dist = distanceForMode(player.position, { x: posComp.x, y: posComp.y });
    if (dist < preyResult.dist) {
      preyResult.target = {
        id: otherId,
        position: { x: posComp.x, y: posComp.y },
        energy: energyComp.current,
        maxEnergy: energyComp.max,
      };
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

    const dist = distanceForMode(player.position, { x: posComp.x, y: posComp.y });
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

  // EMP: More aggressive - fire at fat swarms or clusters
  // - Fire at 2+ swarms (cluster = good value)
  // - Fire at single 400+ energy swarm (fat swarm = high value target)
  // - Fire if total nearby energy > 600 (worth it even for just 2 medium swarms)
  const shouldEMP =
    nearbyActiveSwarmCount >= 2 || fatSwarmNearby !== null || nearbyActiveSwarmTotalEnergy >= 600;
  if (
    shouldEMP &&
    canFireEMP(world, botEntity) &&
    tryAddAbilityIntent(world, botEntity, { abilityType: 'emp' })
  ) {
    logger.info({
      event: 'bot_emp_decision',
      botId: player.id,
      intentAdded: true,
      context: {
        nearbyActiveSwarms: nearbyActiveSwarmCount,
        nearbySwarmEnergy: nearbyActiveSwarmTotalEnergy,
        hasFatSwarm: fatSwarmNearby !== null,
        fatSwarmEnergy: fatSwarmNearby?.energy,
        botEnergy: player.energy,
        reason: fatSwarmNearby
          ? 'fat_swarm_target'
          : nearbyActiveSwarmTotalEnergy >= 600
            ? 'high_value_cluster'
            : 'swarm_cluster',
      },
    });
  }

  // Pseudopod: Fire at nearby enemy multi-cells (territorial control)
  // Or at nearby single-cells that are just out of contact range
  // Check canFirePseudopod first to avoid spamming failed intents every tick
  if (canFirePseudopod(world, botEntity)) {
    if (nearestEnemyMultiCell) {
      // Attack rival multi-cell
      if (
        tryAddAbilityIntent(world, botEntity, {
          abilityType: 'pseudopod',
          targetX: nearestEnemyMultiCell.position.x,
          targetY: nearestEnemyMultiCell.position.y,
        })
      ) {
        logger.info({
          event: 'bot_pseudopod_decision',
          botId: player.id,
          intentAdded: true,
          context: {
            targetType: 'enemy_multicell',
            targetId: nearestEnemyMultiCell.id,
            targetDistance: nearestEnemyMultiCellDist.toFixed(0),
            botEnergy: player.energy,
            reason: 'territorial_attack',
          },
        });
      }
    } else if (
      nearestPrey &&
      player.energy > player.maxEnergy * 0.5 && // Plenty of energy to spare
      nearestPreyDist > 200 && // Too far to catch on contact
      nearestPreyDist < 400 // But within pseudopod range
    ) {
      // Low-priority: snipe escaping single-cell only when conditions are favorable
      if (
        tryAddAbilityIntent(world, botEntity, {
          abilityType: 'pseudopod',
          targetX: nearestPrey.position.x,
          targetY: nearestPrey.position.y,
        })
      ) {
        logger.info({
          event: 'bot_pseudopod_decision',
          botId: player.id,
          intentAdded: true,
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
  }

  // ============================================
  // Movement Decision Logic
  // ============================================

  // Calculate obstacle AND swarm avoidance (multi-cells get larger caution radius)
  const obstacleAvoidance = avoidObstacles(player.position, obstacles, player.stage);
  // Filter out disabled swarms from avoidance - we WANT to approach those to consume them!
  const now = Date.now();
  const activeSwarms = swarms.filter((s) => !s.disabledUntil || s.disabledUntil <= now);
  const swarmAvoidance = avoidSwarms(player.position, activeSwarms);
  const avoidance = {
    x: obstacleAvoidance.x + swarmAvoidance.x,
    y: obstacleAvoidance.y + swarmAvoidance.y,
  };

  // PRIORITIZED STEERING: If avoiding, ONLY avoid - don't blend with hunting
  const avoidanceMag = Math.sqrt(avoidance.x * avoidance.x + avoidance.y * avoidance.y);
  const AVOIDANCE_THRESHOLD = 0.1;

  // Track action for telemetry
  let action: 'escape' | 'hunt_disabled_swarm' | 'hunt_prey' | 'seek_nutrient' | 'wander' = 'wander';
  let targetType: 'swarm' | 'single_cell' | 'nutrient' | null = null;
  let targetDist: number | null = null;

  if (avoidanceMag > AVOIDANCE_THRESHOLD) {
    // ESCAPE state - pure avoidance, even multi-cells prioritize survival
    action = 'escape';
    bot.inputDirection.x = avoidance.x / avoidanceMag;
    bot.inputDirection.y = avoidance.y / avoidanceMag;
  } else {
    // Safe zone - decision tree: disabled swarm > prey > nutrient
    if (bestDisabledSwarm) {
      // Hunt disabled swarm (easy energy) - prioritizes high-energy targets
      action = 'hunt_disabled_swarm';
      targetType = 'swarm';
      targetDist = distanceForMode(player.position, bestDisabledSwarm.position);
      const seekDirection = steerTowards(
        player.position,
        bestDisabledSwarm.position,
        bot.inputDirection
      );
      bot.inputDirection.x = seekDirection.x;
      bot.inputDirection.y = seekDirection.y;
    } else if (nearestPrey) {
      // Hunt single-cell prey
      action = 'hunt_prey';
      targetType = 'single_cell';
      targetDist = nearestPreyDist;
      const seekDirection = steerTowards(player.position, nearestPrey.position, bot.inputDirection);
      bot.inputDirection.x = seekDirection.x;
      bot.inputDirection.y = seekDirection.y;
    } else {
      // Seek nutrients (fallback behavior) - use pre-collected array
      const nearestNutrient = findNearestNutrientFast(player.position, nutrients);
      if (nearestNutrient) {
        action = 'seek_nutrient';
        targetType = 'nutrient';
        targetDist = distanceForMode(player.position, { x: nearestNutrient.x, y: nearestNutrient.y });
        const seekDirection = steerTowards(
          player.position,
          { x: nearestNutrient.x, y: nearestNutrient.y },
          bot.inputDirection
        );
        bot.inputDirection.x = seekDirection.x;
        bot.inputDirection.y = seekDirection.y;
      } else {
        // Wander if nothing to hunt
        action = 'wander';
        updateBotWander(bot, currentTime);
      }
    }
  }

  // Sample bot decisions for telemetry (~1/sec per bot)
  if (shouldSampleDecision(bot, currentTime)) {
    logger.info({
      event: 'bot_decision',
      botId: player.id,
      stage: 'multi-cell',
      action,
      targetType,
      targetDist: targetDist ? targetDist.toFixed(0) : null,
      avoidanceMag: avoidanceMag.toFixed(2),
      energy: player.energy,
      nearbyActiveSwarms: nearbyActiveSwarmCount,
    });
  }

  // Normalize direction
  const dirLength = Math.sqrt(
    bot.inputDirection.x * bot.inputDirection.x + bot.inputDirection.y * bot.inputDirection.y
  );
  if (dirLength > 1) {
    bot.inputDirection.x /= dirLength;
    bot.inputDirection.y /= dirLength;
  }
}

// Fauna snapshot for cyber-organism bot AI (jungle targets)
interface FaunaSnapshot {
  id: string;
  x: number;
  y: number;
  type: 'bug' | 'creature' | 'fruit' | 'player';
}

/**
 * Update cyber-organism bot AI (Stage 3)
 * Hunts fauna in the jungle using combat specialization abilities.
 * These bots can't see/interact with soup entities - only jungle fauna and Stage 3+ players.
 *
 * AI behavior varies by specialization:
 * - Ranged: Keep medium distance, fire projectiles
 * - Melee: Chase and attack at close range
 * - Traps: Place traps, kite enemies into them
 */
function updateCyberOrganismBotAI(
  bot: BotController,
  currentTime: number,
  world: World,
  fauna: FaunaSnapshot[]
) {
  const player = bot.player;

  // Skip dead or evolving bots
  if (player.energy <= 0 || player.isEvolving) {
    bot.inputDirection.x = 0;
    bot.inputDirection.y = 0;
    return;
  }

  // Look up entity at start for ability calls
  const botEntity = getEntityBySocketId(player.id);
  if (botEntity === undefined) return;

  const specComp = world.getComponent<{ specialization: 'melee' | 'ranged' | 'traps' | null }>(
    botEntity,
    Components.CombatSpecialization
  );
  const specialization = specComp?.specialization || 'ranged';

  // Find nearest fauna target
  let nearestTarget: FaunaSnapshot | null = null;
  let nearestDist = BOT_CONFIG.JUNGLE_SEARCH_RADIUS;

  for (const target of fauna) {
    const dx = player.position.x - target.x;
    const dy = player.position.y - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist) {
      nearestTarget = target;
      nearestDist = dist;
    }
  }

  // Track action for telemetry
  let action: 'approach' | 'retreat' | 'strafe' | 'chase' | 'kite' | 'wander' = 'wander';

  // Behavior based on specialization
  if (specialization === 'ranged') {
    // RANGED: Keep medium distance, fire projectiles
    const projectileRange = getConfig('PROJECTILE_MAX_DISTANCE');
    const idealDistance = projectileRange * 0.5; // Stay at ~400px

    if (nearestTarget) {
      // Fire if in range and off cooldown
      if (nearestDist < projectileRange * 0.8 && canFireProjectile(world, botEntity)) {
        if (tryAddAbilityIntent(world, botEntity, {
          abilityType: 'projectile',
          targetX: nearestTarget.x,
          targetY: nearestTarget.y,
        })) {
          logger.info({
            event: 'bot_projectile_decision',
            botId: player.id,
            intentAdded: true,
            context: {
              targetDistance: nearestDist.toFixed(0),
              botEnergy: player.energy,
              specialization: 'ranged',
            },
          });
        }
      }

      // Movement: approach if too far, retreat if too close
      if (nearestDist > idealDistance + 100) {
        // Too far - approach
        action = 'approach';
        const seekDir = steerTowards(
          player.position,
          { x: nearestTarget.x, y: nearestTarget.y },
          bot.inputDirection
        );
        bot.inputDirection.x = seekDir.x;
        bot.inputDirection.y = seekDir.y;
      } else if (nearestDist < idealDistance - 100) {
        // Too close - retreat while still facing target
        action = 'retreat';
        const dx = player.position.x - nearestTarget.x;
        const dy = player.position.y - nearestTarget.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          bot.inputDirection.x = dx / len;
          bot.inputDirection.y = dy / len;
        }
      } else {
        // Good distance - strafe slowly
        action = 'strafe';
        const dx = nearestTarget.x - player.position.x;
        const dy = nearestTarget.y - player.position.y;
        // Perpendicular strafe
        bot.inputDirection.x = -dy * 0.3;
        bot.inputDirection.y = dx * 0.3;
      }
    } else {
      action = 'wander';
      updateBotWander(bot, currentTime);
    }
  } else if (specialization === 'melee') {
    // MELEE: Chase and attack at close range
    const meleeRange = 120; // Close range for melee attacks

    if (nearestTarget) {
      // Attack if in melee range and can fire
      if (nearestDist < meleeRange && canFireMeleeAttack(world, botEntity)) {
        const attackType: MeleeAttackType = Math.random() < 0.6 ? 'swipe' : 'thrust';
        if (tryAddAbilityIntent(world, botEntity, {
          abilityType: 'melee',
          meleeAttackType: attackType,
          targetX: nearestTarget.x,
          targetY: nearestTarget.y,
        })) {
          logger.info({
            event: 'bot_melee_decision',
            botId: player.id,
            intentAdded: true,
            context: {
              attackType,
              targetDistance: nearestDist.toFixed(0),
              botEnergy: player.energy,
              specialization: 'melee',
            },
          });
        }
      }

      // Always chase - melee wants to close distance
      action = 'chase';
      const seekDir = steerTowards(
        player.position,
        { x: nearestTarget.x, y: nearestTarget.y },
        bot.inputDirection,
        0.2
      );
      bot.inputDirection.x = seekDir.x;
      bot.inputDirection.y = seekDir.y;
    } else {
      action = 'wander';
      updateBotWander(bot, currentTime);
    }
  } else if (specialization === 'traps') {
    // TRAPS: Place traps, kite enemies into them
    const trapTriggerRadius = getConfig('TRAP_TRIGGER_RADIUS') || 100;

    if (nearestTarget) {
      // Place trap if enemy is approaching and we can place one
      if (
        nearestDist < 300 &&
        nearestDist > trapTriggerRadius &&
        canPlaceTrap(world, botEntity, player.id)
      ) {
        if (tryAddAbilityIntent(world, botEntity, { abilityType: 'trap' })) {
          logger.info({
            event: 'bot_trap_decision',
            botId: player.id,
            intentAdded: true,
            context: {
              targetDistance: nearestDist.toFixed(0),
              botEnergy: player.energy,
              specialization: 'traps',
            },
          });
        }
      }

      // Kite behavior: retreat while leading enemy through traps
      if (nearestDist < 200) {
        // Too close - retreat
        action = 'retreat';
        const dx = player.position.x - nearestTarget.x;
        const dy = player.position.y - nearestTarget.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          bot.inputDirection.x = dx / len;
          bot.inputDirection.y = dy / len;
        }
      } else if (nearestDist < 400) {
        // Medium range - circle/strafe to reposition
        action = 'kite';
        const dx = nearestTarget.x - player.position.x;
        const dy = nearestTarget.y - player.position.y;
        // Perpendicular movement with slight retreat
        bot.inputDirection.x = -dy * 0.5 + dx * -0.3;
        bot.inputDirection.y = dx * 0.5 + dy * -0.3;
      } else {
        // Far away - approach cautiously to lure into trap range
        action = 'approach';
        const seekDir = steerTowards(
          player.position,
          { x: nearestTarget.x, y: nearestTarget.y },
          bot.inputDirection,
          0.1
        );
        bot.inputDirection.x = seekDir.x * 0.5;
        bot.inputDirection.y = seekDir.y * 0.5;
      }
    } else {
      action = 'wander';
      updateBotWander(bot, currentTime);
    }
  }

  // Sample bot decisions for telemetry (~1/sec per bot)
  if (shouldSampleDecision(bot, currentTime)) {
    logger.info({
      event: 'bot_decision',
      botId: player.id,
      stage: 'cyber-organism',
      specialization,
      action,
      targetType: nearestTarget?.type ?? null,
      targetDist: nearestTarget ? nearestDist.toFixed(0) : null,
      energy: player.energy,
    });
  }

  // Normalize direction
  const cyberDirLength = Math.sqrt(
    bot.inputDirection.x * bot.inputDirection.x + bot.inputDirection.y * bot.inputDirection.y
  );
  if (cyberDirLength > 1) {
    bot.inputDirection.x /= cyberDirLength;
    bot.inputDirection.y /= cyberDirLength;
  }
}

/**
 * Update all bots' AI decision-making
 * Call this before the movement loop in the game tick
 * NOTE: obstacles migrated to ECS - queries ECS directly
 */
// Simple nutrient snapshot for bot AI (avoids re-querying ECS per bot)
interface NutrientSnapshot {
  id: string;
  x: number;
  y: number;
  value: number;
}

export function updateBots(currentTime: number, world: World, swarms: EntropySwarm[]) {
  // Query obstacles from ECS once per tick (shared across all bots)
  const obstacles = getAllObstacleSnapshots(world);

  // Pre-collect nutrients once per tick (avoids O(bots × nutrients) queries)
  const nutrients: NutrientSnapshot[] = [];
  world.forEachWithTag(Tags.Nutrient, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const nutrientComp = world.getComponent<NutrientComponent>(entity, Components.Nutrient);
    const id = getStringIdByEntity(entity);
    if (pos && nutrientComp && id) {
      nutrients.push({ id, x: pos.x, y: pos.y, value: nutrientComp.value });
    }
  });

  // Update single-cell bots (no abilities)
  for (const [botId, bot] of singleCellBots) {
    // Refresh bot.player from ECS (the cached reference goes stale each tick)
    const freshPlayer = getPlayerBySocketId(world, botId);
    if (freshPlayer) {
      bot.player = freshPlayer;
    }
    updateBotAI(bot, currentTime, obstacles, swarms, nutrients);
  }

  // Update multi-cell bots (hunter AI with EMP and pseudopod abilities)
  for (const [botId, bot] of multiCellBots) {
    // Refresh bot.player from ECS (the cached reference goes stale each tick)
    const freshPlayer = getPlayerBySocketId(world, botId);
    if (freshPlayer) {
      bot.player = freshPlayer;
    }
    updateMultiCellBotAI(bot, currentTime, world, obstacles, swarms, nutrients);
  }

  // Pre-collect jungle fauna for cyber-organism bots
  // They can only see/interact with jungle entities, not soup entities
  const fauna: FaunaSnapshot[] = [];

  // CyberBugs
  world.forEachWithTag(Tags.CyberBug, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const id = getStringIdByEntity(entity);
    if (pos && id) {
      fauna.push({ id, x: pos.x, y: pos.y, type: 'bug' });
    }
  });

  // JungleCreatures
  world.forEachWithTag(Tags.JungleCreature, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const id = getStringIdByEntity(entity);
    if (pos && id) {
      fauna.push({ id, x: pos.x, y: pos.y, type: 'creature' });
    }
  });

  // DataFruits
  world.forEachWithTag(Tags.DataFruit, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const id = getStringIdByEntity(entity);
    if (pos && id) {
      fauna.push({ id, x: pos.x, y: pos.y, type: 'fruit' });
    }
  });

  // Other Stage 3+ players (including other cyber-organism bots for PvP)
  world.forEachWithTag(Tags.Player, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
    const playerComp = world.getComponent<{ socketId: string }>(entity, Components.Player);
    if (!pos || !stageComp || !playerComp) return;
    // Only include Stage 3+ (jungle scale)
    if (stageComp.stage < EvolutionStage.CYBER_ORGANISM) return;
    fauna.push({ id: playerComp.socketId, x: pos.x, y: pos.y, type: 'player' });
  });

  // Update cyber-organism bots (Stage 3 - jungle hunters with combat specializations)
  for (const [botId, bot] of cyberOrganismBots) {
    // Refresh bot.player from ECS
    const freshPlayer = getPlayerBySocketId(world, botId);
    if (freshPlayer) {
      bot.player = freshPlayer;
    }
    // Filter out self from fauna targets
    const targetsForThisBot = fauna.filter((f) => f.id !== botId);
    updateCyberOrganismBotAI(bot, currentTime, world, targetsForThisBot);
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
  const wasCyberOrganism = cyberOrganismBots.delete(botId);

  if (!wasSingleCell && !wasMultiCell && !wasCyberOrganism) {
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
  return singleCellBots.size + multiCellBots.size + cyberOrganismBots.size;
}

/**
 * Handle bot death - schedule auto-respawn after delay
 * @param cause - What killed the bot (for death rate tracking)
 */
export function handleBotDeath(botId: string, cause: DeathCause, _io: Server) {
  if (!ecsWorld) {
    logger.warn({ event: 'bot_death_no_ecs', botId });
    return;
  }

  // Check if it's a single-cell bot
  const singleCellBot = singleCellBots.get(botId);
  if (singleCellBot) {
    logBotDeath(botId, cause, EvolutionStage.SINGLE_CELL);
    clearSpawnTime(botId); // Clear evolution tracking on death

    // Schedule respawn via ECS (replaces setTimeout)
    scheduleBotRespawn(botId, 1, ecsWorld);
    return;
  }

  // Check if it's a multi-cell bot
  const multiCellBot = multiCellBots.get(botId);
  if (multiCellBot) {
    logBotDeath(botId, cause, EvolutionStage.MULTI_CELL);
    clearSpawnTime(botId); // Clear evolution tracking on death

    // Schedule respawn via ECS (replaces setTimeout)
    scheduleBotRespawn(botId, 2, ecsWorld);
    return;
  }

  // Check if it's a cyber-organism bot (Stage 3)
  const cyberBot = cyberOrganismBots.get(botId);
  if (cyberBot) {
    logBotDeath(botId, cause, EvolutionStage.CYBER_ORGANISM);
    clearSpawnTime(botId);

    // Schedule respawn via ECS (replaces setTimeout)
    scheduleBotRespawn(botId, 3, ecsWorld);
    return;
  }
}

// ============================================
// Bot Respawn Logic (called by RespawnSystem)
// ============================================

/**
 * Respawn a bot immediately.
 * Called by RespawnSystem when a PendingRespawn timer expires.
 * Extracts the common respawn logic from handleBotDeath's setTimeout callbacks.
 *
 * @param botId - Bot's socket ID
 * @param stage - Stage to respawn as (1=single-cell, 2=multi-cell, 3=cyber-organism)
 * @param io - Socket.io server for broadcasting
 * @param world - ECS world for component access
 */
export function respawnBotNow(botId: string, stage: number, io: Server, world: World): void {
  // Get ECS components
  const posComp = getPositionBySocketId(world, botId);
  const energyComp = getEnergyBySocketId(world, botId);
  const stageComp = getStageBySocketId(world, botId);

  if (!posComp || !energyComp || !stageComp) {
    // Bot was removed from game
    logger.warn({ event: 'bot_respawn_no_entity', botId, stage });
    return;
  }

  // Get the appropriate bot controller
  const singleCellBot = singleCellBots.get(botId);
  const multiCellBot = multiCellBots.get(botId);
  const cyberBot = cyberOrganismBots.get(botId);

  // Determine which bot type and apply respawn logic
  if (stage === 1 && singleCellBot) {
    // Respawn as single-cell
    const newPos = randomSpawnPosition();
    posComp.x = newPos.x;
    posComp.y = newPos.y;
    posComp.z = newPos.z ?? 0;
    energyComp.current = GAME_CONFIG.SINGLE_CELL_ENERGY;
    energyComp.max = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
    stageComp.stage = EvolutionStage.SINGLE_CELL;
    stageComp.radius = GAME_CONFIG.SINGLE_CELL_RADIUS;
    stageComp.isEvolving = false;

    // Reset input and velocity
    singleCellBot.inputDirection.x = 0;
    singleCellBot.inputDirection.y = 0;
    singleCellBot.velocity.x = 0;
    singleCellBot.velocity.y = 0;

    // Reset AI state
    singleCellBot.ai.state = 'wander';
    singleCellBot.ai.targetNutrient = undefined;
    singleCellBot.ai.nextWanderChange = Date.now();

    // Update player reference and broadcast
    const player = getPlayerBySocketId(world, botId);
    if (player) {
      singleCellBot.player = player;
      io.emit('playerRespawned', {
        type: 'playerRespawned',
        player: { ...player },
      } as PlayerRespawnedMessage);
    }

    recordSpawn(botId, EvolutionStage.SINGLE_CELL);
    logBotRespawn(botId);
  } else if (stage === 2 && multiCellBot) {
    // Respawn as multi-cell
    const newPos = randomSpawnPosition();
    posComp.x = newPos.x;
    posComp.y = newPos.y;
    posComp.z = newPos.z ?? 0;
    energyComp.current = GAME_CONFIG.MULTI_CELL_ENERGY;
    energyComp.max = GAME_CONFIG.MULTI_CELL_MAX_ENERGY;
    stageComp.stage = EvolutionStage.MULTI_CELL;
    stageComp.radius = GAME_CONFIG.MULTI_CELL_RADIUS;
    stageComp.isEvolving = false;

    // Reset input and velocity
    multiCellBot.inputDirection.x = 0;
    multiCellBot.inputDirection.y = 0;
    multiCellBot.velocity.x = 0;
    multiCellBot.velocity.y = 0;

    // Reset AI state
    multiCellBot.ai.state = 'wander';
    multiCellBot.ai.targetNutrient = undefined;
    multiCellBot.ai.nextWanderChange = Date.now();

    // Update player reference and broadcast
    const player = getPlayerBySocketId(world, botId);
    if (player) {
      multiCellBot.player = player;
      io.emit('playerRespawned', {
        type: 'playerRespawned',
        player: { ...player },
      } as PlayerRespawnedMessage);
    }

    recordSpawn(botId, EvolutionStage.MULTI_CELL);
    logBotRespawn(botId);
  } else if (stage === 3 && cyberBot) {
    // Respawn as cyber-organism in jungle
    const newPos = randomJungleSpawnPosition();
    posComp.x = newPos.x;
    posComp.y = newPos.y;
    energyComp.current = GAME_CONFIG.CYBER_ORGANISM_ENERGY ?? 15000;
    energyComp.max = GAME_CONFIG.CYBER_ORGANISM_MAX_ENERGY ?? 30000;
    stageComp.stage = EvolutionStage.CYBER_ORGANISM;
    stageComp.radius = GAME_CONFIG.CYBER_ORGANISM_RADIUS;
    stageComp.isEvolving = false;

    // Reset input and velocity
    cyberBot.inputDirection.x = 0;
    cyberBot.inputDirection.y = 0;
    cyberBot.velocity.x = 0;
    cyberBot.velocity.y = 0;

    // Reset AI state
    cyberBot.ai.state = 'wander';
    cyberBot.ai.targetNutrient = undefined;
    cyberBot.ai.nextWanderChange = Date.now();

    // Re-roll specialization on respawn
    const entity = world.query(Components.Player).find((e) => {
      const p = world.getComponent<{ socketId: string }>(e, Components.Player);
      return p?.socketId === botId;
    });
    if (entity !== undefined) {
      const specializations: Array<'melee' | 'ranged' | 'traps'> = ['melee', 'ranged', 'traps'];
      const newSpec = specializations[Math.floor(Math.random() * specializations.length)];
      const specComp = world.getComponent<{ specialization: 'melee' | 'ranged' | 'traps' | null }>(
        entity,
        Components.CombatSpecialization
      );
      if (specComp) {
        specComp.specialization = newSpec;
      }
    }

    // Update player reference and broadcast
    const player = getPlayerBySocketId(world, botId);
    if (player) {
      cyberBot.player = player;
      io.emit('playerRespawned', {
        type: 'playerRespawned',
        player: { ...player },
      } as PlayerRespawnedMessage);
    }

    recordSpawn(botId, EvolutionStage.CYBER_ORGANISM);
    logBotRespawn(botId);
  } else {
    logger.warn({ event: 'bot_respawn_no_controller', botId, stage });
  }
}

/**
 * Get respawn delay for a bot stage
 */
export function getBotRespawnDelay(stage: number): number {
  switch (stage) {
    case 1:
      return BOT_CONFIG.RESPAWN_DELAY;
    case 2:
      return BOT_CONFIG.STAGE2_RESPAWN_DELAY;
    case 3:
      return BOT_CONFIG.STAGE3_RESPAWN_DELAY;
    default:
      return BOT_CONFIG.RESPAWN_DELAY;
  }
}

/**
 * Schedule a bot respawn via ECS PendingRespawn component.
 * Called by handleBotDeath instead of setTimeout.
 *
 * @param botId - Bot's socket ID
 * @param stage - Stage to respawn as (1, 2, or 3)
 * @param world - ECS world to create entity in
 */
export function scheduleBotRespawn(botId: string, stage: number, world: World): void {
  const delay = getBotRespawnDelay(stage);
  const respawnAt = Date.now() + delay;

  // Create a pending respawn entity
  const entity = world.createEntity();
  world.addComponent(entity, Components.PendingRespawn, {
    respawnAt,
    entityType: 'bot',
    stage,
    metadata: { botId },
  });
}
