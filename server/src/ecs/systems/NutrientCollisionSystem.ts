// ============================================
// Nutrient Collision System
// Handles nutrient collection by players
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type { NutrientCollectedMessage } from '@godcell/shared';
import { GAME_CONFIG } from '@godcell/shared';
import {
  Components,
  forEachPlayer,
  getEnergyBySocketId,
  getEntityByStringId,
  destroyEntity as ecsDestroyEntity,
  type PositionComponent,
  type StageComponent,
  type EnergyComponent,
} from '../index';
import { distance, getPlayerRadius, isJungleStage } from '../../helpers';
import { recordNutrientCollection } from '../../logger';

/**
 * NutrientCollisionSystem - Handles nutrient pickup
 *
 * Handles:
 * - Detecting player-nutrient collisions
 * - Awarding energy and capacity increases
 * - Removing collected nutrients and scheduling respawn
 */
export class NutrientCollisionSystem implements System {
  readonly name = 'NutrientCollisionSystem';

  update(ctx: GameContext): void {
    const { world, io, nutrients, respawnNutrient } = ctx;

    forEachPlayer(world, (entity, playerId) => {
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      if (!posComp || !stageComp || !energyComp) return;

      // Skip dead players (waiting for manual respawn)
      if (energyComp.current <= 0) return;

      // Skip if player is evolving (invulnerable during molting)
      if (stageComp.isEvolving) return;

      // Stage 3+ players don't interact with soup nutrients (they've transcended)
      if (isJungleStage(stageComp.stage)) return;

      const playerPos = { x: posComp.x, y: posComp.y };
      const playerRadius = getPlayerRadius(stageComp.stage);

      for (const [nutrientId, nutrient] of nutrients) {
        const dist = distance(playerPos, nutrient.position);
        const collisionRadius = playerRadius + GAME_CONFIG.NUTRIENT_SIZE;

        if (dist < collisionRadius) {
          // Collect nutrient - gain energy (capped at maxEnergy) + capacity increase
          // Both scale with proximity gradient (high-risk nutrients = faster evolution!)

          // Safety clamp to prevent negative energy gain if energy somehow drifts above maxEnergy
          const energyGain = Math.min(
            nutrient.value,
            Math.max(0, energyComp.max - energyComp.current)
          );

          // Update ECS components directly (persists changes)
          energyComp.max += nutrient.capacityIncrease; // Scales with risk (10/20/30/50)
          energyComp.current = Math.min(energyComp.current + energyGain, energyComp.max);

          // Track nutrient collection for telemetry
          recordNutrientCollection(playerId, energyGain);

          // Remove nutrient from world
          nutrients.delete(nutrientId);
          // Remove from ECS
          const nutrientEntity = getEntityByStringId(nutrientId);
          if (nutrientEntity !== undefined) {
            ecsDestroyEntity(world, nutrientEntity);
          }

          // Broadcast collection event to all clients (use ECS values)
          const collectMessage: NutrientCollectedMessage = {
            type: 'nutrientCollected',
            nutrientId,
            playerId,
            collectorEnergy: energyComp.current,
            collectorMaxEnergy: energyComp.max,
          };
          io.emit('nutrientCollected', collectMessage);

          // Schedule respawn after delay
          respawnNutrient(nutrientId);

          // Only collect one nutrient per tick per player
          return; // Using return instead of break since we're in a callback
        }
      }
    });
  }
}
