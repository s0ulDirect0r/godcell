// ============================================
// Player Serialization
// Convert player entities to network formats
// ============================================

import { Components, Tags } from '#shared';
import type {
  World,
  EntityId,
  PositionComponent,
  EnergyComponent,
  StageComponent,
  EnergyUpdateMessage,
} from '#shared';
import { getSocketIdByEntity } from '../factories';

/**
 * Get all player entities from ECS.
 * Returns entities with the Player tag.
 */
export function getPlayerEntities(world: World): EntityId[] {
  return world.getEntitiesWithTag(Tags.Player);
}

/**
 * Get all living player entities (energy > 0).
 */
export function getLivingPlayerEntities(world: World): EntityId[] {
  const players: EntityId[] = [];

  world.forEachWithTag(Tags.Player, (entity) => {
    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    if (energy && energy.current > 0) {
      players.push(entity);
    }
  });

  return players;
}

/**
 * Build EnergyUpdateMessage for a player entity.
 * Returns null if the player is dead or components are missing.
 */
export function buildEnergyUpdateMessage(
  world: World,
  entity: EntityId
): EnergyUpdateMessage | null {
  const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
  if (!energy || energy.current <= 0) return null;

  const socketId = getSocketIdByEntity(entity);
  if (!socketId) return null;

  return {
    type: 'energyUpdate',
    playerId: socketId,
    energy: energy.current,
  };
}

/**
 * Build all energy update messages for living players.
 */
export function buildAllEnergyUpdates(world: World): EnergyUpdateMessage[] {
  const messages: EnergyUpdateMessage[] = [];

  world.forEachWithTag(Tags.Player, (entity) => {
    const msg = buildEnergyUpdateMessage(world, entity);
    if (msg) {
      messages.push(msg);
    }
  });

  return messages;
}

/**
 * Get player position from ECS.
 * Returns undefined if entity doesn't have position.
 */
export function getPlayerPosition(
  world: World,
  entity: EntityId
): { x: number; y: number } | undefined {
  return world.getComponent<PositionComponent>(entity, Components.Position);
}

/**
 * Get player stage from ECS.
 */
export function getPlayerStage(world: World, entity: EntityId) {
  const stage = world.getComponent<StageComponent>(entity, Components.Stage);
  return stage?.stage;
}
