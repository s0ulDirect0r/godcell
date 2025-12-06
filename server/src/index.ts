import { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage } from '#shared';
import type {
  Player,
  Position,
  DeathCause,
  DamageSource,
  Pseudopod,
  PlayerMoveMessage,
  PlayerRespawnRequestMessage,
  PlayerSprintMessage,
  PseudopodFireMessage,
  ProjectileFireMessage,
  WorldSnapshotMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerRespawnedMessage,
  EMPActivateMessage,
  SelectSpecializationMessage,
  SpecializationSelectedMessage,
  CombatSpecialization,
  MeleeAttackMessage,
} from '#shared';
import { initializeBots, updateBots, isBot, spawnBotAt, removeBotPermanently, setBotEcsWorld } from './bots';
import { AbilitySystem } from './abilities';
import { initializeSwarms, updateSwarms, updateSwarmPositions, processSwarmRespawns, spawnSwarmAt } from './swarms';
import { initializeJungleFauna, processJungleFaunaRespawns } from './jungleFauna';
import { buildSwarmsRecord } from './ecs';
import { initNutrientModule, initializeNutrients, respawnNutrient, spawnNutrientAt } from './nutrients';
import { initDevHandler, handleDevCommand, isGamePaused, getTimeScale, shouldRunTick, getConfig } from './dev';
import type { DevCommandMessage } from '#shared';
import {
  logger,
  perfLogger,
  clientLogger,
  logServerStarted,
  logPlayerConnected,
  logPlayerDisconnected,
  logPlayerRespawn,
  logObstaclesSpawned,
  logAggregateStats,
  logGameStateSnapshot,
  maybeLogDeathRateStats,
  maybeLogEvolutionRateStats,
  maybeLogNutrientCollectionStats,
  maybeLogLifetimeStats,
  maybeLogMemoryUsage,
  recordSpawn,
} from './logger';

// ECS - Entity Component System
import {
  createWorld,
  createPlayer as ecsCreatePlayer,
  createObstacle,
  createTree,
  createSwarm as ecsCreateSwarm,
  createPseudopod as ecsCreatePseudopod,
  destroyEntity as ecsDestroyEntity,
  getEntityBySocketId,
  getEntityByStringId,
  Components,
  Tags,
  buildAlivePlayersRecord,
  buildPlayersRecord,
  buildNutrientsRecord,
  buildObstaclesRecord,
  getObstacleCount,
  buildTreesRecord,
  getTreeCount,
  // Stage 3+ entity builders
  buildDataFruitsRecord,
  buildCyberBugsRecord,
  buildJungleCreaturesRecord,
  buildProjectilesRecord,
  buildTrapsRecord,
  // Direct component access helpers
  getPlayerBySocketId,
  hasPlayer,
  getEnergyBySocketId,
  getPositionBySocketId,
  getStageBySocketId,
  getStunnedBySocketId,
  getVelocityBySocketId,
  getSprintBySocketId,
  getCooldownsBySocketId,
  getDamageTrackingBySocketId,
  isBotBySocketId,
  deletePlayerBySocketId,
  forEachPlayer,
  setPlayerStage,
  subtractEnergyBySocketId,
  // ECS setters - update component values directly
  setEnergyBySocketId,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
  setInputBySocketId,
  setVelocityBySocketId,
  setSprintBySocketId,
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
  CyberBugAISystem,
  JungleCreatureAISystem,
  PseudopodSystem,
  ProjectileSystem,
  TrapSystem,
  PredationSystem,
  SwarmCollisionSystem,
  TreeCollisionSystem,
  MovementSystem,
  MetabolismSystem,
  NutrientCollisionSystem,
  NutrientAttractionSystem,
  MacroResourceCollisionSystem,
  DataFruitSystem,
  DeathSystem,
  NetworkBroadcastSystem,
  SpecializationSystem,
  RespawnSystem,
  type CombatSpecializationComponent,
} from './ecs';
import {
  // Math utilities
  distance,
  rayCircleIntersection,
  poissonDiscSampling,
  gridJitterDistribution,
  // Stage helpers
  getStageMaxEnergy,
  getEnergyDecayRate,
  getWorldBoundsForStage,
  isSoupStage,
  isJungleStage,
  getStageEnergy,
  // Spawning utilities
  randomColor,
  randomSpawnPosition,
} from './helpers';
import { calculateAggregateStats, createWorldSnapshot } from './telemetry';

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
// ECS is the sole source of truth for all player state.
const world: World = createWorld();

// NOTE: playerInputDirections and playerVelocities migrated to ECS InputComponent and VelocityComponent
// NOTE: playerSprintState migrated to ECS SprintComponent

// NOTE: playerLastDamageSource and playerLastBeamShooter migrated to ECS DamageTrackingComponent

// NOTE: Pseudopods migrated to ECS PseudopodComponent - see PseudopodSystem

// NOTE: playerEMPCooldowns and playerPseudopodCooldowns migrated to ECS CooldownsComponent

// NOTE: activeDrains migrated to ECS DrainTargetComponent - see setDrainTarget/clearDrainTarget
// NOTE: activeSwarmDrains migrated to ECS SwarmComponent.beingConsumedBy
// NOTE: activeDamage migrated to ECS DamageTrackingComponent.activeDamage
// NOTE: pseudopodHitDecays migrated to ECS DamageTrackingComponent

// NOTE: obstacles migrated to ECS - use getAllObstacleSnapshots/getObstacleCount/buildObstaclesRecord

/**
 * Hitscan raycast for pseudopod beam
 * Checks line-circle intersection against all multi-cell players
 * Applies damage to closest hit and returns target ID
 */
function checkBeamHitscan(start: Position, end: Position, shooterId: string): string | null {
  // Use object wrapper pattern for closure mutation
  const result: { closestHit: { playerId: string; distance: number } | null } = { closestHit: null };

  forEachPlayer(world, (entity, playerId) => {
    // Skip shooter
    if (playerId === shooterId) return;

    const energyComp = getEnergyBySocketId(world, playerId);
    const stageComp = getStageBySocketId(world, playerId);
    const posComp = getPositionBySocketId(world, playerId);
    const stunnedComp = getStunnedBySocketId(world, playerId);
    if (!energyComp || !stageComp || !posComp) return;

    // Skip dead/evolving/stunned players
    if (energyComp.current <= 0) return;
    if (stageComp.isEvolving) return;
    if (stunnedComp?.until && Date.now() < stunnedComp.until) return;

    const targetRadius = stageComp.radius;
    const targetPosition = { x: posComp.x, y: posComp.y };
    const hitDist = rayCircleIntersection(start, end, targetPosition, targetRadius);

    if (hitDist !== null) {
      // Track closest hit
      if (!result.closestHit || hitDist < result.closestHit.distance) {
        result.closestHit = { playerId, distance: hitDist };
      }
    }
  });

  // Apply damage to closest hit
  if (result.closestHit) {
    const targetId = result.closestHit.playerId;
    subtractEnergyBySocketId(world, targetId, getConfig('PSEUDOPOD_DRAIN_RATE'));

    // Track damage source in ECS for death cause logging
    const damageTracking = getDamageTrackingBySocketId(world, targetId);
    if (damageTracking) {
      damageTracking.lastDamageSource = 'beam';
      damageTracking.lastBeamShooter = shooterId;
    }

    const energyComp = getEnergyBySocketId(world, targetId);
    logger.info({
      event: 'beam_hit',
      shooter: shooterId,
      target: targetId,
      damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
      targetEnergyRemaining: energyComp ? energyComp.current.toFixed(0) : 'unknown',
    });

    return targetId;
  }

  return null;
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

  // Create obstacles from generated positions (ECS is sole source of truth)
  for (const position of offsetPositions) {
    const obstacleId = `obstacle-${obstacleIdCounter++}`;
    createObstacle(
      world,
      obstacleId,
      position,
      getConfig('OBSTACLE_GRAVITY_RADIUS'),
      getConfig('OBSTACLE_GRAVITY_STRENGTH')
    );
  }

  const obstacleCount = getObstacleCount(world);
  logObstaclesSpawned(obstacleCount);

  if (obstacleCount < GAME_CONFIG.OBSTACLE_COUNT) {
    logger.warn(`Only placed ${obstacleCount}/${GAME_CONFIG.OBSTACLE_COUNT} obstacles (space constraints)`);
  }
}

/**
 * Initialize digital jungle trees using Bridson's Poisson Disc Sampling
 * Trees are Stage 3+ obstacles that block movement (hard collision).
 * Trees spawn in the jungle area, avoiding the soup region.
 *
 * Multi-scale architecture:
 * - Stage 1-2 (soup): Cannot see or collide with trees (invisible/intangible)
 * - Stage 3+ (jungle): Trees are visible obstacles requiring navigation
 */
function initializeTrees() {
  let treeIdCounter = 0;

  // Trees spawn in the full jungle, avoiding the soup region where Stage 1-2 players live
  // Soup region is centered in the jungle
  // Trees avoid only the small visual soup pool (not the entire soup region)
  // This creates a forest around the pool where Stage 3 players spawn
  const soupAvoidanceZone = {
    position: {
      x: GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2,
      y: GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2,
    },
    // Only avoid the visual pool (300px) + small buffer, NOT the soup gameplay region
    radius: GAME_CONFIG.SOUP_POOL_RADIUS + GAME_CONFIG.TREE_POOL_BUFFER,
  };

  logger.info({
    event: 'tree_avoidance_zone',
    center: soupAvoidanceZone.position,
    radius: soupAvoidanceZone.radius,
    jungleSize: { width: GAME_CONFIG.JUNGLE_WIDTH, height: GAME_CONFIG.JUNGLE_HEIGHT },
  });

  // Generate tree positions using Poisson disc sampling for organic distribution
  // Let Poisson disc fill naturally - no maxPoints cap
  const treePositions = poissonDiscSampling(
    GAME_CONFIG.JUNGLE_WIDTH,
    GAME_CONFIG.JUNGLE_HEIGHT,
    GAME_CONFIG.TREE_MIN_SPACING,
    Infinity, // No cap - let it fill naturally
    [], // No existing points
    [soupAvoidanceZone] // Avoid the pool itself
  );

  // Log sample of tree positions for debugging distribution
  if (treePositions.length > 0) {
    const sample = treePositions.slice(0, 5);
    logger.info({
      event: 'tree_positions_sample',
      samplePositions: sample.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      bounds: {
        minX: Math.round(Math.min(...treePositions.map(p => p.x))),
        maxX: Math.round(Math.max(...treePositions.map(p => p.x))),
        minY: Math.round(Math.min(...treePositions.map(p => p.y))),
        maxY: Math.round(Math.max(...treePositions.map(p => p.y))),
      },
    });
  }

  // Create trees from generated positions
  for (const position of treePositions) {
    const treeId = `tree-${treeIdCounter++}`;

    // Randomize tree size within configured bounds
    const radius = GAME_CONFIG.TREE_MIN_RADIUS +
      Math.random() * (GAME_CONFIG.TREE_MAX_RADIUS - GAME_CONFIG.TREE_MIN_RADIUS);
    const height = GAME_CONFIG.TREE_MIN_HEIGHT +
      Math.random() * (GAME_CONFIG.TREE_MAX_HEIGHT - GAME_CONFIG.TREE_MIN_HEIGHT);
    const variant = Math.random(); // Seed for procedural generation (0-1)

    createTree(world, treeId, position, radius, height, variant);
  }

  const treeCount = getTreeCount(world);
  logger.info({
    event: 'trees_spawned',
    count: treeCount,
    spacing: GAME_CONFIG.TREE_MIN_SPACING,
    jungleSize: `${GAME_CONFIG.JUNGLE_WIDTH}x${GAME_CONFIG.JUNGLE_HEIGHT}`,
  });
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
  setInputBySocketId(world, playerId, 0, 0);
  setVelocityBySocketId(world, playerId, 0, 0);

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


// ============================================
// Socket.io Server Setup
// ============================================

const io = new Server(PORT, {
  cors: {
    origin: '*', // Allow all origins for development
  },
});

logServerStarted(PORT);

// Initialize nutrient module with world and io references
initNutrientModule(world, io);

// Playground mode - empty world for testing (set by PLAYGROUND env var)
const isPlayground = process.env.PLAYGROUND === 'true';

if (isPlayground) {
  logger.info({ event: 'playground_mode', port: PORT });
} else {
  // Initialize game world (normal mode)
  // Pure Bridson's distribution - obstacles and swarms fill map naturally
  initializeObstacles();
  initializeTrees(); // Digital jungle trees (Stage 3+ obstacles)
  initializeJungleFauna(world, io); // Stage 3+ fauna: DataFruits, CyberBugs, JungleCreatures
  initializeNutrients();
  // Set ECS world for bots before initializing
  setBotEcsWorld(world);
  initializeBots(io);
  // Swarms use ECS directly (world passed as parameter)
  initializeSwarms(world, io);
}

// Initialize dev handler with game context
initDevHandler({
  io,
  world, // ECS World for direct component access (nutrients, obstacles, swarms queried from ECS)
  spawnNutrientAt,
  spawnSwarmAt: (position) => spawnSwarmAt(world, io, position),
  spawnBotAt: (position, stage) => spawnBotAt(io, position, stage),
  removeBotPermanently: (botId) => removeBotPermanently(botId, io),
  respawnPlayer,
  getStageEnergy,
});

// ============================================
// Ability System
// ============================================

const abilitySystem = new AbilitySystem({
  world,
  io,
  checkBeamHitscan,
});

// Export for use by bot AI
export { abilitySystem };

// ============================================
// ECS System Runner Setup
// ============================================

// Create the system runner and register all systems
const systemRunner = new SystemRunner();

// Register systems in priority order
// Deferred actions (pending respawns, timers)
systemRunner.register(new RespawnSystem(), SystemPriority.RESPAWN);

// AI Systems
systemRunner.register(new BotAISystem(), SystemPriority.BOT_AI);
systemRunner.register(new CyberBugAISystem(), SystemPriority.CYBER_BUG_AI);
systemRunner.register(new JungleCreatureAISystem(), SystemPriority.JUNGLE_CREATURE_AI);
systemRunner.register(new SwarmAISystem(), SystemPriority.SWARM_AI);
systemRunner.register(new SpecializationSystem(), SystemPriority.SPECIALIZATION);

// Lifecycle (fruit ripening)
systemRunner.register(new DataFruitSystem(), SystemPriority.DATA_FRUIT);

// Physics
systemRunner.register(new GravitySystem(), SystemPriority.GRAVITY);

// Abilities
systemRunner.register(new PseudopodSystem(), SystemPriority.PSEUDOPOD);
systemRunner.register(new ProjectileSystem(), SystemPriority.PROJECTILE);
systemRunner.register(new TrapSystem(), SystemPriority.TRAP);

// Collisions
systemRunner.register(new PredationSystem(), SystemPriority.PREDATION);
systemRunner.register(new SwarmCollisionSystem(), SystemPriority.SWARM_COLLISION);
systemRunner.register(new TreeCollisionSystem(), SystemPriority.TREE_COLLISION);
systemRunner.register(new MovementSystem(), SystemPriority.MOVEMENT);
systemRunner.register(new MetabolismSystem(), SystemPriority.METABOLISM);
systemRunner.register(new NutrientCollisionSystem(), SystemPriority.NUTRIENT_COLLISION);
systemRunner.register(new MacroResourceCollisionSystem(), SystemPriority.MACRO_RESOURCE_COLLISION);
systemRunner.register(new NutrientAttractionSystem(), SystemPriority.NUTRIENT_ATTRACTION);
systemRunner.register(new DeathSystem(), SystemPriority.DEATH);

// Network
systemRunner.register(new NetworkBroadcastSystem(), SystemPriority.NETWORK);

logger.info({
  event: 'systems_registered',
  systems: systemRunner.getSystemNames(),
});

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

  // NOTE: Input and velocity initialized by createPlayer via ECS InputComponent and VelocityComponent

  // Get the legacy Player object for the joinMessage broadcast
  const newPlayer = getPlayerBySocketId(world, socket.id)!;

  // Track spawn time for evolution rate tracking
  recordSpawn(socket.id, EvolutionStage.SINGLE_CELL);

  // Send world snapshot to the new player (initial state, sent once on connect)
  // Uses ECS to build player records, filtering out dead players (energy <= 0)
  const worldSnapshot: WorldSnapshotMessage = {
    type: 'worldSnapshot',
    players: buildAlivePlayersRecord(world),
    nutrients: buildNutrientsRecord(world),
    obstacles: buildObstaclesRecord(world),
    swarms: buildSwarmsRecord(world),
    trees: buildTreesRecord(world),
    // Stage 3+ jungle ecosystem entities
    dataFruits: buildDataFruitsRecord(world),
    cyberBugs: buildCyberBugsRecord(world),
    jungleCreatures: buildJungleCreaturesRecord(world),
    projectiles: buildProjectilesRecord(world),
    traps: buildTrapsRecord(world),
  };
  socket.emit('worldSnapshot', worldSnapshot);

  // Notify all OTHER players that someone joined
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: newPlayer,
  };
  socket.broadcast.emit('playerJoined', joinMessage);

  // ============================================
  // Socket Handler Error Wrapper
  // ============================================
  // Wraps socket event handlers in try-catch to prevent crashes from propagating
  // Logs errors with socket context and continues serving other events
  const safeHandler = <T>(eventName: string, handler: (message: T) => void) => {
    return (message: T) => {
      try {
        handler(message);
      } catch (error) {
        logger.error({
          event: 'socket_handler_error',
          socketId: socket.id,
          eventName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }, `Socket handler ${eventName} threw an error`);
      }
    };
  };

  // ============================================
  // Player Movement Input
  // ============================================

  socket.on('playerMove', safeHandler('playerMove', (message: PlayerMoveMessage) => {
    // Store player's input direction via ECS (will be combined with gravity in game loop)
    // Direction values are -1, 0, or 1 (z is for Stage 5 godcell 3D flight)
    setInputBySocketId(world, socket.id, message.direction.x, message.direction.y, message.direction.z ?? 0);
  }));

  // ============================================
  // Player Respawn Request
  // ============================================

  socket.on('playerRespawnRequest', safeHandler('playerRespawnRequest', (message: PlayerRespawnRequestMessage) => {
    // Check player exists and is dead using ECS
    const energyComp = getEnergyBySocketId(world, socket.id);
    if (!energyComp) return;

    // Only respawn if player is dead (energy <= 0)
    if (energyComp.current <= 0) {
      respawnPlayer(socket.id);
    }
  }));

  // ============================================
  // Pseudopod Beam Fire (Lightning Projectile)
  // ============================================

  socket.on('pseudopodFire', safeHandler('pseudopodFire', (message: PseudopodFireMessage) => {
    // Lookup entity at socket boundary, then use entity-based API
    const entity = getEntityBySocketId(socket.id);
    if (entity === undefined) return;
    abilitySystem.firePseudopod(entity, socket.id, message.targetX, message.targetY);
  }));

  // ============================================
  // Projectile Fire (Stage 3 ranged specialization attack)
  // ============================================

  socket.on('projectileFire', safeHandler('projectileFire', (message: ProjectileFireMessage) => {
    // Lookup entity at socket boundary, then use entity-based API
    const entity = getEntityBySocketId(socket.id);
    if (entity === undefined) return;
    abilitySystem.fireProjectile(entity, socket.id, message.targetX, message.targetY);
  }));

  // ============================================
  // EMP Activation (Multi-cell AoE stun ability)
  // ============================================

  socket.on('empActivate', safeHandler('empActivate', (_message: EMPActivateMessage) => {
    // Lookup entity at socket boundary, then use entity-based API
    const entity = getEntityBySocketId(socket.id);
    if (entity === undefined) return;
    abilitySystem.fireEMP(entity, socket.id);
  }));

  // ============================================
  // Sprint State (Stage 3+ ability)
  // ============================================

  socket.on('playerSprint', safeHandler('playerSprint', (message: PlayerSprintMessage) => {
    // Get player state from ECS
    const energyComp = getEnergyBySocketId(world, socket.id);
    const stageComp = getStageBySocketId(world, socket.id);
    if (!energyComp || !stageComp) return;

    // Only Stage 3+ can sprint
    if (!isJungleStage(stageComp.stage)) return;
    if (energyComp.current <= 0) return; // Dead players can't sprint
    if (stageComp.isEvolving) return; // Can't sprint while molting

    // Update sprint state in ECS
    setSprintBySocketId(world, socket.id, message.sprinting);
  }));

  // ============================================
  // Combat Specialization Selection (Stage 3)
  // ============================================

  socket.on('selectSpecialization', safeHandler('selectSpecialization', (message: SelectSpecializationMessage) => {
    const entity = getEntityBySocketId(socket.id);
    if (!entity) return;

    const specComp = world.getComponent<CombatSpecializationComponent>(
      entity,
      Components.CombatSpecialization
    );

    // Validate: must have pending selection
    if (!specComp || !specComp.selectionPending) {
      logger.warn({
        event: 'specialization_select_rejected',
        playerId: socket.id,
        reason: 'no_pending_selection',
      });
      return;
    }

    // Validate: must be a valid specialization choice
    const validChoices: CombatSpecialization[] = ['melee', 'ranged', 'traps'];
    if (!validChoices.includes(message.specialization as CombatSpecialization)) {
      logger.warn({
        event: 'specialization_select_rejected',
        playerId: socket.id,
        reason: 'invalid_choice',
        received: message.specialization,
      });
      return;
    }

    // Apply the selection
    specComp.specialization = message.specialization;
    specComp.selectionPending = false;

    // Broadcast the selection to all clients
    const selectedMessage: SpecializationSelectedMessage = {
      type: 'specializationSelected',
      playerId: socket.id,
      specialization: specComp.specialization,
    };
    io.emit('specializationSelected', selectedMessage);

    logger.info({
      event: 'specialization_selected',
      playerId: socket.id,
      specialization: specComp.specialization,
      isBot: isBot(socket.id),
    });
  }));

  // ============================================
  // Melee Attack (Stage 3 Melee specialization)
  // ============================================

  socket.on('meleeAttack', safeHandler('meleeAttack', (message: MeleeAttackMessage) => {
    // Lookup entity at socket boundary, then use entity-based API
    const entity = getEntityBySocketId(socket.id);
    if (entity === undefined) return;
    abilitySystem.fireMeleeAttack(entity, socket.id, message.attackType, message.targetX, message.targetY);
  }));

  socket.on('placeTrap', safeHandler('placeTrap', () => {
    logger.debug({ event: 'socket_place_trap', socketId: socket.id });
    // Lookup entity at socket boundary, then use entity-based API
    const entity = getEntityBySocketId(socket.id);
    if (entity === undefined) return;
    abilitySystem.placeTrap(entity, socket.id);
  }));

  // ============================================
  // Dev Command Handling (development mode only)
  // ============================================

  socket.on('devCommand', safeHandler('devCommand', (message: DevCommandMessage) => {
    // Only allow dev commands in development mode
    if (process.env.NODE_ENV === 'production') {
      logger.warn({ event: 'dev_command_blocked', socketId: socket.id, reason: 'production_mode' });
      return;
    }
    handleDevCommand(socket, io, message.command);
  }));

  // ============================================
  // Client Log Forwarding (for debugging)
  // ============================================

  socket.on('clientLog', safeHandler('clientLog', (message: { level: string; args: string[]; timestamp: number }) => {
    const socketId = socket.id || 'unknown';
    const clientId = socketId.slice(0, 8);
    // Validate input: ensure args is an array and limit size
    const args = Array.isArray(message.args) ? message.args.slice(0, 20) : [];
    const logLine = args.join(' ').slice(0, 2000); // Limit log line length

    // Route PERF logs to performance.log, others to client.log
    const targetLogger = logLine.includes('[PERF]') ? perfLogger : clientLogger;

    // Richer metadata: full socketId, clientLevel, descriptive event name
    const meta = {
      socketId,
      clientId,
      clientLevel: message.level,
      event: 'player_client_log',
    };

    if (message.level === 'error') {
      targetLogger.error(meta, logLine);
    } else if (message.level === 'warn') {
      targetLogger.warn(meta, logLine);
    } else {
      targetLogger.info(meta, logLine);
    }
  }));

  // ============================================
  // Disconnection Handling
  // ============================================

  socket.on('disconnect', safeHandler('disconnect', () => {
    logPlayerDisconnected(socket.id);

    // Remove from ECS (source of truth)
    const entity = getEntityBySocketId(socket.id);
    if (entity !== undefined) {
      ecsDestroyEntity(world, entity);
    }

    // NOTE: All player ECS components (Input, Velocity, Sprint) removed by ecsDestroyEntity above

    // Notify other players
    const leftMessage: PlayerLeftMessage = {
      type: 'playerLeft',
      playerId: socket.id,
    };
    socket.broadcast.emit('playerLeft', leftMessage);
  }));
});

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
// Track actual tick timing to detect variance
let lastTickTime = performance.now();
let tickCount = 0;

setInterval(() => {
  // Check if game is paused (dev tool) - skip tick unless stepping
  if (!shouldRunTick()) return;

  // Measure actual time since last tick (detects server tick variance)
  const now = performance.now();
  const actualDelta = now - lastTickTime;
  lastTickTime = now;
  tickCount++;

  // Calculate deltaTime (seconds per tick)
  const deltaTime = TICK_INTERVAL / 1000;

  // Time the actual tick processing
  const tickProcessingStart = performance.now();

  // Process fauna respawns before system updates (Stage 3+ ecosystem)
  processJungleFaunaRespawns(world, io);

  // Run all systems in priority order
  // World = game state, deltaTime = frame context, io = network infrastructure
  systemRunner.update(world, deltaTime, io);

  // Clear transient per-tick tags used for cross-system communication
  world.clearTagFromAll(Tags.SlowedThisTick);
  world.clearTagFromAll(Tags.DamagedThisTick);

  const tickProcessingMs = performance.now() - tickProcessingStart;

  // Log if actual tick delta exceeds expected by 50% (> 25ms for 16.67ms tick)
  // Compare actualDelta (time since last tick) vs tickProcessingMs (time spent in tick)
  // If actualDelta >> tickProcessingMs, event loop was blocked (GC, etc.)
  // If tickProcessingMs is high, our systems are slow
  if (actualDelta > TICK_INTERVAL * 1.5) {
    perfLogger.info({
      event: 'tick_variance',
      tickNum: tickCount,
      actualDeltaMs: actualDelta.toFixed(1),
      tickProcessingMs: tickProcessingMs.toFixed(1),
      expectedMs: TICK_INTERVAL.toFixed(1),
      ratio: (actualDelta / TICK_INTERVAL).toFixed(2),
    }, `Tick variance: ${actualDelta.toFixed(1)}ms (processing: ${tickProcessingMs.toFixed(1)}ms)`);
  }
}, TICK_INTERVAL);

// ============================================
// Periodic Logging
// ============================================

// Helper to wrap interval callbacks in try-catch
const safeInterval = (name: string, callback: () => void, interval: number) => {
  setInterval(() => {
    try {
      callback();
    } catch (error) {
      logger.error({
        event: 'interval_error',
        intervalName: name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, `Interval ${name} threw an error`);
    }
  }, interval);
};

// Log aggregate stats every 15 seconds
safeInterval('aggregate_stats', () => {
  const stats = calculateAggregateStats(world);
  logAggregateStats(stats);
}, 15000);

// Log bot death rate stats every 30 seconds (tracks deaths by cause in rolling 60s window)
safeInterval('death_rate_stats', () => {
  maybeLogDeathRateStats();
}, 5000); // Check frequently, but only logs every 30s when there are deaths

// Log evolution rate stats every 30 seconds (tracks evolutions by transition type in rolling 60s window)
safeInterval('evolution_rate_stats', () => {
  maybeLogEvolutionRateStats();
}, 5000); // Check frequently, but only logs every 30s when there are evolutions

// Log nutrient collection rate stats every 30 seconds (tracks collections in rolling 60s window)
safeInterval('nutrient_collection_stats', () => {
  maybeLogNutrientCollectionStats();
}, 5000); // Check frequently, but only logs every 30s when there are collections

// Log lifetime stats every 60 seconds (average rates since server start)
safeInterval('lifetime_stats', () => {
  maybeLogLifetimeStats();
}, 10000); // Check every 10s, but only logs every 60s

// Log server memory usage every 60 seconds (heap, RSS, external)
safeInterval('memory_usage', () => {
  maybeLogMemoryUsage();
}, 10000); // Check every 10s, but only logs every 60s

// Log full world snapshot every 60 seconds
safeInterval('world_snapshot', () => {
  const snapshot = createWorldSnapshot(world);
  logGameStateSnapshot(snapshot);
}, 60000);
