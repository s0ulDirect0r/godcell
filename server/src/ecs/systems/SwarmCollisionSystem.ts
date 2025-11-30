// ============================================
// Swarm Collision System
// Handles swarm-player collisions (damage, slow effects)
// ============================================

import { GAME_CONFIG, EvolutionStage, Tags, Components } from '@godcell/shared';
import type { SwarmConsumedMessage, EnergyComponent, PositionComponent, StageComponent } from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { logger } from '../../logger';
import {
  getSocketIdByEntity,
  getDamageTrackingBySocketId,
  forEachSwarm,
  getEntityBySocketId,
  forEachPlayer,
  recordDamage,
} from '../factories';
import { distance, getPlayerRadius, getDamageResistance, isSoupStage } from '../../helpers';
import { removeSwarm } from '../../swarms';
import { hasGodMode, getConfig } from '../../dev';

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

  update(ctx: GameContext): void {
    const { world, deltaTime, io } = ctx;

    // ============================================
    // Part 1: Swarm collision detection (damage + slow)
    // Inlined from swarms.ts checkSwarmCollisions
    // ============================================
    const damagedPlayerIds = new Set<string>();
    const slowedPlayerIds = new Set<string>();
    const now = Date.now();

    forEachSwarm(world, (_swarmEntity, _swarmId, swarmPos, _swarmVel, swarmComp) => {
      // Skip disabled swarms (hit by EMP)
      if (swarmComp.disabledUntil && now < swarmComp.disabledUntil) return;

      const swarmPosition = { x: swarmPos.x, y: swarmPos.y };

      forEachPlayer(world, (entity, playerId) => {
        const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
        const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
        const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
        if (!energyComp || !posComp || !stageComp) return;

        // Skip dead/evolving players
        if (energyComp.current <= 0 || stageComp.isEvolving) return;

        // Stage 3+ players don't interact with soup swarms (they've evolved past)
        if (!isSoupStage(stageComp.stage)) return;

        // God mode players are immune
        if (hasGodMode(playerId)) return;

        // Check collision (circle-circle)
        const playerPosition = { x: posComp.x, y: posComp.y };
        const dist = distance(swarmPosition, playerPosition);
        const collisionDist = swarmComp.size + GAME_CONFIG.PLAYER_SIZE;

        if (dist < collisionDist) {
          // Apply damage directly with resistance
          const baseDamage = getConfig('SWARM_DAMAGE_RATE') * deltaTime;
          const resistance = getDamageResistance(stageComp.stage);
          const actualDamage = baseDamage * (1 - resistance);
          energyComp.current -= actualDamage;

          damagedPlayerIds.add(playerId);

          // Record damage for drain aura system
          recordDamage(world, playerId, getConfig('SWARM_DAMAGE_RATE'), 'swarm');

          // Apply movement slow debuff
          slowedPlayerIds.add(playerId);
        }
      });
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
    // First, clear all beingConsumedBy flags (will be set again if still being consumed)
    forEachSwarm(world, (_entity, _swarmId, _posComp, _velComp, swarmComp) => {
      swarmComp.beingConsumedBy = undefined;
    });

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

      forEachSwarm(world, (_swarmEntity, swarmId, swarmPosComp, _velocityComp, swarmComp, swarmEnergyComp) => {
        // Only consume disabled swarms with health remaining
        if (!swarmComp.disabledUntil || Date.now() >= swarmComp.disabledUntil) return;
        if (swarmEnergyComp.current <= 0) return;

        // Check if multi-cell is touching the swarm
        const dist = distance({ x: posComp.x, y: posComp.y }, { x: swarmPosComp.x, y: swarmPosComp.y });
        const collisionDist = swarmComp.size + getPlayerRadius(stageComp.stage);

        if (dist < collisionDist) {
          // Mark swarm as being consumed via ECS component
          swarmComp.beingConsumedBy = playerId;

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
  }
}
