// ============================================
// Pseudopod System
// Handles pseudopod (beam) movement and collision
// ============================================

import type { Server } from 'socket.io';
import type { PseudopodMovedMessage, PseudopodRetractedMessage } from '#shared';
import { Tags, type World } from '#shared';
import type { System } from './types';
import {
  getEntityBySocketId,
  getStringIdByEntity,
  destroyEntity as ecsDestroyEntity,
  forEachPlayer,
  forEachSwarm,
  getDamageTracking,
  requireEnergy,
  requirePosition,
  requireStage,
  Components,
  type EntityId,
  type EnergyComponent,
  type PositionComponent,
  type VelocityComponent,
  type StageComponent,
  type StunnedComponent,
  type PseudopodComponent,
  type DamageTrackingComponent,
} from '../index';
import { isSoupStage } from '../../helpers';
import { getConfig } from '../../dev';
import { logger } from '../../logger';

// Pre-collected target snapshots for O(1) collision checks per beam
interface PlayerTargetSnapshot {
  entity: EntityId;
  playerId: string;
  x: number;
  y: number;
  radius: number;
  energyComp: EnergyComponent;
  isStunned: boolean;
}

interface SwarmTargetSnapshot {
  entity: EntityId;
  swarmId: string;
  x: number;
  y: number;
  size: number;
  energyComp: EnergyComponent;
}

/**
 * PseudopodSystem - Manages pseudopod projectiles
 *
 * Handles:
 * - Beam movement (projectile mode)
 * - Collision detection with players and swarms
 * - Damage application and kill credit tracking
 */
export class PseudopodSystem implements System {
  readonly name = 'PseudopodSystem';

  update(world: World, deltaTime: number, io: Server): void {
    // Pre-collect soup-stage players once per tick (avoids O(beams × players))
    const playerTargets: PlayerTargetSnapshot[] = [];
    forEachPlayer(world, (entity, playerId) => {
      const stageComp = requireStage(world, entity);
      const energyComp = requireEnergy(world, entity);
      const posComp = requirePosition(world, entity);
      const stunnedComp = world.getComponent<StunnedComponent>(entity, Components.Stunned);
      if (!isSoupStage(stageComp.stage)) return;
      if (energyComp.current <= 0 || stageComp.isEvolving) return;
      if (world.hasTag(entity, Tags.GodMode)) return; // Dev cheat: untouchable
      playerTargets.push({
        entity,
        playerId,
        x: posComp.x,
        y: posComp.y,
        radius: stageComp.radius,
        energyComp,
        isStunned: !!(stunnedComp?.until && Date.now() < stunnedComp.until),
      });
    });

    // Pre-collect swarms once per tick (avoids O(beams × swarms))
    const swarmTargets: SwarmTargetSnapshot[] = [];
    forEachSwarm(world, (entity, swarmId, posComp, _velComp, swarmComp, energyComp) => {
      swarmTargets.push({
        entity,
        swarmId,
        x: posComp.x,
        y: posComp.y,
        size: swarmComp.size,
        energyComp,
      });
    });

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

      // Check collision with pre-collected targets
      this.checkBeamCollisionFast(
        world,
        io,
        beamId,
        posComp,
        pseudopodComp,
        playerTargets,
        swarmTargets
      );
      // Beam continues traveling even if it hits (can hit multiple targets)
    });

    // Remove beams that exceeded range
    for (const entity of toRemove) {
      const beamId = getStringIdByEntity(entity);
      ecsDestroyEntity(world, entity);
      if (beamId) {
        io.emit('pseudopodRetracted', {
          type: 'pseudopodRetracted',
          pseudopodId: beamId,
        } as PseudopodRetractedMessage);
      }
    }
  }

  /**
   * Fast beam collision check using pre-collected targets
   * Uses squared distance to avoid sqrt in hot loop
   */
  private checkBeamCollisionFast(
    world: World,
    io: Server,
    beamId: string,
    posComp: PositionComponent,
    pseudopodComp: PseudopodComponent,
    playerTargets: PlayerTargetSnapshot[],
    swarmTargets: SwarmTargetSnapshot[]
  ): boolean {
    // Get shooter for energy rewards
    const shooterEntity = getEntityBySocketId(pseudopodComp.ownerSocketId);
    if (shooterEntity === undefined) return false;
    const shooterStage = world.getComponent<StageComponent>(shooterEntity, Components.Stage);
    const shooterEnergy = world.getComponent<EnergyComponent>(shooterEntity, Components.Energy);
    if (!shooterStage || !shooterEnergy) return false;
    if (!isSoupStage(shooterStage.stage)) return false;

    const hitEntities = pseudopodComp.hitEntities;
    const beamX = posComp.x;
    const beamY = posComp.y;
    const beamHalfWidth = pseudopodComp.width / 2;

    let hitSomething = false;

    // Check collision with pre-collected players (squared distance)
    for (const target of playerTargets) {
      if (target.playerId === pseudopodComp.ownerSocketId) continue;
      if (hitEntities.has(target.entity)) continue;
      if (target.isStunned) continue;

      const dx = beamX - target.x;
      const dy = beamY - target.y;
      const distSq = dx * dx + dy * dy;
      const collisionDist = beamHalfWidth + target.radius;
      const collisionDistSq = collisionDist * collisionDist;

      if (distSq < collisionDistSq) {
        const damage = getConfig('PSEUDOPOD_DRAIN_RATE');
        target.energyComp.current -= damage;
        hitSomething = true;
        hitEntities.add(target.entity);

        const damageTracking = getDamageTracking(world, target.entity);
        if (damageTracking) {
          damageTracking.lastDamageSource = 'beam';
          damageTracking.lastBeamShooter = pseudopodComp.ownerSocketId;
          damageTracking.pseudopodHitRate = damage;
          damageTracking.pseudopodHitExpiresAt = Date.now() + 1500;
        }

        logger.info({
          event: 'beam_hit',
          shooter: pseudopodComp.ownerSocketId,
          target: target.playerId,
          damage,
          targetEnergyRemaining: target.energyComp.current.toFixed(0),
        });

        io.emit('pseudopodHit', {
          type: 'pseudopodHit',
          beamId,
          targetId: target.playerId,
          hitPosition: { x: beamX, y: beamY },
        });
      }
    }

    // Check collision with pre-collected swarms (squared distance)
    // DeathSystem handles swarm deaths centrally

    for (const swarm of swarmTargets) {
      if (hitEntities.has(swarm.entity)) continue;

      const dx = beamX - swarm.x;
      const dy = beamY - swarm.y;
      const distSq = dx * dx + dy * dy;
      const collisionDist = beamHalfWidth + swarm.size;
      const collisionDistSq = collisionDist * collisionDist;

      if (distSq < collisionDistSq) {
        const damage = getConfig('PSEUDOPOD_DRAIN_RATE');
        swarm.energyComp.current -= damage;
        hitSomething = true;
        hitEntities.add(swarm.entity);

        // Also drain/transfer max energy (75% of current drain rate)
        const maxDrain = damage * 0.75;
        const actualMaxDrain = Math.min(maxDrain, swarm.energyComp.max);
        swarm.energyComp.max -= actualMaxDrain;
        shooterEnergy.max += actualMaxDrain;

        // Set damage tracking so DeathSystem knows who killed it
        const damageTracking = world.getComponent<DamageTrackingComponent>(
          swarm.entity,
          Components.DamageTracking
        );
        if (damageTracking) {
          damageTracking.lastDamageSource = 'beam';
          damageTracking.lastBeamShooter = pseudopodComp.ownerSocketId;
        }

        logger.info({
          event: 'beam_hit_swarm',
          shooter: pseudopodComp.ownerSocketId,
          swarmId: swarm.swarmId,
          damage,
          maxDrained: actualMaxDrain.toFixed(1),
          swarmEnergyRemaining: swarm.energyComp.current.toFixed(0),
        });
      }
    }

    return hitSomething;
  }
}
