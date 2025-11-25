// ============================================
// Dev Panel Server Handler
// Handles dev commands for live game tuning
// Only active in development mode
// ============================================

import type { Server, Socket } from 'socket.io';
import {
  GAME_CONFIG,
  EvolutionStage,
  DEV_TUNABLE_CONFIGS,
  type DevCommand,
  type DevConfigUpdatedMessage,
  type DevStateMessage,
  type Position,
  type Player,
  type Nutrient,
  type EntropySwarm,
  type TunableConfigKey,
} from '@godcell/shared';
import { logger } from './logger';

// ============================================
// Dev State
// ============================================

// Runtime config overrides (applied on top of GAME_CONFIG)
const configOverrides: Map<string, number> = new Map();

// Dev mode state
let isPaused = false;
let timeScale = 1.0;
const godModePlayers: Set<string> = new Set();

// Step flag for single-tick advancement when paused
let shouldStepTick = false;

// ============================================
// Config Access (with overrides)
// ============================================

/**
 * Get a config value, checking overrides first
 */
export function getConfig<K extends keyof typeof GAME_CONFIG>(key: K): typeof GAME_CONFIG[K] {
  const override = configOverrides.get(key);
  if (override !== undefined) {
    return override as typeof GAME_CONFIG[K];
  }
  return GAME_CONFIG[key];
}

/**
 * Check if game is paused
 */
export function isGamePaused(): boolean {
  return isPaused;
}

/**
 * Get current time scale
 */
export function getTimeScale(): number {
  return timeScale;
}

/**
 * Check if player has god mode
 */
export function hasGodMode(playerId: string): boolean {
  return godModePlayers.has(playerId);
}

/**
 * Check if we should run a single tick (when paused)
 */
export function shouldRunTick(): boolean {
  if (!isPaused) return true;
  if (shouldStepTick) {
    shouldStepTick = false;
    return true;
  }
  return false;
}

// ============================================
// Dev Command Handlers
// ============================================

interface DevContext {
  io: Server;
  players: Map<string, Player>;
  nutrients: Map<string, Nutrient>;
  obstacles: Map<string, { id: string; position: Position; radius: number; strength: number; damageRate: number }>;
  swarms: Map<string, EntropySwarm>;
  playerInputDirections: Map<string, { x: number; y: number }>;
  playerVelocities: Map<string, { x: number; y: number }>;
  spawnNutrientAt: (position: Position, multiplier?: number) => Nutrient;
  spawnSwarmAt: (io: Server, position: Position) => EntropySwarm;
  spawnBotAt: (position: Position, stage: EvolutionStage) => string;
  removeBotPermanently: (botId: string) => boolean;
  respawnPlayer: (player: Player) => void;
  getStageEnergy: (stage: EvolutionStage) => { energy: number; maxEnergy: number };
  getPlayerRadius: (stage: EvolutionStage) => number;
}

let devContext: DevContext | null = null;

/**
 * Initialize dev handler with game context
 */
export function initDevHandler(context: DevContext) {
  devContext = context;
}

/**
 * Handle a dev command from a client
 */
export function handleDevCommand(socket: Socket, io: Server, command: DevCommand): void {
  if (!devContext) {
    logger.warn({ event: 'dev_command_no_context', command: command.action });
    return;
  }

  logger.info({ event: 'dev_command', action: command.action, socketId: socket.id });

  switch (command.action) {
    case 'updateConfig':
      handleUpdateConfig(io, command.key, command.value);
      break;

    case 'spawnEntity':
      handleSpawnEntity(io, command.entityType, command.position, command.options);
      break;

    case 'deleteEntity':
      handleDeleteEntity(io, command.entityType, command.entityId);
      break;

    case 'setGodMode':
      handleSetGodMode(io, command.playerId, command.enabled);
      break;

    case 'setTimeScale':
      handleSetTimeScale(io, command.scale);
      break;

    case 'teleportPlayer':
      handleTeleportPlayer(io, command.playerId, command.position);
      break;

    case 'setPlayerEnergy':
      handleSetPlayerEnergy(io, command.playerId, command.energy, command.maxEnergy);
      break;

    case 'setPlayerStage':
      handleSetPlayerStage(io, command.playerId, command.stage);
      break;

    case 'pauseGame':
      handlePauseGame(io, command.paused);
      break;

    case 'stepTick':
      handleStepTick();
      break;

    case 'deleteAt':
      handleDeleteAt(io, command.position, command.entityType);
      break;

    case 'clearWorld':
      handleClearWorld(io);
      break;
  }
}

function handleUpdateConfig(io: Server, key: string, value: number): void {
  // Validate key is tunable
  if (!DEV_TUNABLE_CONFIGS.includes(key as TunableConfigKey)) {
    logger.warn({ event: 'dev_invalid_config_key', key });
    return;
  }

  // Store override
  configOverrides.set(key, value);

  // Broadcast to all clients
  const message: DevConfigUpdatedMessage = {
    type: 'devConfigUpdated',
    key,
    value,
  };
  io.emit('devConfigUpdated', message);

  logger.info({ event: 'dev_config_updated', key, value });
}

function handleSpawnEntity(
  io: Server,
  entityType: string,
  position: Position,
  options?: { nutrientMultiplier?: 1 | 2 | 3 | 5; botStage?: EvolutionStage }
): void {
  if (!devContext) return;

  switch (entityType) {
    case 'nutrient': {
      const nutrient = devContext.spawnNutrientAt(position, options?.nutrientMultiplier || 1);
      io.emit('nutrientSpawned', { type: 'nutrientSpawned', nutrient });
      logger.info({ event: 'dev_spawn_nutrient', position, multiplier: options?.nutrientMultiplier || 1 });
      break;
    }

    case 'swarm': {
      const swarm = devContext.spawnSwarmAt(io, position);
      logger.info({ event: 'dev_spawn_swarm', position, swarmId: swarm.id });
      break;
    }

    case 'single-cell': {
      const botId = devContext.spawnBotAt(position, EvolutionStage.SINGLE_CELL);
      logger.info({ event: 'dev_spawn_single_cell', position, botId });
      break;
    }

    case 'multi-cell': {
      const botId = devContext.spawnBotAt(position, EvolutionStage.MULTI_CELL);
      logger.info({ event: 'dev_spawn_multi_cell', position, botId });
      break;
    }

    case 'obstacle': {
      // Obstacles are static and spawned at init - log but don't implement
      logger.info({ event: 'dev_spawn_obstacle_not_implemented', position });
      break;
    }
  }
}

function handleDeleteEntity(io: Server, entityType: string, entityId: string): void {
  if (!devContext) return;

  switch (entityType) {
    case 'nutrient': {
      const deleted = devContext.nutrients.delete(entityId);
      if (deleted) {
        io.emit('nutrientCollected', { type: 'nutrientCollected', nutrientId: entityId, playerId: 'dev', collectorEnergy: 0, collectorMaxEnergy: 0 });
        logger.info({ event: 'dev_delete_nutrient', entityId });
      }
      break;
    }

    case 'swarm': {
      const deleted = devContext.swarms.delete(entityId);
      if (deleted) {
        io.emit('swarmConsumed', { type: 'swarmConsumed', swarmId: entityId, consumerId: 'dev' });
        logger.info({ event: 'dev_delete_swarm', entityId });
      }
      break;
    }

    case 'player': {
      const player = devContext.players.get(entityId);
      if (player) {
        player.energy = 0;
        io.emit('playerDied', { type: 'playerDied', playerId: entityId, position: player.position, color: player.color, cause: 'starvation' });
        logger.info({ event: 'dev_kill_player', entityId });
      }
      break;
    }
  }
}

function handleSetGodMode(io: Server, playerId: string, enabled: boolean): void {
  if (enabled) {
    godModePlayers.add(playerId);
  } else {
    godModePlayers.delete(playerId);
  }

  broadcastDevState(io);
  logger.info({ event: 'dev_god_mode', playerId, enabled });
}

function handleSetTimeScale(io: Server, scale: number): void {
  // Clamp to reasonable range
  timeScale = Math.max(0, Math.min(scale, 5));
  broadcastDevState(io);
  logger.info({ event: 'dev_time_scale', scale: timeScale });
}

function handleTeleportPlayer(io: Server, playerId: string, position: Position): void {
  if (!devContext) return;

  const player = devContext.players.get(playerId);
  if (!player) return;

  // Clamp to world bounds
  player.position.x = Math.max(0, Math.min(position.x, GAME_CONFIG.WORLD_WIDTH));
  player.position.y = Math.max(0, Math.min(position.y, GAME_CONFIG.WORLD_HEIGHT));

  io.emit('playerMoved', { type: 'playerMoved', playerId, position: player.position });
  logger.info({ event: 'dev_teleport', playerId, position: player.position });
}

function handleSetPlayerEnergy(io: Server, playerId: string, energy: number, maxEnergy?: number): void {
  if (!devContext) return;

  const player = devContext.players.get(playerId);
  if (!player) return;

  if (maxEnergy !== undefined) {
    player.maxEnergy = maxEnergy;
  }
  player.energy = Math.min(energy, player.maxEnergy);

  io.emit('energyUpdate', { type: 'energyUpdate', playerId, energy: player.energy });
  logger.info({ event: 'dev_set_energy', playerId, energy: player.energy, maxEnergy: player.maxEnergy });
}

function handleSetPlayerStage(io: Server, playerId: string, stage: EvolutionStage): void {
  if (!devContext) return;

  const player = devContext.players.get(playerId);
  if (!player) return;

  const oldStage = player.stage;
  player.stage = stage;

  // Set energy pools to match the new stage (dev override, not natural evolution)
  const stageStats = devContext.getStageEnergy(stage);
  player.maxEnergy = stageStats.maxEnergy;
  player.energy = stageStats.energy; // Reset to starting energy for this stage

  io.emit('playerEvolved', { type: 'playerEvolved', playerId, newStage: stage, newMaxEnergy: player.maxEnergy });
  io.emit('energyUpdate', { type: 'energyUpdate', playerId, energy: player.energy });
  logger.info({ event: 'dev_set_stage', playerId, oldStage, newStage: stage });
}

function handlePauseGame(io: Server, paused: boolean): void {
  isPaused = paused;
  broadcastDevState(io);
  logger.info({ event: 'dev_pause', paused });
}

function handleStepTick(): void {
  if (isPaused) {
    shouldStepTick = true;
    logger.info({ event: 'dev_step_tick' });
  }
}

function handleClearWorld(io: Server): void {
  if (!devContext) return;

  // Clear all nutrients
  const nutrientCount = devContext.nutrients.size;
  for (const nutrientId of devContext.nutrients.keys()) {
    io.emit('nutrientCollected', {
      type: 'nutrientCollected',
      nutrientId,
      playerId: 'dev',
      collectorEnergy: 0,
      collectorMaxEnergy: 0,
    });
  }
  devContext.nutrients.clear();

  // Clear all swarms
  const swarmCount = devContext.swarms.size;
  for (const swarmId of devContext.swarms.keys()) {
    io.emit('swarmConsumed', {
      type: 'swarmConsumed',
      swarmId,
      consumerId: 'dev',
    });
  }
  devContext.swarms.clear();

  logger.info({ event: 'dev_clear_world', nutrientsCleared: nutrientCount, swarmsCleared: swarmCount });
}

function handleDeleteAt(io: Server, position: Position, entityType: 'nutrient' | 'swarm' | 'single-cell' | 'multi-cell'): void {
  if (!devContext) return;

  const MAX_DELETE_DISTANCE = 100; // Max distance to find entity
  let nearestId: string | null = null;
  let nearestDist = MAX_DELETE_DISTANCE;

  if (entityType === 'nutrient') {
    // Find nearest nutrient
    for (const [id, nutrient] of devContext.nutrients.entries()) {
      const dx = nutrient.position.x - position.x;
      const dy = nutrient.position.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
      }
    }

    if (nearestId) {
      devContext.nutrients.delete(nearestId);
      io.emit('nutrientCollected', {
        type: 'nutrientCollected',
        nutrientId: nearestId,
        playerId: 'dev',
        collectorEnergy: 0,
        collectorMaxEnergy: 0,
      });
      logger.info({ event: 'dev_delete_at_nutrient', position, deletedId: nearestId });
    }
  } else if (entityType === 'swarm') {
    // Find nearest swarm
    for (const [id, swarm] of devContext.swarms.entries()) {
      const dx = swarm.position.x - position.x;
      const dy = swarm.position.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
      }
    }

    if (nearestId) {
      devContext.swarms.delete(nearestId);
      io.emit('swarmConsumed', {
        type: 'swarmConsumed',
        swarmId: nearestId,
        consumerId: 'dev',
      });
      logger.info({ event: 'dev_delete_at_swarm', position, deletedId: nearestId });
    }
  } else if (entityType === 'single-cell' || entityType === 'multi-cell') {
    // Find nearest bot of the specified type
    const isSingleCell = entityType === 'single-cell';
    for (const [id, player] of devContext.players.entries()) {
      // Only consider bots (players with 'bot-' prefix)
      if (!id.startsWith('bot-')) continue;

      // Filter by type: single-cell bots don't have 'multicell' in ID
      const isMultiCellBot = id.includes('multicell');
      if (isSingleCell && isMultiCellBot) continue;
      if (!isSingleCell && !isMultiCellBot) continue;

      const dx = player.position.x - position.x;
      const dy = player.position.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
      }
    }

    if (nearestId) {
      const player = devContext.players.get(nearestId);
      if (player) {
        // Permanently remove the bot (no respawn)
        devContext.removeBotPermanently(nearestId);
        io.emit('playerDied', {
          type: 'playerDied',
          playerId: nearestId,
          position: player.position,
          color: player.color,
          cause: 'starvation',
        });
        logger.info({ event: 'dev_delete_at_bot', position, deletedId: nearestId, entityType });
      }
    }
  }
}

function broadcastDevState(io: Server): void {
  const state: DevStateMessage = {
    type: 'devState',
    isPaused,
    timeScale,
    godModePlayers: Array.from(godModePlayers),
  };
  io.emit('devState', state);
}

/**
 * Get current config overrides for client sync
 */
export function getConfigOverrides(): Record<string, number> {
  return Object.fromEntries(configOverrides);
}

/**
 * Reset all dev state
 */
export function resetDevState(): void {
  configOverrides.clear();
  isPaused = false;
  timeScale = 1.0;
  godModePlayers.clear();
  shouldStepTick = false;
}
