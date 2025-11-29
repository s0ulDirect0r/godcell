import { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Position,
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
  PlayerRespawnedMessage,
  EMPActivateMessage,
} from '@godcell/shared';
import { initializeBots, updateBots, isBot, spawnBotAt, removeBotPermanently, setBotEcsWorld } from './bots';
import { AbilitySystem } from './abilities';
import { initializeSwarms, updateSwarms, updateSwarmPositions, checkSwarmCollisions, getSwarmsRecord, getSwarms, removeSwarm, processSwarmRespawns, spawnSwarmAt, setSwarmEcsWorld } from './swarms';
import { initNutrientModule, getNutrients, initializeNutrients, respawnNutrient, spawnNutrientAt } from './nutrients';
import { initDevHandler, handleDevCommand, isGamePaused, getTimeScale, hasGodMode, shouldRunTick, getConfig } from './dev';
import type { DevCommandMessage } from '@godcell/shared';
import {
  logger,
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
  recordSpawn,
} from './logger';

// ECS - Entity Component System
import {
  createWorld,
  createPlayer as ecsCreatePlayer,
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
  // Spawning utilities
  randomColor,
  randomSpawnPosition,
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
  initializeNutrients(obstacles);
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
  nutrients: getNutrients(),
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
    nutrients: getNutrients(),
    obstacles,
    getSwarms,
    pseudopods,
    pseudopodHits,

    // Player State Maps
    playerVelocities,
    playerInputDirections,
    playerSprintState,
    playerLastDamageSource,
    playerLastBeamShooter,
    pseudopodHitDecays,
    playerEMPCooldowns,
    playerPseudopodCooldowns,

    // Drain state
    activeDrains, // Map<preyId, predatorId> - see godcell-5nc for ECS migration
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
    updateSwarms,
    updateSwarmPositions,
    processSwarmRespawns,
    checkSwarmCollisions,
    respawnNutrient,
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
    nutrients: Object.fromEntries(getNutrients()),
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
    totalNutrients: getNutrients().size,
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
    nutrients: Array.from(getNutrients().values()).map(n => ({
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
