// ============================================
// Nutrient Attraction System
// Attracts nutrients toward gravity wells (visual effect)
// ============================================

import type { Server } from 'socket.io';
import type { NutrientMovedMessage, NutrientCollectedMessage } from '#shared';
import { GAME_CONFIG, Tags, Components, type World, type PositionComponent } from '#shared';
import type { System } from './types';
import { forEachObstacle, getStringIdByEntity, destroyEntity as ecsDestroyEntity } from '../index';
import { distance } from '../../helpers';
import { respawnNutrient } from '../../nutrients';

/**
 * NutrientAttractionSystem - Attracts nutrients to obstacles
 *
 * Handles:
 * - Pulling nutrients toward gravity wells (visual effect)
 * - Destroying nutrients that reach the center
 * - Scheduling respawn for destroyed nutrients
 *
 * Uses ECS as source of truth for nutrients.
 */
export class NutrientAttractionSystem implements System {
  readonly name = 'NutrientAttractionSystem';

  update(world: World, deltaTime: number, io: Server): void {

    // Collect nutrients to destroy after iteration (can't modify during iteration)
    // Use Map to dedupe - nutrient may be near multiple obstacles
    const nutrientsToDestroy = new Map<number, string>(); // entity -> id

    // Iterate all nutrient entities
    world.forEachWithTag(Tags.Nutrient, (nutrientEntity) => {
      const nutrientPos = world.getComponent<PositionComponent>(nutrientEntity, Components.Position);
      const nutrientId = getStringIdByEntity(nutrientEntity);
      if (!nutrientPos || !nutrientId) return;

      forEachObstacle(world, (_entity, obstaclePos, obstacle) => {
        const dist = distance({ x: nutrientPos.x, y: nutrientPos.y }, obstaclePos);

        if (dist < obstacle.radius) {
          // Apply same inverse-square gravity as players
          const distSq = Math.max(dist * dist, 100);
          const forceMagnitude = obstacle.strength / distSq;

          const dx = obstaclePos.x - nutrientPos.x;
          const dy = obstaclePos.y - nutrientPos.y;
          const dirLength = Math.sqrt(dx * dx + dy * dy);

          if (dirLength > 0) {
            const dirX = dx / dirLength;
            const dirY = dy / dirLength;

            // Move nutrient toward obstacle (mutate ECS position directly)
            nutrientPos.x += dirX * forceMagnitude * GAME_CONFIG.OBSTACLE_NUTRIENT_ATTRACTION_SPEED * deltaTime;
            nutrientPos.y += dirY * forceMagnitude * GAME_CONFIG.OBSTACLE_NUTRIENT_ATTRACTION_SPEED * deltaTime;

            // Broadcast nutrient movement
            const moveMessage: NutrientMovedMessage = {
              type: 'nutrientMoved',
              nutrientId,
              position: { x: nutrientPos.x, y: nutrientPos.y },
            };
            io.emit('nutrientMoved', moveMessage);
          }

          // Check if nutrient reached center (destroyed by distortion)
          if (dist < 20) {
            nutrientsToDestroy.set(nutrientEntity, nutrientId);
          }
        }
      });
    });

    // Destroy nutrients that reached obstacle centers
    for (const [entity, id] of nutrientsToDestroy) {
      ecsDestroyEntity(world, entity);

      // Broadcast as "collected" by obstacle (special playerId)
      const collectMessage: NutrientCollectedMessage = {
        type: 'nutrientCollected',
        nutrientId: id,
        playerId: 'obstacle',
        collectorEnergy: 0,
        collectorMaxEnergy: 0,
      };
      io.emit('nutrientCollected', collectMessage);

      // Schedule respawn
      respawnNutrient(id);
    }
  }
}
