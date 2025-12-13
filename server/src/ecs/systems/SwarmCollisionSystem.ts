// ============================================
// Swarm Collision System
// Handles swarm-player collisions (damage, slow effects)
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Tags, Components, type World } from '#shared';
import type { EnergyComponent, PositionComponent, StageComponent, DamageTrackingComponent } from '#shared';
import type { System } from './types';
import {
  getSocketIdByEntity,
  getDamageTracking,
  forEachSwarm,
  getEntityBySocketId,
  forEachPlayer,
  recordDamage,
  requireEnergy,
  requirePosition,
  requireStage,
} from '../factories';
import { isSoupStage } from '../../helpers';
import { getConfig } from '../../dev';
import { logger } from '../../logger';

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
    const damagedEntities = new Set<number>();
    const slowedEntities = new Set<number>();
    const now = Date.now();

    // Pre-collect soup-stage players (stages 1-2) - these are the only ones that interact with swarms
    // This avoids checking stage inside the nested loop
    const soupPlayers: { entity: number; playerId: string; energyComp: EnergyComponent; posComp: PositionComponent; radius: number }[] = [];
    forEachPlayer(world, (entity, playerId) => {
      const energyComp = requireEnergy(world, entity);
      const posComp = requirePosition(world, entity);
      const stageComp = requireStage(world, entity);
      if (energyComp.current <= 0 || stageComp.isEvolving) return;
      if (!isSoupStage(stageComp.stage)) return;
      soupPlayers.push({ entity, playerId, energyComp, posComp, radius: stageComp.radius });
    });

    // Now check swarms only against soup players
    forEachSwarm(world, (_swarmEntity, _swarmId, swarmPos, _swarmVel, swarmComp, swarmEnergyComp) => {
      // Skip disabled swarms (hit by EMP)
      if (swarmComp.disabledUntil && now < swarmComp.disabledUntil) return;

      const swarmX = swarmPos.x;
      const swarmY = swarmPos.y;

      for (const { entity, playerId, energyComp, posComp, radius } of soupPlayers) {
        // Collision distance = swarm size + player radius (no energy-based scaling)
        const BASE_ENERGY = 100;
        const MAX_ENERGY = 500;
        const MAX_SCALE = 1.5;
        const energyRatio = Math.min((swarmEnergyComp.current - BASE_ENERGY) / (MAX_ENERGY - BASE_ENERGY), 1);
        const energyScale = 1 + energyRatio * (MAX_SCALE - 1); // Used for damage scaling only
        const collisionDist = swarmComp.size + radius;
        const collisionDistSq = collisionDist * collisionDist;

        // Fast squared distance check (avoid sqrt)
        const dx = swarmX - posComp.x;
        const dy = swarmY - posComp.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionDistSq) {
          // Damage scales with swarm energy: bigger swarms drain faster
          // Base 100 energy = 1x, 500 energy = 5x rate
          const baseDamage = getConfig('SWARM_DAMAGE_RATE');
          const damage = baseDamage * energyScale * deltaTime;
          energyComp.current -= damage;

          // Swarm absorbs drained energy (capped at 500)
          const MAX_SWARM_ENERGY = 500;
          swarmEnergyComp.current = Math.min(swarmEnergyComp.current + damage, MAX_SWARM_ENERGY);
          swarmEnergyComp.max = Math.max(swarmEnergyComp.max, swarmEnergyComp.current);  // Track peak for kill rewards

          damagedEntities.add(entity);

          // Record damage for drain aura system
          recordDamage(world, entity, getConfig('SWARM_DAMAGE_RATE'), 'swarm');

          // Apply movement slow debuff
          slowedEntities.add(entity);
        }
      }
    });

    // ============================================
    // Part 2: Add ECS tags for cross-system communication
    // MovementSystem reads SlowedThisTick to apply speed reduction
    // ============================================
    for (const entity of slowedEntities) {
      world.addTag(entity, Tags.SlowedThisTick);
    }

    for (const entity of damagedEntities) {
      world.addTag(entity, Tags.DamagedThisTick);
      // Track damage source in ECS
      const damageTracking = getDamageTracking(world, entity);
      if (damageTracking) {
        damageTracking.lastDamageSource = 'swarm';
      }
    }

    // Handle swarm consumption (multi-cells eating disabled swarms)
    // Optimized: Pre-filter to only multi-cell players and disabled swarms
    // DeathSystem handles swarm deaths centrally

    // Pre-collect disabled swarms (usually very few - only those hit by EMP)
    const disabledSwarms: { entity: number; swarmId: string; x: number; y: number; size: number; swarmComp: any; energyComp: EnergyComponent }[] = [];
    forEachSwarm(world, (entity, swarmId, posComp, _velComp, swarmComp, energyComp) => {
      // Clear consumption flag
      swarmComp.beingConsumedBy = undefined;
      // Only collect disabled swarms with health remaining
      if (swarmComp.disabledUntil && now < swarmComp.disabledUntil && energyComp.current > 0) {
        disabledSwarms.push({ entity, swarmId, x: posComp.x, y: posComp.y, size: swarmComp.size, swarmComp, energyComp });
      }
    });

    // Early exit if no disabled swarms (common case - saves the player loop entirely)
    if (disabledSwarms.length === 0) return;

    // Pre-collect multi-cell players (usually only 1-2)
    const multiCellPlayers: { playerId: string; x: number; y: number; radius: number; energyComp: EnergyComponent }[] = [];
    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;
      const energyComp = requireEnergy(world, entity);
      const posComp = requirePosition(world, entity);
      const stageComp = requireStage(world, entity);
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
    for (const player of multiCellPlayers) {
      for (const swarm of disabledSwarms) {
        // Fast squared distance check
        const dx = player.x - swarm.x;
        const dy = player.y - swarm.y;
        const distSq = dx * dx + dy * dy;
        // Collision uses base size (no energy-based scaling)
        const collisionDist = swarm.size + player.radius;
        const collisionDistSq = collisionDist * collisionDist;

        if (distSq < collisionDistSq) {
          // Mark swarm as being consumed
          swarm.swarmComp.beingConsumedBy = player.playerId;

          // Gradual consumption - transfer energy from swarm to player
          // Flat 200/sec drain rate
          const drainRate = 200;
          const damageDealt = Math.min(drainRate * deltaTime, swarm.energyComp.current);
          const playerEnergyBefore = player.energyComp.current;
          const playerMaxBefore = player.energyComp.max;
          swarm.energyComp.current -= damageDealt;

          // Drained energy goes into both current AND max energy
          player.energyComp.current = Math.min(player.energyComp.current + damageDealt, player.energyComp.max + damageDealt);
          player.energyComp.max += damageDealt;

          logger.info({
            event: 'swarm_consumption_tick',
            playerId: player.playerId,
            swarmId: swarm.swarmId,
            drainRate: drainRate.toFixed(1),
            damageDealt: damageDealt.toFixed(1),
            swarmEnergyRemaining: swarm.energyComp.current.toFixed(1),
            playerEnergyBefore: playerEnergyBefore.toFixed(1),
            playerEnergyAfter: player.energyComp.current.toFixed(1),
            playerMaxBefore: playerMaxBefore.toFixed(1),
            playerMaxAfter: player.energyComp.max.toFixed(1),
          });

          // Set damage tracking so DeathSystem knows who killed it
          const damageTracking = world.getComponent<DamageTrackingComponent>(swarm.entity, Components.DamageTracking);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'consumption';
            damageTracking.lastBeamShooter = player.playerId;
          }
        }
      }
    }
  }
}
