// ============================================
// ECS Entity Factories
// Functions to create entities with proper components
// ============================================

import {
  GAME_CONFIG,
  EvolutionStage,
  World,
  ComponentStore,
  Components,
  Tags,
} from '#shared';
import type {
  Position,
  Player,
  EntityId,
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  PlayerComponent,
  StageComponent,
  InputComponent,
  SprintComponent,
  StunnedComponent,
  SpawnImmunityComponent,
  CooldownsComponent,
  DamageTrackingComponent,
  DrainTargetComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  TreeComponent,
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
  DamageSource,
  // Stage 3+ macro-resources
  DataFruitComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  ProjectileComponent,
  TrapComponent,
  // Stage 3 combat specialization
  CombatSpecializationComponent,
  KnockbackComponent,
  // Server-only components
  PendingRespawnComponent,
} from '#shared';

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
  world.registerStore<SpawnImmunityComponent>(Components.SpawnImmunity, new ComponentStore());
  world.registerStore<CooldownsComponent>(Components.Cooldowns, new ComponentStore());
  world.registerStore<DamageTrackingComponent>(Components.DamageTracking, new ComponentStore());
  world.registerStore<DrainTargetComponent>(Components.DrainTarget, new ComponentStore());
  world.registerStore<NutrientComponent>(Components.Nutrient, new ComponentStore());
  world.registerStore<ObstacleComponent>(Components.Obstacle, new ComponentStore());
  world.registerStore<SwarmComponent>(Components.Swarm, new ComponentStore());
  world.registerStore<PseudopodComponent>(Components.Pseudopod, new ComponentStore());
  world.registerStore<TreeComponent>(Components.Tree, new ComponentStore());

  // Stage 3+ macro-resources (jungle ecosystem)
  world.registerStore<DataFruitComponent>(Components.DataFruit, new ComponentStore());
  world.registerStore<CyberBugComponent>(Components.CyberBug, new ComponentStore());
  world.registerStore<JungleCreatureComponent>(Components.JungleCreature, new ComponentStore());
  world.registerStore<ProjectileComponent>(Components.Projectile, new ComponentStore());
  world.registerStore<TrapComponent>(Components.Trap, new ComponentStore());

  // Stage 3 combat specialization
  world.registerStore<CombatSpecializationComponent>(Components.CombatSpecialization, new ComponentStore());
  world.registerStore<KnockbackComponent>(Components.Knockback, new ComponentStore());

  // Ability markers (no data, just presence)
  world.registerStore<CanFireEMPComponent>(Components.CanFireEMP, new ComponentStore());
  world.registerStore<CanFirePseudopodComponent>(Components.CanFirePseudopod, new ComponentStore());
  world.registerStore<CanSprintComponent>(Components.CanSprint, new ComponentStore());

  // Server-only components (deferred actions, timers)
  world.registerStore<PendingRespawnComponent>(Components.PendingRespawn, new ComponentStore());

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
        radius: GAME_CONFIG.SINGLE_CELL_RADIUS,
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
        radius: GAME_CONFIG.MULTI_CELL_RADIUS,
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
        radius: GAME_CONFIG.CYBER_ORGANISM_RADIUS,
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
        radius: GAME_CONFIG.HUMANOID_RADIUS,
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
        radius: GAME_CONFIG.GODCELL_RADIUS,
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
    z: position.z ?? 0,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, { x: 0, y: 0, z: 0 });
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
    radius: stageValues.radius,
  });
  world.addComponent<InputComponent>(entity, Components.Input, {
    direction: { x: 0, y: 0, z: 0 },
  });
  world.addComponent<CooldownsComponent>(entity, Components.Cooldowns, {});
  world.addComponent<StunnedComponent>(entity, Components.Stunned, { until: 0 });
  world.addComponent<SpawnImmunityComponent>(entity, Components.SpawnImmunity, {
    until: 0, // Disabled - spawn distance of 400px should be enough
  });
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
    z: position.z ?? 0,
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
    z: position.z ?? 0,
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
 * Energy is the swarm's health pool (used during EMP disable + consumption)
 * patrolTarget is the initial wander target (optional, can be set later)
 */
export function createSwarm(
  world: World,
  swarmId: string,
  position: Position,
  size: number,
  energy: number,
  patrolTarget?: Position
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: position.z ?? 0,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, { x: 0, y: 0, z: 0 });
  world.addComponent<EnergyComponent>(entity, Components.Energy, {
    current: energy,
    max: energy,
  });
  world.addComponent<SwarmComponent>(entity, Components.Swarm, {
    size,
    state: 'patrol',
    homePosition: { x: position.x, y: position.y, z: position.z ?? 0 },
    patrolTarget: patrolTarget ? { x: patrolTarget.x, y: patrolTarget.y, z: patrolTarget.z ?? 0 } : undefined,
  });
  // DamageTracking for centralized death handling in DeathSystem
  world.addComponent<DamageTrackingComponent>(entity, Components.DamageTracking, {
    activeDamage: [],
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
    z: position.z ?? 0,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, { x: velocity.x, y: velocity.y, z: 0 });
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
 * Create a tree (jungle environment obstacle) entity.
 * Trees are static obstacles that only Stage 3+ players can see and collide with.
 */
export function createTree(
  world: World,
  treeId: string,
  position: Position,
  radius: number,
  height: number,
  variant: number
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: position.z ?? 0,
  });
  world.addComponent<TreeComponent>(entity, Components.Tree, {
    radius,
    height,
    variant,
  });

  world.addTag(entity, Tags.Tree);
  registerStringIdMapping(entity, treeId);

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
    stageComp.radius = stageValues.radius;
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

  // Initialize z position for Stage 3+ (so meshes sit on ground, not clip through)
  // Stage 3-4: z = radius (bottom touches ground)
  // Stage 5: z = radius + 100 (starts slightly airborne for 3D flight)
  if (newStage === EvolutionStage.CYBER_ORGANISM ||
      newStage === EvolutionStage.HUMANOID ||
      newStage === EvolutionStage.GODCELL) {
    const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
    const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
    if (posComp) {
      // Godcell starts airborne, others sit on ground
      posComp.z = newStage === EvolutionStage.GODCELL ? stageValues.radius + 100 : stageValues.radius;
    }
    if (velComp) {
      velComp.z = 0; // Reset z velocity
    }
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

// ============================================
// Query Helpers (for migrating away from players Map)
// ============================================

/**
 * Get all player entity IDs.
 */
export function getAllPlayerEntities(world: World): EntityId[] {
  return world.getEntitiesWithTag(Tags.Player);
}

/**
 * Iterate over all player entities with a callback.
 * More efficient than allocating an array.
 */
export function forEachPlayer(
  world: World,
  callback: (entity: EntityId, socketId: string) => void
): void {
  world.forEachWithTag(Tags.Player, (entity) => {
    const socketId = getSocketIdByEntity(entity);
    if (socketId) {
      callback(entity, socketId);
    }
  });
}

/**
 * Player data snapshot - all component data needed for game logic.
 * Use this to read player state without holding component references.
 */
export interface PlayerSnapshot {
  entity: EntityId;
  socketId: string;
  name: string;
  color: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  energy: number;
  maxEnergy: number;
  stage: EvolutionStage;
  isEvolving: boolean;
  evolvingUntil?: number;
  stunnedUntil?: number;
  isSprinting: boolean;
  lastEMPTime?: number;
  lastPseudopodTime?: number;
  isBot: boolean;
}

/**
 * Get a snapshot of a player entity's state.
 * Returns null if entity is not a valid player.
 */
export function getPlayerSnapshot(world: World, entity: EntityId): PlayerSnapshot | null {
  const player = world.getComponent<PlayerComponent>(entity, Components.Player);
  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
  const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
  const stage = world.getComponent<StageComponent>(entity, Components.Stage);

  if (!player || !pos || !energy || !stage) {
    return null;
  }

  const stunned = world.getComponent<StunnedComponent>(entity, Components.Stunned);
  const sprint = world.getComponent<SprintComponent>(entity, Components.Sprint);
  const cooldowns = world.getComponent<CooldownsComponent>(entity, Components.Cooldowns);
  const socketId = getSocketIdByEntity(entity);

  return {
    entity,
    socketId: socketId || player.socketId,
    name: player.name,
    color: player.color,
    position: { x: pos.x, y: pos.y },
    velocity: vel ? { x: vel.x, y: vel.y } : { x: 0, y: 0 },
    energy: energy.current,
    maxEnergy: energy.max,
    stage: stage.stage,
    isEvolving: stage.isEvolving,
    evolvingUntil: stage.evolvingUntil,
    stunnedUntil: stunned?.until,
    isSprinting: sprint?.isSprinting ?? false,
    lastEMPTime: cooldowns?.lastEMPTime,
    lastPseudopodTime: cooldowns?.lastPseudopodTime,
    isBot: world.hasTag(entity, Tags.Bot),
  };
}

/**
 * Convert an ECS player entity to the legacy Player interface format.
 * Used for network serialization until client migrates to ECS.
 */
export function entityToLegacyPlayer(world: World, entity: EntityId): Player | null {
  const player = world.getComponent<PlayerComponent>(entity, Components.Player);
  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
  const stage = world.getComponent<StageComponent>(entity, Components.Stage);
  const socketId = getSocketIdByEntity(entity);

  if (!player || !pos || !energy || !stage || !socketId) {
    return null;
  }

  const stunned = world.getComponent<StunnedComponent>(entity, Components.Stunned);
  const cooldowns = world.getComponent<CooldownsComponent>(entity, Components.Cooldowns);

  return {
    id: socketId,
    position: { x: pos.x, y: pos.y, z: pos.z },
    color: player.color,
    energy: energy.current,
    maxEnergy: energy.max,
    stage: stage.stage,
    isEvolving: stage.isEvolving,
    radius: stage.radius,
    stunnedUntil: stunned?.until,
    lastEMPTime: cooldowns?.lastEMPTime,
  };
}

/**
 * Build the legacy players Record for network broadcasts.
 * Used until client migrates to component-based state.
 */
export function buildPlayersRecord(world: World): Record<string, Player> {
  const result: Record<string, Player> = {};

  world.forEachWithTag(Tags.Player, (entity) => {
    const legacyPlayer = entityToLegacyPlayer(world, entity);
    if (legacyPlayer) {
      result[legacyPlayer.id] = legacyPlayer;
    }
  });

  return result;
}

/**
 * Build the legacy players Record with only alive players (energy > 0).
 * Used for initial game state broadcast.
 */
export function buildAlivePlayersRecord(world: World): Record<string, Player> {
  const result: Record<string, Player> = {};

  world.forEachWithTag(Tags.Player, (entity) => {
    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    if (!energy || energy.current <= 0) return;

    const legacyPlayer = entityToLegacyPlayer(world, entity);
    if (legacyPlayer) {
      result[legacyPlayer.id] = legacyPlayer;
    }
  });

  return result;
}

// ============================================
// Direct Component Access by Socket ID (LEGACY)
// These helpers are for socket boundary code (index.ts) and bot spawning.
// For game logic in systems, prefer entity-based helpers below.
// ============================================

/**
 * Get a legacy Player object by socket ID.
 * Returns null if not found or dead.
 */
export function getPlayerBySocketId(world: World, socketId: string): Player | null {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return null;
  return entityToLegacyPlayer(world, entity);
}

/**
 * Check if a player exists by socket ID.
 */
export function hasPlayer(world: World, socketId: string): boolean {
  const entity = getEntityBySocketId(socketId);
  return entity !== undefined && world.hasTag(entity, Tags.Player);
}

/**
 * Get player's energy component by socket ID.
 * Returns undefined if not found.
 */
export function getEnergyBySocketId(
  world: World,
  socketId: string
): EnergyComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<EnergyComponent>(entity, Components.Energy);
}

/**
 * Get player's position component by socket ID.
 */
export function getPositionBySocketId(
  world: World,
  socketId: string
): PositionComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<PositionComponent>(entity, Components.Position);
}

/**
 * Get player's stage component by socket ID.
 */
export function getStageBySocketId(
  world: World,
  socketId: string
): StageComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<StageComponent>(entity, Components.Stage);
}

/**
 * Get player's velocity component by socket ID.
 */
export function getVelocityBySocketId(
  world: World,
  socketId: string
): VelocityComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<VelocityComponent>(entity, Components.Velocity);
}

/**
 * Set player's velocity by socket ID.
 * Mutates the existing component in place.
 */
export function setVelocityBySocketId(
  world: World,
  socketId: string,
  x: number,
  y: number
): boolean {
  const vel = getVelocityBySocketId(world, socketId);
  if (!vel) return false;
  vel.x = x;
  vel.y = y;
  return true;
}

/**
 * Get player's input component by socket ID.
 */
export function getInputBySocketId(
  world: World,
  socketId: string
): InputComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<InputComponent>(entity, Components.Input);
}

/**
 * Set player's input direction by socket ID.
 * Mutates the existing component in place.
 */
export function setInputBySocketId(
  world: World,
  socketId: string,
  x: number,
  y: number,
  z: number = 0
): boolean {
  const input = getInputBySocketId(world, socketId);
  if (!input) return false;
  input.direction.x = x;
  input.direction.y = y;
  input.direction.z = z;
  return true;
}

/**
 * Get player's sprint component by socket ID.
 */
export function getSprintBySocketId(
  world: World,
  socketId: string
): SprintComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<SprintComponent>(entity, Components.Sprint);
}

/**
 * Set player's sprint state by socket ID.
 * Returns false if player doesn't have SprintComponent (Stage 1-2 players).
 */
export function setSprintBySocketId(
  world: World,
  socketId: string,
  isSprinting: boolean
): boolean {
  const sprint = getSprintBySocketId(world, socketId);
  if (!sprint) return false;
  sprint.isSprinting = isSprinting;
  return true;
}

/**
 * Get player's stunned component by socket ID.
 */
export function getStunnedBySocketId(
  world: World,
  socketId: string
): StunnedComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<StunnedComponent>(entity, Components.Stunned);
}

/**
 * Get player's cooldowns component by socket ID.
 */
export function getCooldownsBySocketId(
  world: World,
  socketId: string
): CooldownsComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<CooldownsComponent>(entity, Components.Cooldowns);
}

/**
 * Get player's damage tracking component by socket ID.
 */
export function getDamageTrackingBySocketId(
  world: World,
  socketId: string
): DamageTrackingComponent | undefined {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return undefined;
  return world.getComponent<DamageTrackingComponent>(entity, Components.DamageTracking);
}

/**
 * Check if player is a bot by socket ID.
 */
export function isBotBySocketId(world: World, socketId: string): boolean {
  const entity = getEntityBySocketId(socketId);
  if (!entity) return false;
  return world.hasTag(entity, Tags.Bot);
}

/**
 * Delete player entity by socket ID.
 */
export function deletePlayerBySocketId(world: World, socketId: string): void {
  const entity = getEntityBySocketId(socketId);
  if (entity) {
    destroyEntity(world, entity);
  }
}

// ============================================
// ECS Setters - Update component values directly
// ============================================

/**
 * Set player energy by socket ID.
 * Updates the ECS component directly.
 */
export function setEnergyBySocketId(
  world: World,
  socketId: string,
  energy: number
): void {
  const energyComp = getEnergyBySocketId(world, socketId);
  if (energyComp) {
    energyComp.current = energy;
  }
}

/**
 * Set player max energy by socket ID.
 * Updates the ECS component directly.
 */
export function setMaxEnergyBySocketId(
  world: World,
  socketId: string,
  maxEnergy: number
): void {
  const energyComp = getEnergyBySocketId(world, socketId);
  if (energyComp) {
    energyComp.max = maxEnergy;
  }
}

/**
 * Add energy to player by socket ID (clamped to max).
 * Returns the new energy value, or undefined if player not found.
 */
export function addEnergyBySocketId(
  world: World,
  socketId: string,
  amount: number
): number | undefined {
  const energyComp = getEnergyBySocketId(world, socketId);
  if (energyComp) {
    energyComp.current = Math.min(energyComp.max, energyComp.current + amount);
    return energyComp.current;
  }
  return undefined;
}

/**
 * Subtract energy from player by socket ID (clamped to 0).
 * Returns the new energy value, or undefined if player not found.
 */
export function subtractEnergyBySocketId(
  world: World,
  socketId: string,
  amount: number
): number | undefined {
  const energyComp = getEnergyBySocketId(world, socketId);
  if (energyComp) {
    energyComp.current = Math.max(0, energyComp.current - amount);
    return energyComp.current;
  }
  return undefined;
}

/**
 * Set player position by socket ID.
 * Updates the ECS component directly.
 */
export function setPositionBySocketId(
  world: World,
  socketId: string,
  x: number,
  y: number
): void {
  const posComp = getPositionBySocketId(world, socketId);
  if (posComp) {
    posComp.x = x;
    posComp.y = y;
  }
}

// ============================================
// Entity-Based Component Access
// Game-layer helpers that take EntityId directly
// Use these in systems and game logic
// ============================================

/**
 * Get player's energy component by entity ID.
 */
export function getEnergy(
  world: World,
  entity: EntityId
): EnergyComponent | undefined {
  return world.getComponent<EnergyComponent>(entity, Components.Energy);
}

/**
 * Get player's position component by entity ID.
 */
export function getPosition(
  world: World,
  entity: EntityId
): PositionComponent | undefined {
  return world.getComponent<PositionComponent>(entity, Components.Position);
}

/**
 * Get player's stage component by entity ID.
 */
export function getStage(
  world: World,
  entity: EntityId
): StageComponent | undefined {
  return world.getComponent<StageComponent>(entity, Components.Stage);
}

/**
 * Get player's velocity component by entity ID.
 */
export function getVelocity(
  world: World,
  entity: EntityId
): VelocityComponent | undefined {
  return world.getComponent<VelocityComponent>(entity, Components.Velocity);
}

/**
 * Get player's input component by entity ID.
 */
export function getInput(
  world: World,
  entity: EntityId
): InputComponent | undefined {
  return world.getComponent<InputComponent>(entity, Components.Input);
}

/**
 * Get player's sprint component by entity ID.
 */
export function getSprint(
  world: World,
  entity: EntityId
): SprintComponent | undefined {
  return world.getComponent<SprintComponent>(entity, Components.Sprint);
}

/**
 * Get player's stunned component by entity ID.
 */
export function getStunned(
  world: World,
  entity: EntityId
): StunnedComponent | undefined {
  return world.getComponent<StunnedComponent>(entity, Components.Stunned);
}

/**
 * Get player's cooldowns component by entity ID.
 */
export function getCooldowns(
  world: World,
  entity: EntityId
): CooldownsComponent | undefined {
  return world.getComponent<CooldownsComponent>(entity, Components.Cooldowns);
}

/**
 * Get player's damage tracking component by entity ID.
 */
export function getDamageTracking(
  world: World,
  entity: EntityId
): DamageTrackingComponent | undefined {
  return world.getComponent<DamageTrackingComponent>(entity, Components.DamageTracking);
}

/**
 * Check if entity is a bot by entity ID.
 */
export function isBot(world: World, entity: EntityId): boolean {
  return world.hasTag(entity, Tags.Bot);
}

// ============================================
// Throwing Component Access (for invariant enforcement)
// Use these in systems where missing components indicate bugs
// ============================================

/**
 * Get player's energy component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireEnergy(world: World, entity: EntityId): EnergyComponent {
  const comp = world.getComponent<EnergyComponent>(entity, Components.Energy);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Energy missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's position component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requirePosition(world: World, entity: EntityId): PositionComponent {
  const comp = world.getComponent<PositionComponent>(entity, Components.Position);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Position missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's stage component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireStage(world: World, entity: EntityId): StageComponent {
  const comp = world.getComponent<StageComponent>(entity, Components.Stage);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Stage missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's velocity component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireVelocity(world: World, entity: EntityId): VelocityComponent {
  const comp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Velocity missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's input component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireInput(world: World, entity: EntityId): InputComponent {
  const comp = world.getComponent<InputComponent>(entity, Components.Input);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Input missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's cooldowns component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireCooldowns(world: World, entity: EntityId): CooldownsComponent {
  const comp = world.getComponent<CooldownsComponent>(entity, Components.Cooldowns);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Cooldowns missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's stunned component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireStunned(world: World, entity: EntityId): StunnedComponent {
  const comp = world.getComponent<StunnedComponent>(entity, Components.Stunned);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Stunned missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's damage tracking component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requireDamageTracking(world: World, entity: EntityId): DamageTrackingComponent {
  const comp = world.getComponent<DamageTrackingComponent>(entity, Components.DamageTracking);
  if (!comp) {
    throw new Error(`EntityMissingComponent: DamageTracking missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Get player's player component by entity ID.
 * Throws if component is missing (invariant violation).
 */
export function requirePlayer(world: World, entity: EntityId): PlayerComponent {
  const comp = world.getComponent<PlayerComponent>(entity, Components.Player);
  if (!comp) {
    throw new Error(`EntityMissingComponent: Player missing on entity ${entity}`);
  }
  return comp;
}

/**
 * Set player's velocity by entity ID.
 */
export function setVelocity(
  world: World,
  entity: EntityId,
  x: number,
  y: number
): boolean {
  const vel = getVelocity(world, entity);
  if (!vel) return false;
  vel.x = x;
  vel.y = y;
  return true;
}

/**
 * Set player's input direction by entity ID.
 */
export function setInput(
  world: World,
  entity: EntityId,
  x: number,
  y: number,
  z: number = 0
): boolean {
  const input = getInput(world, entity);
  if (!input) return false;
  input.direction.x = x;
  input.direction.y = y;
  input.direction.z = z;
  return true;
}

/**
 * Set player's sprint state by entity ID.
 */
export function setSprint(
  world: World,
  entity: EntityId,
  isSprinting: boolean
): boolean {
  const sprint = getSprint(world, entity);
  if (!sprint) return false;
  sprint.isSprinting = isSprinting;
  return true;
}

/**
 * Set player energy by entity ID.
 */
export function setEnergy(
  world: World,
  entity: EntityId,
  energy: number
): void {
  const energyComp = getEnergy(world, entity);
  if (energyComp) {
    energyComp.current = energy;
  }
}

/**
 * Set player max energy by entity ID.
 */
export function setMaxEnergy(
  world: World,
  entity: EntityId,
  maxEnergy: number
): void {
  const energyComp = getEnergy(world, entity);
  if (energyComp) {
    energyComp.max = maxEnergy;
  }
}

/**
 * Add energy to player by entity ID (clamped to max).
 * Returns the new energy value, or undefined if entity not found.
 */
export function addEnergy(
  world: World,
  entity: EntityId,
  amount: number
): number | undefined {
  const energyComp = getEnergy(world, entity);
  if (energyComp) {
    energyComp.current = Math.min(energyComp.max, energyComp.current + amount);
    return energyComp.current;
  }
  return undefined;
}

/**
 * Subtract energy from player by entity ID (clamped to 0).
 * Returns the new energy value, or undefined if entity not found.
 */
export function subtractEnergy(
  world: World,
  entity: EntityId,
  amount: number
): number | undefined {
  const energyComp = getEnergy(world, entity);
  if (energyComp) {
    energyComp.current = Math.max(0, energyComp.current - amount);
    return energyComp.current;
  }
  return undefined;
}

/**
 * Set player stage by entity ID.
 * Also initializes z position for Stage 3+ (ground placement / flight).
 */
export function setStage(
  world: World,
  entity: EntityId,
  stage: EvolutionStage
): void {
  const stageValues = getStageValues(stage);

  const stageComp = getStage(world, entity);
  if (stageComp) {
    stageComp.stage = stage;
    stageComp.radius = stageValues.radius;
  }

  // Initialize z position for Stage 3+ (so meshes sit on ground, not clip through)
  if (stage === EvolutionStage.CYBER_ORGANISM ||
      stage === EvolutionStage.HUMANOID ||
      stage === EvolutionStage.GODCELL) {
    const posComp = getPosition(world, entity);
    const velComp = getVelocity(world, entity);
    if (posComp) {
      // Godcell starts airborne, others sit on ground
      posComp.z = stage === EvolutionStage.GODCELL ? stageValues.radius + 100 : stageValues.radius;
    }
    if (velComp) {
      velComp.z = 0; // Reset z velocity
    }
  }
}

/**
 * Set player position by entity ID.
 */
export function setPosition(
  world: World,
  entity: EntityId,
  x: number,
  y: number
): void {
  const posComp = getPosition(world, entity);
  if (posComp) {
    posComp.x = x;
    posComp.y = y;
  }
}

/**
 * Update player position by adding deltas.
 * Returns the new position, or undefined if not found.
 */
export function movePosition(
  world: World,
  entity: EntityId,
  dx: number,
  dy: number
): { x: number; y: number } | undefined {
  const posComp = getPosition(world, entity);
  if (posComp) {
    posComp.x += dx;
    posComp.y += dy;
    return { x: posComp.x, y: posComp.y };
  }
  return undefined;
}

/**
 * Clamp player position to world bounds by entity ID.
 * Returns the clamped position, or undefined if not found.
 */
export function clampPosition(
  world: World,
  entity: EntityId,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): { x: number; y: number } | undefined {
  const posComp = getPosition(world, entity);
  if (posComp) {
    posComp.x = Math.max(minX, Math.min(maxX, posComp.x));
    posComp.y = Math.max(minY, Math.min(maxY, posComp.y));
    return { x: posComp.x, y: posComp.y };
  }
  return undefined;
}

/**
 * Delete player entity by entity ID.
 * Unregisters all mappings and destroys the entity.
 */
export function deletePlayer(world: World, entity: EntityId): void {
  destroyEntity(world, entity);
}

// ============================================
// Obstacle Query Helpers
// ============================================

/**
 * Obstacle data snapshot for iteration.
 * Contains all data needed for collision/gravity without holding component refs.
 */
export interface ObstacleSnapshot {
  entity: EntityId;
  id: string; // String ID for network messages
  position: Position;
  radius: number;
  strength: number;
}

/**
 * Iterate over all obstacle entities.
 * Callback receives entity ID and obstacle's position.
 */
export function forEachObstacle(
  world: World,
  callback: (entity: EntityId, position: Position, obstacle: ObstacleComponent) => void
): void {
  world.forEachWithTag(Tags.Obstacle, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const obs = world.getComponent<ObstacleComponent>(entity, Components.Obstacle);
    if (pos && obs) {
      callback(entity, { x: pos.x, y: pos.y }, obs);
    }
  });
}

/**
 * Get all obstacles as snapshots.
 * Useful when you need to iterate multiple times or need stable references.
 */
export function getAllObstacleSnapshots(world: World): ObstacleSnapshot[] {
  const snapshots: ObstacleSnapshot[] = [];
  world.forEachWithTag(Tags.Obstacle, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const obs = world.getComponent<ObstacleComponent>(entity, Components.Obstacle);
    const id = getStringIdByEntity(entity);
    if (pos && obs && id) {
      snapshots.push({
        entity,
        id,
        position: { x: pos.x, y: pos.y },
        radius: obs.radius,
        strength: obs.strength,
      });
    }
  });
  return snapshots;
}

/**
 * Get all obstacle positions for spawn safety checks.
 * Returns array of { position, radius } for distance calculations.
 */
export function getObstacleZones(
  world: World
): Array<{ position: Position; radius: number }> {
  const zones: Array<{ position: Position; radius: number }> = [];
  forEachObstacle(world, (_entity, position, obstacle) => {
    zones.push({ position, radius: obstacle.radius });
  });
  return zones;
}

/**
 * Get obstacle count.
 */
export function getObstacleCount(world: World): number {
  return world.getEntitiesWithTag(Tags.Obstacle).length;
}

/**
 * Convert ECS obstacles to legacy Obstacle record for network broadcasts.
 */
export function buildObstaclesRecord(world: World): Record<string, {
  id: string;
  position: Position;
  radius: number;
  strength: number;
  damageRate: number;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    radius: number;
    strength: number;
    damageRate: number;
  }> = {};

  world.forEachWithTag(Tags.Obstacle, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const obs = world.getComponent<ObstacleComponent>(entity, Components.Obstacle);
    const id = getStringIdByEntity(entity);
    if (pos && obs && id) {
      result[id] = {
        id,
        position: { x: pos.x, y: pos.y },
        radius: obs.radius,
        strength: obs.strength,
        // damageRate is derived from config, not stored in component
        damageRate: 0, // Will be set from GAME_CONFIG when needed
      };
    }
  });

  return result;
}

// ============================================
// Nutrient Query Helpers
// ============================================

/**
 * Nutrient data snapshot for iteration.
 * Contains all data needed for collision/attraction without holding component refs.
 */
export interface NutrientSnapshot {
  entity: EntityId;
  id: string; // String ID for network messages
  position: Position;
  value: number;
  capacityIncrease: number;
  valueMultiplier: number;
  isHighValue: boolean;
}

/**
 * Iterate over all nutrient entities.
 * Callback receives entity ID, string ID, position, and nutrient data.
 */
export function forEachNutrient(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: Position,
    nutrient: NutrientComponent
  ) => void
): void {
  world.forEachWithTag(Tags.Nutrient, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const nutrient = world.getComponent<NutrientComponent>(entity, Components.Nutrient);
    const id = getStringIdByEntity(entity);
    if (pos && nutrient && id) {
      callback(entity, id, { x: pos.x, y: pos.y }, nutrient);
    }
  });
}

/**
 * Get all nutrients as snapshots.
 * Useful when you need to iterate multiple times or need stable references.
 */
export function getAllNutrientSnapshots(world: World): NutrientSnapshot[] {
  const snapshots: NutrientSnapshot[] = [];
  forEachNutrient(world, (entity, id, position, nutrient) => {
    snapshots.push({
      entity,
      id,
      position: { x: position.x, y: position.y },
      value: nutrient.value,
      capacityIncrease: nutrient.capacityIncrease,
      valueMultiplier: nutrient.valueMultiplier,
      isHighValue: nutrient.isHighValue,
    });
  });
  return snapshots;
}

/**
 * Get a nutrient's position component by string ID.
 * Returns undefined if not found.
 */
export function getNutrientPosition(
  world: World,
  nutrientId: string
): PositionComponent | undefined {
  const entity = getEntityByStringId(nutrientId);
  if (entity === undefined) return undefined;
  return world.getComponent<PositionComponent>(entity, Components.Position);
}

/**
 * Get nutrient count.
 */
export function getNutrientCount(world: World): number {
  return world.getEntitiesWithTag(Tags.Nutrient).length;
}

/**
 * Convert ECS nutrients to legacy Nutrient record for network broadcasts.
 */
export function buildNutrientsRecord(world: World): Record<string, {
  id: string;
  position: Position;
  value: number;
  capacityIncrease: number;
  valueMultiplier: number;
  isHighValue: boolean;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    value: number;
    capacityIncrease: number;
    valueMultiplier: number;
    isHighValue: boolean;
  }> = {};

  forEachNutrient(world, (_entity, id, position, nutrient) => {
    result[id] = {
      id,
      position,
      value: nutrient.value,
      capacityIncrease: nutrient.capacityIncrease,
      valueMultiplier: nutrient.valueMultiplier,
      isHighValue: nutrient.isHighValue,
    };
  });

  return result;
}

// ============================================
// DrainTarget Helpers
// Manages prey-predator drain relationships via ECS component
// ============================================

/**
 * Set a drain target on prey entity (when predator starts draining).
 * @param world The ECS world
 * @param preySocketId Socket ID of the prey being drained
 * @param predatorSocketId Socket ID of the predator doing the draining
 * @returns true if drain was set, false if entities not found
 */
export function setDrainTarget(
  world: World,
  preySocketId: string,
  predatorSocketId: string
): boolean {
  const preyEntity = getEntityBySocketId(preySocketId);
  const predatorEntity = getEntityBySocketId(predatorSocketId);
  if (preyEntity === undefined || predatorEntity === undefined) return false;

  world.addComponent<DrainTargetComponent>(preyEntity, Components.DrainTarget, {
    predatorId: predatorEntity,
  });
  return true;
}

/**
 * Clear drain target from prey entity (when drain ends).
 * @param world The ECS world
 * @param preySocketId Socket ID of the prey
 */
export function clearDrainTarget(world: World, preySocketId: string): void {
  const preyEntity = getEntityBySocketId(preySocketId);
  if (preyEntity === undefined) return;

  world.removeComponent(preyEntity, Components.DrainTarget);
}

/**
 * Check if an entity is currently being drained.
 * @param world The ECS world
 * @param preySocketId Socket ID of the potential prey
 * @returns true if entity has a DrainTarget component
 */
export function hasDrainTarget(world: World, preySocketId: string): boolean {
  const preyEntity = getEntityBySocketId(preySocketId);
  if (preyEntity === undefined) return false;

  return world.hasComponent(preyEntity, Components.DrainTarget);
}

/**
 * Get the predator socket ID that is draining the given prey.
 * @param world The ECS world
 * @param preySocketId Socket ID of the prey
 * @returns Predator socket ID, or undefined if not being drained
 */
export function getDrainPredatorId(
  world: World,
  preySocketId: string
): string | undefined {
  const preyEntity = getEntityBySocketId(preySocketId);
  if (preyEntity === undefined) return undefined;

  const drainComp = world.getComponent<DrainTargetComponent>(
    preyEntity,
    Components.DrainTarget
  );
  if (!drainComp) return undefined;

  return getSocketIdByEntity(drainComp.predatorId);
}

/**
 * Iterate over all entities that have a DrainTarget component.
 * Callback receives prey socket ID and predator socket ID.
 */
export function forEachDrainTarget(
  world: World,
  callback: (preySocketId: string, predatorSocketId: string) => void
): void {
  const store = world.getStore<DrainTargetComponent>(Components.DrainTarget);
  if (!store) return;

  for (const [entity, drainComp] of store.entries()) {
    const preySocketId = getSocketIdByEntity(entity);
    const predatorSocketId = getSocketIdByEntity(drainComp.predatorId);
    if (preySocketId && predatorSocketId) {
      callback(preySocketId, predatorSocketId);
    }
  }
}

// ============================================
// Swarm Query Helpers
// ============================================

/**
 * Swarm data snapshot for iteration.
 * Contains all data needed for AI/collision without holding component refs.
 * Matches EntropySwarm interface for network compatibility.
 */
export interface SwarmSnapshot {
  entity: EntityId;
  id: string;
  position: Position;
  velocity: { x: number; y: number };
  size: number;
  state: 'patrol' | 'chase';
  targetPlayerId?: string;  // Socket ID (converted from EntityId)
  patrolTarget?: Position;
  homePosition: Position;
  disabledUntil?: number;
  energy: number;
}

/**
 * Iterate over all swarm entities.
 * Callback receives entity, string ID, and components.
 */
export function forEachSwarm(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    velocity: VelocityComponent,
    swarm: SwarmComponent,
    energy: EnergyComponent
  ) => void
): void {
  world.forEachWithTag(Tags.Swarm, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
    const swarm = world.getComponent<SwarmComponent>(entity, Components.Swarm);
    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    const id = getStringIdByEntity(entity);
    if (pos && vel && swarm && energy && id) {
      callback(entity, id, pos, vel, swarm, energy);
    }
  });
}

/**
 * Get all swarms as snapshots.
 * Useful when you need to iterate multiple times or need stable references.
 */
export function getAllSwarmSnapshots(world: World): SwarmSnapshot[] {
  const snapshots: SwarmSnapshot[] = [];
  world.forEachWithTag(Tags.Swarm, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
    const swarm = world.getComponent<SwarmComponent>(entity, Components.Swarm);
    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    const id = getStringIdByEntity(entity);
    if (pos && vel && swarm && energy && id) {
      snapshots.push({
        entity,
        id,
        position: { x: pos.x, y: pos.y },
        velocity: { x: vel.x, y: vel.y },
        size: swarm.size,
        state: swarm.state,
        targetPlayerId: swarm.targetPlayerId,
        patrolTarget: swarm.patrolTarget ? { ...swarm.patrolTarget } : undefined,
        homePosition: { ...swarm.homePosition },
        disabledUntil: swarm.disabledUntil,
        energy: energy.current,
      });
    }
  });
  return snapshots;
}

/**
 * Get swarm count.
 */
export function getSwarmCount(world: World): number {
  return world.getEntitiesWithTag(Tags.Swarm).length;
}

/**
 * Get swarm entity by string ID.
 */
export function getSwarmEntity(world: World, swarmId: string): EntityId | undefined {
  return getEntityByStringId(swarmId);
}

/**
 * Get swarm components by string ID.
 * Returns all components needed for swarm operations.
 */
export function getSwarmComponents(world: World, swarmId: string): {
  entity: EntityId;
  position: PositionComponent;
  velocity: VelocityComponent;
  swarm: SwarmComponent;
  energy: EnergyComponent;
} | null {
  const entity = getEntityByStringId(swarmId);
  if (entity === undefined) return null;

  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
  const swarm = world.getComponent<SwarmComponent>(entity, Components.Swarm);
  const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);

  if (!pos || !vel || !swarm || !energy) return null;

  return { entity, position: pos, velocity: vel, swarm, energy };
}

/**
 * Convert ECS swarms to EntropySwarm record for network broadcasts.
 * Matches the EntropySwarm interface expected by clients.
 */
export function buildSwarmsRecord(world: World): Record<string, {
  id: string;
  position: Position;
  velocity: { x: number; y: number };
  size: number;
  state: 'patrol' | 'chase';
  targetPlayerId?: string;
  patrolTarget?: Position;
  disabledUntil?: number;
  energy?: number;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    velocity: { x: number; y: number };
    size: number;
    state: 'patrol' | 'chase';
    targetPlayerId?: string;
    patrolTarget?: Position;
    disabledUntil?: number;
    energy?: number;
  }> = {};

  world.forEachWithTag(Tags.Swarm, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
    const swarm = world.getComponent<SwarmComponent>(entity, Components.Swarm);
    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    const id = getStringIdByEntity(entity);
    if (pos && vel && swarm && energy && id) {
      result[id] = {
        id,
        position: { x: pos.x, y: pos.y },
        velocity: { x: vel.x, y: vel.y },
        size: swarm.size,
        state: swarm.state,
        targetPlayerId: swarm.targetPlayerId,
        patrolTarget: swarm.patrolTarget ? { ...swarm.patrolTarget } : undefined,
        disabledUntil: swarm.disabledUntil,
        energy: energy.current,
      };
    }
  });

  return result;
}

// ============================================
// Damage Recording (drain aura system)
// ============================================

/**
 * Record damage for this tick - used by drain aura visual system.
 * Writes directly to ECS DamageTrackingComponent.activeDamage.
 */
export function recordDamage(
  world: World,
  entity: EntityId,
  damageRate: number,
  source: DamageSource,
  proximityFactor?: number
): void {
  const damageTracking = world.getComponent<DamageTrackingComponent>(entity, Components.DamageTracking);
  if (damageTracking) {
    damageTracking.activeDamage.push({ damageRate, source, proximityFactor });
  }
}

// ============================================
// Tree Query Helpers
// ============================================

/**
 * Tree data snapshot for iteration.
 * Contains all data needed for collision without holding component refs.
 */
export interface TreeSnapshot {
  entity: EntityId;
  id: string;
  position: Position;
  radius: number;
  height: number;
  variant: number;
}

/**
 * Iterate over all tree entities.
 * Callback receives entity, string ID, position, and tree component.
 */
export function forEachTree(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    tree: TreeComponent
  ) => void
): void {
  world.forEachWithTag(Tags.Tree, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const tree = world.getComponent<TreeComponent>(entity, Components.Tree);
    const id = getStringIdByEntity(entity);
    if (pos && tree && id) {
      callback(entity, id, pos, tree);
    }
  });
}

/**
 * Get all trees as snapshots.
 * Useful when you need to iterate multiple times or need stable references.
 */
export function getAllTreeSnapshots(world: World): TreeSnapshot[] {
  const snapshots: TreeSnapshot[] = [];
  forEachTree(world, (entity, id, pos, tree) => {
    snapshots.push({
      entity,
      id,
      position: { x: pos.x, y: pos.y },
      radius: tree.radius,
      height: tree.height,
      variant: tree.variant,
    });
  });
  return snapshots;
}

/**
 * Get tree count.
 */
export function getTreeCount(world: World): number {
  return world.getEntitiesWithTag(Tags.Tree).length;
}

/**
 * Convert ECS trees to Tree record for network broadcasts.
 * Matches the Tree interface expected by clients.
 */
export function buildTreesRecord(world: World): Record<string, {
  id: string;
  position: Position;
  radius: number;
  height: number;
  variant: number;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    radius: number;
    height: number;
    variant: number;
  }> = {};

  forEachTree(world, (_entity, id, pos, tree) => {
    result[id] = {
      id,
      position: { x: pos.x, y: pos.y },
      radius: tree.radius,
      height: tree.height,
      variant: tree.variant,
    };
  });

  return result;
}

// ============================================
// Stage 3+ Macro-Resource Factories
// ============================================

/**
 * Create a DataFruit on the ground (simple, ready to collect).
 * Uses GAME_CONFIG for value/capacity. Despawns after timeout.
 */
export function createDataFruitOnGround(
  world: World,
  fruitId: string,
  position: Position
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: 0,
  });
  world.addComponent<DataFruitComponent>(entity, Components.DataFruit, {
    treeEntityId: 0,  // Not attached to tree
    value: GAME_CONFIG.DATAFRUIT_VALUE,
    capacityIncrease: GAME_CONFIG.DATAFRUIT_CAPACITY,
    ripeness: 1.0,
    fallenAt: Date.now(),  // Already on ground, starts despawn timer
  });

  world.addTag(entity, Tags.DataFruit);
  registerStringIdMapping(entity, fruitId);

  return entity;
}

/**
 * Create a DataFruit entity (legacy, supports tree attachment).
 * @deprecated Use createDataFruitOnGround for simpler spawning
 */
export function createDataFruit(
  world: World,
  fruitId: string,
  treeEntityId: number,
  position: Position,
  value: number,
  capacityIncrease: number,
  ripeness: number = 1.0
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: 0,
  });
  world.addComponent<DataFruitComponent>(entity, Components.DataFruit, {
    treeEntityId,
    value,
    capacityIncrease,
    ripeness,
    fallenAt: undefined,
  });

  world.addTag(entity, Tags.DataFruit);
  registerStringIdMapping(entity, fruitId);

  return entity;
}

/**
 * Create a CyberBug entity (small skittish prey).
 */
export function createCyberBug(
  world: World,
  bugId: string,
  swarmId: string,
  position: Position,
  homePosition: Position,
  value: number,
  capacityIncrease: number
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: 0,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, {
    x: 0,
    y: 0,
    z: 0,
  });
  world.addComponent<CyberBugComponent>(entity, Components.CyberBug, {
    swarmId,
    size: GAME_CONFIG.CYBERBUG_COLLISION_RADIUS,
    state: 'patrol',
    fleeingFrom: undefined,
    homePosition: { x: homePosition.x, y: homePosition.y },
    patrolTarget: undefined,
    value,
    capacityIncrease,
  });

  world.addTag(entity, Tags.CyberBug);
  registerStringIdMapping(entity, bugId);

  return entity;
}

/**
 * Create a JungleCreature entity (larger NPC fauna).
 */
export function createJungleCreature(
  world: World,
  creatureId: string,
  variant: 'grazer' | 'stalker' | 'ambusher',
  position: Position,
  homePosition: Position,
  value: number,
  capacityIncrease: number
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: 0,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, {
    x: 0,
    y: 0,
    z: 0,
  });
  world.addComponent<JungleCreatureComponent>(entity, Components.JungleCreature, {
    variant,
    size: GAME_CONFIG.JUNGLE_CREATURE_COLLISION_RADIUS,
    state: variant === 'ambusher' ? 'idle' : 'patrol',
    targetEntityId: undefined,
    homePosition: { x: homePosition.x, y: homePosition.y },
    territoryRadius: GAME_CONFIG.JUNGLE_CREATURE_PATROL_RADIUS,
    value,
    capacityIncrease,
    aggressionRange: variant !== 'grazer' ? GAME_CONFIG.JUNGLE_CREATURE_AGGRO_RADIUS : undefined,
  });

  world.addTag(entity, Tags.JungleCreature);
  registerStringIdMapping(entity, creatureId);

  return entity;
}

/**
 * Create a Projectile entity (Stage 3 ranged specialization attack).
 * Cloned from createPseudopod pattern.
 */
export interface ProjectileOptions {
  speed?: number;
  damage?: number;
  maxDistance?: number;
  collisionRadius?: number;
}

export function createProjectile(
  world: World,
  projectileId: string,
  ownerId: EntityId,
  ownerSocketId: string,
  startPos: Position,
  targetPos: Position,
  color: string,
  options?: ProjectileOptions
): EntityId {
  const entity = world.createEntity();

  // Use provided options or fall back to default config values
  const speed = options?.speed ?? GAME_CONFIG.PROJECTILE_SPEED;
  const damage = options?.damage ?? GAME_CONFIG.PROJECTILE_DAMAGE;
  const maxDistance = options?.maxDistance ?? GAME_CONFIG.PROJECTILE_MAX_DISTANCE;

  // Calculate direction vector
  const dx = targetPos.x - startPos.x;
  const dy = targetPos.y - startPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const dirX = dist > 0 ? dx / dist : 1;
  const dirY = dist > 0 ? dy / dist : 0;

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: startPos.x,
    y: startPos.y,
    z: 0,
  });
  world.addComponent<VelocityComponent>(entity, Components.Velocity, {
    x: dirX * speed,
    y: dirY * speed,
    z: 0,
  });
  world.addComponent<ProjectileComponent>(entity, Components.Projectile, {
    ownerId,
    ownerSocketId,
    damage,
    capacitySteal: GAME_CONFIG.PROJECTILE_CAPACITY_STEAL,
    startX: startPos.x,
    startY: startPos.y,
    targetX: targetPos.x,
    targetY: targetPos.y,
    speed,
    maxDistance,
    distanceTraveled: 0,
    state: 'traveling',
    hitEntityId: undefined,
    color,
    createdAt: Date.now(),
  });

  world.addTag(entity, Tags.Projectile);
  registerStringIdMapping(entity, projectileId);

  return entity;
}

// ============================================
// DataFruit Query Helpers
// ============================================

/**
 * DataFruit snapshot for collision detection.
 */
export interface DataFruitSnapshot {
  entity: EntityId;
  id: string;
  position: Position;
  treeEntityId: number;
  value: number;
  capacityIncrease: number;
  ripeness: number;
  fallenAt?: number;
}

/**
 * Iterate over all DataFruit entities.
 */
export function forEachDataFruit(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    fruit: DataFruitComponent
  ) => void
): void {
  world.forEachWithTag(Tags.DataFruit, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const fruit = world.getComponent<DataFruitComponent>(entity, Components.DataFruit);
    const id = getStringIdByEntity(entity);
    if (pos && fruit && id) {
      callback(entity, id, pos, fruit);
    }
  });
}

/**
 * Get total number of DataFruit entities.
 */
export function getDataFruitCount(world: World): number {
  return world.getEntitiesWithTag(Tags.DataFruit).length;
}

/**
 * Get all DataFruits as snapshots.
 */
export function getAllDataFruitSnapshots(world: World): DataFruitSnapshot[] {
  const snapshots: DataFruitSnapshot[] = [];
  forEachDataFruit(world, (entity, id, pos, fruit) => {
    snapshots.push({
      entity,
      id,
      position: { x: pos.x, y: pos.y },
      treeEntityId: fruit.treeEntityId,
      value: fruit.value,
      capacityIncrease: fruit.capacityIncrease,
      ripeness: fruit.ripeness,
      fallenAt: fruit.fallenAt,
    });
  });
  return snapshots;
}

/**
 * Convert ECS DataFruits to network format.
 */
export function buildDataFruitsRecord(world: World): Record<string, {
  id: string;
  position: Position;
  treeEntityId: number;
  value: number;
  capacityIncrease: number;
  ripeness: number;
  fallenAt?: number;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    treeEntityId: number;
    value: number;
    capacityIncrease: number;
    ripeness: number;
    fallenAt?: number;
  }> = {};

  forEachDataFruit(world, (_entity, id, pos, fruit) => {
    result[id] = {
      id,
      position: { x: pos.x, y: pos.y },
      treeEntityId: fruit.treeEntityId,
      value: fruit.value,
      capacityIncrease: fruit.capacityIncrease,
      ripeness: fruit.ripeness,
      fallenAt: fruit.fallenAt,
    };
  });

  return result;
}

// ============================================
// CyberBug Query Helpers
// ============================================

/**
 * CyberBug snapshot for collision detection.
 */
export interface CyberBugSnapshot {
  entity: EntityId;
  id: string;
  position: Position;
  swarmId: string;
  state: 'idle' | 'patrol' | 'flee';
  value: number;
  capacityIncrease: number;
}

/**
 * Iterate over all CyberBug entities.
 */
export function forEachCyberBug(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    bug: CyberBugComponent
  ) => void
): void {
  world.forEachWithTag(Tags.CyberBug, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const bug = world.getComponent<CyberBugComponent>(entity, Components.CyberBug);
    const id = getStringIdByEntity(entity);
    if (pos && bug && id) {
      callback(entity, id, pos, bug);
    }
  });
}

/**
 * Get all CyberBugs as snapshots.
 */
export function getAllCyberBugSnapshots(world: World): CyberBugSnapshot[] {
  const snapshots: CyberBugSnapshot[] = [];
  forEachCyberBug(world, (entity, id, pos, bug) => {
    snapshots.push({
      entity,
      id,
      position: { x: pos.x, y: pos.y },
      swarmId: bug.swarmId,
      state: bug.state,
      value: bug.value,
      capacityIncrease: bug.capacityIncrease,
    });
  });
  return snapshots;
}

/**
 * Convert ECS CyberBugs to network format.
 */
export function buildCyberBugsRecord(world: World): Record<string, {
  id: string;
  position: Position;
  swarmId: string;
  state: 'idle' | 'patrol' | 'flee';
  value: number;
  capacityIncrease: number;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    swarmId: string;
    state: 'idle' | 'patrol' | 'flee';
    value: number;
    capacityIncrease: number;
  }> = {};

  forEachCyberBug(world, (_entity, id, pos, bug) => {
    result[id] = {
      id,
      position: { x: pos.x, y: pos.y },
      swarmId: bug.swarmId,
      state: bug.state,
      value: bug.value,
      capacityIncrease: bug.capacityIncrease,
    };
  });

  return result;
}

// ============================================
// JungleCreature Query Helpers
// ============================================

/**
 * JungleCreature snapshot for collision detection.
 */
export interface JungleCreatureSnapshot {
  entity: EntityId;
  id: string;
  position: Position;
  variant: 'grazer' | 'stalker' | 'ambusher';
  state: 'idle' | 'patrol' | 'hunt' | 'flee';
  size: number;  // Collision radius
  value: number;
  capacityIncrease: number;
}

/**
 * Iterate over all JungleCreature entities.
 */
export function forEachJungleCreature(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    creature: JungleCreatureComponent
  ) => void
): void {
  world.forEachWithTag(Tags.JungleCreature, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const creature = world.getComponent<JungleCreatureComponent>(entity, Components.JungleCreature);
    const id = getStringIdByEntity(entity);
    if (pos && creature && id) {
      callback(entity, id, pos, creature);
    }
  });
}

/**
 * Get all JungleCreatures as snapshots.
 */
export function getAllJungleCreatureSnapshots(world: World): JungleCreatureSnapshot[] {
  const snapshots: JungleCreatureSnapshot[] = [];
  forEachJungleCreature(world, (entity, id, pos, creature) => {
    snapshots.push({
      entity,
      id,
      position: { x: pos.x, y: pos.y },
      variant: creature.variant,
      state: creature.state,
      size: creature.size,
      value: creature.value,
      capacityIncrease: creature.capacityIncrease,
    });
  });
  return snapshots;
}

/**
 * Convert ECS JungleCreatures to network format.
 */
export function buildJungleCreaturesRecord(world: World): Record<string, {
  id: string;
  position: Position;
  variant: 'grazer' | 'stalker' | 'ambusher';
  state: 'idle' | 'patrol' | 'hunt' | 'flee';
  value: number;
  capacityIncrease: number;
}> {
  const result: Record<string, {
    id: string;
    position: Position;
    variant: 'grazer' | 'stalker' | 'ambusher';
    state: 'idle' | 'patrol' | 'hunt' | 'flee';
    value: number;
    capacityIncrease: number;
  }> = {};

  forEachJungleCreature(world, (_entity, id, pos, creature) => {
    result[id] = {
      id,
      position: { x: pos.x, y: pos.y },
      variant: creature.variant,
      state: creature.state,
      value: creature.value,
      capacityIncrease: creature.capacityIncrease,
    };
  });

  return result;
}

// ============================================
// Projectile Query Helpers
// ============================================

/**
 * Projectile snapshot for collision detection.
 */
export interface ProjectileSnapshot {
  entity: EntityId;
  id: string;
  position: Position;
  ownerId: number;
  ownerSocketId: string;
  state: 'traveling' | 'hit' | 'missed';
  damage: number;
  color: string;
}

/**
 * Iterate over all Projectile entities.
 */
export function forEachProjectile(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    projectile: ProjectileComponent
  ) => void
): void {
  world.forEachWithTag(Tags.Projectile, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const projectile = world.getComponent<ProjectileComponent>(entity, Components.Projectile);
    const id = getStringIdByEntity(entity);
    if (pos && projectile && id) {
      callback(entity, id, pos, projectile);
    }
  });
}

/**
 * Get all Projectiles as snapshots.
 */
export function getAllProjectileSnapshots(world: World): ProjectileSnapshot[] {
  const snapshots: ProjectileSnapshot[] = [];
  forEachProjectile(world, (entity, id, pos, projectile) => {
    snapshots.push({
      entity,
      id,
      position: { x: pos.x, y: pos.y },
      ownerId: projectile.ownerId,
      ownerSocketId: projectile.ownerSocketId,
      state: projectile.state,
      damage: projectile.damage,
      color: projectile.color,
    });
  });
  return snapshots;
}

/**
 * Convert ECS Projectiles to network format.
 */
export function buildProjectilesRecord(world: World): Record<string, {
  id: string;
  ownerId: string;
  position: Position;
  targetPosition: Position;
  state: 'traveling' | 'hit' | 'missed';
  color: string;
}> {
  const result: Record<string, {
    id: string;
    ownerId: string;
    position: Position;
    targetPosition: Position;
    state: 'traveling' | 'hit' | 'missed';
    color: string;
  }> = {};

  forEachProjectile(world, (_entity, id, pos, projectile) => {
    result[id] = {
      id,
      ownerId: projectile.ownerSocketId,
      position: { x: pos.x, y: pos.y },
      targetPosition: { x: projectile.targetX, y: projectile.targetY },
      state: projectile.state,
      color: projectile.color,
    };
  });

  return result;
}

// ============================================
// Trap Factory & Query Helpers
// ============================================

/**
 * Create a trap entity.
 * Traps are disguised as DataFruits and trigger when enemies approach.
 */
export function createTrap(
  world: World,
  trapId: string,
  ownerId: EntityId,
  ownerSocketId: string,
  position: Position,
  color: string
): EntityId {
  const entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: position.x,
    y: position.y,
    z: 0,
  });

  world.addComponent<TrapComponent>(entity, Components.Trap, {
    ownerId,
    ownerSocketId,
    damage: GAME_CONFIG.TRAP_DAMAGE,
    stunDuration: GAME_CONFIG.TRAP_STUN_DURATION,
    triggerRadius: GAME_CONFIG.TRAP_TRIGGER_RADIUS,
    placedAt: Date.now(),
    lifetime: GAME_CONFIG.TRAP_LIFETIME,
    color,
  });

  world.addTag(entity, Tags.Trap);
  registerStringIdMapping(entity, trapId);

  return entity;
}

/**
 * Iterate over all Trap entities.
 */
export function forEachTrap(
  world: World,
  callback: (
    entity: EntityId,
    id: string,
    position: PositionComponent,
    trap: TrapComponent
  ) => void
): void {
  world.forEachWithTag(Tags.Trap, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const trap = world.getComponent<TrapComponent>(entity, Components.Trap);
    const id = getStringIdByEntity(entity);
    if (pos && trap && id) {
      callback(entity, id, pos, trap);
    }
  });
}

/**
 * Count traps owned by a specific player.
 */
export function countTrapsForPlayer(world: World, ownerSocketId: string): number {
  let count = 0;
  forEachTrap(world, (_entity, _id, _pos, trap) => {
    if (trap.ownerSocketId === ownerSocketId) {
      count++;
    }
  });
  return count;
}

/**
 * Get all Trap entities as snapshots.
 */
export function getAllTrapSnapshots(world: World): {
  entity: EntityId;
  id: string;
  position: Position;
  ownerSocketId: string;
  color: string;
}[] {
  const snapshots: {
    entity: EntityId;
    id: string;
    position: Position;
    ownerSocketId: string;
    color: string;
  }[] = [];

  forEachTrap(world, (entity, id, pos, trap) => {
    snapshots.push({
      entity,
      id,
      position: { x: pos.x, y: pos.y },
      ownerSocketId: trap.ownerSocketId,
      color: trap.color,
    });
  });

  return snapshots;
}

/**
 * Convert ECS Traps to network format.
 */
export function buildTrapsRecord(world: World): Record<string, {
  id: string;
  ownerId: string;
  position: Position;
  triggerRadius: number;
  damage: number;
  stunDuration: number;
  placedAt: number;
  lifetime: number;
  color: string;
}> {
  const result: Record<string, {
    id: string;
    ownerId: string;
    position: Position;
    triggerRadius: number;
    damage: number;
    stunDuration: number;
    placedAt: number;
    lifetime: number;
    color: string;
  }> = {};

  forEachTrap(world, (_entity, id, pos, trap) => {
    result[id] = {
      id,
      ownerId: trap.ownerSocketId,
      position: { x: pos.x, y: pos.y },
      triggerRadius: trap.triggerRadius,
      damage: trap.damage,
      stunDuration: trap.stunDuration,
      placedAt: trap.placedAt,
      lifetime: trap.lifetime,
      color: trap.color,
    };
  });

  return result;
}
