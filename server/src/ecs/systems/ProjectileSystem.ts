// ============================================
// Projectile System
// Handles Stage 3 ranged specialization projectile movement and collision
// Targets CyberBugs, JungleCreatures, and other jungle-scale players
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Tags, type World, Components } from '#shared';
import type {
  PositionComponent,
  VelocityComponent,
  ProjectileComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  EntropySerpentComponent,
  PlayerComponent,
  EnergyComponent,
  EntityId,
} from '#shared';
import type { System } from './types';
import {
  getStringIdByEntity,
  getEntityBySocketId,
  destroyEntity,
  addEnergy,
  setMaxEnergy,
  getEnergy,
  getPosition,
  getStage,
  subtractEnergy,
} from '../factories';
import { distance } from '../../helpers';
import { isJungleStage } from '../../helpers/stages';
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
    // Use for...of with break for true early exit (forEach can't break)
    let bugToKill: { entity: EntityId; id: string; pos: { x: number; y: number } } | null = null;

    const bugEntities = world.getEntitiesWithTag(Tags.CyberBug);
    for (const bugEntity of bugEntities) {
      const bugPos = world.getComponent<PositionComponent>(bugEntity, Components.Position);
      const bugComp = world.getComponent<CyberBugComponent>(bugEntity, Components.CyberBug);
      const bugId = getStringIdByEntity(bugEntity);
      if (!bugPos || !bugComp || !bugId) continue;

      const bugPosition = { x: bugPos.x, y: bugPos.y };
      const dist = distance(projectilePos, bugPosition);
      const hitDist = collisionRadius + bugComp.size;

      if (dist < hitDist) {
        projComp.hitEntityId = bugEntity;
        bugToKill = { entity: bugEntity, id: bugId, pos: bugPosition };
        break; // True early exit
      }
    }

    // Process bug kill
    if (bugToKill) {
      const bugComp = world.getComponent<CyberBugComponent>(bugToKill.entity, Components.CyberBug);
      const shooterEntity = getEntityBySocketId(projComp.ownerSocketId);
      if (bugComp && shooterEntity) {
        // Award energy and capacity to shooter (entity-based)
        addEnergy(world, shooterEntity, bugComp.value);
        const shooterEnergy = getEnergy(world, shooterEntity);
        if (shooterEnergy) {
          setMaxEnergy(world, shooterEntity, shooterEnergy.max + bugComp.capacityIncrease);
        }

        // Emit kill event
        io.emit('cyberBugKilled', {
          type: 'cyberBugKilled',
          bugId: bugToKill.id,
          killerId: projComp.ownerSocketId,
          position: bugToKill.pos,
          energyGained: bugComp.value,
          capacityGained: bugComp.capacityIncrease,
        });

        io.emit('projectileHit', {
          type: 'projectileHit',
          projectileId,
          targetId: bugToKill.id,
          targetType: 'cyberbug',
          hitPosition: bugToKill.pos,
          damage: projComp.damage,
          killed: true,
        });

        logger.info({
          event: isBot(projComp.ownerSocketId)
            ? 'bot_projectile_kill_bug'
            : 'player_projectile_kill_bug',
          shooter: projComp.ownerSocketId,
          bugId: bugToKill.id,
          energyGained: bugComp.value,
          capacityGained: bugComp.capacityIncrease,
        });

        // Destroy the bug
        destroyEntity(world, bugToKill.entity);
      }
      return true;
    }

    // Check JungleCreatures
    // Use for...of with break for true early exit
    let creatureToKill: { entity: EntityId; id: string; pos: { x: number; y: number } } | null =
      null;

    const creatureEntities = world.getEntitiesWithTag(Tags.JungleCreature);
    for (const creatureEntity of creatureEntities) {
      const creaturePos = world.getComponent<PositionComponent>(
        creatureEntity,
        Components.Position
      );
      const creatureComp = world.getComponent<JungleCreatureComponent>(
        creatureEntity,
        Components.JungleCreature
      );
      const creatureId = getStringIdByEntity(creatureEntity);
      if (!creaturePos || !creatureComp || !creatureId) continue;

      const creaturePosition = { x: creaturePos.x, y: creaturePos.y };
      const dist = distance(projectilePos, creaturePosition);
      const hitDist = collisionRadius + creatureComp.size;

      if (dist < hitDist) {
        projComp.hitEntityId = creatureEntity;
        creatureToKill = { entity: creatureEntity, id: creatureId, pos: creaturePosition };
        break; // True early exit
      }
    }

    // Process creature kill
    if (creatureToKill) {
      const creatureComp = world.getComponent<JungleCreatureComponent>(
        creatureToKill.entity,
        Components.JungleCreature
      );
      const shooterEntity2 = getEntityBySocketId(projComp.ownerSocketId);
      if (creatureComp && shooterEntity2) {
        // Award energy and capacity to shooter (entity-based)
        addEnergy(world, shooterEntity2, creatureComp.value);
        const shooterEnergy2 = getEnergy(world, shooterEntity2);
        if (shooterEnergy2) {
          setMaxEnergy(world, shooterEntity2, shooterEnergy2.max + creatureComp.capacityIncrease);
        }

        // Emit kill event
        io.emit('jungleCreatureKilled', {
          type: 'jungleCreatureKilled',
          creatureId: creatureToKill.id,
          killerId: projComp.ownerSocketId,
          position: creatureToKill.pos,
          energyGained: creatureComp.value,
          capacityGained: creatureComp.capacityIncrease,
        });

        io.emit('projectileHit', {
          type: 'projectileHit',
          projectileId,
          targetId: creatureToKill.id,
          targetType: 'junglecreature',
          hitPosition: creatureToKill.pos,
          damage: projComp.damage,
          killed: true,
        });

        logger.info({
          event: isBot(projComp.ownerSocketId)
            ? 'bot_projectile_kill_creature'
            : 'player_projectile_kill_creature',
          shooter: projComp.ownerSocketId,
          creatureId: creatureToKill.id,
          variant: creatureComp.variant,
          energyGained: creatureComp.value,
          capacityGained: creatureComp.capacityIncrease,
        });

        // Destroy the creature
        destroyEntity(world, creatureToKill.entity);
      }
      return true;
    }

    // Check EntropySerpents (apex predators - can be damaged but not instantly killed)
    let serpentHit: { entity: EntityId; id: string; pos: { x: number; y: number } } | null = null;

    const serpentEntities = world.getEntitiesWithTag(Tags.EntropySerpent);
    for (const serpentEntity of serpentEntities) {
      const serpentPos = world.getComponent<PositionComponent>(serpentEntity, Components.Position);
      const serpentComp = world.getComponent<EntropySerpentComponent>(
        serpentEntity,
        Components.EntropySerpent
      );
      const serpentId = getStringIdByEntity(serpentEntity);
      if (!serpentPos || !serpentComp || !serpentId) continue;

      const serpentPosition = { x: serpentPos.x, y: serpentPos.y };
      const dist = distance(projectilePos, serpentPosition);
      const hitDist = collisionRadius + serpentComp.size;

      if (dist < hitDist) {
        projComp.hitEntityId = serpentEntity;
        serpentHit = { entity: serpentEntity, id: serpentId, pos: serpentPosition };
        break;
      }
    }

    // Process serpent hit (damage but don't destroy - AI system handles death)
    if (serpentHit) {
      const serpentEnergy = world.getComponent<EnergyComponent>(
        serpentHit.entity,
        Components.Energy
      );
      if (serpentEnergy) {
        serpentEnergy.current = Math.max(0, serpentEnergy.current - projComp.damage);

        io.emit('entropySerpentDamaged', {
          type: 'entropySerpentDamaged',
          serpentId: serpentHit.id,
          damage: projComp.damage,
          currentEnergy: serpentEnergy.current,
          attackerId: projComp.ownerSocketId,
        });

        io.emit('projectileHit', {
          type: 'projectileHit',
          projectileId,
          targetId: serpentHit.id,
          targetType: 'serpent',
          hitPosition: serpentHit.pos,
          damage: projComp.damage,
          killed: serpentEnergy.current <= 0,
        });

        logger.info({
          event: isBot(projComp.ownerSocketId)
            ? 'bot_projectile_hit_serpent'
            : 'player_projectile_hit_serpent',
          shooter: projComp.ownerSocketId,
          serpentId: serpentHit.id,
          damage: projComp.damage,
          serpentEnergyRemaining: serpentEnergy.current,
        });
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

    // Use for...of with break for true early exit
    let hitPlayerData: {
      socketId: string;
      pos: { x: number; y: number };
      damage: number;
      killed: boolean;
      entity: EntityId;
    } | null = null;

    const playerEntities = world.getEntitiesWithTag(Tags.Player);
    for (const playerEntity of playerEntities) {
      const playerComp = world.getComponent<PlayerComponent>(playerEntity, Components.Player);
      if (!playerComp) continue;
      const socketId = playerComp.socketId;

      // Skip the projectile owner
      if (socketId === projComp.ownerSocketId) continue;

      // Only hit jungle-scale players (Stage 3+) - use entity-based helpers
      const stage = getStage(world, playerEntity);
      if (!stage || !isJungleStage(stage.stage)) continue;

      // Get player position (entity-based)
      const playerPos = getPosition(world, playerEntity);
      if (!playerPos) continue;

      const playerPosition = { x: playerPos.x, y: playerPos.y };
      const playerRadius = stage.radius;
      const dist = distance(projectilePos, playerPosition);
      const hitDist = collisionRadius + playerRadius;

      if (dist < hitDist) {
        projComp.hitEntityId = playerEntity;

        // Apply damage to target player (entity-based)
        const targetEnergy = getEnergy(world, playerEntity);
        if (targetEnergy) {
          const newEnergy = Math.max(0, targetEnergy.current - projComp.damage);
          subtractEnergy(world, playerEntity, projComp.damage);

          hitPlayerData = {
            socketId,
            pos: playerPosition,
            damage: projComp.damage,
            killed: newEnergy <= 0,
            entity: playerEntity,
          };
        }
        break; // True early exit
      }
    }

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
        event: isBot(projComp.ownerSocketId)
          ? 'bot_projectile_hit_player'
          : 'player_projectile_hit_player',
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
