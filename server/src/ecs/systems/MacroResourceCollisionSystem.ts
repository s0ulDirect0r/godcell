// ============================================
// Macro Resource Collision System
// Handles Stage 3 resource collection: DataFruit pickup
// Similar to NutrientCollisionSystem but for jungle-scale resources
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Tags, Components, type World } from '@godcell/shared';
import type {
  PositionComponent,
  DataFruitComponent,
  StageComponent,
  EnergyComponent,
  PlayerComponent,
  EntityId,
} from '@godcell/shared';
import type { System } from './types';
import {
  forEachPlayer,
  forEachDataFruit,
  destroyEntity,
  addEnergyBySocketId,
  getEnergyBySocketId,
  setMaxEnergyBySocketId,
  getStringIdByEntity,
} from '../factories';
import { logger } from '../../logger';
import { distance } from '../../helpers';

/**
 * Check if player is in jungle stage (Stage 3+)
 * Only jungle-stage players can collect macro-resources
 */
function isJungleStage(stage: EvolutionStage): boolean {
  return (
    stage === EvolutionStage.CYBER_ORGANISM ||
    stage === EvolutionStage.HUMANOID ||
    stage === EvolutionStage.GODCELL
  );
}

/**
 * Get collection radius based on player stage
 * Later stages have larger collection radii
 */
function getCollectionRadius(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.DATAFRUIT_COLLISION_RADIUS;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.DATAFRUIT_COLLISION_RADIUS * 1.5;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.DATAFRUIT_COLLISION_RADIUS * 2;
    default:
      return 0; // Soup-stage players can't collect
  }
}

/**
 * MacroResourceCollisionSystem - Handles DataFruit collection
 *
 * Detects when jungle-stage players overlap with DataFruits and:
 * 1. Awards energy and capacity increase
 * 2. Emits collection event for client effects
 * 3. Destroys the collected fruit
 */
export class MacroResourceCollisionSystem implements System {
  readonly name = 'MacroResourceCollisionSystem';

  update(world: World, deltaTime: number, io: Server): void {
    const fruitsToCollect: {
      entity: EntityId;
      fruitId: string;
      collectorSocketId: string;
      value: number;
      capacityIncrease: number;
      position: { x: number; y: number };
    }[] = [];

    // Check each player against each fruit
    forEachPlayer(world, (playerEntity, playerId) => {
      const playerPos = world.getComponent<PositionComponent>(playerEntity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(playerEntity, Components.Stage);
      const energyComp = world.getComponent<EnergyComponent>(playerEntity, Components.Energy);

      if (!playerPos || !stageComp || !energyComp) return;

      // Skip dead, evolving, or soup-stage players
      if (energyComp.current <= 0 || stageComp.isEvolving) return;
      if (!isJungleStage(stageComp.stage)) return;

      const collectionRadius = getCollectionRadius(stageComp.stage);
      const playerPosition = { x: playerPos.x, y: playerPos.y };

      forEachDataFruit(world, (fruitEntity, fruitId, fruitPos, fruitComp) => {
        // Only collect fallen/ripe fruits (fallenAt must be set OR ripeness >= 0.8)
        const canCollect = fruitComp.fallenAt !== undefined || fruitComp.ripeness >= 0.8;
        if (!canCollect) return;

        const fruitPosition = { x: fruitPos.x, y: fruitPos.y };
        const dist = distance(playerPosition, fruitPosition);

        if (dist < collectionRadius) {
          // Mark for collection (don't modify while iterating)
          fruitsToCollect.push({
            entity: fruitEntity,
            fruitId,
            collectorSocketId: playerId,
            value: fruitComp.value,
            capacityIncrease: fruitComp.capacityIncrease,
            position: fruitPosition,
          });
        }
      });
    });

    // Process collections
    for (const fruit of fruitsToCollect) {
      // Award energy and capacity
      addEnergyBySocketId(world, fruit.collectorSocketId, fruit.value);
      const collectorEnergy = getEnergyBySocketId(world, fruit.collectorSocketId);
      if (collectorEnergy) {
        setMaxEnergyBySocketId(
          world,
          fruit.collectorSocketId,
          collectorEnergy.max + fruit.capacityIncrease
        );
      }

      // Emit collection event
      io.emit('dataFruitCollected', {
        type: 'dataFruitCollected',
        fruitId: fruit.fruitId,
        collectorId: fruit.collectorSocketId,
        position: fruit.position,
        energyGained: fruit.value,
        capacityGained: fruit.capacityIncrease,
      });

      logger.info({
        event: 'data_fruit_collected',
        fruitId: fruit.fruitId,
        collector: fruit.collectorSocketId,
        energyGained: fruit.value,
        capacityGained: fruit.capacityIncrease,
      });

      // Destroy the fruit
      destroyEntity(world, fruit.entity);
    }
  }
}
