// ============================================
// DataFruit System
// Handles Stage 3 DataFruit lifecycle: ripening, falling, despawning
// Fruits grow on trees and can be collected by players
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Tags, Components, type World } from '@godcell/shared';
import type {
  PositionComponent,
  DataFruitComponent,
  TreeComponent,
  EntityId,
} from '@godcell/shared';
import type { System } from './types';
import { forEachDataFruit, forEachTree, destroyEntity, getStringIdByEntity } from '../factories';
import { logger } from '../../logger';

/**
 * DataFruitSystem - Manages fruit ripening and despawning
 *
 * Lifecycle:
 * 1. Fruit spawns attached to tree (treeEntityId set, fallenAt undefined)
 * 2. Ripeness increases over time (0 → 1)
 * 3. When fully ripe, fruit falls (fallenAt set to timestamp)
 * 4. Fallen fruits despawn after timeout
 *
 * Note: Fruit spawning is handled by DataFruitSpawner (Phase 4)
 * Note: Fruit collection is handled by MacroResourceCollisionSystem
 */
export class DataFruitSystem implements System {
  readonly name = 'DataFruitSystem';

  update(world: World, deltaTime: number, io: Server): void {
    const now = Date.now();
    const toRemove: EntityId[] = [];

    forEachDataFruit(world, (entity, fruitId, posComp, fruitComp) => {
      // Increase ripeness over time (attached fruits only)
      if (fruitComp.treeEntityId !== 0 && fruitComp.fallenAt === undefined) {
        // DATAFRUIT_RIPENESS_TIME is in ms, convert to seconds for ripening rate
        const ripenRate = 1 / (GAME_CONFIG.DATAFRUIT_RIPENESS_TIME / 1000);
        fruitComp.ripeness += ripenRate * deltaTime;

        // Check if fully ripe → fall
        if (fruitComp.ripeness >= 1) {
          fruitComp.ripeness = 1;
          this.dropFruit(world, io, entity, fruitId, posComp, fruitComp);
        }
      }

      // Check for despawn (fallen fruits only)
      if (fruitComp.fallenAt !== undefined) {
        const timeSinceFallen = now - fruitComp.fallenAt; // Already in ms
        if (timeSinceFallen >= GAME_CONFIG.DATAFRUIT_GROUND_LIFETIME) {
          toRemove.push(entity);

          // Emit despawn event
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

  /**
   * Drop fruit from tree to ground
   */
  private dropFruit(
    world: World,
    io: Server,
    entity: EntityId,
    fruitId: string,
    posComp: PositionComponent,
    fruitComp: DataFruitComponent
  ): void {
    // Get parent tree position for ground placement
    const treeEntity = fruitComp.treeEntityId;
    const treePosComp = world.getComponent<PositionComponent>(treeEntity, Components.Position);
    const treeComp = world.getComponent<TreeComponent>(treeEntity, Components.Tree);

    if (treePosComp && treeComp) {
      // Drop to base of tree with random offset
      const offsetAngle = Math.random() * Math.PI * 2;
      const offsetDist = Math.random() * treeComp.radius * 1.5;

      posComp.x = treePosComp.x + Math.cos(offsetAngle) * offsetDist;
      posComp.y = treePosComp.y + Math.sin(offsetAngle) * offsetDist;
    }

    // Mark as fallen
    fruitComp.fallenAt = Date.now();
    fruitComp.treeEntityId = 0; // Detach from tree

    // Emit fall event for client animation
    io.emit('dataFruitFell', {
      type: 'dataFruitFell',
      fruitId,
      position: { x: posComp.x, y: posComp.y },
    });

    logger.info({
      event: 'data_fruit_fall',
      fruitId,
      position: { x: posComp.x, y: posComp.y },
    });
  }
}
