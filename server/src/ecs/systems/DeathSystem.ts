// ============================================
// Death System
// Handles player death checks and processing
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import {
  Components,
  forEachPlayer,
  getPlayerBySocketId,
  setEnergyBySocketId,
  type EnergyComponent,
} from '../index';

/**
 * DeathSystem - Checks for and processes player deaths
 *
 * Handles:
 * - Death detection (energy <= 0 with tracked damage source)
 * - Triggers death handling (rewards, broadcasts, bot respawn)
 * - Marks death as processed (sentinel value) to prevent reprocessing
 */
export class DeathSystem implements System {
  readonly name = 'DeathSystem';

  update(ctx: GameContext): void {
    const { world, playerLastDamageSource, handlePlayerDeath } = ctx;

    forEachPlayer(world, (entity, playerId) => {
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      if (!energyComp) return;

      // Only process if:
      // 1. Energy is at or below 0
      // 2. We have a damage source tracked (meaning this is a fresh death, not already processed)
      if (energyComp.current <= 0 && playerLastDamageSource.has(playerId)) {
        const cause = playerLastDamageSource.get(playerId)!;

        // Get Player object for death handler (legacy interface, will be removed)
        const player = getPlayerBySocketId(world, playerId);
        if (player) {
          handlePlayerDeath(player, cause);
        }

        // Mark as "death processed" - sentinel value prevents catch-all from re-triggering
        // Respawn will set energy back to positive value
        setEnergyBySocketId(world, playerId, -1);

        // Clear damage source to prevent reprocessing same death
        playerLastDamageSource.delete(playerId);
      }
    });
  }
}
