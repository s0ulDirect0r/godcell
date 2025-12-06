// ============================================
// Detection Serialization
// Build detection messages for multi-cell chemical sensing
// ============================================

import {
  EvolutionStage,
  Components,
  Tags,
} from '#shared';
import type {
  World,
  EntityId,
  PositionComponent,
  EnergyComponent,
  StageComponent,
  NutrientComponent,
  DetectedEntity,
  DetectionUpdateMessage,
} from '#shared';
import { getSocketIdByEntity, getStringIdByEntity } from '../factories';

/**
 * Calculate distance between two positions.
 */
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get all entities within detection range of a position.
 * Used for multi-cell chemical sensing.
 */
export interface DetectedEntityData {
  entity: EntityId;
  position: { x: number; y: number };
  entityType: 'player' | 'nutrient' | 'swarm';
  stage?: EvolutionStage;
  stringId: string;
}

/**
 * Find all players within detection range (for chemical sensing).
 * Excludes dead players and self.
 */
export function detectPlayersInRange(
  world: World,
  sensorEntity: EntityId,
  sensorPosition: { x: number; y: number },
  detectionRadius: number
): DetectedEntityData[] {
  const detected: DetectedEntityData[] = [];

  world.forEachWithTag(Tags.Player, (entity) => {
    // Don't detect yourself
    if (entity === sensorEntity) return;

    // Skip dead players
    const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
    if (!energy || energy.current <= 0) return;

    // Check distance
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (!pos) return;

    const dist = distance(sensorPosition, pos);
    if (dist <= detectionRadius) {
      const stage = world.getComponent<StageComponent>(entity, Components.Stage);
      const socketId = getSocketIdByEntity(entity);

      if (socketId) {
        detected.push({
          entity,
          position: { x: pos.x, y: pos.y },
          entityType: 'player',
          stage: stage?.stage,
          stringId: socketId,
        });
      }
    }
  });

  return detected;
}

/**
 * Find all nutrients within detection range.
 */
export function detectNutrientsInRange(
  world: World,
  sensorPosition: { x: number; y: number },
  detectionRadius: number
): DetectedEntityData[] {
  const detected: DetectedEntityData[] = [];

  world.forEachWithTag(Tags.Nutrient, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (!pos) return;

    const dist = distance(sensorPosition, pos);
    if (dist <= detectionRadius) {
      const stringId = getStringIdByEntity(entity);

      if (stringId) {
        detected.push({
          entity,
          position: { x: pos.x, y: pos.y },
          entityType: 'nutrient',
          stringId,
        });
      }
    }
  });

  return detected;
}

/**
 * Find all swarms within detection range.
 */
export function detectSwarmsInRange(
  world: World,
  sensorPosition: { x: number; y: number },
  detectionRadius: number
): DetectedEntityData[] {
  const detected: DetectedEntityData[] = [];

  world.forEachWithTag(Tags.Swarm, (entity) => {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    if (!pos) return;

    const dist = distance(sensorPosition, pos);
    if (dist <= detectionRadius) {
      const stringId = getStringIdByEntity(entity);

      if (stringId) {
        detected.push({
          entity,
          position: { x: pos.x, y: pos.y },
          entityType: 'swarm',
          stringId,
        });
      }
    }
  });

  return detected;
}

/**
 * Build a DetectionUpdateMessage for a player entity.
 * Returns null if the player doesn't have detection capability (single-cell).
 */
export function buildDetectionUpdateMessage(
  world: World,
  playerEntity: EntityId,
  detectionRadius: number
): { socketId: string; message: DetectionUpdateMessage } | null {
  // Check player is alive
  const energy = world.getComponent<EnergyComponent>(playerEntity, Components.Energy);
  if (!energy || energy.current <= 0) return null;

  // Get player stage - only multi-cells and above can detect
  const stageComp = world.getComponent<StageComponent>(playerEntity, Components.Stage);
  if (!stageComp || stageComp.stage === EvolutionStage.SINGLE_CELL) return null;

  // Get player position
  const pos = world.getComponent<PositionComponent>(playerEntity, Components.Position);
  if (!pos) return null;

  // Get socket ID for sending
  const socketId = getSocketIdByEntity(playerEntity);
  if (!socketId) return null;

  // Detect all nearby entities
  const detectedPlayers = detectPlayersInRange(world, playerEntity, pos, detectionRadius);
  const detectedNutrients = detectNutrientsInRange(world, pos, detectionRadius);
  const detectedSwarms = detectSwarmsInRange(world, pos, detectionRadius);

  // Convert to network format
  const detected: DetectedEntity[] = [
    ...detectedPlayers.map((d) => ({
      id: d.stringId,
      position: d.position,
      entityType: d.entityType,
      stage: d.stage,
    })),
    ...detectedNutrients.map((d) => ({
      id: d.stringId,
      position: d.position,
      entityType: d.entityType as 'nutrient',
    })),
    ...detectedSwarms.map((d) => ({
      id: d.stringId,
      position: d.position,
      entityType: d.entityType as 'swarm',
    })),
  ];

  return {
    socketId,
    message: {
      type: 'detectionUpdate',
      detected,
    },
  };
}
