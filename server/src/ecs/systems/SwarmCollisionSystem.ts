// ============================================
// Swarm Collision System
// Handles swarm-player collisions (damage, slow effects)
// ============================================

import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { SwarmConsumedMessage } from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { logger } from '../../logger';

/**
 * SwarmCollisionSystem - Handles swarm-player interactions
 *
 * This system handles:
 * 1. Swarm collisions (damage + slow effect)
 * 2. Swarm consumption (multi-cells eating disabled swarms)
 *
 * Stores damaged/slowed player sets in ctx.tickData for MovementSystem.
 */
export class SwarmCollisionSystem implements System {
  readonly name = 'SwarmCollisionSystem';

  update(ctx: GameContext): void {
    const {
      players,
      getSwarms,
      deltaTime,
      io,
      recordDamage,
      applyDamageWithResistance,
      checkSwarmCollisions,
      playerLastDamageSource,
      activeSwarmDrains,
      getPlayerRadius,
      distance,
      removeSwarm,
      tickData,
    } = ctx;

    // Check for swarm collisions (damage + slow)
    const { damagedPlayerIds, slowedPlayerIds } = checkSwarmCollisions(
      players,
      deltaTime,
      recordDamage,
      applyDamageWithResistance
    );

    // Store in tickData for access by MovementSystem
    tickData.damagedPlayerIds = damagedPlayerIds;
    tickData.slowedPlayerIds = slowedPlayerIds;

    // Track damage source
    for (const playerId of damagedPlayerIds) {
      playerLastDamageSource.set(playerId, 'swarm');
    }

    // Handle swarm consumption (multi-cells eating disabled swarms)
    const currentSwarmDrains = new Set<string>();

    for (const [playerId, player] of players) {
      // Only Stage 2 (MULTI_CELL) can consume swarms
      if (player.stage !== EvolutionStage.MULTI_CELL) continue;
      if (player.energy <= 0) continue;

      for (const [swarmId, swarm] of getSwarms()) {
        // Only consume disabled swarms with health remaining
        if (!swarm.disabledUntil || Date.now() >= swarm.disabledUntil) continue;
        if (!swarm.energy || swarm.energy <= 0) continue;

        // Check if multi-cell is touching the swarm
        const dist = distance(player.position, swarm.position);
        const collisionDist = swarm.size + getPlayerRadius(player.stage);

        if (dist < collisionDist) {
          currentSwarmDrains.add(swarmId);

          // Gradual consumption
          const damageDealt = GAME_CONFIG.SWARM_CONSUMPTION_RATE * deltaTime;
          swarm.energy -= damageDealt;

          if (swarm.energy <= 0) {
            // Swarm fully consumed - grant rewards
            player.energy = Math.min(player.maxEnergy, player.energy + GAME_CONFIG.SWARM_ENERGY_GAIN);
            player.maxEnergy += GAME_CONFIG.SWARM_MAX_ENERGY_GAIN;

            io.emit('swarmConsumed', {
              type: 'swarmConsumed',
              swarmId,
              consumerId: playerId,
            } as SwarmConsumedMessage);

            logger.info({
              event: 'swarm_consumed',
              consumerId: playerId,
              swarmId,
              energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
              maxEnergyGained: GAME_CONFIG.SWARM_MAX_ENERGY_GAIN,
            });

            removeSwarm(swarmId);
          }
        }
      }
    }

    // Update active swarm drains tracking
    activeSwarmDrains.clear();
    currentSwarmDrains.forEach(id => activeSwarmDrains.add(id));
  }
}
