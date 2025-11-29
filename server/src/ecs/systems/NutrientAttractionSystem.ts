// ============================================
// Nutrient Attraction System
// Attracts nutrients toward gravity wells (visual effect)
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type { NutrientMovedMessage, NutrientCollectedMessage } from '@godcell/shared';
import { GAME_CONFIG } from '@godcell/shared';
import { forEachObstacle, getEntityByStringId, destroyEntity as ecsDestroyEntity } from '../index';
import { distance } from '../../helpers';

/**
 * NutrientAttractionSystem - Attracts nutrients to obstacles
 *
 * Handles:
 * - Pulling nutrients toward gravity wells (visual effect)
 * - Destroying nutrients that reach the center
 * - Scheduling respawn for destroyed nutrients
 *
 * TODO Phase 5: Replace nutrients Map iteration with ECS iteration
 */
export class NutrientAttractionSystem implements System {
  readonly name = 'NutrientAttractionSystem';

  update(ctx: GameContext): void {
    const { world, io, deltaTime, nutrients, respawnNutrient } = ctx;

    for (const [nutrientId, nutrient] of nutrients) {
      forEachObstacle(world, (_entity, obstaclePos, obstacle) => {
        const dist = distance(nutrient.position, obstaclePos);

        if (dist < obstacle.radius) {
          // Apply same inverse-square gravity as players
          const distSq = Math.max(dist * dist, 100);
          const forceMagnitude = obstacle.strength / distSq;

          const dx = obstaclePos.x - nutrient.position.x;
          const dy = obstaclePos.y - nutrient.position.y;
          const dirLength = Math.sqrt(dx * dx + dy * dy);

          if (dirLength > 0) {
            const dirX = dx / dirLength;
            const dirY = dy / dirLength;

            // Move nutrient toward obstacle
            nutrient.position.x += dirX * forceMagnitude * GAME_CONFIG.OBSTACLE_NUTRIENT_ATTRACTION_SPEED * deltaTime;
            nutrient.position.y += dirY * forceMagnitude * GAME_CONFIG.OBSTACLE_NUTRIENT_ATTRACTION_SPEED * deltaTime;

            // Broadcast nutrient movement
            const moveMessage: NutrientMovedMessage = {
              type: 'nutrientMoved',
              nutrientId,
              position: nutrient.position,
            };
            io.emit('nutrientMoved', moveMessage);
          }

          // Check if nutrient reached center (destroyed by distortion)
          if (dist < 20) {
            nutrients.delete(nutrientId);
            // Remove from ECS (dual-write during migration)
            const nutrientEntity = getEntityByStringId(nutrientId);
            if (nutrientEntity !== undefined) {
              ecsDestroyEntity(world, nutrientEntity);
            }

            // Broadcast as "collected" by obstacle (special playerId)
            const collectMessage: NutrientCollectedMessage = {
              type: 'nutrientCollected',
              nutrientId,
              playerId: 'obstacle',
              collectorEnergy: 0,
              collectorMaxEnergy: 0,
            };
            io.emit('nutrientCollected', collectMessage);

            // Schedule respawn
            respawnNutrient(nutrientId);
          }
        }
      });
    }
  }
}
