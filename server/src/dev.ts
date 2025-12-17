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
  projectToSphere,
  type DevCommand,
  type DevConfigUpdatedMessage,
  type DevStateMessage,
  type Position,
  type Nutrient, // Still needed for spawnNutrientAt return type
  type EntropySwarm, // Still needed for spawnSwarmAt return type
  type TunableConfigKey,
  type World,
  type SpecializationPromptMessage,
  type CombatSpecializationComponent,
  type SphereContextComponent,
} from '#shared';
import { logger } from './logger';
import {
  setEnergy,
  setMaxEnergy,
  setStage,
  setPosition,
  getEnergy,
  getStage,
  getPosition,
  getEntityBySocketId,
  forEachPlayer,
  forEachNutrient,
  getEntityByStringId,
  destroyEntity,
  getNutrientCount,
  forEachSwarm,
  getSwarmCount,
  getSwarmComponents,
  Components,
} from './ecs';
import { removeSwarm } from './swarms';
import { getNextEvolutionStage } from './helpers/stages';

// ============================================
// Dev State
// ============================================

// Runtime config overrides (applied on top of GAME_CONFIG)
const configOverrides: Map<string, number> = new Map();

// Dev mode state
let isPaused = false;
let timeScale = 1.0;

// Step flag for single-tick advancement when paused
let shouldStepTick = false;

// ============================================
// Config Access (with overrides)
// ============================================

/**
 * Get a config value, checking overrides first
 */
export function getConfig<K extends keyof typeof GAME_CONFIG>(key: K): (typeof GAME_CONFIG)[K] {
  const override = configOverrides.get(key);
  if (override !== undefined) {
    return override as (typeof GAME_CONFIG)[K];
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
  world: World; // ECS World for direct component access (source of truth)
  // NOTE: nutrients migrated to ECS - use forEachNutrient/getNutrientCount
  // NOTE: obstacles migrated to ECS - use getAllObstacleSnapshots/getObstacleCount
  // NOTE: swarms migrated to ECS - use forEachSwarm/getSwarmCount
  // NOTE: playerInputDirections and playerVelocities migrated to ECS InputComponent and VelocityComponent
  spawnNutrientAt: (position: Position, multiplier?: number) => Nutrient;
  spawnSwarmAt: (position: Position) => EntropySwarm;
  spawnBotAt: (position: Position, stage: EvolutionStage) => string;
  removeBotPermanently: (botId: string) => boolean;
  respawnPlayer: (playerId: string) => void;
  getStageEnergy: (stage: EvolutionStage) => { energy: number; maxEnergy: number };
  // Note: getPlayerRadius removed - use stageComp.radius directly from ECS
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

    case 'evolveNext':
      handleEvolveNext(io, command.playerId);
      break;

    case 'devolvePrev':
      handleDevolvePrev(io, command.playerId);
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
      logger.info({
        event: 'dev_spawn_nutrient',
        position,
        multiplier: options?.nutrientMultiplier || 1,
      });
      break;
    }

    case 'swarm': {
      const swarm = devContext.spawnSwarmAt(position);
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

    case 'cyber-organism': {
      const botId = devContext.spawnBotAt(position, EvolutionStage.CYBER_ORGANISM);
      logger.info({ event: 'dev_spawn_cyber_organism', position, botId });
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
      // Find nutrient entity in ECS by string ID
      const nutrientEntity = getEntityByStringId(entityId);
      if (nutrientEntity !== undefined) {
        destroyEntity(devContext.world, nutrientEntity);
        io.emit('nutrientCollected', {
          type: 'nutrientCollected',
          nutrientId: entityId,
          playerId: 'dev',
          collectorEnergy: 0,
          collectorMaxEnergy: 0,
        });
        logger.info({ event: 'dev_delete_nutrient', entityId });
      }
      break;
    }

    case 'swarm': {
      const swarmComponents = getSwarmComponents(devContext.world, entityId);
      if (swarmComponents) {
        removeSwarm(devContext.world, entityId);
        io.emit('swarmConsumed', { type: 'swarmConsumed', swarmId: entityId, consumerId: 'dev' });
        logger.info({ event: 'dev_delete_swarm', entityId });
      }
      break;
    }

    case 'player': {
      // Check if player exists via ECS and lookup entity
      const entity = getEntityBySocketId(entityId);
      if (entity !== undefined) {
        const posComp = getPosition(devContext.world, entity);
        // Use entity-based setter to persist the energy change
        setEnergy(devContext.world, entity, 0);
        io.emit('playerDied', {
          type: 'playerDied',
          playerId: entityId,
          position: posComp ? { x: posComp.x, y: posComp.y } : { x: 0, y: 0 },
          color: '#ff0000', // Color not critical for dev kill
          cause: 'starvation',
        });
        logger.info({ event: 'dev_kill_player', entityId });
      }
      break;
    }
  }
}

function handleSetTimeScale(io: Server, scale: number): void {
  // Clamp to reasonable range
  timeScale = Math.max(0, Math.min(scale, 5));
  broadcastDevState(io);
  logger.info({ event: 'dev_time_scale', scale: timeScale });
}

function handleTeleportPlayer(io: Server, playerId: string, position: Position): void {
  if (!devContext) return;

  // Lookup entity at boundary
  const entity = getEntityBySocketId(playerId);
  if (entity === undefined) return;

  // Clamp to world bounds and update via entity-based setter
  const clampedX = Math.max(0, Math.min(position.x, GAME_CONFIG.WORLD_WIDTH));
  const clampedY = Math.max(0, Math.min(position.y, GAME_CONFIG.WORLD_HEIGHT));
  setPosition(devContext.world, entity, clampedX, clampedY);

  io.emit('playerMoved', {
    type: 'playerMoved',
    playerId,
    position: { x: clampedX, y: clampedY },
    velocity: { x: 0, y: 0, z: 0 },
  });
  logger.info({ event: 'dev_teleport', playerId, position: { x: clampedX, y: clampedY } });
}

function handleSetPlayerEnergy(
  io: Server,
  playerId: string,
  energy: number,
  maxEnergy?: number
): void {
  if (!devContext) return;

  // Lookup entity at boundary
  const entity = getEntityBySocketId(playerId);
  if (entity === undefined) return;

  // Get current ECS energy component (source of truth)
  const energyComp = getEnergy(devContext.world, entity);
  if (!energyComp) return;

  // Update via entity-based setters
  if (maxEnergy !== undefined) {
    setMaxEnergy(devContext.world, entity, maxEnergy);
    energyComp.max = maxEnergy; // Update local reference for broadcast
  }
  const newEnergy = Math.min(energy, energyComp.max);
  setEnergy(devContext.world, entity, newEnergy);

  io.emit('energyUpdate', { type: 'energyUpdate', playerId, energy: newEnergy });
  logger.info({ event: 'dev_set_energy', playerId, energy: newEnergy, maxEnergy: energyComp.max });
}

function handleSetPlayerStage(io: Server, playerId: string, stage: EvolutionStage): void {
  if (!devContext) return;

  // Lookup entity at boundary
  const entity = getEntityBySocketId(playerId);
  if (entity === undefined) return;

  // Read stage directly from ECS (source of truth)
  const stageComp = getStage(devContext.world, entity);
  if (!stageComp) return;

  const oldStage = stageComp.stage;

  // Set energy pools to match the new stage (dev override, not natural evolution)
  const stageStats = devContext.getStageEnergy(stage);

  // Update via entity-based setters - stage, maxEnergy, and energy
  setStage(devContext.world, entity, stage);
  setMaxEnergy(devContext.world, entity, stageStats.maxEnergy);
  setEnergy(devContext.world, entity, stageStats.energy);

  // Stage 3 (Cyber-Organism): Add combat specialization component and prompt
  // This mirrors MetabolismSystem behavior for natural evolution
  if (stage === EvolutionStage.CYBER_ORGANISM) {
    const now = Date.now();
    const deadline = now + GAME_CONFIG.SPECIALIZATION_SELECTION_DURATION;

    // Add or update the combat specialization component with pending selection
    if (devContext.world.hasComponent(entity, Components.CombatSpecialization)) {
      const spec = devContext.world.getComponent<CombatSpecializationComponent>(
        entity,
        Components.CombatSpecialization
      )!;
      spec.specialization = null;
      spec.selectionPending = true;
      spec.selectionDeadline = deadline;
    } else {
      devContext.world.addComponent<CombatSpecializationComponent>(
        entity,
        Components.CombatSpecialization,
        {
          specialization: null,
          selectionPending: true,
          selectionDeadline: deadline,
        }
      );
    }

    // Emit specialization prompt to trigger the modal
    const promptMessage: SpecializationPromptMessage = {
      type: 'specializationPrompt',
      playerId: playerId,
      deadline: deadline,
    };
    io.emit('specializationPrompt', promptMessage);

    logger.info({
      event: 'dev_specialization_prompt_sent',
      playerId,
      deadline,
    });

    // Teleport to jungle sphere (inner surface) - mirrors MetabolismSystem behavior
    const posComp = getPosition(devContext.world, entity);
    if (posComp) {
      const currentPos = { x: posComp.x, y: posComp.y, z: posComp.z ?? 0 };
      const junglePos = projectToSphere(currentPos, GAME_CONFIG.JUNGLE_SPHERE_RADIUS);

      // Update position to jungle sphere (directly set including z)
      posComp.x = junglePos.x;
      posComp.y = junglePos.y;
      posComp.z = junglePos.z;

      // Update sphere context to jungle inner surface
      const sphereCtx = devContext.world.getComponent<SphereContextComponent>(
        entity,
        Components.SphereContext
      );
      if (sphereCtx) {
        sphereCtx.surfaceRadius = GAME_CONFIG.JUNGLE_SPHERE_RADIUS;
        sphereCtx.isInnerSurface = true;
      }

      // Broadcast position update for sphere transition
      io.emit('playerMoved', {
        type: 'playerMoved',
        playerId: playerId,
        position: { x: junglePos.x, y: junglePos.y, z: junglePos.z },
        velocity: { x: 0, y: 0, z: 0 },
      });

      logger.info({
        event: 'dev_player_ascended_to_jungle',
        playerId,
        fromRadius: GAME_CONFIG.SOUP_SPHERE_RADIUS,
        toRadius: GAME_CONFIG.JUNGLE_SPHERE_RADIUS,
        newPosition: junglePos,
      });
    }
  }

  io.emit('playerEvolved', {
    type: 'playerEvolved',
    playerId,
    newStage: stage,
    newMaxEnergy: stageStats.maxEnergy,
    radius: stageComp.radius,
  });
  io.emit('energyUpdate', { type: 'energyUpdate', playerId, energy: stageStats.energy });
  logger.info({ event: 'dev_set_stage', playerId, oldStage, newStage: stage });
}

function handleEvolveNext(io: Server, playerId: string): void {
  if (!devContext) return;

  const entity = getEntityBySocketId(playerId);
  if (entity === undefined) return;

  const stageComp = getStage(devContext.world, entity);
  if (!stageComp) return;

  const currentStage = stageComp.stage;
  const nextInfo = getNextEvolutionStage(currentStage);

  if (!nextInfo) {
    logger.info({ event: 'dev_evolve_next_already_max', playerId, currentStage });
    return;
  }

  // Delegate to existing stage-setting logic
  handleSetPlayerStage(io, playerId, nextInfo.stage);
  logger.info({ event: 'dev_evolve_next', playerId, from: currentStage, to: nextInfo.stage });
}

function handleDevolvePrev(io: Server, playerId: string): void {
  if (!devContext) return;

  const entity = getEntityBySocketId(playerId);
  if (entity === undefined) return;

  const stageComp = getStage(devContext.world, entity);
  if (!stageComp) return;

  const currentStage = stageComp.stage;

  // Get previous stage (reverse of evolution order)
  let prevStage: EvolutionStage | null = null;
  switch (currentStage) {
    case EvolutionStage.MULTI_CELL:
      prevStage = EvolutionStage.SINGLE_CELL;
      break;
    case EvolutionStage.CYBER_ORGANISM:
      prevStage = EvolutionStage.MULTI_CELL;
      break;
    case EvolutionStage.HUMANOID:
      prevStage = EvolutionStage.CYBER_ORGANISM;
      break;
    case EvolutionStage.GODCELL:
      prevStage = EvolutionStage.HUMANOID;
      break;
    default:
      // Already at single_cell (min stage)
      break;
  }

  if (!prevStage) {
    logger.info({ event: 'dev_devolve_prev_already_min', playerId, currentStage });
    return;
  }

  handleSetPlayerStage(io, playerId, prevStage);
  logger.info({ event: 'dev_devolve_prev', playerId, from: currentStage, to: prevStage });
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

  // Clear all nutrients from ECS
  const nutrientCount = getNutrientCount(devContext.world);
  const nutrientsToDestroy: Array<{ entity: number; id: string }> = [];

  // Collect all nutrients first (can't modify during iteration)
  forEachNutrient(devContext.world, (entity, id) => {
    nutrientsToDestroy.push({ entity, id });
  });

  // Destroy and broadcast
  for (const { entity, id } of nutrientsToDestroy) {
    destroyEntity(devContext.world, entity);
    io.emit('nutrientCollected', {
      type: 'nutrientCollected',
      nutrientId: id,
      playerId: 'dev',
      collectorEnergy: 0,
      collectorMaxEnergy: 0,
    });
  }

  // Clear all swarms (from ECS)
  const swarmCount = getSwarmCount(devContext.world);
  const swarmIdsToRemove: string[] = [];
  forEachSwarm(devContext.world, (_entity, swarmId) => {
    swarmIdsToRemove.push(swarmId);
  });
  for (const swarmId of swarmIdsToRemove) {
    removeSwarm(devContext.world, swarmId);
    io.emit('swarmConsumed', {
      type: 'swarmConsumed',
      swarmId,
      consumerId: 'dev',
    });
  }

  logger.info({
    event: 'dev_clear_world',
    nutrientsCleared: nutrientCount,
    swarmsCleared: swarmCount,
  });
}

function handleDeleteAt(
  io: Server,
  position: Position,
  entityType: 'nutrient' | 'swarm' | 'single-cell' | 'multi-cell' | 'cyber-organism'
): void {
  if (!devContext) return;

  const MAX_DELETE_DISTANCE = 100; // Max distance to find entity
  let nearestId: string | null = null;
  let nearestDist = MAX_DELETE_DISTANCE;

  if (entityType === 'nutrient') {
    // Find nearest nutrient using ECS
    let nearestEntity: number | null = null;

    forEachNutrient(devContext.world, (entity, id, nutrientPos) => {
      const dx = nutrientPos.x - position.x;
      const dy = nutrientPos.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
        nearestEntity = entity;
      }
    });

    if (nearestId && nearestEntity !== null) {
      destroyEntity(devContext.world, nearestEntity);
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
    // Find nearest swarm using ECS
    forEachSwarm(devContext.world, (_entity, swarmId, swarmPosComp) => {
      const dx = swarmPosComp.x - position.x;
      const dy = swarmPosComp.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = swarmId;
      }
    });

    if (nearestId) {
      removeSwarm(devContext.world, nearestId);
      io.emit('swarmConsumed', {
        type: 'swarmConsumed',
        swarmId: nearestId,
        consumerId: 'dev',
      });
      logger.info({ event: 'dev_delete_at_swarm', position, deletedId: nearestId });
    }
  } else if (
    entityType === 'single-cell' ||
    entityType === 'multi-cell' ||
    entityType === 'cyber-organism'
  ) {
    // Find nearest bot of the specified type using ECS iteration
    // Use object wrapper pattern for closure mutation
    const result: { nearestId: string | null; nearestDist: number; nearestPos: Position | null } = {
      nearestId: null,
      nearestDist: MAX_DELETE_DISTANCE,
      nearestPos: null,
    };

    // Capture world reference before callback to satisfy TypeScript narrowing
    const world = devContext.world;
    forEachPlayer(world, (entity, id) => {
      // Only consider bots (players with 'bot-' prefix)
      if (!id.startsWith('bot-')) return;

      // Use entity-based helpers directly (entity already available from forEachPlayer)
      const stageComp = getStage(world, entity);
      const posComp = getPosition(world, entity);
      if (!stageComp || !posComp) return;

      // Filter by stage matching the entity type
      const matchesType =
        (entityType === 'single-cell' && stageComp.stage === EvolutionStage.SINGLE_CELL) ||
        (entityType === 'multi-cell' && stageComp.stage === EvolutionStage.MULTI_CELL) ||
        (entityType === 'cyber-organism' && stageComp.stage === EvolutionStage.CYBER_ORGANISM);
      if (!matchesType) return;

      const dx = posComp.x - position.x;
      const dy = posComp.y - position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < result.nearestDist) {
        result.nearestDist = dist;
        result.nearestId = id;
        result.nearestPos = { x: posComp.x, y: posComp.y };
      }
    });

    if (result.nearestId && result.nearestPos) {
      // Permanently remove the bot (no respawn)
      devContext.removeBotPermanently(result.nearestId);
      io.emit('playerDied', {
        type: 'playerDied',
        playerId: result.nearestId,
        position: result.nearestPos,
        color: '#ff0000', // Color not critical for dev kill
        cause: 'starvation',
      });
      logger.info({
        event: 'dev_delete_at_bot',
        position,
        deletedId: result.nearestId,
        entityType,
      });
    }
  }
}

function broadcastDevState(io: Server): void {
  const state: DevStateMessage = {
    type: 'devState',
    isPaused,
    timeScale,
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
  shouldStepTick = false;
}
