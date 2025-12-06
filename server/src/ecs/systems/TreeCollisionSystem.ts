// ============================================
// Tree Collision System
// Handles Stage 3+ player collisions with trees (hard blocking)
// ============================================

import type { Server } from 'socket.io';
import { Tags, Components, type World } from '@shared';
import type {
  EnergyComponent,
  PositionComponent,
  StageComponent,
  TreeComponent,
} from '@shared';
import type { System } from './types';
import { getSocketIdByEntity, forEachTree } from '../factories';
import { distance, isJungleStage } from '../../helpers';

/**
 * TreeCollisionSystem - Handles tree collisions for Stage 3+ players
 *
 * Trees are hard obstacles in the digital jungle environment.
 * Stage 1-2 players (soup scale) cannot see or collide with trees.
 * Stage 3+ players (jungle scale) are blocked by trees.
 *
 * Collision response:
 * - Hard blocking: player is pushed out of tree collision radius
 * - No damage: trees are obstacles, not hazards
 * - Push-back maintains momentum direction (just stopped at boundary)
 */
export class TreeCollisionSystem implements System {
  readonly name = 'TreeCollisionSystem';

  update(world: World, _deltaTime: number, _io: Server): void {
    // Iterate over all player entities
    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;

      // Get ECS components
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !posComp || !stageComp) return;

      // Skip dead/evolving players
      if (energyComp.current <= 0 || stageComp.isEvolving) return;

      // Only Stage 3+ players collide with trees (jungle scale)
      if (!isJungleStage(stageComp.stage)) return;

      // Get player collision radius based on stage
      const playerRadius = stageComp.radius;
      const playerPos = { x: posComp.x, y: posComp.y };

      // Check collision with each tree
      forEachTree(world, (_treeEntity, _treeId, treePosComp, treeComp) => {
        const treePos = { x: treePosComp.x, y: treePosComp.y };
        const dist = distance(playerPos, treePos);

        // Combined collision radius (player + tree trunk)
        const collisionDist = playerRadius + treeComp.radius;

        if (dist < collisionDist) {
          // Collision detected - push player out of tree
          // Calculate push-back direction (from tree center to player)
          const overlap = collisionDist - dist;

          if (dist > 0.001) {
            // Normal case: push player away from tree center
            const pushDirX = (playerPos.x - treePos.x) / dist;
            const pushDirY = (playerPos.y - treePos.y) / dist;

            // Apply push-back (move player to edge of collision zone)
            posComp.x += pushDirX * overlap;
            posComp.y += pushDirY * overlap;
          } else {
            // Edge case: player exactly at tree center, push in arbitrary direction
            posComp.x += overlap;
          }
        }
      });
    });
  }
}
