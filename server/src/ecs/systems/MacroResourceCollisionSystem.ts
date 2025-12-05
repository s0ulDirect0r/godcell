// ============================================
// Macro Resource Collision System
// Handles Stage 3+ resource collection: DataFruit pickup
// Mirrors NutrientCollisionSystem pattern for jungle-scale resources
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Components, type World } from '@godcell/shared';
import type {
  PositionComponent,
  StageComponent,
  EnergyComponent,
} from '@godcell/shared';
import type { System } from './types';
import {
  forEachPlayer,
  forEachDataFruit,
  destroyEntity,
} from '../factories';
import { logger } from '../../logger';
import { distance, isJungleStage } from '../../helpers';

/**
 * MacroResourceCollisionSystem - Handles DataFruit collection
 *
 * Simple first-touch-wins pattern (matches NutrientCollisionSystem):
 * 1. Detect player-fruit collision using player radius + fruit size
 * 2. Award energy and capacity increase
 * 3. Destroy collected fruit
 */
export class MacroResourceCollisionSystem implements System {
  readonly name = 'MacroResourceCollisionSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    // Track collected fruits this tick (first touch wins)
    const collectedThisTick = new Set<string>();

    forEachPlayer(world, (playerEntity, playerId) => {
      const playerPos = world.getComponent<PositionComponent>(playerEntity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(playerEntity, Components.Stage);
      const energyComp = world.getComponent<EnergyComponent>(playerEntity, Components.Energy);

      if (!playerPos || !stageComp || !energyComp) return;

      // Skip dead, evolving, or soup-stage players
      if (energyComp.current <= 0 || stageComp.isEvolving) return;
      if (!isJungleStage(stageComp.stage)) return;

      const playerPosition = { x: playerPos.x, y: playerPos.y };
      const playerRadius = stageComp.radius;
      const collisionRadius = playerRadius + GAME_CONFIG.DATAFRUIT_COLLISION_RADIUS;

      forEachDataFruit(world, (fruitEntity, fruitId, fruitPos, fruitComp) => {
        // Skip if already collected this tick
        if (collectedThisTick.has(fruitId)) return;

        const fruitPosition = { x: fruitPos.x, y: fruitPos.y };
        const dist = distance(playerPosition, fruitPosition);

        if (dist < collisionRadius) {
          // Award energy (capped at max) and capacity increase
          const energyGain = Math.min(
            fruitComp.value,
            Math.max(0, energyComp.max - energyComp.current)
          );
          energyComp.current = Math.min(energyComp.current + energyGain, energyComp.max);
          energyComp.max += fruitComp.capacityIncrease;

          // Mark as collected
          collectedThisTick.add(fruitId);

          // Emit collection event
          io.emit('dataFruitCollected', {
            type: 'dataFruitCollected',
            fruitId,
            playerId,
            energyGained: energyGain,
            capacityGained: fruitComp.capacityIncrease,
          });

          logger.info({
            event: 'player_fruit_collected',
            fruitId,
            playerId,
            energyGained: energyGain,
            capacityGained: fruitComp.capacityIncrease,
          });

          // Destroy the fruit
          destroyEntity(world, fruitEntity);
        }
      });
    });
  }
}
