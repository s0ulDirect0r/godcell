// ============================================
// Pseudopod System
// Handles pseudopod (beam) movement and collision
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type { Position, PseudopodMovedMessage, PseudopodRetractedMessage } from '@godcell/shared';
import { GAME_CONFIG, Tags } from '@godcell/shared';
import {
  getEntityBySocketId,
  getStringIdByEntity,
  destroyEntity as ecsDestroyEntity,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
  forEachPlayer,
  forEachSwarm,
  getDamageTrackingBySocketId,
  Components,
  type EntityId,
  type EnergyComponent,
  type PositionComponent,
  type VelocityComponent,
  type StageComponent,
  type StunnedComponent,
  type PseudopodComponent,
} from '../index';
import { removeSwarm } from '../../swarms';
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
    const { world, io, deltaTime } = ctx;

    // Skip if using hitscan mode (beams are visual-only and auto-removed)
    if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') return;

    const toRemove: EntityId[] = [];

    // Iterate pseudopod entities via ECS
    world.forEachWithTag(Tags.Pseudopod, (entity) => {
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const pseudopodComp = world.getComponent<PseudopodComponent>(entity, Components.Pseudopod);
      if (!posComp || !velComp || !pseudopodComp) return;

      const beamId = getStringIdByEntity(entity);
      if (!beamId) return;

      // Move beam (projectile mode)
      const travelDist = Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y) * deltaTime;
      posComp.x += velComp.x * deltaTime;
      posComp.y += velComp.y * deltaTime;
      pseudopodComp.distanceTraveled += travelDist;

      // Broadcast position update to clients
      io.emit('pseudopodMoved', {
        type: 'pseudopodMoved',
        pseudopodId: beamId,
        position: { x: posComp.x, y: posComp.y },
      } as PseudopodMovedMessage);

      // Check if beam exceeded max distance
      if (pseudopodComp.distanceTraveled >= pseudopodComp.maxDistance) {
        toRemove.push(entity);
        return;
      }

      // Check collision with players (multi-cells only)
      this.checkBeamCollisionECS(ctx, entity, beamId, posComp, pseudopodComp);
      // Beam continues traveling even if it hits (can hit multiple targets)
    });

    // Remove beams that exceeded range
    for (const entity of toRemove) {
      const beamId = getStringIdByEntity(entity);
      ecsDestroyEntity(world, entity);
      if (beamId) {
        io.emit('pseudopodRetracted', { type: 'pseudopodRetracted', pseudopodId: beamId } as PseudopodRetractedMessage);
      }
    }
  }

  /**
   * Check beam collision with players and swarms (projectile mode) - ECS version
   * Uses PseudopodComponent.hitEntities for hit tracking instead of external Map
   */
  private checkBeamCollisionECS(
    ctx: GameContext,
    beamEntity: EntityId,
    beamId: string,
    posComp: PositionComponent,
    pseudopodComp: PseudopodComponent
  ): boolean {
    const {
      world,
      io,
    } = ctx;

    // Get shooter stage from ECS
    const shooterEntity = getEntityBySocketId(pseudopodComp.ownerSocketId);
    if (shooterEntity === undefined) return false;
    const shooterStage = world.getComponent<StageComponent>(shooterEntity, Components.Stage);
    const shooterEnergy = world.getComponent<EnergyComponent>(shooterEntity, Components.Energy);
    if (!shooterStage || !shooterEnergy) return false;

    // Stage 3+ shooters don't interact with soup-stage combat
    if (!isSoupStage(shooterStage.stage)) return false;

    // Use hitEntities Set from PseudopodComponent for hit tracking
    const hitEntities = pseudopodComp.hitEntities;
    const beamPosition = { x: posComp.x, y: posComp.y };

    let hitSomething = false;

    // Check collision with all soup-stage players (Stage 1 and 2) via ECS
    forEachPlayer(world, (targetEntity, targetId) => {
      if (targetId === pseudopodComp.ownerSocketId) return; // Can't hit yourself
      if (hitEntities.has(targetEntity)) return; // Already hit this target (by entity ID)

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
      const dist = distance(beamPosition, targetPosition);
      const collisionDist = pseudopodComp.width / 2 + targetRadius;

      if (dist < collisionDist) {
        // Hit! Drain energy from target (one-time damage per beam)
        const damage = getConfig('PSEUDOPOD_DRAIN_RATE');
        targetEnergy.current -= damage;
        hitSomething = true;

        // Track damage source and shooter for kill credit in ECS
        const damageTracking = getDamageTrackingBySocketId(world, targetId);
        if (damageTracking) {
          damageTracking.lastDamageSource = 'beam';
          damageTracking.lastBeamShooter = pseudopodComp.ownerSocketId;
        }

        // Mark this target as hit by this beam (store entity ID)
        hitEntities.add(targetEntity);

        logger.info({
          event: 'beam_hit',
          shooter: pseudopodComp.ownerSocketId,
          target: targetId,
          damage,
          targetEnergyRemaining: targetEnergy.current.toFixed(0),
        });

        // Emit hit event for visual effects
        io.emit('pseudopodHit', {
          type: 'pseudopodHit',
          beamId,
          targetId,
          hitPosition: beamPosition,
        });

        // Add decay timer for brief drain aura after hit (1.5 seconds)
        if (damageTracking) {
          damageTracking.pseudopodHitRate = damage;
          damageTracking.pseudopodHitExpiresAt = Date.now() + 1500;
        }
      }
    });

    // Check collision with swarms (active or disabled) - from ECS
    // Track swarms to remove after iteration
    const swarmsToRemove: string[] = [];

    forEachSwarm(world, (swarmEntity, swarmId, swarmPosComp, _velocityComp, swarmComp, swarmEnergyComp) => {
      // Swarms are now ECS entities, so we can use their entity ID directly
      if (hitEntities.has(swarmEntity)) return; // Already hit this swarm

      const swarmPosition = { x: swarmPosComp.x, y: swarmPosComp.y };
      const dist = distance(beamPosition, swarmPosition);
      const collisionDist = pseudopodComp.width / 2 + swarmComp.size;

      if (dist < collisionDist) {
        // Hit! Deal damage to swarm via ECS component
        swarmEnergyComp.current -= getConfig('PSEUDOPOD_DRAIN_RATE');
        hitSomething = true;
        hitEntities.add(swarmEntity);

        logger.info({
          event: 'beam_hit_swarm',
          shooter: pseudopodComp.ownerSocketId,
          swarmId,
          damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
          swarmEnergyRemaining: swarmEnergyComp.current.toFixed(0),
        });

        // Check if swarm died
        if (swarmEnergyComp.current <= 0) {
          // Award shooter - get current maxEnergy from ECS
          const newMaxEnergy = shooterEnergy.max + GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN;
          setMaxEnergyBySocketId(world, pseudopodComp.ownerSocketId, newMaxEnergy);
          addEnergyBySocketId(world, pseudopodComp.ownerSocketId, GAME_CONFIG.SWARM_ENERGY_GAIN);

          // Queue swarm for removal
          swarmsToRemove.push(swarmId);

          io.emit('swarmConsumed', {
            type: 'swarmConsumed',
            swarmId,
            consumerId: pseudopodComp.ownerSocketId,
            position: swarmPosition,
          });

          logger.info({
            event: 'beam_kill_swarm',
            shooter: pseudopodComp.ownerSocketId,
            swarmId,
            maxEnergyGained: GAME_CONFIG.SWARM_BEAM_KILL_MAX_ENERGY_GAIN,
            energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
          });
        }
      }
    });

    // Remove killed swarms after iteration
    for (const swarmId of swarmsToRemove) {
      removeSwarm(world, swarmId);
    }

    return hitSomething;
  }

  /**
   * Check beam collision using hitscan (instant raycast)
   * Returns the ID of the player hit, or null if no hit
   */
  checkBeamHitscan(ctx: GameContext, start: Position, end: Position, shooterId: string): string | null {
    const { world } = ctx;

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
        // Track damage source and shooter for kill credit in ECS
        const damageTracking = getDamageTrackingBySocketId(world, hit.playerId);
        if (damageTracking) {
          damageTracking.lastDamageSource = 'beam';
          damageTracking.lastBeamShooter = shooterId;
        }

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
