// ============================================
// Nutrient Collision System
// Handles nutrient collection by players
// ============================================

import type { Server } from 'socket.io';
import type { NutrientCollectedMessage } from '@godcell/shared';
import { GAME_CONFIG, type World } from '@godcell/shared';
import type { System } from './types';
import {
  Components,
  forEachPlayer,
  getAllNutrientSnapshots,
  destroyEntity as ecsDestroyEntity,
  type PositionComponent,
  type StageComponent,
  type EnergyComponent,
} from '../index';
import { distance, isJungleStage } from '../../helpers';
import { recordNutrientCollection } from '../../logger';
import { respawnNutrient } from '../../nutrients';

/**
 * NutrientCollisionSystem - Handles nutrient pickup
 *
 * Handles:
 * - Detecting player-nutrient collisions
 * - Awarding energy and capacity increases
 * - Removing collected nutrients and scheduling respawn
 *
 * Uses ECS as source of truth for nutrients.
 */
export class NutrientCollisionSystem implements System {
  readonly name = 'NutrientCollisionSystem';

  update(world: World, _deltaTime: number, io: Server): void {

    // Get nutrient snapshots once per tick (stable during iteration)
    const nutrientSnapshots = getAllNutrientSnapshots(world);
    // Track collected nutrients this tick to handle multiple players
    const collectedThisTick = new Set<string>();

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
      const playerRadius = stageComp.radius;

      for (const nutrient of nutrientSnapshots) {
        // Skip if already collected this tick
        if (collectedThisTick.has(nutrient.id)) continue;

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

          // Mark as collected and destroy ECS entity
          collectedThisTick.add(nutrient.id);
          ecsDestroyEntity(world, nutrient.entity);

          // Broadcast collection event to all clients (use ECS values)
          const collectMessage: NutrientCollectedMessage = {
            type: 'nutrientCollected',
            nutrientId: nutrient.id,
            playerId,
            collectorEnergy: energyComp.current,
            collectorMaxEnergy: energyComp.max,
          };
          io.emit('nutrientCollected', collectMessage);

          // Schedule respawn after delay
          respawnNutrient(nutrient.id);

          // Only collect one nutrient per tick per player
          return; // Using return instead of break since we're in a callback
        }
      }
    });
  }
}
