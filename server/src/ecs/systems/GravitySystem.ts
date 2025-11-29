// ============================================
// Gravity System
// Applies gravitational forces from obstacles to entities
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import { EvolutionStage } from '@godcell/shared';
import { forEachObstacle, setEnergyBySocketId } from '../index';
import { distance, isJungleStage } from '../../helpers';
import { getConfig, hasGodMode } from '../../dev';
import { logSingularityCrush, logGravityDebug } from '../../logger';

/**
 * GravitySystem - Applies gravity forces from obstacles
 *
 * Handles:
 * - Friction/momentum decay for players and swarms
 * - Gravitational pull from obstacles (inverse-square)
 * - Singularity instant death at obstacle cores
 *
 * TODO Phase 5: Replace players/swarms Map iteration with ECS iteration
 */
export class GravitySystem implements System {
  readonly name = 'GravitySystem';

  update(ctx: GameContext): void {
    const { world, deltaTime, players, playerVelocities, playerLastDamageSource, getSwarms, isBot } = ctx;

    // Apply gravity to players
    for (const [playerId, player] of players) {
      if (player.energy <= 0 || player.isEvolving) continue;

      const velocity = playerVelocities.get(playerId);
      if (!velocity) continue;

      // Apply friction to create momentum/inertia (velocity decays over time)
      // Use exponential decay for smooth deceleration: v = v * friction^dt
      // Stage-specific friction for different movement feels
      let friction = getConfig('MOVEMENT_FRICTION'); // Default soup friction (0.66)

      if (player.stage === EvolutionStage.CYBER_ORGANISM) {
        friction = getConfig('CYBER_ORGANISM_FRICTION'); // Quick stop (0.25)
      }
      // TODO: HUMANOID and GODCELL friction when implemented

      const frictionFactor = Math.pow(friction, deltaTime);
      velocity.x *= frictionFactor;
      velocity.y *= frictionFactor;

      // Stage 3+ players don't interact with soup obstacles (they've transcended)
      if (isJungleStage(player.stage)) continue;

      // Accumulate gravity forces from all obstacles (using ECS query)
      forEachObstacle(world, (_entity, obstaclePos, obstacle) => {
        const dist = distance(player.position, obstaclePos);
        if (dist > obstacle.radius) return; // Outside event horizon

        // Instant death at singularity core (energy-only: energy = 0)
        // God mode players survive singularities
        if (dist < getConfig('OBSTACLE_CORE_RADIUS') && !hasGodMode(playerId)) {
          logSingularityCrush(playerId, dist);
          // Use ECS setter to persist the change
          setEnergyBySocketId(world, playerId, 0); // Instant energy depletion
          playerLastDamageSource.set(playerId, 'singularity');
          return;
        }

        // Inverse-square gravity: F = strength / dist²
        // Prevent divide-by-zero and extreme forces
        const distSq = Math.max(dist * dist, 100);

        // Scale gravity strength for pixels/second velocity units
        const gravityStrength = obstacle.strength * 100000000;
        const forceMagnitude = gravityStrength / distSq;

        // Direction FROM player TO obstacle (attraction)
        const dx = obstaclePos.x - player.position.x;
        const dy = obstaclePos.y - player.position.y;
        const dirLength = Math.sqrt(dx * dx + dy * dy);

        if (dirLength === 0) return;

        const dirX = dx / dirLength;
        const dirY = dy / dirLength;

        // Accumulate gravitational acceleration into velocity
        velocity.x += dirX * forceMagnitude * deltaTime;
        velocity.y += dirY * forceMagnitude * deltaTime;

        // DEBUG: Log gravity forces
        if (!isBot(playerId)) {
          logGravityDebug(playerId, dist, forceMagnitude, velocity);
        }
      });
    }

    // Apply gravity to entropy swarms with momentum (corrupted data, less mass)
    for (const swarm of getSwarms().values()) {
      // Apply friction to swarms (same momentum system as players)
      const swarmFrictionFactor = Math.pow(getConfig('MOVEMENT_FRICTION'), deltaTime);
      swarm.velocity.x *= swarmFrictionFactor;
      swarm.velocity.y *= swarmFrictionFactor;

      // Accumulate gravity forces from all obstacles (using ECS query)
      forEachObstacle(world, (_entity, obstaclePos, obstacle) => {
        const dist = distance(swarm.position, obstaclePos);
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
        const dx = obstaclePos.x - swarm.position.x;
        const dy = obstaclePos.y - swarm.position.y;
        const dirLength = Math.sqrt(dx * dx + dy * dy);

        if (dirLength === 0) return;

        const dirX = dx / dirLength;
        const dirY = dy / dirLength;

        // Accumulate gravitational acceleration into velocity
        swarm.velocity.x += dirX * forceMagnitude * deltaTime;
        swarm.velocity.y += dirY * forceMagnitude * deltaTime;
      });
    }
  }
}
