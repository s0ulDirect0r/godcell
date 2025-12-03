// ============================================
// Projectile System
// Handles Stage 3 ranged specialization projectile movement and collision
// Targets CyberBugs, JungleCreatures, and other jungle-scale players
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Tags, type World, Components } from '@godcell/shared';
import type {
  PositionComponent,
  VelocityComponent,
  ProjectileComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  StageComponent,
  EnergyComponent,
  EntityId,
} from '@godcell/shared';
import type { System } from './types';
import {
  getStringIdByEntity,
  destroyEntity,
  forEachCyberBug,
  forEachJungleCreature,
  forEachPlayer,
  addEnergyBySocketId,
  setMaxEnergyBySocketId,
  getEnergyBySocketId,
  getPositionBySocketId,
  getStageBySocketId,
  subtractEnergyBySocketId,
} from '../factories';
import { distance } from '../../helpers';
import { isJungleStage, getPlayerRadius } from '../../helpers/stages';
import { logger } from '../../logger';
import { isBot } from '../../bots';

/**
 * ProjectileSystem - Manages Stage 3 ranged specialization attack projectiles
 *
 * Handles:
 * - Projectile movement
 * - Collision detection with CyberBugs and JungleCreatures
 * - Damage application and kill rewards
 */
export class ProjectileSystem implements System {
  readonly name = 'ProjectileSystem';

  update(world: World, deltaTime: number, io: Server): void {
    const toRemove: EntityId[] = [];

    // Iterate projectile entities
    world.forEachWithTag(Tags.Projectile, (entity) => {
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const projComp = world.getComponent<ProjectileComponent>(entity, Components.Projectile);
      if (!posComp || !velComp || !projComp) return;

      const projectileId = getStringIdByEntity(entity);
      if (!projectileId) return;

      // Skip if already hit or missed
      if (projComp.state !== 'traveling') {
        toRemove.push(entity);
        return;
      }

      // Move projectile
      const travelDist = Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y) * deltaTime;
      posComp.x += velComp.x * deltaTime;
      posComp.y += velComp.y * deltaTime;
      projComp.distanceTraveled += travelDist;

      // Check if projectile exceeded max distance
      if (projComp.distanceTraveled >= projComp.maxDistance) {
        projComp.state = 'missed';
        toRemove.push(entity);
        io.emit('projectileRetracted', {
          type: 'projectileRetracted',
          projectileId,
        });
        return;
      }

      // Check collision with players first (PvP), then fauna
      let hit = this.checkPlayerCollision(world, io, projectileId, posComp, projComp);
      if (!hit) {
        hit = this.checkFaunaCollision(world, io, entity, projectileId, posComp, projComp);
      }
      if (hit) {
        projComp.state = 'hit';
        toRemove.push(entity);
      }
    });

    // Remove finished projectiles
    for (const entity of toRemove) {
      destroyEntity(world, entity);
    }
  }

  /**
   * Check projectile collision with CyberBugs and JungleCreatures
   */
  private checkFaunaCollision(
    world: World,
    io: Server,
    _projectileEntity: EntityId,
    projectileId: string,
    posComp: PositionComponent,
    projComp: ProjectileComponent
  ): boolean {
    const projectilePos = { x: posComp.x, y: posComp.y };
    const collisionRadius = GAME_CONFIG.PROJECTILE_COLLISION_RADIUS;

    // Check CyberBugs first (smaller, easier to hit)
    let hitBug = false;
    const bugsToKill: { entity: EntityId; id: string; pos: { x: number; y: number } }[] = [];

    forEachCyberBug(world, (bugEntity, bugId, bugPos, bugComp) => {
      if (hitBug) return; // Only hit one target per projectile

      const bugPosition = { x: bugPos.x, y: bugPos.y };
      const dist = distance(projectilePos, bugPosition);
      const hitDist = collisionRadius + bugComp.size;

      if (dist < hitDist) {
        hitBug = true;
        projComp.hitEntityId = bugEntity;
        bugsToKill.push({ entity: bugEntity, id: bugId, pos: bugPosition });
      }
    });

    // Process bug kill
    if (bugsToKill.length > 0) {
      const bug = bugsToKill[0];
      const bugComp = world.getComponent<CyberBugComponent>(bug.entity, Components.CyberBug);
      if (bugComp) {
        // Award energy and capacity to shooter
        addEnergyBySocketId(world, projComp.ownerSocketId, bugComp.value);
        const shooterEnergy = getEnergyBySocketId(world, projComp.ownerSocketId);
        if (shooterEnergy) {
          setMaxEnergyBySocketId(world, projComp.ownerSocketId, shooterEnergy.max + bugComp.capacityIncrease);
        }

        // Emit kill event
        io.emit('cyberBugKilled', {
          type: 'cyberBugKilled',
          bugId: bug.id,
          killerId: projComp.ownerSocketId,
          position: bug.pos,
          energyGained: bugComp.value,
          capacityGained: bugComp.capacityIncrease,
        });

        io.emit('projectileHit', {
          type: 'projectileHit',
          projectileId,
          targetId: bug.id,
          targetType: 'cyberbug',
          hitPosition: bug.pos,
          damage: projComp.damage,
          killed: true,
        });

        logger.info({
          event: 'projectile_kill_bug',
          shooter: projComp.ownerSocketId,
          bugId: bug.id,
          energyGained: bugComp.value,
          capacityGained: bugComp.capacityIncrease,
        });

        // Destroy the bug
        destroyEntity(world, bug.entity);
      }
      return true;
    }

    // Check JungleCreatures
    let hitCreature = false;
    const creaturesToDamage: {
      entity: EntityId;
      id: string;
      pos: { x: number; y: number };
      killed: boolean;
    }[] = [];

    forEachJungleCreature(world, (creatureEntity, creatureId, creaturePos, creatureComp) => {
      if (hitCreature) return;

      const creaturePosition = { x: creaturePos.x, y: creaturePos.y };
      const dist = distance(projectilePos, creaturePosition);
      const hitDist = collisionRadius + creatureComp.size;

      if (dist < hitDist) {
        hitCreature = true;
        projComp.hitEntityId = creatureEntity;

        // JungleCreatures have health via EnergyComponent (if we add it)
        // For now, one-shot kill like bugs
        creaturesToDamage.push({
          entity: creatureEntity,
          id: creatureId,
          pos: creaturePosition,
          killed: true, // One-shot for now
        });
      }
    });

    // Process creature damage/kill
    if (creaturesToDamage.length > 0) {
      const creature = creaturesToDamage[0];
      const creatureComp = world.getComponent<JungleCreatureComponent>(creature.entity, Components.JungleCreature);
      if (creatureComp) {
        // Award energy and capacity to shooter
        addEnergyBySocketId(world, projComp.ownerSocketId, creatureComp.value);
        const shooterEnergy2 = getEnergyBySocketId(world, projComp.ownerSocketId);
        if (shooterEnergy2) {
          setMaxEnergyBySocketId(world, projComp.ownerSocketId, shooterEnergy2.max + creatureComp.capacityIncrease);
        }

        // Emit kill event
        io.emit('jungleCreatureKilled', {
          type: 'jungleCreatureKilled',
          creatureId: creature.id,
          killerId: projComp.ownerSocketId,
          position: creature.pos,
          energyGained: creatureComp.value,
          capacityGained: creatureComp.capacityIncrease,
        });

        io.emit('projectileHit', {
          type: 'projectileHit',
          projectileId,
          targetId: creature.id,
          targetType: 'junglecreature',
          hitPosition: creature.pos,
          damage: projComp.damage,
          killed: true,
        });

        logger.info({
          event: 'projectile_kill_creature',
          shooter: projComp.ownerSocketId,
          creatureId: creature.id,
          variant: creatureComp.variant,
          energyGained: creatureComp.value,
          capacityGained: creatureComp.capacityIncrease,
        });

        // Destroy the creature
        destroyEntity(world, creature.entity);
      }
      return true;
    }

    return false;
  }

  /**
   * Check projectile collision with other jungle-scale players (PvP)
   * Skips the projectile owner and non-jungle-stage players
   */
  private checkPlayerCollision(
    world: World,
    io: Server,
    projectileId: string,
    posComp: PositionComponent,
    projComp: ProjectileComponent
  ): boolean {
    const projectilePos = { x: posComp.x, y: posComp.y };
    const collisionRadius = GAME_CONFIG.PROJECTILE_COLLISION_RADIUS;

    let hitPlayer = false;
    let hitPlayerData: {
      socketId: string;
      pos: { x: number; y: number };
      damage: number;
      killed: boolean;
      entity: EntityId;
    } | null = null;

    forEachPlayer(world, (playerEntity, socketId) => {
      if (hitPlayer) return; // Only hit one target per projectile

      // Skip the projectile owner
      if (socketId === projComp.ownerSocketId) return;

      // Only hit jungle-scale players (Stage 3+)
      const stage = getStageBySocketId(world, socketId);
      if (!stage || !isJungleStage(stage.stage)) return;

      // Get player position
      const playerPos = getPositionBySocketId(world, socketId);
      if (!playerPos) return;

      const playerPosition = { x: playerPos.x, y: playerPos.y };
      const playerRadius = getPlayerRadius(stage.stage);
      const dist = distance(projectilePos, playerPosition);
      const hitDist = collisionRadius + playerRadius;

      if (dist < hitDist) {
        hitPlayer = true;
        projComp.hitEntityId = playerEntity;

        // Apply damage to target player
        const targetEnergy = getEnergyBySocketId(world, socketId);
        if (targetEnergy) {
          const newEnergy = Math.max(0, targetEnergy.current - projComp.damage);
          subtractEnergyBySocketId(world, socketId, projComp.damage);

          hitPlayerData = {
            socketId,
            pos: playerPosition,
            damage: projComp.damage,
            killed: newEnergy <= 0,
            entity: playerEntity,
          };
        }
      }
    });

    // Process player hit
    if (hitPlayerData) {
      const { socketId, pos, damage, killed } = hitPlayerData;

      io.emit('projectileHit', {
        type: 'projectileHit',
        projectileId,
        targetId: socketId,
        targetType: 'player',
        hitPosition: pos,
        damage,
        killed,
      });

      logger.info({
        event: isBot(projComp.ownerSocketId) ? 'bot_projectile_hit_player' : 'player_projectile_hit_player',
        shooter: projComp.ownerSocketId,
        targetId: socketId,
        damage,
        killed,
      });

      // Note: Death handling is done by DeathSystem when energy reaches 0

      return true;
    }

    return false;
  }
}
