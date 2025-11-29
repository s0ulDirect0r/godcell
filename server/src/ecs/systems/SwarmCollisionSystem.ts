// ============================================
// Swarm Collision System
// Handles swarm-player collisions (damage, slow effects)
// ============================================

import { GAME_CONFIG, EvolutionStage, Tags, Components } from '@godcell/shared';
import type { SwarmConsumedMessage, EnergyComponent, PositionComponent, StageComponent } from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { logger } from '../../logger';
import { getSocketIdByEntity } from '../factories';

/**
 * SwarmCollisionSystem - Handles swarm-player interactions
 *
 * Uses ECS components directly for all reads and writes.
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
      world,
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
    // Note: checkSwarmCollisions still uses the players cache for collision detection
    // but damage is applied directly to ECS via applyDamageWithResistance
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
    // Use ECS directly for player data
    const currentSwarmDrains = new Set<string>();

    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;

      // Get ECS components directly
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !posComp || !stageComp) return;

      // Only Stage 2 (MULTI_CELL) can consume swarms
      if (stageComp.stage !== EvolutionStage.MULTI_CELL) return;
      if (energyComp.current <= 0) return;

      for (const [swarmId, swarm] of getSwarms()) {
        // Only consume disabled swarms with health remaining
        if (!swarm.disabledUntil || Date.now() >= swarm.disabledUntil) continue;
        if (!swarm.energy || swarm.energy <= 0) continue;

        // Check if multi-cell is touching the swarm
        const dist = distance({ x: posComp.x, y: posComp.y }, swarm.position);
        const collisionDist = swarm.size + getPlayerRadius(stageComp.stage);

        if (dist < collisionDist) {
          currentSwarmDrains.add(swarmId);

          // Gradual consumption
          const damageDealt = GAME_CONFIG.SWARM_CONSUMPTION_RATE * deltaTime;
          swarm.energy -= damageDealt;

          if (swarm.energy <= 0) {
            // Swarm fully consumed - grant rewards via ECS components directly
            energyComp.current = Math.min(energyComp.max, energyComp.current + GAME_CONFIG.SWARM_ENERGY_GAIN);
            energyComp.max += GAME_CONFIG.SWARM_MAX_ENERGY_GAIN;

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
    });

    // Update active swarm drains tracking
    activeSwarmDrains.clear();
    currentSwarmDrains.forEach(id => activeSwarmDrains.add(id));
  }
}
