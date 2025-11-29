// ============================================
// Swarm Collision System
// Handles swarm-player collisions (damage, slow effects)
// ============================================

import { GAME_CONFIG, EvolutionStage, Tags, Components } from '@godcell/shared';
import type { SwarmConsumedMessage, EnergyComponent, PositionComponent, StageComponent } from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { logger } from '../../logger';
import { getSocketIdByEntity, getDamageTrackingBySocketId, forEachSwarm } from '../factories';

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
      deltaTime,
      io,
      recordDamage,
      checkSwarmCollisions,
      activeSwarmDrains,
      getPlayerRadius,
      distance,
      removeSwarm,
      tickData,
    } = ctx;

    // Check for swarm collisions (damage + slow)
    // Now uses ECS iteration directly and applies damage with resistance inline
    const { damagedPlayerIds, slowedPlayerIds } = checkSwarmCollisions(
      world,
      deltaTime,
      recordDamage
    );

    // Store in tickData for access by MovementSystem
    tickData.damagedPlayerIds = damagedPlayerIds;
    tickData.slowedPlayerIds = slowedPlayerIds;

    // Track damage source in ECS
    for (const playerId of damagedPlayerIds) {
      const damageTracking = getDamageTrackingBySocketId(world, playerId);
      if (damageTracking) {
        damageTracking.lastDamageSource = 'swarm';
      }
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

      // Track swarms to remove (can't modify during iteration)
      const swarmsToRemove: string[] = [];

      forEachSwarm(world, (swarmEntity, swarmId, swarmPosComp, _velocityComp, swarmComp, swarmEnergyComp) => {
        // Only consume disabled swarms with health remaining
        if (!swarmComp.disabledUntil || Date.now() >= swarmComp.disabledUntil) return;
        if (swarmEnergyComp.current <= 0) return;

        // Check if multi-cell is touching the swarm
        const dist = distance({ x: posComp.x, y: posComp.y }, { x: swarmPosComp.x, y: swarmPosComp.y });
        const collisionDist = swarmComp.size + getPlayerRadius(stageComp.stage);

        if (dist < collisionDist) {
          currentSwarmDrains.add(swarmId);

          // Gradual consumption - mutate ECS component directly
          const damageDealt = GAME_CONFIG.SWARM_CONSUMPTION_RATE * deltaTime;
          swarmEnergyComp.current -= damageDealt;

          if (swarmEnergyComp.current <= 0) {
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

            swarmsToRemove.push(swarmId);
          }
        }
      });

      // Remove consumed swarms after iteration
      for (const swarmId of swarmsToRemove) {
        removeSwarm(world, swarmId);
      }
    });

    // Update active swarm drains tracking
    activeSwarmDrains.clear();
    currentSwarmDrains.forEach(id => activeSwarmDrains.add(id));
  }
}
