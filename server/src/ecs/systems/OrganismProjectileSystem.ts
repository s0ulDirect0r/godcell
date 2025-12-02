// ============================================
// Organism Projectile System
// Handles Stage 3 projectile movement and collision with fauna
// Cloned from PseudopodSystem, targets CyberBugs and JungleCreatures
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Tags, type World, Components } from '@godcell/shared';
import type {
  PositionComponent,
  VelocityComponent,
  OrganismProjectileComponent,
  EnergyComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  EntityId,
} from '@godcell/shared';
import type { System } from './types';
import {
  getStringIdByEntity,
  destroyEntity,
  forEachCyberBug,
  forEachJungleCreature,
  getEntityBySocketId,
  addEnergyBySocketId,
  setMaxEnergyBySocketId,
  getEnergyBySocketId,
} from '../factories';
import { distance } from '../../helpers';
import { logger } from '../../logger';

/**
 * OrganismProjectileSystem - Manages Stage 3 attack projectiles
 *
 * Handles:
 * - Projectile movement
 * - Collision detection with CyberBugs and JungleCreatures
 * - Damage application and kill rewards
 */
export class OrganismProjectileSystem implements System {
  readonly name = 'OrganismProjectileSystem';

  update(world: World, deltaTime: number, io: Server): void {
    const toRemove: EntityId[] = [];

    // Iterate organism projectile entities
    world.forEachWithTag(Tags.OrganismProjectile, (entity) => {
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const projComp = world.getComponent<OrganismProjectileComponent>(entity, Components.OrganismProjectile);
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
        io.emit('organismProjectileRetracted', {
          type: 'organismProjectileRetracted',
          projectileId,
        });
        return;
      }

      // Check collision with fauna
      const hit = this.checkFaunaCollision(world, io, entity, projectileId, posComp, projComp);
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
    projComp: OrganismProjectileComponent
  ): boolean {
    const projectilePos = { x: posComp.x, y: posComp.y };
    const collisionRadius = GAME_CONFIG.ORGANISM_PROJECTILE_COLLISION_RADIUS;

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

        io.emit('organismProjectileHit', {
          type: 'organismProjectileHit',
          projectileId,
          targetId: bug.id,
          targetType: 'cyberbug',
          hitPosition: bug.pos,
          damage: projComp.damage,
          killed: true,
        });

        logger.info({
          event: 'organism_projectile_kill_bug',
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

        io.emit('organismProjectileHit', {
          type: 'organismProjectileHit',
          projectileId,
          targetId: creature.id,
          targetType: 'junglecreature',
          hitPosition: creature.pos,
          damage: projComp.damage,
          killed: true,
        });

        logger.info({
          event: 'organism_projectile_kill_creature',
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
}
