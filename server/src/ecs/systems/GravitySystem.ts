// ============================================
// Gravity System
// Applies gravitational forces from obstacles to entities
// ============================================

import type { Server } from 'socket.io';
import { type World } from '#shared';
import type { VelocityComponent } from '#shared';
import type { System } from './types';
import {
  forEachObstacle,
  forEachPlayer,
  forEachSwarm,
  setEnergy,
  getDamageTracking,
  requireEnergy,
  requirePosition,
  requireStage,
  requireVelocity,
  Components,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
} from '../index';
import { distance, isJungleStage } from '../../helpers';
import { getConfig } from '../../dev';
import { logSingularityCrush, logGravityDebug } from '../../logger';
import { isBot } from '../../bots';

/**
 * GravitySystem - Applies gravity forces from obstacles
 *
 * Handles:
 * - Gravitational pull from obstacles (inverse-square)
 * - Singularity instant death at obstacle cores
 * - Friction/momentum decay for swarms (player friction is in MovementSystem)
 */
export class GravitySystem implements System {
  readonly name = 'GravitySystem';

  update(world: World, deltaTime: number, _io: Server): void {

    // Apply gravity to players (iterate ECS directly)
    forEachPlayer(world, (entity, playerId) => {
      const energyComponent = requireEnergy(world, entity);
      const stageComponent = requireStage(world, entity);
      const positionComponent = requirePosition(world, entity);
      const velocityComponent = requireVelocity(world, entity);

      if (energyComponent.current <= 0 || stageComponent.isEvolving) return;

      // NOTE: Friction is handled in MovementSystem for all stages

      // Stage 3+ players don't interact with soup obstacles (they've transcended)
      if (isJungleStage(stageComponent.stage)) return;

      const playerPos = { x: positionComponent.x, y: positionComponent.y };

      // Accumulate gravity forces from all obstacles (using ECS query)
      forEachObstacle(world, (_obstacleEntity, obstaclePos, obstacle) => {
        const dist = distance(playerPos, obstaclePos);
        if (dist > obstacle.radius) return; // Outside event horizon

        // Instant death at inner spark (energy-only: energy = 0)
        if (dist < getConfig('OBSTACLE_SPARK_RADIUS')) {
          logSingularityCrush(playerId, dist);
          // Use entity-based setter to persist the change
          setEnergy(world, entity, 0); // Instant energy depletion
          // Track damage source in ECS for death cause logging (entity-based)
          const damageTracking = getDamageTracking(world, entity);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'singularity';
          }
          return;
        }

        // Light energy drain based on proximity to center
        // Closer = stronger drain (simulates energy being pulled into the singularity)
        const proximityFactor = 1 - (dist / obstacle.radius); // 0 at edge, 1 at center
        const drainRate = getConfig('OBSTACLE_ENERGY_DRAIN_RATE');
        const energyDrain = drainRate * proximityFactor * proximityFactor * deltaTime; // Squared for steeper curve near center

        if (energyDrain > 0) {
          const newEnergy = Math.max(0, energyComponent.current - energyDrain);
          setEnergy(world, entity, newEnergy);
          // Track damage source for death cause (entity-based)
          const damageTracking = getDamageTracking(world, entity);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'gravity';
          }
        }

        // Inverse-square gravity: F = strength / dist²
        // Prevent divide-by-zero and extreme forces
        const distSq = Math.max(dist * dist, 100);

        // Scale gravity strength for pixels/second velocity units
        const gravityStrength = obstacle.strength * 100000000;
        const forceMagnitude = gravityStrength / distSq;

        // Direction FROM player TO obstacle (attraction)
        const dx = obstaclePos.x - playerPos.x;
        const dy = obstaclePos.y - playerPos.y;
        const dirLength = Math.sqrt(dx * dx + dy * dy);

        if (dirLength === 0) return;

        const dirX = dx / dirLength;
        const dirY = dy / dirLength;

        // Accumulate gravitational acceleration into velocity
        velocityComponent.x += dirX * forceMagnitude * deltaTime;
        velocityComponent.y += dirY * forceMagnitude * deltaTime;

        // DEBUG: Log gravity forces
        if (!isBot(playerId)) {
          logGravityDebug(playerId, dist, forceMagnitude, velocityComponent);
        }
      });
    });

    // Apply gravity to entropy swarms with momentum (corrupted data, less mass)
    // Swarms are now ECS entities - iterate via forEachSwarm
    forEachSwarm(world, (_swarmEntity, _swarmId, swarmPosComp, swarmVelocityComp) => {
      // Apply friction to swarms (same momentum system as players)
      const swarmFrictionFactor = Math.pow(getConfig('MOVEMENT_FRICTION'), deltaTime);
      swarmVelocityComp.x *= swarmFrictionFactor;
      swarmVelocityComp.y *= swarmFrictionFactor;

      const swarmPosition = { x: swarmPosComp.x, y: swarmPosComp.y };

      // Accumulate gravity forces from all obstacles (using ECS query)
      forEachObstacle(world, (_obstacleEntity, obstaclePos, obstacle) => {
        const dist = distance(swarmPosition, obstaclePos);
        if (dist > obstacle.radius) return; // Outside event horizon

        // Swarms are IMMUNE to singularity death spark - they pass through unharmed
        // (corrupted data has no physical form to crush)
        if (dist < getConfig('OBSTACLE_SPARK_RADIUS')) {
          return;
        }

        // 80% gravity resistance compared to players (corrupted data has less mass)
        const distSq = Math.max(dist * dist, 100);
        const gravityStrength = obstacle.strength * 100000000;
        const forceMagnitude = (gravityStrength / distSq) * 0.2; // 20% gravity

        // Direction FROM swarm TO obstacle (attraction)
        const dx = obstaclePos.x - swarmPosition.x;
        const dy = obstaclePos.y - swarmPosition.y;
        const dirLength = Math.sqrt(dx * dx + dy * dy);

        if (dirLength === 0) return;

        const dirX = dx / dirLength;
        const dirY = dy / dirLength;

        // Accumulate gravitational acceleration into velocity (mutate ECS component)
        swarmVelocityComp.x += dirX * forceMagnitude * deltaTime;
        swarmVelocityComp.y += dirY * forceMagnitude * deltaTime;
      });
    });
  }
}
