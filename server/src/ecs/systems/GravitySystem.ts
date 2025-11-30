// ============================================
// Gravity System
// Applies gravitational forces from obstacles to entities
// ============================================

import { EvolutionStage, Resources, type World, type TimeResource } from '@godcell/shared';
import type { VelocityComponent } from '@godcell/shared';
import type { System } from './types';
import {
  forEachObstacle,
  forEachPlayer,
  forEachSwarm,
  setEnergyBySocketId,
  getDamageTrackingBySocketId,
  Components,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
} from '../index';
import { distance, isJungleStage } from '../../helpers';
import { getConfig, hasGodMode } from '../../dev';
import { logSingularityCrush, logGravityDebug } from '../../logger';
import { isBot } from '../../bots';

/**
 * GravitySystem - Applies gravity forces from obstacles
 *
 * Handles:
 * - Friction/momentum decay for players and swarms
 * - Gravitational pull from obstacles (inverse-square)
 * - Singularity instant death at obstacle cores
 */
export class GravitySystem implements System {
  readonly name = 'GravitySystem';

  update(world: World): void {
    const time = world.getResource<TimeResource>(Resources.Time)!;
    const deltaTime = time.delta;

    // Apply gravity to players (iterate ECS directly)
    forEachPlayer(world, (entity, playerId) => {
      const energyComponent = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const stageComponent = world.getComponent<StageComponent>(entity, Components.Stage);
      const positionComponent = world.getComponent<PositionComponent>(entity, Components.Position);
      const velocityComponent = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!energyComponent || !stageComponent || !positionComponent || !velocityComponent) return;

      if (energyComponent.current <= 0 || stageComponent.isEvolving) return;

      // Apply friction to create momentum/inertia (velocity decays over time)
      // Use exponential decay for smooth deceleration: v = v * friction^dt
      // Stage-specific friction for different movement feels
      let friction = getConfig('MOVEMENT_FRICTION'); // Default soup friction (0.66)

      if (stageComponent.stage === EvolutionStage.CYBER_ORGANISM) {
        friction = getConfig('CYBER_ORGANISM_FRICTION'); // Quick stop (0.25)
      }
      // TODO: HUMANOID and GODCELL friction when implemented

      const frictionFactor = Math.pow(friction, deltaTime);
      velocityComponent.x *= frictionFactor;
      velocityComponent.y *= frictionFactor;

      // Stage 3+ players don't interact with soup obstacles (they've transcended)
      if (isJungleStage(stageComponent.stage)) return;

      const playerPos = { x: positionComponent.x, y: positionComponent.y };

      // Accumulate gravity forces from all obstacles (using ECS query)
      forEachObstacle(world, (_obstacleEntity, obstaclePos, obstacle) => {
        const dist = distance(playerPos, obstaclePos);
        if (dist > obstacle.radius) return; // Outside event horizon

        // Instant death at singularity core (energy-only: energy = 0)
        // God mode players survive singularities
        if (dist < getConfig('OBSTACLE_CORE_RADIUS') && !hasGodMode(playerId)) {
          logSingularityCrush(playerId, dist);
          // Use ECS setter to persist the change
          setEnergyBySocketId(world, playerId, 0); // Instant energy depletion
          // Track damage source in ECS for death cause logging
          const damageTracking = getDamageTrackingBySocketId(world, playerId);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'singularity';
          }
          return;
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

        // Swarms can get destroyed by singularities too
        if (dist < getConfig('OBSTACLE_CORE_RADIUS')) {
          // For now, swarms just get pulled through - they're corrupted data
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
