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
  getEntityBySocketId,
  destroyEntity as ecsDestroyEntity,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
  forEachPlayer,
  Components,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
  type StunnedComponent,
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
      pseudopodHits,
      playerLastDamageSource,
      playerLastBeamShooter,
      pseudopodHitDecays,
      getSwarms,
      applyDamageWithResistance,
    } = ctx;

    // Get shooter stage from ECS
    const shooterEntity = getEntityBySocketId(beam.ownerId);
    if (shooterEntity === undefined) return false;
    const shooterStage = world.getComponent<StageComponent>(shooterEntity, Components.Stage);
    const shooterEnergy = world.getComponent<EnergyComponent>(shooterEntity, Components.Energy);
    if (!shooterStage || !shooterEnergy) return false;

    // Stage 3+ shooters don't interact with soup-stage combat
    if (!isSoupStage(shooterStage.stage)) return false;

    // Get or create hit tracking set for this beam
    let hitSet = pseudopodHits.get(beam.id);
    if (!hitSet) {
      hitSet = new Set<string>();
      pseudopodHits.set(beam.id, hitSet);
    }

    let hitSomething = false;

    // Check collision with all soup-stage players (Stage 1 and 2) via ECS
    forEachPlayer(world, (targetEntity, targetId) => {
      if (targetId === beam.ownerId) return; // Can't hit yourself
      if (hitSet!.has(targetId)) return; // Already hit this target

      const targetStage = world.getComponent<StageComponent>(targetEntity, Components.Stage);
      const targetEnergy = world.getComponent<EnergyComponent>(targetEntity, Components.Energy);
      const targetPos = world.getComponent<PositionComponent>(targetEntity, Components.Position);
      const targetStunned = world.getComponent<StunnedComponent>(targetEntity, Components.Stunned);
      if (!targetStage || !targetEnergy || !targetPos) return;

      if (!isSoupStage(targetStage.stage)) return; // Beams only hit soup-stage targets
      if (targetEnergy.current <= 0) return; // Skip dead players
      if (targetStage.isEvolving) return; // Skip evolving players
      if (targetStunned?.until && Date.now() < targetStunned.until) return; // Skip stunned

      // Circle-circle collision: beam position vs target position
      const targetRadius = getPlayerRadius(targetStage.stage);
      const targetPosition = { x: targetPos.x, y: targetPos.y };
      const dist = distance(beam.position, targetPosition);
      const collisionDist = beam.width / 2 + targetRadius;

      if (dist < collisionDist) {
        // Hit! Drain energy from target (one-time damage per beam, with resistance)
        // Apply damage directly to ECS component
        const damage = getConfig('PSEUDOPOD_DRAIN_RATE');
        targetEnergy.current -= damage;
        hitSomething = true;

        // Track damage source and shooter for kill credit
        playerLastDamageSource.set(targetId, 'beam');
        playerLastBeamShooter.set(targetId, beam.ownerId);

        // Mark this target as hit by this beam
        hitSet!.add(targetId);

        logger.info({
          event: 'beam_hit',
          shooter: beam.ownerId,
          target: targetId,
          damage,
          targetEnergyRemaining: targetEnergy.current.toFixed(0),
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
          rate: damage,
          expiresAt: Date.now() + 1500,
        });
      }
    });

    // Check collision with swarms (active or disabled)
    for (const [swarmId, swarm] of getSwarms()) {
      if (hitSet.has(swarmId)) continue; // Already hit this swarm

      const dist = distance(beam.position, swarm.position);
      const collisionDist = beam.width / 2 + swarm.size;

      if (dist < collisionDist) {
        // Hit! Deal damage to swarm
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
          // Award shooter - get current maxEnergy from ECS
          const newMaxEnergy = shooterEnergy.max + GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN;
          setMaxEnergyBySocketId(world, beam.ownerId, newMaxEnergy);
          addEnergyBySocketId(world, beam.ownerId, GAME_CONFIG.SWARM_ENERGY_GAIN);

          // Remove swarm
          getSwarms().delete(swarmId);

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
    const { world, playerLastDamageSource, playerLastBeamShooter } = ctx;

    type HitInfo = { playerId: string; distance: number; entity: number };
    let closestHit: HitInfo | null = null;

    // Find closest hit via ECS iteration
    forEachPlayer(world, (entity, playerId) => {
      if (playerId === shooterId) return; // Skip shooter

      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stunnedComp = world.getComponent<StunnedComponent>(entity, Components.Stunned);
      if (!stageComp || !energyComp || !posComp) return;

      // Skip dead/evolving/stunned players
      if (energyComp.current <= 0) return;
      if (stageComp.isEvolving) return;
      if (stunnedComp?.until && Date.now() < stunnedComp.until) return;

      const targetRadius = getPlayerRadius(stageComp.stage);
      const targetPosition = { x: posComp.x, y: posComp.y };
      const hitDist = rayCircleIntersection(start, end, targetPosition, targetRadius);

      if (hitDist !== null) {
        if (!closestHit || hitDist < closestHit.distance) {
          closestHit = { playerId, distance: hitDist, entity };
        }
      }
    });

    // Apply damage to closest hit (type assertion needed due to callback mutation)
    const hit = closestHit as HitInfo | null;
    if (hit) {
      const targetEnergy = world.getComponent<EnergyComponent>(hit.entity, Components.Energy);
      if (targetEnergy) {
        const damage = getConfig('PSEUDOPOD_DRAIN_RATE');
        targetEnergy.current -= damage;
        playerLastDamageSource.set(hit.playerId, 'beam');
        playerLastBeamShooter.set(hit.playerId, shooterId);

        logger.info({
          event: 'beam_hit',
          shooter: shooterId,
          target: hit.playerId,
          damage,
          targetEnergyRemaining: targetEnergy.current.toFixed(0),
        });
      }

      return hit.playerId;
    }

    return null;
  }
}
