// ============================================
// ECS Entity Factories
// Functions to create entities with proper components
// ============================================

import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { Position } from '@godcell/shared';
import { World, ComponentStore, Components, Tags } from './index';
import type { EntityId } from './types';
import type {
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  PlayerComponent,
  StageComponent,
  InputComponent,
  SprintComponent,
  StunnedComponent,
  CooldownsComponent,
  DamageTrackingComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
} from './components';

// ============================================
// World Setup
// ============================================

/**
 * Create and configure an ECS World with all component stores registered.
 */
export function createWorld(): World {
  const world = new World();

  // Register all component stores
  world.registerStore<PositionComponent>(Components.Position, new ComponentStore());
  world.registerStore<VelocityComponent>(Components.Velocity, new ComponentStore());
  world.registerStore<EnergyComponent>(Components.Energy, new ComponentStore());
  world.registerStore<PlayerComponent>(Components.Player, new ComponentStore());
  world.registerStore<StageComponent>(Components.Stage, new ComponentStore());
  world.registerStore<InputComponent>(Components.Input, new ComponentStore());
  world.registerStore<SprintComponent>(Components.Sprint, new ComponentStore());
  world.registerStore<StunnedComponent>(Components.Stunned, new ComponentStore());
  world.registerStore<CooldownsComponent>(Components.Cooldowns, new ComponentStore());
  world.registerStore<DamageTrackingComponent>(Components.DamageTracking, new ComponentStore());
  world.registerStore<NutrientComponent>(Components.Nutrient, new ComponentStore());
  world.registerStore<ObstacleComponent>(Components.Obstacle, new ComponentStore());
  world.registerStore<SwarmComponent>(Components.Swarm, new ComponentStore());
  world.registerStore<PseudopodComponent>(Components.Pseudopod, new ComponentStore());

  // Ability markers (no data, just presence)
  world.registerStore<CanFireEMPComponent>(Components.CanFireEMP, new ComponentStore());
  world.registerStore<CanFirePseudopodComponent>(Components.CanFirePseudopod, new ComponentStore());
  world.registerStore<CanSprintComponent>(Components.CanSprint, new ComponentStore());

  return world;
}

// ============================================
// Lookup Tables
// Maps between EntityId and external identifiers (socketId, etc.)
// ============================================

// EntityId <-> SocketId bidirectional lookup
const entityToSocket = new Map<EntityId, string>();
const socketToEntity = new Map<string, EntityId>();

// EntityId <-> String ID (for nutrients, obstacles, swarms, pseudopods)
const entityToStringId = new Map<EntityId, string>();
const stringIdToEntity = new Map<string, EntityId>();

/**
 * Get EntityId from socket ID.
 */
export function getEntityBySocketId(socketId: string): EntityId | undefined {
  return socketToEntity.get(socketId);
}

/**
 * Get socket ID from EntityId.
 */
export function getSocketIdByEntity(entity: EntityId): string | undefined {
  return entityToSocket.get(entity);
}

/**
 * Get EntityId from string ID (nutrient, obstacle, swarm, pseudopod).
 */
export function getEntityByStringId(stringId: string): EntityId | undefined {
  return stringIdToEntity.get(stringId);
}

/**
 * Get string ID from EntityId.
 */
export function getStringIdByEntity(entity: EntityId): string | undefined {
  return entityToStringId.get(entity);
}

/**
 * Register socket ID <-> EntityId mapping.
 */
function registerSocketMapping(entity: EntityId, socketId: string): void {
  entityToSocket.set(entity, socketId);
  socketToEntity.set(socketId, entity);
}

/**
 * Register string ID <-> EntityId mapping.
 */
function registerStringIdMapping(entity: EntityId, stringId: string): void {
  entityToStringId.set(entity, stringId);
  stringIdToEntity.set(stringId, entity);
}

/**
 * Unregister all mappings for an entity.
 */
export function unregisterEntity(entity: EntityId): void {
  const socketId = entityToSocket.get(entity);
  if (socketId) {
    socketToEntity.delete(socketId);
    entityToSocket.delete(entity);
  }

  const stringId = entityToStringId.get(entity);
  if (stringId) {
    stringIdToEntity.delete(stringId);
    entityToStringId.delete(entity);
  }
}

// ============================================
// Entity Factories
// ============================================

/**
 * Get stage-specific values for a player.
 */
function getStageValues(stage: EvolutionStage): {
  energy: number;
  maxEnergy: number;
  radius: number;
  detectionRadius: number | null;
  canEMP: boolean;
  canPseudopod: boolean;
  canSprint: boolean;
  canEngulf: boolean;
} {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return {
        energy: GAME_CONFIG.SINGLE_CELL_ENERGY,
        maxEnergy: GAME_CONFIG.SINGLE_CELL_MAX_ENERGY,
        radius: GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.SINGLE_CELL_SIZE_MULTIPLIER,
        detectionRadius: null,
        canEMP: false,
        canPseudopod: false,
        canSprint: false,
        canEngulf: false,
      };
    case EvolutionStage.MULTI_CELL:
      return {
        energy: GAME_CONFIG.MULTI_CELL_ENERGY,
        maxEnergy: GAME_CONFIG.MULTI_CELL_MAX_ENERGY,
        radius: GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER,
        detectionRadius: GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS,
        canEMP: true,
        canPseudopod: true,
        canSprint: false,
        canEngulf: true,
      };
    case EvolutionStage.CYBER_ORGANISM:
      return {
        energy: GAME_CONFIG.CYBER_ORGANISM_ENERGY,
        maxEnergy: GAME_CONFIG.CYBER_ORGANISM_MAX_ENERGY,
        radius: GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.CYBER_ORGANISM_SIZE_MULTIPLIER,
        detectionRadius: GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS * 1.5,
        canEMP: true,
        canPseudopod: true,
        canSprint: true,
        canEngulf: true,
      };
    case EvolutionStage.HUMANOID:
      return {
        energy: GAME_CONFIG.HUMANOID_ENERGY,
        maxEnergy: GAME_CONFIG.HUMANOID_MAX_ENERGY,
        radius: GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.HUMANOID_SIZE_MULTIPLIER,
        detectionRadius: GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS * 2,
        canEMP: true,
        canPseudopod: true,
        canSprint: true,
        canEngulf: true,
      };
    case EvolutionStage.GODCELL:
      return {
        energy: GAME_CONFIG.GODCELL_ENERGY,
        maxEnergy: GAME_CONFIG.GODCELL_MAX_ENERGY,
        radius: GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.GODCELL_SIZE_MULTIPLIER,
        detectionRadius: GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS * 3,
        canEMP: true,
        canPseudopod: true,
        canSprint: true,
        canEngulf: true,
      };
    default:
      return getStageValues(EvolutionStage.SINGLE_CELL);
  }
}

/**
 * Create a player entity.
 */
export function createPlayer(
  world: World,
  socketId: string,
  name: string,
  color: string,
  position: Position,
  stage: EvolutionStage = EvolutionStage.SINGLE_CELL
): EntityId {
  const entity = world.createEntity();
  const stageValues = getStageValues(stage);

  // Core components
  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, { x: 0, y: 0 });
  world.addComponent<EnergyComponent>(entity, Components.Energy, {
    current: stageValues.energy,
    max: stageValues.maxEnergy,
  });

  // Player-specific components
  world.addComponent<PlayerComponent>(entity, Components.Player, {
    socketId,
    name,
    color,
  });
  world.addComponent<StageComponent>(entity, Components.Stage, {
    stage,
    isEvolving: false,
  });
  world.addComponent<InputComponent>(entity, Components.Input, {
    direction: { x: 0, y: 0 },
  });
  world.addComponent<CooldownsComponent>(entity, Components.Cooldowns, {});
  world.addComponent<DamageTrackingComponent>(entity, Components.DamageTracking, {
    activeDamage: [],
  });

  // Ability components based on stage
  if (stageValues.canEMP) {
    world.addComponent<CanFireEMPComponent>(entity, Components.CanFireEMP, {});
  }
  if (stageValues.canPseudopod) {
    world.addComponent<CanFirePseudopodComponent>(entity, Components.CanFirePseudopod, {});
  }
  if (stageValues.canSprint) {
    world.addComponent<CanSprintComponent>(entity, Components.CanSprint, {});
    world.addComponent<SprintComponent>(entity, Components.Sprint, { isSprinting: false });
  }

  // Tags
  world.addTag(entity, Tags.Player);

  // Register lookup
  registerSocketMapping(entity, socketId);

  return entity;
}

/**
 * Create a bot player entity.
 */
export function createBot(
  world: World,
  botId: string,
  name: string,
  color: string,
  position: Position,
  stage: EvolutionStage = EvolutionStage.SINGLE_CELL
): EntityId {
  // Bots are players with an additional Bot tag
  const entity = createPlayer(world, botId, name, color, position, stage);
  world.addTag(entity, Tags.Bot);
  return entity;
}

/**
 * Create a nutrient entity.
 */
export function createNutrient(
  world: World,
  nutrientId: string,
  position: Position,
  value: number,
  capacityIncrease: number,
  valueMultiplier: number,
  isHighValue: boolean
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
  });
  world.addComponent<NutrientComponent>(entity, Components.Nutrient, {
    value,
    capacityIncrease,
    valueMultiplier,
    isHighValue,
  });

  world.addTag(entity, Tags.Nutrient);
  registerStringIdMapping(entity, nutrientId);

  return entity;
}

/**
 * Create an obstacle (gravity well) entity.
 */
export function createObstacle(
  world: World,
  obstacleId: string,
  position: Position,
  radius: number,
  strength: number
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
  });
  world.addComponent<ObstacleComponent>(entity, Components.Obstacle, {
    radius,
    strength,
  });

  world.addTag(entity, Tags.Obstacle);
  registerStringIdMapping(entity, obstacleId);

  return entity;
}

/**
 * Create an entropy swarm entity.
 */
export function createSwarm(
  world: World,
  swarmId: string,
  position: Position,
  size: number
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, { x: 0, y: 0 });
  world.addComponent<SwarmComponent>(entity, Components.Swarm, {
    size,
    state: 'patrol',
    homePosition: { x: position.x, y: position.y },
  });

  world.addTag(entity, Tags.Swarm);
  registerStringIdMapping(entity, swarmId);

  return entity;
}

/**
 * Create a pseudopod (beam projectile) entity.
 */
export function createPseudopod(
  world: World,
  beamId: string,
  ownerEntity: EntityId,
  ownerSocketId: string,
  position: Position,
  velocity: { x: number; y: number },
  width: number,
  maxDistance: number,
  color: string
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, velocity);
  world.addComponent<PseudopodComponent>(entity, Components.Pseudopod, {
    ownerId: ownerEntity,
    ownerSocketId,
    width,
    maxDistance,
    distanceTraveled: 0,
    createdAt: Date.now(),
    color,
    hitEntities: new Set(),
  });

  world.addTag(entity, Tags.Pseudopod);
  registerStringIdMapping(entity, beamId);

  return entity;
}

/**
 * Update a player's stage and associated abilities.
 */
export function setPlayerStage(world: World, entity: EntityId, newStage: EvolutionStage): void {
  const stageValues = getStageValues(newStage);

  // Update stage component
  const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
  if (stageComp) {
    stageComp.stage = newStage;
  }

  // Update energy capacity (keep current ratio)
  const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
  if (energyComp) {
    const ratio = energyComp.current / energyComp.max;
    energyComp.max = stageValues.maxEnergy;
    energyComp.current = Math.min(stageValues.maxEnergy, energyComp.current);
  }

  // Add/remove ability components based on stage
  if (stageValues.canEMP && !world.hasComponent(entity, Components.CanFireEMP)) {
    world.addComponent<CanFireEMPComponent>(entity, Components.CanFireEMP, {});
  }
  if (stageValues.canPseudopod && !world.hasComponent(entity, Components.CanFirePseudopod)) {
    world.addComponent<CanFirePseudopodComponent>(entity, Components.CanFirePseudopod, {});
  }
  if (stageValues.canSprint && !world.hasComponent(entity, Components.CanSprint)) {
    world.addComponent<CanSprintComponent>(entity, Components.CanSprint, {});
    world.addComponent<SprintComponent>(entity, Components.Sprint, { isSprinting: false });
  }
}

/**
 * Destroy an entity and clean up all lookups.
 */
export function destroyEntity(world: World, entity: EntityId): void {
  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Clear all lookup tables (for world reset).
 */
export function clearLookups(): void {
  entityToSocket.clear();
  socketToEntity.clear();
  entityToStringId.clear();
  stringIdToEntity.clear();
}
