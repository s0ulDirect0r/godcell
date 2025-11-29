import { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Position,
  Nutrient,
  Obstacle,
  DeathCause,
  DamageSource,
  Pseudopod,
  PlayerMoveMessage,
  PlayerRespawnRequestMessage,
  PlayerSprintMessage,
  PseudopodFireMessage,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  NutrientMovedMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PlayerEvolutionStartedMessage,
  PlayerEvolvedMessage,
  PseudopodSpawnedMessage,
  PseudopodMovedMessage,
  PseudopodRetractedMessage,
  PlayerEngulfedMessage,
  DetectedEntity,
  DetectionUpdateMessage,
  EMPActivateMessage,
  EMPActivatedMessage,
  SwarmConsumedMessage,
  PlayerDrainStateMessage,
} from '@godcell/shared';
import { initializeBots, updateBots, isBot, handleBotDeath, spawnBotAt, removeBotPermanently, setBotEcsWorld } from './bots';
import { AbilitySystem } from './abilities';
import { initializeSwarms, updateSwarms, updateSwarmPositions, checkSwarmCollisions, getSwarmsRecord, getSwarms, removeSwarm, processSwarmRespawns, spawnSwarmAt, setSwarmEcsWorld } from './swarms';
import { initDevHandler, handleDevCommand, isGamePaused, getTimeScale, hasGodMode, shouldRunTick, getConfig } from './dev';
import type { DevCommandMessage } from '@godcell/shared';
import {
  logger,
  logServerStarted,
  logPlayerConnected,
  logPlayerDisconnected,
  logPlayerDeath,
  logPlayerRespawn,
  logPlayerEvolution,
  logNutrientsSpawned,
  logObstaclesSpawned,
  logGravityDebug,
  logSingularityCrush,
  logAggregateStats,
  logGameStateSnapshot,
  maybeLogDeathRateStats,
  maybeLogEvolutionRateStats,
  maybeLogNutrientCollectionStats,
  maybeLogLifetimeStats,
  recordSpawn,
  recordEvolution,
  clearSpawnTime,
  recordNutrientCollection,
  recordLifetimeDeath,
} from './logger';

// ECS - Entity Component System
import {
  createWorld,
  createPlayer as ecsCreatePlayer,
  createNutrient as ecsCreateNutrient,
  createObstacle as ecsCreateObstacle,
  createSwarm as ecsCreateSwarm,
  createPseudopod as ecsCreatePseudopod,
  destroyEntity as ecsDestroyEntity,
  getEntityBySocketId,
  getEntityByStringId,
  Components,
  Tags,
  buildAlivePlayersRecord,
  buildPlayersRecord,
  // Direct component access helpers
  getPlayerBySocketId,
  hasPlayer,
  getEnergyBySocketId,
  getPositionBySocketId,
  getStageBySocketId,
  getVelocityBySocketId,
  getSprintBySocketId,
  getCooldownsBySocketId,
  isBotBySocketId,
  deletePlayerBySocketId,
  forEachPlayer,
  setPlayerStage,
  // ECS setters - update component values directly
  setEnergyBySocketId,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
  type World,
  type EntityId,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
  // Systems
  SystemRunner,
  SystemPriority,
  BotAISystem,
  GravitySystem,
  SwarmAISystem,
  PseudopodSystem,
  PredationSystem,
  SwarmCollisionSystem,
  MovementSystem,
  MetabolismSystem,
  NutrientCollisionSystem,
  NutrientAttractionSystem,
  DeathSystem,
  NetworkBroadcastSystem,
  type GameContext,
} from './ecs';
import {
  // Math utilities
  distance,
  rayCircleIntersection,
  lineCircleIntersection,
  poissonDiscSampling,
  // Stage helpers
  getStageMaxEnergy,
  getDamageResistance,
  getEnergyDecayRate,
  getPlayerRadius,
  getWorldBoundsForStage,
  isSoupStage,
  isJungleStage,
  getStageEnergy,
  getNextEvolutionStage,
  // Spawning utilities
  randomColor,
  randomSpawnPosition,
  isNutrientSpawnSafe,
  calculateNutrientValueMultiplier,
} from './helpers';

// ============================================
// Server Configuration
// ============================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const TICK_RATE = 60; // Server updates 60 times per second
const TICK_INTERVAL = 1000 / TICK_RATE;

// ============================================
// Game State
// ============================================

// ECS World - central container for all entities and components
// ECS is the source of truth. The players Map below is a cache rebuilt each tick.
const world: World = createWorld();

// All players currently in the game
// Maps socket ID → Player data
// IMPORTANT: This is now a CACHE that gets rebuilt from ECS each tick.
// Write to ECS components, not to this Map. Reads are fine during tick.
const players: Map<string, Player> = new Map();

/**
 * Sync the players Map from ECS components.
 * Called at the start of each tick to ensure legacy code reads current ECS state.
 * This is a temporary bridge - once all code reads from ECS directly, remove this.
 */
function syncPlayersFromECS(): void {
  players.clear();
  forEachPlayer(world, (entity, socketId) => {
    const player = getPlayerBySocketId(world, socketId);
    if (player) {
      players.set(socketId, player);
    }
  });
}

// Player input directions (from keyboard/controller)
// Maps socket ID → {x, y} direction (-1, 0, or 1)
const playerInputDirections: Map<string, { x: number; y: number }> = new Map();

// Player velocities (actual velocity in pixels/second, accumulates forces)
// Maps socket ID → {x, y} velocity
const playerVelocities: Map<string, { x: number; y: number }> = new Map();

// Player sprint state (Stage 3+ ability - hold Shift to sprint)
// Maps socket ID → boolean (is sprinting)
const playerSprintState: Map<string, boolean> = new Map();

// Track what last damaged each player (for death cause logging)
// Maps player ID → damage source
const playerLastDamageSource: Map<string, DeathCause> = new Map();

// Track who fired the beam that last hit each player (for kill rewards)
// Maps target player ID → shooter player ID
const playerLastBeamShooter: Map<string, string> = new Map();

// Pseudopods (hunting tentacles extended by multi-cells)
// Maps pseudopod ID → Pseudopod data
const pseudopods: Map<string, Pseudopod> = new Map();

// Pseudopod hit tracking (prevent multiple hits on same target per beam)
// Maps beam ID → Set of player IDs already hit
const pseudopodHits: Map<string, Set<string>> = new Map();

// Pseudopod cooldowns (prevent spam)
// Maps player ID → timestamp of last pseudopod extension
const playerPseudopodCooldowns: Map<string, number> = new Map();

// EMP cooldowns (prevent spam)
// Maps player ID → timestamp of last EMP use
const playerEMPCooldowns: Map<string, number> = new Map();

// Active energy drains (multi-cell draining prey on contact)
// Maps prey ID → predator ID
const activeDrains: Map<string, string> = new Map();

// Active swarm consumption (multi-cells eating disabled swarms)
// Set of swarm IDs currently being consumed
const activeSwarmDrains: Set<string> = new Set();

// NEW: Damage tracking system for variable-intensity drain auras
// Track all active damage sources per entity this tick
interface ActiveDamage {
  damageRate: number;        // DPS this tick
  source: DamageSource;      // Which damage source
  proximityFactor?: number;  // For gravity gradient (0-1, higher = closer to center)
}
const activeDamageThisTick = new Map<string, ActiveDamage[]>();

// Pseudopod hit decay timers (for brief aura after beam hits)
// Maps playerId → {rate, expiresAt}
const pseudopodHitDecays = new Map<string, { rate: number; expiresAt: number }>();

// All nutrients currently in the world
// Maps nutrient ID → Nutrient data
const nutrients: Map<string, Nutrient> = new Map();

// Timers for nutrient respawning
// Maps nutrient ID → NodeJS.Timeout
const nutrientRespawnTimers: Map<string, NodeJS.Timeout> = new Map();

// Counter for generating unique nutrient IDs
let nutrientIdCounter = 0;

// All gravity obstacles in the world
// Maps obstacle ID → Obstacle data
const obstacles: Map<string, Obstacle> = new Map();

/**
 * Hitscan raycast for pseudopod beam
 * Checks line-circle intersection against all multi-cell players
 * Applies damage to closest hit and returns target ID
 */
function checkBeamHitscan(start: Position, end: Position, shooterId: string): string | null {
  let closestHit: { playerId: string; distance: number } | null = null;

  for (const [playerId, target] of players) {
    // Skip shooter
    if (playerId === shooterId) continue;

    // Skip dead/evolving/stunned players
    if (target.energy <= 0) continue;
    if (target.isEvolving) continue;
    if (target.stunnedUntil && Date.now() < target.stunnedUntil) continue;

    const targetRadius = getPlayerRadius(target.stage);
    const hitDist = rayCircleIntersection(start, end, target.position, targetRadius);

    if (hitDist !== null) {
      // Track closest hit
      if (!closestHit || hitDist < closestHit.distance) {
        closestHit = { playerId, distance: hitDist };
      }
    }
  }

  // Apply damage to closest hit
  if (closestHit) {
    const target = players.get(closestHit.playerId);
    if (target) {
      applyDamageWithResistance(target, getConfig('PSEUDOPOD_DRAIN_RATE'));
      playerLastDamageSource.set(closestHit.playerId, 'beam');
      playerLastBeamShooter.set(closestHit.playerId, shooterId); // Track shooter for kill rewards

      logger.info({
        event: 'beam_hit',
        shooter: shooterId,
        target: closestHit.playerId,
        damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
        targetEnergyRemaining: target.energy.toFixed(0),
      });
    }

    return closestHit.playerId;
  }

  return null;
}

/**
 * Spawn a nutrient at a random location within the soup region
 * Nutrients near obstacles get enhanced value based on gradient system (2x/3x/5x multipliers)
 * Note: "Respawn" creates a NEW nutrient with a new ID, not reusing the old one
 */
function spawnNutrient(emitEvent: boolean = false): Nutrient {
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
    logger.warn('Could not find safe nutrient spawn position after max attempts, using fallback');
  }

  return spawnNutrientAt(position, undefined, emitEvent);
}

/**
 * Spawn a nutrient at a specific position
 * Used for prey drops and specific spawn locations
 * @param position - Where to spawn the nutrient
 * @param overrideMultiplier - Optional multiplier override (1/2/3/5) for dev tools
 */
function spawnNutrientAt(position: Position, overrideMultiplier?: number, emitEvent: boolean = false): Nutrient {
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
  if (emitEvent && typeof io !== 'undefined') {
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
function respawnNutrient(nutrientId: string) {
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
function initializeNutrients() {
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
    logger.warn(`Only placed ${nutrients.size}/${GAME_CONFIG.NUTRIENT_COUNT} nutrients (space constraints)`);
  }
}

/**
 * Initialize gravity obstacles using Bridson's Poisson Disc Sampling
 * Pure spatial distribution - no safe zones, obstacles fill the soup naturally
 * Guarantees 850px separation between obstacles for good coverage
 * Keeps obstacles away from walls (event horizon + buffer = 330px)
 * Note: Obstacles are soup-scale hazards, placed within the soup region
 */
function initializeObstacles() {
  const MIN_OBSTACLE_SEPARATION = 850; // Good spacing for 12 obstacles on 4800×3200 soup
  const WALL_PADDING = 330; // Event horizon (180px) + 150px buffer
  let obstacleIdCounter = 0;

  // Generate obstacle positions using Bridson's algorithm on a padded area
  // Obstacles spawn within the soup region (which is centered in the jungle)
  const paddedWidth = GAME_CONFIG.SOUP_WIDTH - WALL_PADDING * 2;
  const paddedHeight = GAME_CONFIG.SOUP_HEIGHT - WALL_PADDING * 2;

  const obstaclePositions = poissonDiscSampling(
    paddedWidth,
    paddedHeight,
    MIN_OBSTACLE_SEPARATION,
    GAME_CONFIG.OBSTACLE_COUNT
  );

  // Offset positions to account for padding AND soup origin in jungle
  const offsetPositions = obstaclePositions.map(pos => ({
    x: pos.x + WALL_PADDING + GAME_CONFIG.SOUP_ORIGIN_X,
    y: pos.y + WALL_PADDING + GAME_CONFIG.SOUP_ORIGIN_Y,
  }));

  // Create obstacles from generated positions
  for (const position of offsetPositions) {
    const obstacle: Obstacle = {
      id: `obstacle-${obstacleIdCounter++}`,
      position,
      radius: getConfig('OBSTACLE_GRAVITY_RADIUS'),
      strength: getConfig('OBSTACLE_GRAVITY_STRENGTH'),
      damageRate: GAME_CONFIG.OBSTACLE_DAMAGE_RATE,
    };

    obstacles.set(obstacle.id, obstacle);

    // Add to ECS (dual-write during migration)
    ecsCreateObstacle(
      world,
      obstacle.id,
      position,
      obstacle.radius,
      obstacle.strength
    );
  }

  logObstaclesSpawned(obstacles.size);

  if (obstacles.size < GAME_CONFIG.OBSTACLE_COUNT) {
    logger.warn(`Only placed ${obstacles.size}/${GAME_CONFIG.OBSTACLE_COUNT} obstacles (space constraints)`);
  }
}

/**
 * Apply damage to player with resistance factored in
 * Returns actual damage dealt after resistance
 * God mode players take no damage
 */
function applyDamageWithResistance(player: Player, baseDamage: number): number {
  // God mode players are immune to damage
  if (hasGodMode(player.id)) return 0;

  const resistance = getDamageResistance(player.stage);
  const actualDamage = baseDamage * (1 - resistance);

  // Write damage to ECS (not the cached player object)
  const energyComp = getEnergyBySocketId(world, player.id);
  if (energyComp) {
    energyComp.current -= actualDamage;
  }

  return actualDamage;
}

/**
 * Check beam collision with multi-cell players
 * Drains energy from hit targets
 * Returns true if hit something
 *
 * Stage filtering: Pseudopod beams are a soup-stage (Stage 2) combat system
 * Only MULTI_CELL shooters can shoot, and only MULTI_CELL targets can be hit
 * Stage 3+ players have evolved past the soup and don't use pseudopods
 */
function checkBeamCollision(beam: Pseudopod): boolean {
  const shooter = players.get(beam.ownerId);
  if (!shooter) return false;

  // Stage 3+ shooters don't interact with soup-stage combat
  if (!isSoupStage(shooter.stage)) return false;

  // Get or create hit tracking set for this beam
  let hitSet = pseudopodHits.get(beam.id);
  if (!hitSet) {
    hitSet = new Set<string>();
    pseudopodHits.set(beam.id, hitSet);
  }

  let hitSomething = false;

  // Check collision with all soup-stage players (Stage 1 and 2)
  for (const [targetId, target] of players) {
    if (targetId === beam.ownerId) continue; // Can't hit yourself
    if (hitSet.has(targetId)) continue; // Already hit this target
    if (!isSoupStage(target.stage)) continue; // Beams only hit soup-stage targets (Stage 1 & 2)
    if (target.energy <= 0) continue; // Skip dead players
    if (target.isEvolving) continue; // Skip evolving players
    if (target.stunnedUntil && Date.now() < target.stunnedUntil) continue; // Skip stunned players

    // Circle-circle collision: beam position vs target position
    const targetRadius = getPlayerRadius(target.stage);
    const dist = distance(beam.position, target.position);
    const collisionDist = beam.width / 2 + targetRadius;

    if (dist < collisionDist) {
      // Hit! Drain energy from target (one-time damage per beam, with resistance)
      applyDamageWithResistance(target, getConfig('PSEUDOPOD_DRAIN_RATE'));
      hitSomething = true;

      // Track damage source and shooter for kill credit
      playerLastDamageSource.set(targetId, 'beam');
      playerLastBeamShooter.set(targetId, beam.ownerId);

      // Mark this target as hit by this beam
      hitSet.add(targetId);

      logger.info({
        event: 'beam_hit',
        shooter: beam.ownerId,
        target: targetId,
        damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
        targetEnergyRemaining: target.energy.toFixed(0),
      });

      // Emit hit event for visual effects
      io.emit('pseudopodHit', {
        type: 'pseudopodHit',
        beamId: beam.id,
        targetId,
        hitPosition: { x: beam.position.x, y: beam.position.y },
      });

      // Add decay timer for brief drain aura after hit (1.5 seconds)
      pseudopodHitDecays.set(targetId, {
        rate: getConfig('PSEUDOPOD_DRAIN_RATE'),
        expiresAt: Date.now() + 1500, // 1.5 second decay
      });

      // Beam continues traveling, can hit multiple different targets
    }
  }

  // Check collision with swarms (active or disabled)
  for (const [swarmId, swarm] of getSwarms()) {
    if (hitSet.has(swarmId)) continue; // Already hit this swarm

    const dist = distance(beam.position, swarm.position);
    const collisionDist = beam.width / 2 + swarm.size;

    if (dist < collisionDist) {
      // Hit! Deal damage to swarm
      // Initialize energy if not set (swarms gain energy pool when first damaged)
      if (swarm.energy === undefined) {
        swarm.energy = GAME_CONFIG.SWARM_ENERGY;
      }
      swarm.energy -= getConfig('PSEUDOPOD_DRAIN_RATE');
      hitSomething = true;
      hitSet.add(swarmId);

      logger.info({
        event: 'beam_hit_swarm',
        shooter: beam.ownerId,
        swarmId,
        damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
        swarmEnergyRemaining: swarm.energy.toFixed(0),
      });

      // Check if swarm died
      if (swarm.energy <= 0) {
        // Award shooter with reduced maxEnergy (ranged kill = nutrient loss) - write to ECS
        const newMaxEnergy = shooter.maxEnergy + GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN;
        setMaxEnergyBySocketId(world, beam.ownerId, newMaxEnergy);
        addEnergyBySocketId(world, beam.ownerId, GAME_CONFIG.SWARM_ENERGY_GAIN);

        // Remove swarm
        getSwarms().delete(swarmId);

        // Broadcast swarm death
        io.emit('swarmConsumed', {
          type: 'swarmConsumed',
          swarmId,
          consumerId: beam.ownerId,
          position: swarm.position,
        });

        logger.info({
          event: 'beam_kill_swarm',
          shooter: beam.ownerId,
          swarmId,
          maxEnergyGained: GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN,
          energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
        });
      }
    }
  }

  return hitSomething;
}

/**
 * Engulf prey (phagocytosis)
 * Kills prey, rewards predator with energy and nutrient drops
 */
function engulfPrey(predatorId: string, preyId: string, position: Position) {
  const predator = players.get(predatorId);
  const prey = players.get(preyId);

  if (!predator || !prey) return;

  // Calculate rewards (gain % of victim's maxEnergy)
  const energyGain = prey.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
  // Write to ECS (not the cached player object)
  addEnergyBySocketId(world, predatorId, energyGain);

  // Kill prey (energy-only: set energy to 0)
  setEnergyBySocketId(world, preyId, 0);
  playerLastDamageSource.set(preyId, 'predation');

  // Broadcast engulfment
  io.emit('playerEngulfed', {
    type: 'playerEngulfed',
    predatorId,
    preyId,
    position,
    energyGained: energyGain,
  } as PlayerEngulfedMessage);

  // Broadcast death
  io.emit('playerDied', {
    type: 'playerDied',
    playerId: preyId,
    position,
    color: prey.color,
    cause: 'predation',
  } as PlayerDiedMessage);

  // Handle bot death (respawn logic)
  if (isBot(preyId)) {
    handleBotDeath(preyId, 'predation', io, players, playerInputDirections, playerVelocities);
  }

  logger.info({
    event: 'player_engulfed',
    predatorId,
    preyId,
    isBot: isBot(preyId),
    energyGained: energyGain.toFixed(1),
  });
}

/**
 * Check for contact predation (multi-cells draining energy from touching cells)
 * Drains energy over time - prey can escape if contact is broken
 *
 * Stage filtering: Only soup-stage predators (Stage 2) can prey on soup-stage prey (Stage 1)
 * Stage 3+ players have evolved past the soup and don't interact with soup entities
 */
function checkPredationCollisions(deltaTime: number) {
  const currentDrains = new Set<string>(); // Track prey being drained this tick

  for (const [predatorId, predator] of players) {
    // Only Stage 2 (MULTI_CELL) can drain via contact
    // Stage 1 can't drain, Stage 3+ have evolved past soup predation
    if (predator.stage !== EvolutionStage.MULTI_CELL) continue;
    if (predator.energy <= 0) continue;
    if (predator.isEvolving) continue;
    if (predator.stunnedUntil && Date.now() < predator.stunnedUntil) continue; // Can't drain while stunned

    const predatorRadius = getPlayerRadius(predator.stage);

    // Check collision with all other players (Stage 1 only)
    for (const [preyId, prey] of players) {
      if (preyId === predatorId) continue; // Don't drain yourself
      if (prey.stage !== EvolutionStage.SINGLE_CELL) continue; // Only drain Stage 1
      if (prey.energy <= 0) continue; // Skip dead prey
      if (prey.isEvolving) continue; // Skip evolving prey

      const preyRadius = getPlayerRadius(prey.stage);
      const dist = distance(predator.position, prey.position);
      const collisionDist = predatorRadius + preyRadius;

      if (dist < collisionDist) {
        // God mode players can't be drained
        if (hasGodMode(preyId)) continue;

        // Contact! Drain energy from prey (energy-only system)
        // Predation bypasses damage resistance - being engulfed is inescapable
        const damage = getConfig('CONTACT_DRAIN_RATE') * deltaTime;

        // Write damage to ECS (not the cached player object)
        const preyEnergyComp = getEnergyBySocketId(world, preyId);
        if (preyEnergyComp) {
          preyEnergyComp.current -= damage;
        }

        // Transfer drained energy to predator
        addEnergyBySocketId(world, predatorId, damage);

        currentDrains.add(preyId);

        // Track which predator is draining this prey (for kill credit)
        activeDrains.set(preyId, predatorId);

        // Mark damage source for death tracking
        playerLastDamageSource.set(preyId, 'predation');

        // Record damage for drain aura system
        recordDamage(preyId, getConfig('CONTACT_DRAIN_RATE'), 'predation');

        // Only one predator can drain a prey at a time (first contact wins)
        break;
      }
    }
  }

  // Clear drains for prey that escaped contact this tick
  for (const [preyId, predatorId] of activeDrains) {
    if (!currentDrains.has(preyId)) {
      activeDrains.delete(preyId);
    }
  }
}

/**
 * Update pseudopod beams (projectile movement, collision, despawn)
 * Called every game tick
 */
function updatePseudopods(deltaTime: number, io: Server) {
  // Skip if using hitscan mode (beams are visual-only and auto-removed)
  if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') return;

  const toRemove: string[] = [];

  for (const [id, beam] of pseudopods) {
    // Move beam (projectile mode)
    const travelDist = Math.sqrt(beam.velocity.x * beam.velocity.x + beam.velocity.y * beam.velocity.y) * deltaTime;
    beam.position.x += beam.velocity.x * deltaTime;
    beam.position.y += beam.velocity.y * deltaTime;
    beam.distanceTraveled += travelDist;

    // Broadcast position update to clients
    io.emit('pseudopodMoved', {
      type: 'pseudopodMoved',
      pseudopodId: id,
      position: beam.position,
    } as PseudopodMovedMessage);

    // Check if beam exceeded max distance
    if (beam.distanceTraveled >= beam.maxDistance) {
      toRemove.push(id);
      continue;
    }

    // Check collision with players (multi-cells only)
    checkBeamCollision(beam);
    // Beam continues traveling even if it hits (can hit multiple targets)
  }

  // Remove beams that exceeded range
  for (const id of toRemove) {
    pseudopods.delete(id);
    pseudopodHits.delete(id); // Clean up hit tracking
    // Remove from ECS (dual-write during migration)
    const beamEntity = getEntityByStringId(id);
    if (beamEntity !== undefined) {
      ecsDestroyEntity(world, beamEntity);
    }
    io.emit('pseudopodRetracted', { type: 'pseudopodRetracted', pseudopodId: id } as PseudopodRetractedMessage);
  }
}

/**
 * Handle player death - broadcast death event with cause
 * Bots auto-respawn, human players wait for manual respawn
 */
function handlePlayerDeath(player: Player, cause: DeathCause) {
  // Handle predation rewards before death (contact drain)
  if (cause === 'predation') {
    const predatorId = activeDrains.get(player.id);
    if (predatorId) {
      const predator = players.get(predatorId);
      if (predator) {
        // Calculate reward based on victim stage
        let maxEnergyGain = 0;
        if (player.stage === EvolutionStage.SINGLE_CELL) {
          // Killing single-cell: 30% of maxEnergy
          maxEnergyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
        } else {
          // Killing multi-cell: 80% of maxEnergy (huge reward)
          maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;
        }

        // Award maxEnergy increase to predator (write to ECS)
        setMaxEnergyBySocketId(world, predatorId, predator.maxEnergy + maxEnergyGain);
        // Clamp current energy to new max (addEnergy with 0 does this)
        addEnergyBySocketId(world, predatorId, 0);

        logger.info({
          event: 'predation_kill',
          predatorId,
          victimId: player.id,
          victimStage: player.stage,
          maxEnergyGained: maxEnergyGain.toFixed(1),
        });
      }
      // Clear drain tracking
      activeDrains.delete(player.id);
    }
  }

  // Handle beam kill rewards (pseudopod)
  if (cause === 'beam') {
    const shooterId = playerLastBeamShooter.get(player.id);
    if (shooterId) {
      const shooter = players.get(shooterId);
      if (shooter) {
        // Only multi-cells can be killed by beams, always award 80%
        const maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;

        // Award maxEnergy increase AND current energy to shooter (write to ECS)
        const newMaxEnergy = shooter.maxEnergy + maxEnergyGain;
        setMaxEnergyBySocketId(world, shooterId, newMaxEnergy);
        const energyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN; // 30% of victim's maxEnergy
        addEnergyBySocketId(world, shooterId, energyGain);

        logger.info({
          event: 'beam_kill',
          shooterId,
          victimId: player.id,
          victimStage: player.stage,
          maxEnergyGained: maxEnergyGain.toFixed(1),
          energyGained: energyGain.toFixed(1),
        });
      }
      // Clear beam shooter tracking
      playerLastBeamShooter.delete(player.id);
    }
  }

  // Send final energy update showing 0 before death message
  const finalEnergyUpdate: EnergyUpdateMessage = {
    type: 'energyUpdate',
    playerId: player.id,
    energy: 0, // Ensure client sees energy at 0
  };
  io.emit('energyUpdate', finalEnergyUpdate);

  // Record death for lifetime stats
  recordLifetimeDeath(cause);

  // Broadcast death event (for dilution effect)
  const deathMessage: PlayerDiedMessage = {
    type: 'playerDied',
    playerId: player.id,
    position: { ...player.position },
    color: player.color,
    cause: cause as 'starvation' | 'singularity' | 'swarm' | 'obstacle' | 'predation',
  };
  io.emit('playerDied', deathMessage);

  // Auto-respawn bots after delay
  if (isBot(player.id)) {
    handleBotDeath(player.id, cause, io, players, playerInputDirections, playerVelocities);
  } else {
    logPlayerDeath(player.id, cause);
  }
}

/**
 * Respawn a dead player - reset to single-cell at random location
 * Uses ECS as source of truth.
 */
function respawnPlayer(playerId: string) {
  // Get ECS components
  const posComp = getPositionBySocketId(world, playerId);
  const energyComp = getEnergyBySocketId(world, playerId);
  const stageComp = getStageBySocketId(world, playerId);
  if (!posComp || !energyComp || !stageComp) return;

  // Reset player to Stage 1 (single-cell)
  const newPos = randomSpawnPosition(world);
  posComp.x = newPos.x;
  posComp.y = newPos.y;
  energyComp.current = GAME_CONFIG.SINGLE_CELL_ENERGY;
  energyComp.max = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
  stageComp.stage = EvolutionStage.SINGLE_CELL;
  stageComp.isEvolving = false;

  // Also update ECS stage abilities (removes multi-cell abilities)
  const entity = getEntityBySocketId(playerId);
  if (entity) {
    setPlayerStage(world, entity, EvolutionStage.SINGLE_CELL);
  }

  // Reset input direction and velocity (stop movement if player was holding input during death)
  const inputDirection = playerInputDirections.get(playerId);
  if (inputDirection) {
    inputDirection.x = 0;
    inputDirection.y = 0;
  }
  const velocity = playerVelocities.get(playerId);
  if (velocity) {
    velocity.x = 0;
    velocity.y = 0;
  }

  // Get the updated player state from ECS for broadcast
  const respawnedPlayer = getPlayerBySocketId(world, playerId);
  if (respawnedPlayer) {
    // Broadcast respawn event
    const respawnMessage: PlayerRespawnedMessage = {
      type: 'playerRespawned',
      player: respawnedPlayer,
    };
    io.emit('playerRespawned', respawnMessage);
  }

  // Track spawn time for evolution rate tracking (reset on respawn)
  recordSpawn(playerId, EvolutionStage.SINGLE_CELL);

  logPlayerRespawn(playerId);
}

// Energy update broadcast counter (reduce network spam)
let energyUpdateTicks = 0;
const ENERGY_UPDATE_INTERVAL = 10; // Broadcast every 10 ticks (~6 times/sec)

/**
 * Broadcast energy updates to clients (throttled)
 * Energy-only system: energy is the sole resource
 */
function broadcastEnergyUpdates() {
  energyUpdateTicks++;

  if (energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
    energyUpdateTicks = 0;

    for (const [playerId, player] of players) {
      // Skip dead players (no need to broadcast their energy)
      if (player.energy <= 0) continue;

      const updateMessage: EnergyUpdateMessage = {
        type: 'energyUpdate',
        playerId,
        energy: player.energy,
      };
      io.emit('energyUpdate', updateMessage);
    }
  }
}

/**
 * Helper function to record damage for this tick
 * Used by all damage sources to contribute to drain aura intensity
 */
function recordDamage(
  entityId: string,
  damageRate: number,
  source: DamageSource,
  proximityFactor?: number
) {
  if (!activeDamageThisTick.has(entityId)) {
    activeDamageThisTick.set(entityId, []);
  }
  activeDamageThisTick.get(entityId)!.push({ damageRate, source, proximityFactor });
}

/**
 * Broadcast drain state updates to clients
 * Sends comprehensive damage info for variable-intensity drain auras
 */
function broadcastDrainState() {
  // Add pseudopod hit decays to active damage (if not expired)
  const now = Date.now();
  for (const [playerId, decay] of pseudopodHitDecays) {
    if (now < decay.expiresAt) {
      recordDamage(playerId, decay.rate, 'beam');
    } else {
      pseudopodHitDecays.delete(playerId); // Clean up expired
    }
  }

  // Aggregate damage info per player
  const damageInfo: Record<string, { totalDamageRate: number; primarySource: DamageSource; proximityFactor?: number }> = {};

  for (const [playerId, damages] of activeDamageThisTick) {
    // Sum total damage rate
    const totalDamageRate = damages.reduce((sum, d) => sum + d.damageRate, 0);

    // Find dominant source (highest damage)
    const sorted = damages.sort((a, b) => b.damageRate - a.damageRate);
    const primarySource = sorted[0].source;

    // Average proximity factors for gravity (if any)
    const proximityFactors = damages
      .filter(d => d.proximityFactor !== undefined)
      .map(d => d.proximityFactor!);
    const proximityFactor =
      proximityFactors.length > 0
        ? proximityFactors.reduce((sum, p) => sum + p, 0) / proximityFactors.length
        : undefined;

    damageInfo[playerId] = { totalDamageRate, primarySource, proximityFactor };
  }

  // Build damage info for swarms being consumed
  const swarmDamageInfo: Record<string, { totalDamageRate: number; primarySource: DamageSource }> = {};

  for (const swarmId of activeSwarmDrains) {
    // Swarms being consumed are taking damage from predation (multi-cell contact drain)
    swarmDamageInfo[swarmId] = {
      totalDamageRate: GAME_CONFIG.SWARM_CONSUMPTION_RATE,
      primarySource: 'predation',
    };
  }

  const drainStateMessage: PlayerDrainStateMessage = {
    type: 'playerDrainState',
    drainedPlayerIds: [], // deprecated
    drainedSwarmIds: [],  // deprecated
    damageInfo,
    swarmDamageInfo,
  };

  io.emit('playerDrainState', drainStateMessage);

  // Clear for next tick
  activeDamageThisTick.clear();
}

// Detection update broadcast counter (chemical sensing for multi-cells)
let detectionUpdateTicks = 0;
const DETECTION_UPDATE_INTERVAL = 15; // Every 15 ticks (~4 times/sec) - less frequent than energy

/**
 * Broadcast detected entities to multi-cell players (chemical sensing)
 * Multi-cells can "smell" nearby prey and nutrients from extended range
 */
function broadcastDetectionUpdates() {
  detectionUpdateTicks++;

  if (detectionUpdateTicks >= DETECTION_UPDATE_INTERVAL) {
    detectionUpdateTicks = 0;

    for (const [playerId, player] of players) {
      // Only multi-cells and above have chemical sensing
      if (player.stage === EvolutionStage.SINGLE_CELL) continue;
      if (player.energy <= 0) continue; // Skip dead players

      const detected: DetectedEntity[] = [];

      // Detect other players (potential prey or threats)
      for (const [otherId, otherPlayer] of players) {
        if (otherId === playerId) continue; // Don't detect yourself
        if (otherPlayer.energy <= 0) continue; // Skip dead players

        const dist = distance(player.position, otherPlayer.position);
        if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
          detected.push({
            id: otherId,
            position: otherPlayer.position,
            entityType: 'player',
            stage: otherPlayer.stage,
          });
        }
      }

      // Detect nutrients
      for (const [nutrientId, nutrient] of nutrients) {
        const dist = distance(player.position, nutrient.position);
        if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
          detected.push({
            id: nutrientId,
            position: nutrient.position,
            entityType: 'nutrient',
          });
        }
      }

      // Detect swarms (potential prey for multi-cells)
      for (const [swarmId, swarm] of getSwarms()) {
        const dist = distance(player.position, swarm.position);
        if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
          detected.push({
            id: swarmId,
            position: swarm.position,
            entityType: 'swarm',
          });
        }
      }

      // Send detection update to this player only (private information)
      const socket = io.sockets.sockets.get(playerId);
      if (socket) {
        const detectionMessage: DetectionUpdateMessage = {
          type: 'detectionUpdate',
          detected,
        };
        socket.emit('detectionUpdate', detectionMessage);
      }
    }
  }
}

// ============================================
// Socket.io Server Setup
// ============================================

const io = new Server(PORT, {
  cors: {
    origin: '*', // Allow all origins for development
  },
});

logServerStarted(PORT);

// Playground mode - empty world for testing (set by PLAYGROUND env var)
const isPlayground = process.env.PLAYGROUND === 'true';

if (isPlayground) {
  logger.info({ event: 'playground_mode', port: PORT });
} else {
  // Initialize game world (normal mode)
  // Pure Bridson's distribution - obstacles and swarms fill map naturally
  initializeObstacles();
  initializeNutrients();
  // Set ECS world for bots and swarms before initializing
  setBotEcsWorld(world);
  initializeBots(io, players, playerInputDirections, playerVelocities);
  setSwarmEcsWorld(world);
  initializeSwarms(io);
}

// Initialize dev handler with game context
initDevHandler({
  io,
  world, // ECS World for direct component access
  players,
  nutrients,
  obstacles,
  swarms: getSwarms(),
  playerInputDirections,
  playerVelocities,
  spawnNutrientAt,
  spawnSwarmAt,
  spawnBotAt: (position, stage) => spawnBotAt(io, players, playerInputDirections, playerVelocities, position, stage),
  removeBotPermanently: (botId) => removeBotPermanently(botId, io, players, playerInputDirections, playerVelocities),
  respawnPlayer,
  getStageEnergy,
  getPlayerRadius,
});

// ============================================
// Ability System
// ============================================

const abilitySystem = new AbilitySystem({
  players,
  io,
  ecsWorld: world, // ECS World for dual-write during migration
  pseudopods,
  pseudopodHits,
  playerEMPCooldowns,
  playerPseudopodCooldowns,
  getSwarms,
  checkBeamHitscan,
  applyDamageWithResistance,
  getPlayerRadius,
});

// Export for use by bot AI
export { abilitySystem };

// ============================================
// ECS System Runner Setup
// ============================================

// Create the system runner and register all systems
const systemRunner = new SystemRunner();

// Register systems in priority order
systemRunner.register(new BotAISystem(), SystemPriority.BOT_AI);
systemRunner.register(new GravitySystem(), SystemPriority.GRAVITY);
systemRunner.register(new SwarmAISystem(), SystemPriority.SWARM_AI);
systemRunner.register(new PseudopodSystem(), SystemPriority.PSEUDOPOD);
systemRunner.register(new PredationSystem(), SystemPriority.PREDATION);
systemRunner.register(new SwarmCollisionSystem(), SystemPriority.SWARM_COLLISION);
systemRunner.register(new MovementSystem(), SystemPriority.MOVEMENT);
systemRunner.register(new MetabolismSystem(), SystemPriority.METABOLISM);
systemRunner.register(new NutrientCollisionSystem(), SystemPriority.NUTRIENT_COLLISION);
systemRunner.register(new NutrientAttractionSystem(), SystemPriority.NUTRIENT_ATTRACTION);
systemRunner.register(new DeathSystem(), SystemPriority.DEATH);
systemRunner.register(new NetworkBroadcastSystem(), SystemPriority.NETWORK);

logger.info({
  event: 'systems_registered',
  systems: systemRunner.getSystemNames(),
});

// Track last broadcasted drains for comparison
const lastBroadcastedDrains = new Set<string>();

/**
 * Build the GameContext for this tick
 * This provides systems access to all game state and helper functions
 */
function buildGameContext(deltaTime: number): GameContext {
  // Sync the players cache from ECS so legacy code reads current ECS state
  syncPlayersFromECS();

  return {
    // ECS World
    world,
    io,
    deltaTime,

    // Entity Collections
    players,
    nutrients,
    obstacles,
    getSwarms,
    pseudopods,
    pseudopodHits,

    // Player State Maps
    playerVelocities,
    playerInputDirections,
    playerSprintState,
    playerLastDamageSource,
    playerEMPCooldowns,
    playerPseudopodCooldowns,

    // Drain state
    activeDrains: new Set(activeDrains.keys()), // Convert Map to Set of prey IDs
    activeSwarmDrains,
    lastBroadcastedDrains,
    activeDamage: activeDamageThisTick,

    // Per-tick transient data (will be populated by systems)
    tickData: {
      damagedPlayerIds: new Set(),
      slowedPlayerIds: new Set(),
    },

    // Ability System
    abilitySystem,

    // Helper Functions
    distance,
    getPlayerRadius,
    getWorldBoundsForStage,
    applyDamageWithResistance,
    recordDamage,
    getStageMaxEnergy,
    getDamageResistance,
    getEnergyDecayRate,
    isSoupStage,
    isJungleStage,
    isBot,

    // Legacy Functions (called by wrapper systems)
    updateBots,
    applyGravityForces,
    updateSwarms,
    updateSwarmPositions,
    processSwarmRespawns,
    updatePseudopods,
    checkPredationCollisions,
    checkSwarmCollisions,
    respawnNutrient,
    handlePlayerDeath,
    broadcastEnergyUpdates,
    broadcastDetectionUpdates,
    broadcastDrainState,
    removeSwarm,
  };
}

// ============================================
// Connection Handling
// ============================================

io.on('connection', (socket) => {
  logPlayerConnected(socket.id);

  // Create a new player in ECS (source of truth)
  // Energy-only system: energy is the sole resource (life + fuel)
  const spawnPosition = randomSpawnPosition(world);
  const playerColor = randomColor();

  ecsCreatePlayer(
    world,
    socket.id,
    socket.id, // name defaults to socketId
    playerColor,
    spawnPosition,
    EvolutionStage.SINGLE_CELL
  );

  // Legacy Maps for input/velocity tracking (will be migrated to ECS components later)
  playerInputDirections.set(socket.id, { x: 0, y: 0 });
  playerVelocities.set(socket.id, { x: 0, y: 0 });

  // Get the legacy Player object for the joinMessage broadcast
  const newPlayer = getPlayerBySocketId(world, socket.id)!;

  // Track spawn time for evolution rate tracking
  recordSpawn(socket.id, EvolutionStage.SINGLE_CELL);

  // Send current game state to the new player
  // Uses ECS to build player records, filtering out dead players (energy <= 0)
  const gameState: GameStateMessage = {
    type: 'gameState',
    players: buildAlivePlayersRecord(world),
    nutrients: Object.fromEntries(nutrients),
    obstacles: Object.fromEntries(obstacles),
    swarms: getSwarmsRecord(),
  };
  socket.emit('gameState', gameState);

  // Notify all OTHER players that someone joined
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: newPlayer,
  };
  socket.broadcast.emit('playerJoined', joinMessage);

  // ============================================
  // Player Movement Input
  // ============================================

  socket.on('playerMove', (message: PlayerMoveMessage) => {
    const inputDirection = playerInputDirections.get(socket.id);
    if (!inputDirection) return;

    // Store player's input direction (will be combined with gravity in game loop)
    // Direction values are -1, 0, or 1
    inputDirection.x = message.direction.x;
    inputDirection.y = message.direction.y;
  });

  // ============================================
  // Player Respawn Request
  // ============================================

  socket.on('playerRespawnRequest', (message: PlayerRespawnRequestMessage) => {
    // Check player exists and is dead using ECS
    const energyComp = getEnergyBySocketId(world, socket.id);
    if (!energyComp) return;

    // Only respawn if player is dead (energy <= 0)
    if (energyComp.current <= 0) {
      respawnPlayer(socket.id);
    }
  });

  // ============================================
  // Pseudopod Beam Fire (Lightning Projectile)
  // ============================================

  socket.on('pseudopodFire', (message: PseudopodFireMessage) => {
    // Delegate to AbilitySystem (used by both players and bots)
    abilitySystem.firePseudopod(socket.id, message.targetX, message.targetY);
  });

  // ============================================
  // EMP Activation (Multi-cell AoE stun ability)
  // ============================================

  socket.on('empActivate', (_message: EMPActivateMessage) => {
    // Delegate to AbilitySystem (used by both players and bots)
    abilitySystem.fireEMP(socket.id);
  });

  // ============================================
  // Sprint State (Stage 3+ ability)
  // ============================================

  socket.on('playerSprint', (message: PlayerSprintMessage) => {
    const player = players.get(socket.id);
    if (!player) return;

    // Only Stage 3+ can sprint
    if (!isJungleStage(player.stage)) return;
    if (player.energy <= 0) return; // Dead players can't sprint
    if (player.isEvolving) return; // Can't sprint while molting

    // Update sprint state
    playerSprintState.set(socket.id, message.sprinting);
  });

  // ============================================
  // Dev Command Handling (development mode only)
  // ============================================

  socket.on('devCommand', (message: DevCommandMessage) => {
    // Only allow dev commands in development mode
    if (process.env.NODE_ENV === 'production') {
      logger.warn({ event: 'dev_command_blocked', socketId: socket.id, reason: 'production_mode' });
      return;
    }
    handleDevCommand(socket, io, message.command);
  });

  // ============================================
  // Disconnection Handling
  // ============================================

  socket.on('disconnect', () => {
    logPlayerDisconnected(socket.id);

    // Remove from ECS (dual-write during migration)
    const entity = getEntityBySocketId(socket.id);
    if (entity !== undefined) {
      ecsDestroyEntity(world, entity);
    }

    // Remove from game state
    players.delete(socket.id);
    playerInputDirections.delete(socket.id);
    playerVelocities.delete(socket.id);
    playerSprintState.delete(socket.id);

    // Notify other players
    const leftMessage: PlayerLeftMessage = {
      type: 'playerLeft',
      playerId: socket.id,
    };
    socket.broadcast.emit('playerLeft', leftMessage);
  });
});

// ============================================
// Gravity Physics
// ============================================

/**
 * Apply gravity forces from obstacles to all players
 * Uses inverse-square gravity: force increases exponentially near center
 * Gravity forces are added to existing velocity (creating momentum)
 */
function applyGravityForces(deltaTime: number) {
  for (const [playerId, player] of players) {
    if (player.energy <= 0 || player.isEvolving) continue;

    const velocity = playerVelocities.get(playerId);
    if (!velocity) continue;

    // Apply friction to create momentum/inertia (velocity decays over time)
    // Use exponential decay for smooth deceleration: v = v * friction^dt
    // Stage-specific friction for different movement feels
    let friction = getConfig('MOVEMENT_FRICTION'); // Default soup friction (0.66)

    if (player.stage === EvolutionStage.CYBER_ORGANISM) {
      friction = getConfig('CYBER_ORGANISM_FRICTION'); // Quick stop (0.25)
    }
    // TODO: HUMANOID and GODCELL friction when implemented

    const frictionFactor = Math.pow(friction, deltaTime);
    velocity.x *= frictionFactor;
    velocity.y *= frictionFactor;

    // Stage 3+ players don't interact with soup obstacles (they've transcended)
    if (isJungleStage(player.stage)) continue;

    // Accumulate gravity forces into existing velocity (don't reset)
    for (const obstacle of obstacles.values()) {
      const dist = distance(player.position, obstacle.position);
      if (dist > obstacle.radius) continue; // Outside event horizon

      // Instant death at singularity core (energy-only: energy = 0)
      // God mode players survive singularities
      if (dist < getConfig('OBSTACLE_CORE_RADIUS') && !hasGodMode(playerId)) {
        logSingularityCrush(playerId, dist);
        // Use ECS setter to persist the change
        setEnergyBySocketId(world, playerId, 0); // Instant energy depletion (will be processed by checkPlayerDeaths)
        playerLastDamageSource.set(playerId, 'singularity');
        continue;
      }

      // Inverse-square gravity: F = strength / dist²
      // Prevent divide-by-zero and extreme forces
      const distSq = Math.max(dist * dist, 100);

      // Scale gravity strength for pixels/second velocity units
      // obstacle.strength (0.03) needs massive scaling for pixel velocities
      const gravityStrength = obstacle.strength * 100000000; // Scale factor for pixels/second (10x more)
      const forceMagnitude = gravityStrength / distSq;

      // Direction FROM player TO obstacle (attraction)
      const dx = obstacle.position.x - player.position.x;
      const dy = obstacle.position.y - player.position.y;
      const dirLength = Math.sqrt(dx * dx + dy * dy);

      if (dirLength === 0) continue;

      const dirX = dx / dirLength;
      const dirY = dy / dirLength;

      // Accumulate gravitational acceleration (pixels/second²) into velocity
      // Multiply by deltaTime to get velocity change for this frame
      velocity.x += dirX * forceMagnitude * deltaTime;
      velocity.y += dirY * forceMagnitude * deltaTime;

      // DEBUG: Log gravity forces
      if (!isBot(playerId)) {
        logGravityDebug(playerId, dist, forceMagnitude, velocity);
      }
    }
  }

  // Apply gravity to entropy swarms with momentum (corrupted data, less mass)
  for (const swarm of getSwarms().values()) {
    // Apply friction to swarms (same momentum system as players)
    const swarmFrictionFactor = Math.pow(getConfig('MOVEMENT_FRICTION'), deltaTime);
    swarm.velocity.x *= swarmFrictionFactor;
    swarm.velocity.y *= swarmFrictionFactor;

    // Accumulate gravity forces into existing velocity
    for (const obstacle of obstacles.values()) {
      const dist = distance(swarm.position, obstacle.position);
      if (dist > obstacle.radius) continue; // Outside event horizon

      // Swarms can get destroyed by singularities too
      if (dist < getConfig('OBSTACLE_CORE_RADIUS')) {
        // For now, swarms just get pulled through - they're corrupted data, they might survive
        // Could add swarm death logic later
        continue;
      }

      // 80% gravity resistance compared to players (original value)
      // Corrupted data has less mass - now works with momentum system
      const distSq = Math.max(dist * dist, 100);
      const gravityStrength = obstacle.strength * 100000000;
      const forceMagnitude = (gravityStrength / distSq) * 0.2; // 20% gravity (80% resistance)

      // Direction FROM swarm TO obstacle (attraction)
      const dx = obstacle.position.x - swarm.position.x;
      const dy = obstacle.position.y - swarm.position.y;
      const dirLength = Math.sqrt(dx * dx + dy * dy);

      if (dirLength === 0) continue;

      const dirX = dx / dirLength;
      const dirY = dy / dirLength;

      // Accumulate gravitational acceleration into velocity (frame-rate independent)
      swarm.velocity.x += dirX * forceMagnitude * deltaTime;
      swarm.velocity.y += dirY * forceMagnitude * deltaTime;
    }
  }
}

// ============================================
// Game Loop (Server Tick)
// ============================================

/**
 * Main game loop - runs 60 times per second
 * All game logic is now handled by the ECS System Runner.
 *
 * System execution order (by priority):
 * 1. BotAISystem (100) - Bot decision making
 * 2. SwarmAISystem (110) - Swarm AI, movement, respawns
 * 3. GravitySystem (200) - Apply gravity forces
 * 4. PseudopodSystem (300) - Beam physics
 * 5. PredationSystem (400) - Player-player eating
 * 6. SwarmCollisionSystem (410) - Swarm damage + consumption
 * 7. MovementSystem (500) - Player movement
 * 8. MetabolismSystem (600) - Energy decay
 * 9. NutrientCollisionSystem (610) - Nutrient pickup
 * 10. NutrientAttractionSystem (620) - Nutrient visual attraction
 * 11. DeathSystem (700) - Death checks
 * 12. NetworkBroadcastSystem (900) - State broadcasts
 */
setInterval(() => {
  // Check if game is paused (dev tool) - skip tick unless stepping
  if (!shouldRunTick()) return;

  const deltaTime = TICK_INTERVAL / 1000; // Convert to seconds

  // Build game context for this tick
  const ctx = buildGameContext(deltaTime);

  // Run all systems in priority order
  systemRunner.update(ctx);
}, TICK_INTERVAL);

// ============================================
// Periodic Logging
// ============================================

/**
 * Calculate aggregate statistics about the game state
 * Energy-only system: energy is the sole life resource
 */
function calculateAggregateStats() {
  const allPlayers = Array.from(players.values());
  const alivePlayers = allPlayers.filter(p => p.energy > 0);
  const deadPlayers = allPlayers.filter(p => p.energy <= 0);
  const bots = allPlayers.filter(p => isBot(p.id));
  const aliveBots = bots.filter(p => p.energy > 0);

  // Calculate averages for alive players only
  const avgEnergy = alivePlayers.length > 0
    ? alivePlayers.reduce((sum, p) => sum + p.energy, 0) / alivePlayers.length
    : 0;

  // Stage distribution
  const stageDistribution: Record<string, number> = {};
  for (const player of alivePlayers) {
    stageDistribution[player.stage] = (stageDistribution[player.stage] || 0) + 1;
  }

  return {
    totalPlayers: allPlayers.length,
    alivePlayers: alivePlayers.length,
    deadPlayers: deadPlayers.length,
    totalBots: bots.length,
    aliveBots: aliveBots.length,
    avgPlayerEnergy: avgEnergy,
    totalNutrients: nutrients.size,
    stageDistribution,
  };
}

/**
 * Create a complete game state snapshot
 * Energy-only system: energy is the sole life resource
 */
function createGameStateSnapshot() {
  return {
    timestamp: Date.now(),
    players: Array.from(players.values()).map(p => ({
      id: p.id,
      isBot: isBot(p.id),
      stage: p.stage,
      energy: p.energy,
      maxEnergy: p.maxEnergy,
      position: { x: p.position.x, y: p.position.y },
      alive: p.energy > 0,
    })),
    nutrients: Array.from(nutrients.values()).map(n => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      value: n.value,
    })),
    obstacles: Array.from(obstacles.values()).map(o => ({
      id: o.id,
      position: { x: o.position.x, y: o.position.y },
      radius: o.radius,
    })),
  };
}

// Log aggregate stats every 15 seconds
setInterval(() => {
  const stats = calculateAggregateStats();
  logAggregateStats(stats);
}, 15000);

// Log bot death rate stats every 30 seconds (tracks deaths by cause in rolling 60s window)
setInterval(() => {
  maybeLogDeathRateStats();
}, 5000); // Check frequently, but only logs every 30s when there are deaths

// Log evolution rate stats every 30 seconds (tracks evolutions by transition type in rolling 60s window)
setInterval(() => {
  maybeLogEvolutionRateStats();
}, 5000); // Check frequently, but only logs every 30s when there are evolutions

// Log nutrient collection rate stats every 30 seconds (tracks collections in rolling 60s window)
setInterval(() => {
  maybeLogNutrientCollectionStats();
}, 5000); // Check frequently, but only logs every 30s when there are collections

// Log lifetime stats every 60 seconds (average rates since server start)
setInterval(() => {
  maybeLogLifetimeStats();
}, 10000); // Check every 10s, but only logs every 60s

// Log full game state snapshot every 60 seconds
setInterval(() => {
  const snapshot = createGameStateSnapshot();
  logGameStateSnapshot(snapshot);
}, 60000);
