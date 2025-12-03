// ============================================
// Client ECS Entity Factories
// Functions to create/update entities from network messages
// ============================================

import {
  World,
  ComponentStore,
  Components,
  Tags,
  GAME_CONFIG,
} from '@godcell/shared';
import { ClientComponents } from './types';
import type {
  DrainAuraComponent,
  GainAuraComponent,
  EvolutionAuraComponent,
} from './components';
import type {
  EntityId,
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  PlayerComponent,
  StageComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  TreeComponent,
  DataFruitComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  ProjectileComponent,
  InterpolationTargetComponent,
  ClientDamageInfoComponent,
} from '@godcell/shared';
import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
  Tree,
  DataFruit,
  CyberBug,
  JungleCreature,
  Projectile,
  DamageSource,
  EvolutionStage,
} from '@godcell/shared';

// ============================================
// World Setup
// ============================================

/**
 * Create and configure a client ECS World.
 * Registers only the component stores needed for rendering.
 */
export function createClientWorld(): World {
  const world = new World();

  // Core components
  world.registerStore<PositionComponent>(Components.Position, new ComponentStore());
  world.registerStore<VelocityComponent>(Components.Velocity, new ComponentStore());
  world.registerStore<EnergyComponent>(Components.Energy, new ComponentStore());

  // Player components
  world.registerStore<PlayerComponent>(Components.Player, new ComponentStore());
  world.registerStore<StageComponent>(Components.Stage, new ComponentStore());

  // Entity-type components
  world.registerStore<NutrientComponent>(Components.Nutrient, new ComponentStore());
  world.registerStore<ObstacleComponent>(Components.Obstacle, new ComponentStore());
  world.registerStore<SwarmComponent>(Components.Swarm, new ComponentStore());
  world.registerStore<PseudopodComponent>(Components.Pseudopod, new ComponentStore());
  world.registerStore<TreeComponent>(Components.Tree, new ComponentStore());

  // Stage 3+ macro-resource components
  world.registerStore<DataFruitComponent>(Components.DataFruit, new ComponentStore());
  world.registerStore<CyberBugComponent>(Components.CyberBug, new ComponentStore());
  world.registerStore<JungleCreatureComponent>(Components.JungleCreature, new ComponentStore());
  world.registerStore<ProjectileComponent>(Components.Projectile, new ComponentStore());

  // Client-only components
  world.registerStore<InterpolationTargetComponent>(Components.InterpolationTarget, new ComponentStore());
  world.registerStore<ClientDamageInfoComponent>(Components.ClientDamageInfo, new ComponentStore());

  // Client-only aura components (visual feedback)
  world.registerStore<DrainAuraComponent>(ClientComponents.DrainAura, new ComponentStore());
  world.registerStore<GainAuraComponent>(ClientComponents.GainAura, new ComponentStore());
  world.registerStore<EvolutionAuraComponent>(ClientComponents.EvolutionAura, new ComponentStore());

  return world;
}

// ============================================
// Lookup Tables
// Maps between EntityId and string IDs (player ID, nutrient ID, etc.)
// ============================================

const entityToStringId = new Map<EntityId, string>();
const stringIdToEntity = new Map<string, EntityId>();

/**
 * Get EntityId from string ID.
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
 * Register string ID <-> EntityId mapping.
 */
function registerMapping(entity: EntityId, stringId: string): void {
  entityToStringId.set(entity, stringId);
  stringIdToEntity.set(stringId, entity);
}

/**
 * Unregister all mappings for an entity.
 */
export function unregisterEntity(entity: EntityId): void {
  const stringId = entityToStringId.get(entity);
  if (stringId) {
    stringIdToEntity.delete(stringId);
    entityToStringId.delete(entity);
  }
}

/**
 * Clear all lookup tables (for world reset).
 */
export function clearLookups(): void {
  entityToStringId.clear();
  stringIdToEntity.clear();
}

// ============================================
// Entity Factories - Create from Network Objects
// ============================================

/**
 * Create or update a player entity from a network Player object.
 */
export function upsertPlayer(world: World, player: Player): EntityId {
  let entity = stringIdToEntity.get(player.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = player.position.x;
      pos.y = player.position.y;
    }

    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    if (energy) {
      energy.current = player.energy;
      energy.max = player.maxEnergy;
    }

    const stage = world.getComponent<StageComponent>(entity, Components.Stage);
    if (stage) {
      stage.stage = player.stage;
      stage.isEvolving = player.isEvolving || false;
    }

    // Update interpolation target
    const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
    if (interp) {
      interp.targetX = player.position.x;
      interp.targetY = player.position.y;
      interp.timestamp = Date.now();
    }

    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: player.position.x,
    y: player.position.y,
  });

  world.addComponent<EnergyComponent>(entity, Components.Energy, {
    current: player.energy,
    max: player.maxEnergy,
  });

  world.addComponent<PlayerComponent>(entity, Components.Player, {
    socketId: player.id,
    name: player.id, // Client doesn't have name, use ID
    color: player.color,
  });

  world.addComponent<StageComponent>(entity, Components.Stage, {
    stage: player.stage,
    isEvolving: player.isEvolving || false,
  });

  world.addComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget, {
    targetX: player.position.x,
    targetY: player.position.y,
    timestamp: Date.now(),
  });

  world.addTag(entity, Tags.Player);
  registerMapping(entity, player.id);

  return entity;
}

/**
 * Update player position target (for interpolation).
 * z is optional - only used for Stage 5 (godcell) 3D movement.
 */
export function updatePlayerTarget(world: World, playerId: string, x: number, y: number, z?: number): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  if (pos) {
    pos.x = x;
    pos.y = y;
    if (z !== undefined) {
      pos.z = z;
    }
  }

  const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
  if (interp) {
    interp.targetX = x;
    interp.targetY = y;
    if (z !== undefined) {
      interp.targetZ = z;
    }
    interp.timestamp = Date.now();
  }
}

/**
 * Remove a player entity.
 */
export function removePlayer(world: World, playerId: string): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Update player energy (and optionally max energy).
 */
export function updatePlayerEnergy(world: World, playerId: string, energy: number, maxEnergy?: number): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
  if (energyComp) {
    energyComp.current = energy;
    if (maxEnergy !== undefined) {
      energyComp.max = maxEnergy;
    }
  }
}

/**
 * Set player evolving state (for molting animation).
 */
export function setPlayerEvolving(world: World, playerId: string, isEvolving: boolean): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  const stage = world.getComponent<StageComponent>(entity, Components.Stage);
  if (stage) {
    stage.isEvolving = isEvolving;
  }
}

/**
 * Update player after evolution completes.
 */
export function updatePlayerEvolved(world: World, playerId: string, newStage: EvolutionStage, newMaxEnergy: number): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  const stage = world.getComponent<StageComponent>(entity, Components.Stage);
  if (stage) {
    stage.stage = newStage;
    stage.isEvolving = false;
  }

  const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
  if (energy) {
    energy.max = newMaxEnergy;
  }
}

/**
 * Create or update a nutrient entity from a network Nutrient object.
 */
export function upsertNutrient(world: World, nutrient: Nutrient): EntityId {
  let entity = stringIdToEntity.get(nutrient.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = nutrient.position.x;
      pos.y = nutrient.position.y;
    }
    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: nutrient.position.x,
    y: nutrient.position.y,
  });

  world.addComponent<NutrientComponent>(entity, Components.Nutrient, {
    value: nutrient.value,
    capacityIncrease: nutrient.capacityIncrease,
    valueMultiplier: nutrient.valueMultiplier,
    isHighValue: nutrient.isHighValue || false,
  });

  world.addTag(entity, Tags.Nutrient);
  registerMapping(entity, nutrient.id);

  return entity;
}

/**
 * Update nutrient position.
 */
export function updateNutrientPosition(world: World, nutrientId: string, x: number, y: number): void {
  const entity = stringIdToEntity.get(nutrientId);
  if (entity === undefined) return;

  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  if (pos) {
    pos.x = x;
    pos.y = y;
  }
}

/**
 * Remove a nutrient entity.
 */
export function removeNutrient(world: World, nutrientId: string): void {
  const entity = stringIdToEntity.get(nutrientId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Create or update an obstacle entity from a network Obstacle object.
 */
export function upsertObstacle(world: World, obstacle: Obstacle): EntityId {
  let entity = stringIdToEntity.get(obstacle.id);

  if (entity !== undefined) {
    return entity; // Obstacles don't change
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: obstacle.position.x,
    y: obstacle.position.y,
  });

  world.addComponent<ObstacleComponent>(entity, Components.Obstacle, {
    radius: obstacle.radius,
    strength: obstacle.strength,
  });

  world.addTag(entity, Tags.Obstacle);
  registerMapping(entity, obstacle.id);

  return entity;
}

/**
 * Create or update a tree entity from a network Tree object.
 * Trees are static - they don't change once created.
 */
export function upsertTree(world: World, tree: Tree): EntityId {
  let entity = stringIdToEntity.get(tree.id);

  if (entity !== undefined) {
    return entity; // Trees don't change
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: tree.position.x,
    y: tree.position.y,
  });

  world.addComponent<TreeComponent>(entity, Components.Tree, {
    radius: tree.radius,
    height: tree.height,
    variant: tree.variant,
  });

  world.addTag(entity, Tags.Tree);
  registerMapping(entity, tree.id);

  return entity;
}

/**
 * Create or update a swarm entity from a network EntropySwarm object.
 */
export function upsertSwarm(world: World, swarm: EntropySwarm): EntityId {
  let entity = stringIdToEntity.get(swarm.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = swarm.position.x;
      pos.y = swarm.position.y;
    }

    const swarmComp = world.getComponent<SwarmComponent>(entity, Components.Swarm);
    if (swarmComp) {
      swarmComp.state = swarm.state;
      swarmComp.disabledUntil = swarm.disabledUntil;
    }

    const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
    if (interp) {
      interp.targetX = swarm.position.x;
      interp.targetY = swarm.position.y;
      interp.timestamp = Date.now();
    }

    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: swarm.position.x,
    y: swarm.position.y,
  });

  world.addComponent<SwarmComponent>(entity, Components.Swarm, {
    size: swarm.size,
    state: swarm.state,
    homePosition: swarm.position,
    disabledUntil: swarm.disabledUntil,
  });

  world.addComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget, {
    targetX: swarm.position.x,
    targetY: swarm.position.y,
    timestamp: Date.now(),
  });

  world.addTag(entity, Tags.Swarm);
  registerMapping(entity, swarm.id);

  return entity;
}

/**
 * Update swarm position target (for interpolation).
 */
export function updateSwarmTarget(
  world: World,
  swarmId: string,
  x: number,
  y: number,
  disabledUntil?: number
): void {
  const entity = stringIdToEntity.get(swarmId);
  if (entity === undefined) return;

  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  if (pos) {
    pos.x = x;
    pos.y = y;
  }

  const swarmComp = world.getComponent<SwarmComponent>(entity, Components.Swarm);
  if (swarmComp) {
    swarmComp.disabledUntil = disabledUntil;
  }

  const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
  if (interp) {
    interp.targetX = x;
    interp.targetY = y;
    interp.timestamp = Date.now();
  }
}

/**
 * Remove a swarm entity.
 */
export function removeSwarm(world: World, swarmId: string): void {
  const entity = stringIdToEntity.get(swarmId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Create or update a pseudopod entity from a network Pseudopod object.
 */
export function upsertPseudopod(world: World, pseudopod: Pseudopod): EntityId {
  let entity = stringIdToEntity.get(pseudopod.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = pseudopod.position.x;
      pos.y = pseudopod.position.y;
    }
    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: pseudopod.position.x,
    y: pseudopod.position.y,
  });

  world.addComponent<VelocityComponent>(entity, Components.Velocity, {
    x: pseudopod.velocity.x,
    y: pseudopod.velocity.y,
  });

  // Note: PseudopodComponent expects EntityId for ownerId, but network sends string
  // For client rendering, we only need the position and color anyway
  world.addComponent<PseudopodComponent>(entity, Components.Pseudopod, {
    ownerId: 0, // Not used on client
    ownerSocketId: pseudopod.ownerId,
    width: pseudopod.width,
    maxDistance: pseudopod.maxDistance,
    distanceTraveled: pseudopod.distanceTraveled,
    createdAt: pseudopod.createdAt,
    color: pseudopod.color,
    hitEntities: new Set(),
  });

  world.addTag(entity, Tags.Pseudopod);
  registerMapping(entity, pseudopod.id);

  return entity;
}

/**
 * Update pseudopod position.
 */
export function updatePseudopodPosition(world: World, pseudopodId: string, x: number, y: number): void {
  const entity = stringIdToEntity.get(pseudopodId);
  if (entity === undefined) return;

  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  if (pos) {
    pos.x = x;
    pos.y = y;
  }
}

/**
 * Remove a pseudopod entity.
 */
export function removePseudopod(world: World, pseudopodId: string): void {
  const entity = stringIdToEntity.get(pseudopodId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

// ============================================
// Stage 3+ Macro-Resource Factories
// ============================================

/**
 * Create or update a DataFruit entity from a network DataFruit object.
 */
export function upsertDataFruit(world: World, fruit: DataFruit): EntityId {
  let entity = stringIdToEntity.get(fruit.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = fruit.position.x;
      pos.y = fruit.position.y;
    }

    const fruitComp = world.getComponent<DataFruitComponent>(entity, Components.DataFruit);
    if (fruitComp) {
      fruitComp.ripeness = fruit.ripeness;
      fruitComp.fallenAt = fruit.fallenAt;
    }

    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: fruit.position.x,
    y: fruit.position.y,
  });

  world.addComponent<DataFruitComponent>(entity, Components.DataFruit, {
    treeEntityId: fruit.treeEntityId,
    value: fruit.value,
    capacityIncrease: fruit.capacityIncrease,
    ripeness: fruit.ripeness,
    fallenAt: fruit.fallenAt,
  });

  world.addTag(entity, Tags.DataFruit);
  registerMapping(entity, fruit.id);

  return entity;
}

/**
 * Remove a DataFruit entity.
 */
export function removeDataFruit(world: World, fruitId: string): void {
  const entity = stringIdToEntity.get(fruitId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Create or update a CyberBug entity from a network CyberBug object.
 */
export function upsertCyberBug(world: World, bug: CyberBug): EntityId {
  let entity = stringIdToEntity.get(bug.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = bug.position.x;
      pos.y = bug.position.y;
    }

    const bugComp = world.getComponent<CyberBugComponent>(entity, Components.CyberBug);
    if (bugComp) {
      bugComp.state = bug.state;
    }

    const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
    if (interp) {
      interp.targetX = bug.position.x;
      interp.targetY = bug.position.y;
      interp.timestamp = Date.now();
    }

    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: bug.position.x,
    y: bug.position.y,
  });

  // Client uses defaults for server-side fields (homePosition, size)
  world.addComponent<CyberBugComponent>(entity, Components.CyberBug, {
    swarmId: bug.swarmId,
    size: GAME_CONFIG.CYBERBUG_COLLISION_RADIUS, // Default size for rendering
    state: bug.state,
    homePosition: { x: bug.position.x, y: bug.position.y }, // Not tracked on client
    value: bug.value,
    capacityIncrease: bug.capacityIncrease,
  });

  world.addComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget, {
    targetX: bug.position.x,
    targetY: bug.position.y,
    timestamp: Date.now(),
  });

  world.addTag(entity, Tags.CyberBug);
  registerMapping(entity, bug.id);

  return entity;
}

/**
 * Remove a CyberBug entity.
 */
export function removeCyberBug(world: World, bugId: string): void {
  const entity = stringIdToEntity.get(bugId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Update a CyberBug's position and state from a movement message.
 */
export function updateCyberBugPosition(
  world: World,
  bugId: string,
  x: number,
  y: number,
  state: string
): void {
  const entity = stringIdToEntity.get(bugId);
  if (entity === undefined) return;

  // Update interpolation target (render systems interpolate toward this)
  const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
  if (interp) {
    interp.targetX = x;
    interp.targetY = y;
    interp.timestamp = Date.now();
  }

  // Update state for visual changes
  const bugComp = world.getComponent<CyberBugComponent>(entity, Components.CyberBug);
  if (bugComp) {
    bugComp.state = state as 'idle' | 'patrol' | 'flee';
  }
}

/**
 * Create or update a JungleCreature entity from a network JungleCreature object.
 */
export function upsertJungleCreature(world: World, creature: JungleCreature): EntityId {
  let entity = stringIdToEntity.get(creature.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = creature.position.x;
      pos.y = creature.position.y;
    }

    const creatureComp = world.getComponent<JungleCreatureComponent>(entity, Components.JungleCreature);
    if (creatureComp) {
      creatureComp.state = creature.state;
    }

    const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
    if (interp) {
      interp.targetX = creature.position.x;
      interp.targetY = creature.position.y;
      interp.timestamp = Date.now();
    }

    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: creature.position.x,
    y: creature.position.y,
  });

  // Client uses defaults for server-side AI fields
  world.addComponent<JungleCreatureComponent>(entity, Components.JungleCreature, {
    variant: creature.variant,
    size: GAME_CONFIG.JUNGLE_CREATURE_COLLISION_RADIUS, // Default size for rendering
    state: creature.state,
    homePosition: { x: creature.position.x, y: creature.position.y }, // Not tracked on client
    territoryRadius: GAME_CONFIG.JUNGLE_CREATURE_PATROL_RADIUS, // Default
    value: creature.value,
    capacityIncrease: creature.capacityIncrease,
    aggressionRange: GAME_CONFIG.JUNGLE_CREATURE_AGGRO_RADIUS, // Default
  });

  world.addComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget, {
    targetX: creature.position.x,
    targetY: creature.position.y,
    timestamp: Date.now(),
  });

  world.addTag(entity, Tags.JungleCreature);
  registerMapping(entity, creature.id);

  return entity;
}

/**
 * Remove a JungleCreature entity.
 */
export function removeJungleCreature(world: World, creatureId: string): void {
  const entity = stringIdToEntity.get(creatureId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

/**
 * Update a JungleCreature's position and state from a movement message.
 */
export function updateJungleCreaturePosition(
  world: World,
  creatureId: string,
  x: number,
  y: number,
  state: string
): void {
  const entity = stringIdToEntity.get(creatureId);
  if (entity === undefined) return;

  // Update interpolation target (render systems interpolate toward this)
  const interp = world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
  if (interp) {
    interp.targetX = x;
    interp.targetY = y;
    interp.timestamp = Date.now();
  }

  // Update state for visual changes
  const creatureComp = world.getComponent<JungleCreatureComponent>(entity, Components.JungleCreature);
  if (creatureComp) {
    creatureComp.state = state as 'idle' | 'patrol' | 'hunt' | 'flee';
  }
}

/**
 * Create or update a Projectile entity from a network Projectile object.
 */
export function upsertProjectile(world: World, projectile: Projectile): EntityId {
  let entity = stringIdToEntity.get(projectile.id);

  if (entity !== undefined) {
    // Update existing entity
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (pos) {
      pos.x = projectile.position.x;
      pos.y = projectile.position.y;
    }

    const projComp = world.getComponent<ProjectileComponent>(entity, Components.Projectile);
    if (projComp) {
      projComp.state = projectile.state;
    }

    return entity;
  }

  // Create new entity
  entity = world.createEntity();

  // Compute velocity direction from position to target
  const dx = projectile.targetPosition.x - projectile.position.x;
  const dy = projectile.targetPosition.y - projectile.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const speed = GAME_CONFIG.PROJECTILE_SPEED;
  const vx = dist > 0 ? (dx / dist) * speed : 0;
  const vy = dist > 0 ? (dy / dist) * speed : 0;

  world.addComponent<PositionComponent>(entity, Components.Position, {
    x: projectile.position.x,
    y: projectile.position.y,
  });

  world.addComponent<VelocityComponent>(entity, Components.Velocity, {
    x: vx,
    y: vy,
  });

  // Client uses defaults for server-only fields
  world.addComponent<ProjectileComponent>(entity, Components.Projectile, {
    ownerId: 0, // Not used on client
    ownerSocketId: projectile.ownerId,
    damage: GAME_CONFIG.PROJECTILE_DAMAGE,
    capacitySteal: 0,
    startX: projectile.position.x,
    startY: projectile.position.y,
    targetX: projectile.targetPosition.x,
    targetY: projectile.targetPosition.y,
    speed: speed,
    maxDistance: GAME_CONFIG.PROJECTILE_MAX_DISTANCE,
    distanceTraveled: 0,
    state: projectile.state,
    color: projectile.color,
    createdAt: Date.now(),
  });

  world.addTag(entity, Tags.Projectile);
  registerMapping(entity, projectile.id);

  return entity;
}

/**
 * Remove a Projectile entity.
 */
export function removeProjectile(world: World, projectileId: string): void {
  const entity = stringIdToEntity.get(projectileId);
  if (entity === undefined) return;

  unregisterEntity(entity);
  world.destroyEntity(entity);
}

// ============================================
// Damage Info Updates
// ============================================

/**
 * Update damage info for a player entity.
 */
export function setPlayerDamageInfo(
  world: World,
  playerId: string,
  totalDamageRate: number,
  primarySource: DamageSource,
  proximityFactor?: number
): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  let info = world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);
  if (!info) {
    world.addComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo, {
      totalDamageRate,
      primarySource,
      proximityFactor,
    });
  } else {
    info.totalDamageRate = totalDamageRate;
    info.primarySource = primarySource;
    info.proximityFactor = proximityFactor;
  }
}

/**
 * Clear damage info for a player entity.
 */
export function clearPlayerDamageInfo(world: World, playerId: string): void {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  if (world.hasComponent(entity, Components.ClientDamageInfo)) {
    world.removeComponent(entity, Components.ClientDamageInfo);
  }
}

/**
 * Update damage info for a swarm entity.
 */
export function setSwarmDamageInfo(
  world: World,
  swarmId: string,
  totalDamageRate: number,
  primarySource: DamageSource
): void {
  const entity = stringIdToEntity.get(swarmId);
  if (entity === undefined) return;

  let info = world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);
  if (!info) {
    world.addComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo, {
      totalDamageRate,
      primarySource,
    });
  } else {
    info.totalDamageRate = totalDamageRate;
    info.primarySource = primarySource;
  }
}

// ============================================
// Local Player Management
// ============================================

/**
 * Set the local player (the player controlled by this client).
 * Adds LocalPlayer tag to the entity.
 */
export function setLocalPlayer(world: World, playerId: string): void {
  // First, clear any existing LocalPlayer tag
  clearLocalPlayer(world);

  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return;

  world.addTag(entity, Tags.LocalPlayer);
}

/**
 * Clear the LocalPlayer tag from all entities.
 */
export function clearLocalPlayer(world: World): void {
  world.forEachWithTag(Tags.LocalPlayer, (entity) => {
    world.removeTag(entity, Tags.LocalPlayer);
  });
}

/**
 * Get the local player's entity ID.
 */
export function getLocalPlayerEntity(world: World): EntityId | undefined {
  let result: EntityId | undefined;
  world.forEachWithTag(Tags.LocalPlayer, (entity) => {
    result = entity;
  });
  return result;
}

/**
 * Get the local player's string ID.
 */
export function getLocalPlayerId(world: World): string | undefined {
  const entity = getLocalPlayerEntity(world);
  if (entity === undefined) return undefined;
  return getStringIdByEntity(entity);
}

/**
 * Get the local Player object.
 */
export function getLocalPlayer(world: World): Player | null {
  const playerId = getLocalPlayerId(world);
  if (!playerId) return null;
  return getPlayer(world, playerId);
}

// ============================================
// Query Helpers - for compatibility with GameState API
// ============================================

/**
 * Get a Player object by ID (for compatibility with existing code).
 */
export function getPlayer(world: World, playerId: string): Player | null {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return null;

  const pos = world.getComponent<PositionComponent>(entity, Components.Position);
  const player = world.getComponent<PlayerComponent>(entity, Components.Player);
  const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
  const stage = world.getComponent<StageComponent>(entity, Components.Stage);

  if (!pos || !player || !energy || !stage) return null;

  return {
    id: playerId,
    position: { x: pos.x, y: pos.y, z: pos.z },
    color: player.color,
    energy: energy.current,
    maxEnergy: energy.max,
    stage: stage.stage,
    isEvolving: stage.isEvolving,
  };
}

/**
 * Check if a player entity exists.
 */
export function hasPlayer(_world: World, playerId: string): boolean {
  return stringIdToEntity.has(playerId);
}

/**
 * Get player's EnergyComponent.
 */
export function getPlayerEnergy(world: World, playerId: string): EnergyComponent | undefined {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return undefined;
  return world.getComponent<EnergyComponent>(entity, Components.Energy);
}

/**
 * Get player's StageComponent.
 */
export function getPlayerStage(world: World, playerId: string): StageComponent | undefined {
  const entity = stringIdToEntity.get(playerId);
  if (entity === undefined) return undefined;
  return world.getComponent<StageComponent>(entity, Components.Stage);
}

/**
 * Iterate over all player entities.
 */
export function forEachPlayer(
  world: World,
  callback: (entity: EntityId, playerId: string, player: Player) => void
): void {
  world.forEachWithTag(Tags.Player, (entity) => {
    const playerId = getStringIdByEntity(entity);
    if (!playerId) return;

    const playerObj = getPlayer(world, playerId);
    if (playerObj) {
      callback(entity, playerId, playerObj);
    }
  });
}

// ============================================
// Aura Component Helpers
// ============================================

/**
 * Add or update a drain aura on an entity.
 * Used by AuraStateSystem when entity is taking damage.
 */
export function setDrainAura(
  world: World,
  entity: EntityId,
  intensity: number,
  source: DamageSource,
  proximityFactor?: number
): void {
  const existing = world.getComponent<DrainAuraComponent>(entity, ClientComponents.DrainAura);
  if (existing) {
    existing.intensity = intensity;
    existing.source = source;
    existing.proximityFactor = proximityFactor;
  } else {
    world.addComponent<DrainAuraComponent>(entity, ClientComponents.DrainAura, {
      intensity,
      source,
      proximityFactor,
    });
  }
}

/**
 * Remove drain aura from an entity.
 * Used by AuraStateSystem when entity stops taking damage.
 */
export function clearDrainAura(world: World, entity: EntityId): void {
  if (world.hasComponent(entity, ClientComponents.DrainAura)) {
    world.removeComponent(entity, ClientComponents.DrainAura);
  }
}

/**
 * Trigger a gain aura flash on an entity.
 * Used for nutrient collection, fruit collection, predation gains.
 *
 * @param color - THREE.Color hex value (0x00ffff cyan, 0xffd700 gold, etc.)
 * @param duration - Flash duration in ms (default 500)
 */
export function triggerGainAura(
  world: World,
  entity: EntityId,
  intensity: number,
  color: number,
  duration: number = 500
): void {
  const existing = world.getComponent<GainAuraComponent>(entity, ClientComponents.GainAura);
  if (existing) {
    // Reset the trigger time to restart animation
    existing.intensity = intensity;
    existing.color = color;
    existing.triggerTime = Date.now();
    existing.duration = duration;
  } else {
    world.addComponent<GainAuraComponent>(entity, ClientComponents.GainAura, {
      intensity,
      color,
      triggerTime: Date.now(),
      duration,
    });
  }
}

/**
 * Remove gain aura from an entity.
 * Called when flash animation completes.
 */
export function clearGainAura(world: World, entity: EntityId): void {
  if (world.hasComponent(entity, ClientComponents.GainAura)) {
    world.removeComponent(entity, ClientComponents.GainAura);
  }
}

/**
 * Set evolution aura on an entity.
 * Used when entity starts evolving (molting).
 */
export function setEvolutionAura(
  world: World,
  entity: EntityId,
  targetStage: EvolutionStage,
  duration: number
): void {
  const existing = world.getComponent<EvolutionAuraComponent>(entity, ClientComponents.EvolutionAura);
  if (existing) {
    existing.progress = 0;
    existing.targetStage = targetStage;
    existing.startTime = Date.now();
    existing.duration = duration;
  } else {
    world.addComponent<EvolutionAuraComponent>(entity, ClientComponents.EvolutionAura, {
      progress: 0,
      targetStage,
      startTime: Date.now(),
      duration,
    });
  }
}

/**
 * Remove evolution aura from an entity.
 * Called when evolution completes.
 */
export function clearEvolutionAura(world: World, entity: EntityId): void {
  if (world.hasComponent(entity, ClientComponents.EvolutionAura)) {
    world.removeComponent(entity, ClientComponents.EvolutionAura);
  }
}

/**
 * Get the drain aura component for an entity by string ID.
 */
export function getDrainAura(world: World, entityId: string): DrainAuraComponent | undefined {
  const entity = stringIdToEntity.get(entityId);
  if (entity === undefined) return undefined;
  return world.getComponent<DrainAuraComponent>(entity, ClientComponents.DrainAura);
}

/**
 * Get the gain aura component for an entity by string ID.
 */
export function getGainAura(world: World, entityId: string): GainAuraComponent | undefined {
  const entity = stringIdToEntity.get(entityId);
  if (entity === undefined) return undefined;
  return world.getComponent<GainAuraComponent>(entity, ClientComponents.GainAura);
}

/**
 * Get the evolution aura component for an entity by string ID.
 */
export function getEvolutionAura(world: World, entityId: string): EvolutionAuraComponent | undefined {
  const entity = stringIdToEntity.get(entityId);
  if (entity === undefined) return undefined;
  return world.getComponent<EvolutionAuraComponent>(entity, ClientComponents.EvolutionAura);
}
