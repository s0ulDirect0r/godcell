// ============================================
// Pseudopod System
// Handles pseudopod (beam) movement and collision
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type { Position, Pseudopod, PseudopodMovedMessage, PseudopodRetractedMessage } from '@godcell/shared';
import { GAME_CONFIG } from '@godcell/shared';
import {
  getEntityByStringId,
  destroyEntity as ecsDestroyEntity,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
} from '../index';
import { distance, rayCircleIntersection } from '../../helpers';
import { getConfig } from '../../dev';
import { logger } from '../../logger';
import { getPlayerRadius, isSoupStage } from '../../helpers';

/**
 * PseudopodSystem - Manages pseudopod projectiles
 *
 * Handles:
 * - Beam movement (projectile mode)
 * - Collision detection with players and swarms
 * - Hitscan mode instant collision
 * - Damage application and kill credit tracking
 *
 * TODO Phase 5: Replace players Map iteration with ECS iteration
 */
export class PseudopodSystem implements System {
  readonly name = 'PseudopodSystem';

  update(ctx: GameContext): void {
    const { io, deltaTime, pseudopods, pseudopodHits } = ctx;

    // Skip if using hitscan mode (beams are visual-only and auto-removed)
    if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') return;

    const toRemove: string[] = [];

    for (const [id, beam] of pseudopods) {
      // Move beam (projectile mode)
      const travelDist = Math.sqrt(beam.velocity.x * beam.velocity.x + beam.velocity.y * beam.velocity.y) * deltaTime;
      beam.position.x += beam.velocity.x * deltaTime;
      beam.position.y += beam.velocity.y * deltaTime;
      beam.distanceTraveled += travelDist;

      // Broadcast position update to clients
      io.emit('pseudopodMoved', {
        type: 'pseudopodMoved',
        pseudopodId: id,
        position: beam.position,
      } as PseudopodMovedMessage);

      // Check if beam exceeded max distance
      if (beam.distanceTraveled >= beam.maxDistance) {
        toRemove.push(id);
        continue;
      }

      // Check collision with players (multi-cells only)
      this.checkBeamCollision(ctx, beam);
      // Beam continues traveling even if it hits (can hit multiple targets)
    }

    // Remove beams that exceeded range
    for (const id of toRemove) {
      pseudopods.delete(id);
      pseudopodHits.delete(id); // Clean up hit tracking
      // Remove from ECS (dual-write during migration)
      const beamEntity = getEntityByStringId(id);
      if (beamEntity !== undefined) {
        ecsDestroyEntity(ctx.world, beamEntity);
      }
      io.emit('pseudopodRetracted', { type: 'pseudopodRetracted', pseudopodId: id } as PseudopodRetractedMessage);
    }
  }

  /**
   * Check beam collision with players and swarms (projectile mode)
   */
  private checkBeamCollision(ctx: GameContext, beam: Pseudopod): boolean {
    const {
      world,
      io,
      players,
      pseudopodHits,
      playerLastDamageSource,
      playerLastBeamShooter,
      pseudopodHitDecays,
      getSwarms,
      applyDamageWithResistance,
    } = ctx;

    const shooter = players.get(beam.ownerId);
    if (!shooter) return false;

    // Stage 3+ shooters don't interact with soup-stage combat
    if (!isSoupStage(shooter.stage)) return false;

    // Get or create hit tracking set for this beam
    let hitSet = pseudopodHits.get(beam.id);
    if (!hitSet) {
      hitSet = new Set<string>();
      pseudopodHits.set(beam.id, hitSet);
    }

    let hitSomething = false;

    // Check collision with all soup-stage players (Stage 1 and 2)
    for (const [targetId, target] of players) {
      if (targetId === beam.ownerId) continue; // Can't hit yourself
      if (hitSet.has(targetId)) continue; // Already hit this target
      if (!isSoupStage(target.stage)) continue; // Beams only hit soup-stage targets (Stage 1 & 2)
      if (target.energy <= 0) continue; // Skip dead players
      if (target.isEvolving) continue; // Skip evolving players
      if (target.stunnedUntil && Date.now() < target.stunnedUntil) continue; // Skip stunned players

      // Circle-circle collision: beam position vs target position
      const targetRadius = getPlayerRadius(target.stage);
      const dist = distance(beam.position, target.position);
      const collisionDist = beam.width / 2 + targetRadius;

      if (dist < collisionDist) {
        // Hit! Drain energy from target (one-time damage per beam, with resistance)
        applyDamageWithResistance(target, getConfig('PSEUDOPOD_DRAIN_RATE'));
        hitSomething = true;

        // Track damage source and shooter for kill credit
        playerLastDamageSource.set(targetId, 'beam');
        playerLastBeamShooter.set(targetId, beam.ownerId);

        // Mark this target as hit by this beam
        hitSet.add(targetId);

        logger.info({
          event: 'beam_hit',
          shooter: beam.ownerId,
          target: targetId,
          damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
          targetEnergyRemaining: target.energy.toFixed(0),
        });

        // Emit hit event for visual effects
        io.emit('pseudopodHit', {
          type: 'pseudopodHit',
          beamId: beam.id,
          targetId,
          hitPosition: { x: beam.position.x, y: beam.position.y },
        });

        // Add decay timer for brief drain aura after hit (1.5 seconds)
        pseudopodHitDecays.set(targetId, {
          rate: getConfig('PSEUDOPOD_DRAIN_RATE'),
          expiresAt: Date.now() + 1500, // 1.5 second decay
        });

        // Beam continues traveling, can hit multiple different targets
      }
    }

    // Check collision with swarms (active or disabled)
    for (const [swarmId, swarm] of getSwarms()) {
      if (hitSet.has(swarmId)) continue; // Already hit this swarm

      const dist = distance(beam.position, swarm.position);
      const collisionDist = beam.width / 2 + swarm.size;

      if (dist < collisionDist) {
        // Hit! Deal damage to swarm
        // Initialize energy if not set (swarms gain energy pool when first damaged)
        if (swarm.energy === undefined) {
          swarm.energy = GAME_CONFIG.SWARM_ENERGY;
        }
        swarm.energy -= getConfig('PSEUDOPOD_DRAIN_RATE');
        hitSomething = true;
        hitSet.add(swarmId);

        logger.info({
          event: 'beam_hit_swarm',
          shooter: beam.ownerId,
          swarmId,
          damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
          swarmEnergyRemaining: swarm.energy.toFixed(0),
        });

        // Check if swarm died
        if (swarm.energy <= 0) {
          // Award shooter with reduced maxEnergy (ranged kill = nutrient loss) - write to ECS
          const newMaxEnergy = shooter.maxEnergy + GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN;
          setMaxEnergyBySocketId(world, beam.ownerId, newMaxEnergy);
          addEnergyBySocketId(world, beam.ownerId, GAME_CONFIG.SWARM_ENERGY_GAIN);

          // Remove swarm
          getSwarms().delete(swarmId);

          // Broadcast swarm death
          io.emit('swarmConsumed', {
            type: 'swarmConsumed',
            swarmId,
            consumerId: beam.ownerId,
            position: swarm.position,
          });

          logger.info({
            event: 'beam_kill_swarm',
            shooter: beam.ownerId,
            swarmId,
            maxEnergyGained: GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN,
            energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
          });
        }
      }
    }

    return hitSomething;
  }

  /**
   * Check beam collision using hitscan (instant raycast)
   * Returns the ID of the player hit, or null if no hit
   */
  checkBeamHitscan(ctx: GameContext, start: Position, end: Position, shooterId: string): string | null {
    const { players, playerLastDamageSource, playerLastBeamShooter, applyDamageWithResistance } = ctx;

    let closestHit: { playerId: string; distance: number } | null = null;

    for (const [playerId, target] of players) {
      // Skip shooter
      if (playerId === shooterId) continue;

      // Skip dead/evolving/stunned players
      if (target.energy <= 0) continue;
      if (target.isEvolving) continue;
      if (target.stunnedUntil && Date.now() < target.stunnedUntil) continue;

      const targetRadius = getPlayerRadius(target.stage);
      const hitDist = rayCircleIntersection(start, end, target.position, targetRadius);

      if (hitDist !== null) {
        // Track closest hit
        if (!closestHit || hitDist < closestHit.distance) {
          closestHit = { playerId, distance: hitDist };
        }
      }
    }

    // Apply damage to closest hit
    if (closestHit) {
      const target = players.get(closestHit.playerId);
      if (target) {
        applyDamageWithResistance(target, getConfig('PSEUDOPOD_DRAIN_RATE'));
        playerLastDamageSource.set(closestHit.playerId, 'beam');
        playerLastBeamShooter.set(closestHit.playerId, shooterId); // Track shooter for kill rewards

        logger.info({
          event: 'beam_hit',
          shooter: shooterId,
          target: closestHit.playerId,
          damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
          targetEnergyRemaining: target.energy.toFixed(0),
        });
      }

      return closestHit.playerId;
    }

    return null;
  }
}
