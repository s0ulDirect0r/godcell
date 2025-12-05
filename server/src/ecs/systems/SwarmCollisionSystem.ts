// ============================================
// Swarm Collision System
// Handles swarm-player collisions (damage, slow effects)
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Tags, Components, type World } from '@godcell/shared';
import type { SwarmConsumedMessage, EnergyComponent, PositionComponent, StageComponent } from '@godcell/shared';
import type { System } from './types';
import { logger } from '../../logger';
import {
  getSocketIdByEntity,
  getDamageTrackingBySocketId,
  forEachSwarm,
  getEntityBySocketId,
  forEachPlayer,
  recordDamage,
} from '../factories';
import { distance, isSoupStage } from '../../helpers';
import { removeSwarm } from '../../swarms';
import { getConfig } from '../../dev';

/**
 * SwarmCollisionSystem - Handles swarm-player interactions
 *
 * Uses ECS components directly for all reads and writes.
 *
 * This system handles:
 * 1. Swarm collisions (damage + slow effect)
 * 2. Swarm consumption (multi-cells eating disabled swarms)
 *
 * Uses ECS tags (SlowedThisTick, DamagedThisTick) for cross-system communication.
 */
export class SwarmCollisionSystem implements System {
  readonly name = 'SwarmCollisionSystem';

  update(world: World, deltaTime: number, io: Server): void {

    // ============================================
    // Part 1: Swarm collision detection (damage + slow)
    // Optimized: Pre-filter players by stage to avoid O(S×P) on all players
    // ============================================
    const damagedPlayerIds = new Set<string>();
    const slowedPlayerIds = new Set<string>();
    const now = Date.now();

    // Pre-collect soup-stage players (stages 1-2) - these are the only ones that interact with swarms
    // This avoids checking stage inside the nested loop
    const soupPlayers: { entity: number; playerId: string; energyComp: EnergyComponent; posComp: PositionComponent; radius: number }[] = [];
    forEachPlayer(world, (entity, playerId) => {
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !posComp || !stageComp) return;
      if (energyComp.current <= 0 || stageComp.isEvolving) return;
      if (!isSoupStage(stageComp.stage)) return;
      soupPlayers.push({ entity, playerId, energyComp, posComp, radius: stageComp.radius });
    });

    // Now check swarms only against soup players
    forEachSwarm(world, (_swarmEntity, _swarmId, swarmPos, _swarmVel, swarmComp) => {
      // Skip disabled swarms (hit by EMP)
      if (swarmComp.disabledUntil && now < swarmComp.disabledUntil) return;

      const swarmX = swarmPos.x;
      const swarmY = swarmPos.y;

      for (const { playerId, energyComp, posComp, radius } of soupPlayers) {
        // Collision distance = swarm size + player radius (varies by stage)
        const collisionDist = swarmComp.size + radius;
        const collisionDistSq = collisionDist * collisionDist;

        // Fast squared distance check (avoid sqrt)
        const dx = swarmX - posComp.x;
        const dy = swarmY - posComp.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionDistSq) {
          // Apply damage directly (energy pools provide stage durability)
          const damage = getConfig('SWARM_DAMAGE_RATE') * deltaTime;
          energyComp.current -= damage;

          damagedPlayerIds.add(playerId);

          // Record damage for drain aura system
          recordDamage(world, playerId, getConfig('SWARM_DAMAGE_RATE'), 'swarm');

          // Apply movement slow debuff
          slowedPlayerIds.add(playerId);
        }
      }
    });

    // ============================================
    // Part 2: Add ECS tags for cross-system communication
    // MovementSystem reads SlowedThisTick to apply speed reduction
    // ============================================
    for (const playerId of slowedPlayerIds) {
      const entity = getEntityBySocketId(playerId);
      if (entity !== undefined) {
        world.addTag(entity, Tags.SlowedThisTick);
      }
    }

    for (const playerId of damagedPlayerIds) {
      const entity = getEntityBySocketId(playerId);
      if (entity !== undefined) {
        world.addTag(entity, Tags.DamagedThisTick);
      }
      // Track damage source in ECS
      const damageTracking = getDamageTrackingBySocketId(world, playerId);
      if (damageTracking) {
        damageTracking.lastDamageSource = 'swarm';
      }
    }

    // Handle swarm consumption (multi-cells eating disabled swarms)
    // Optimized: Pre-filter to only multi-cell players and disabled swarms

    // Pre-collect disabled swarms (usually very few - only those hit by EMP)
    const disabledSwarms: { swarmId: string; x: number; y: number; size: number; swarmComp: any; energyComp: EnergyComponent }[] = [];
    forEachSwarm(world, (_entity, swarmId, posComp, _velComp, swarmComp, energyComp) => {
      // Clear consumption flag
      swarmComp.beingConsumedBy = undefined;
      // Only collect disabled swarms with health remaining
      if (swarmComp.disabledUntil && now < swarmComp.disabledUntil && energyComp.current > 0) {
        disabledSwarms.push({ swarmId, x: posComp.x, y: posComp.y, size: swarmComp.size, swarmComp, energyComp });
      }
    });

    // Early exit if no disabled swarms (common case - saves the player loop entirely)
    if (disabledSwarms.length === 0) return;

    // Pre-collect multi-cell players (usually only 1-2)
    const multiCellPlayers: { playerId: string; x: number; y: number; radius: number; energyComp: EnergyComponent }[] = [];
    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !posComp || !stageComp) return;
      if (stageComp.stage !== EvolutionStage.MULTI_CELL) return;
      if (energyComp.current <= 0) return;
      multiCellPlayers.push({
        playerId,
        x: posComp.x,
        y: posComp.y,
        radius: stageComp.radius,
        energyComp,
      });
    });

    // Check collisions between multi-cell players and disabled swarms
    const swarmsToRemove: string[] = [];

    for (const player of multiCellPlayers) {
      for (const swarm of disabledSwarms) {
        // Fast squared distance check
        const dx = player.x - swarm.x;
        const dy = player.y - swarm.y;
        const distSq = dx * dx + dy * dy;
        const collisionDist = swarm.size + player.radius;
        const collisionDistSq = collisionDist * collisionDist;

        if (distSq < collisionDistSq) {
          // Mark swarm as being consumed
          swarm.swarmComp.beingConsumedBy = player.playerId;

          // Gradual consumption
          const damageDealt = GAME_CONFIG.SWARM_CONSUMPTION_RATE * deltaTime;
          swarm.energyComp.current -= damageDealt;

          if (swarm.energyComp.current <= 0) {
            // Swarm fully consumed - grant rewards
            player.energyComp.current = Math.min(player.energyComp.max, player.energyComp.current + GAME_CONFIG.SWARM_ENERGY_GAIN);
            player.energyComp.max += GAME_CONFIG.SWARM_MAX_ENERGY_GAIN;

            io.emit('swarmConsumed', {
              type: 'swarmConsumed',
              swarmId: swarm.swarmId,
              consumerId: player.playerId,
            } as SwarmConsumedMessage);

            logger.info({
              event: 'swarm_consumed',
              consumerId: player.playerId,
              swarmId: swarm.swarmId,
              energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
              maxEnergyGained: GAME_CONFIG.SWARM_MAX_ENERGY_GAIN,
            });

            swarmsToRemove.push(swarm.swarmId);
          }
        }
      }
    }

    // Remove consumed swarms after iteration
    for (const swarmId of swarmsToRemove) {
      removeSwarm(world, swarmId);
    }
  }
}
