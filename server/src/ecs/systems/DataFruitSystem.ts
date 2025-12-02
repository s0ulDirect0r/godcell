// ============================================
// DataFruit System
// Handles DataFruit despawning after timeout
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, type World } from '@godcell/shared';
import type { EntityId } from '@godcell/shared';
import type { System } from './types';
import { forEachDataFruit, destroyEntity } from '../factories';
import { logger } from '../../logger';

/**
 * DataFruitSystem - Despawns fruits after timeout
 *
 * Simple lifecycle:
 * 1. Fruit spawns on ground (fallenAt set at creation)
 * 2. After DATAFRUIT_GROUND_LIFETIME, fruit despawns
 *
 * Collection is handled by MacroResourceCollisionSystem.
 */
export class DataFruitSystem implements System {
  readonly name = 'DataFruitSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    const now = Date.now();
    const toRemove: EntityId[] = [];

    forEachDataFruit(world, (entity, fruitId, _posComp, fruitComp) => {
      // Despawn after timeout
      if (fruitComp.fallenAt !== undefined) {
        const age = now - fruitComp.fallenAt;
        if (age >= GAME_CONFIG.DATAFRUIT_GROUND_LIFETIME) {
          toRemove.push(entity);

          io.emit('dataFruitDespawned', {
            type: 'dataFruitDespawned',
            fruitId,
          });

          logger.info({
            event: 'data_fruit_despawn',
            fruitId,
            reason: 'timeout',
          });
        }
      }
    });

    // Remove despawned fruits
    for (const entity of toRemove) {
      destroyEntity(world, entity);
    }
  }
}
