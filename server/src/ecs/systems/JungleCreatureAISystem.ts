// ============================================
// JungleCreature AI System
// Handles Stage 3 JungleCreature AI behavior
// Creatures have variant-specific behavior: grazer, stalker, ambusher
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Components, distance, type World } from '#shared';
import type {
  PositionComponent,
  VelocityComponent,
  JungleCreatureComponent,
  StageComponent,
  EnergyComponent,
  EntityId,
  JungleCreatureMovedMessage,
  StunnedComponent,
} from '#shared';
import type { System } from './types';
import {
  forEachJungleCreature,
  forEachTree,
  forEachPlayer,
  addEnergy,
  getDamageTracking,
  recordDamage,
} from '../factories';
import { processCreatureRespawns } from '../../jungleFauna';
import { isJungleStage } from '../../helpers/stages';

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a random patrol target within territory radius
 */
function generatePatrolTarget(
  homePosition: { x: number; y: number },
  territoryRadius: number
): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * territoryRadius;
  return {
    x: homePosition.x + Math.cos(angle) * radius,
    y: homePosition.y + Math.sin(angle) * radius,
  };
}

/**
 * Find the nearest jungle-stage player within aggression range
 */
function findNearestTarget(
  creaturePosition: { x: number; y: number },
  aggressionRange: number,
  world: World
): { entityId: EntityId; socketId: string; position: { x: number; y: number } } | null {
  let nearestTarget: {
    entityId: EntityId;
    socketId: string;
    position: { x: number; y: number };
  } | null = null;
  let nearestDist = aggressionRange;

  forEachPlayer(world, (entity, playerId) => {
    const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
    const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
    const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
    if (!energyComp || !posComp || !stageComp) return;

    // Skip dead players and evolving players
    if (energyComp.current <= 0 || stageComp.isEvolving) return;

    // JungleCreatures only target jungle-stage players (Stage 3+)
    if (!isJungleStage(stageComp.stage)) return;

    const playerPosition = { x: posComp.x, y: posComp.y };
    const dist = distance(creaturePosition, playerPosition);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestTarget = { entityId: entity, socketId: playerId, position: playerPosition };
    }
  });

  return nearestTarget;
}

/**
 * JungleCreatureAISystem - Manages AI for JungleCreatures
 *
 * Variant behaviors:
 * - grazer: Passive, patrols territory, flees when damaged (NYI: damage tracking)
 * - stalker: Actively hunts players that enter aggression range
 * - ambusher: Waits idle, then attacks when player gets very close
 */
export class JungleCreatureAISystem implements System {
  readonly name = 'JungleCreatureAISystem';

  update(world: World, deltaTime: number, io: Server): void {
    forEachJungleCreature(world, (entity, _creatureId, posComp, creatureComp) => {
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!velComp) return;

      const stun = world.getComponent<StunnedComponent>(entity, Components.Stunned);
      if (stun && Date.now() < stun.until) {
        velComp.x = velComp.y = 0;
        return;
      }
      // Dispatch to variant-specific behavior
      switch (creatureComp.variant) {
        case 'grazer':
          this.updateGrazer(world, deltaTime, entity, posComp, velComp, creatureComp);
          break;
        case 'stalker':
          this.updateStalker(world, deltaTime, io, entity, posComp, velComp, creatureComp);
          break;
        case 'ambusher':
          this.updateAmbusher(world, deltaTime, io, entity, posComp, velComp, creatureComp);
          break;
      }
    });

    // Update positions based on velocity and broadcast to clients
    this.updatePositions(world, deltaTime, io);

    // Process pending creature respawns
    processCreatureRespawns(world, io);
  }

  /**
   * Grazer behavior: Passive patrol, never attacks
   * Just wanders around territory peacefully
   */
  private updateGrazer(
    world: World,
    deltaTime: number,
    entity: EntityId,
    posComp: PositionComponent,
    velComp: VelocityComponent,
    creatureComp: JungleCreatureComponent
  ): void {
    const now = Date.now();
    const threat =
      creatureComp.targetEntityId !== undefined
        ? world.getComponent<PositionComponent>(creatureComp.targetEntityId, Components.Position)
        : undefined;
    let tx: number, ty: number;
    if (threat && now < (creatureComp.hurtUntil ?? 0)) {
      creatureComp.state = 'flee';
      const dx = posComp.x - threat.x,
        dy = posComp.y - threat.y,
        dist = Math.hypot(dx, dy) || 1;
      tx = posComp.x + (dx / dist) * 400;
      ty = posComp.y + (dy / dist) * 400;
      // A wounded grazer circles its feeding ground instead of fleeing forever.
      if (
        Math.hypot(
          posComp.x - creatureComp.homePosition.x,
          posComp.y - creatureComp.homePosition.y
        ) > 700
      ) {
        tx = creatureComp.homePosition.x;
        ty = creatureComp.homePosition.y;
      }
    } else {
      creatureComp.state = 'patrol';
      if (!creatureComp.patrolTarget || distance(posComp, creatureComp.patrolTarget) < 40)
        creatureComp.patrolTarget = generatePatrolTarget(creatureComp.homePosition, 300);
      tx = creatureComp.patrolTarget.x;
      ty = creatureComp.patrolTarget.y;
    }
    const dx = tx - posComp.x,
      dy = ty - posComp.y,
      dist = Math.hypot(dx, dy) || 1;
    const speed = creatureComp.state === 'flee' ? 230 : 65;
    const blend = 1 - Math.exp(-deltaTime * 5);
    velComp.x += ((dx / dist) * speed - velComp.x) * blend;
    velComp.y += ((dy / dist) * speed - velComp.y) * blend;
  }

  /**
   * Stalker behavior: Actively hunts players in aggression range
   */
  private updateStalker(
    world: World,
    deltaTime: number,
    io: Server,
    entity: EntityId,
    posComp: PositionComponent,
    velComp: VelocityComponent,
    creatureComp: JungleCreatureComponent
  ): void {
    const creaturePosition = { x: posComp.x, y: posComp.y };
    const aggressionRange =
      creatureComp.aggressionRange ?? GAME_CONFIG.JUNGLE_CREATURE_AGGRO_RADIUS;

    // Look for nearby targets
    const target = findNearestTarget(creaturePosition, aggressionRange, world);

    if (target) {
      // HUNT: Player detected within aggression range
      if (creatureComp.state !== 'hunt' || creatureComp.targetEntityId !== target.entityId) {
        creatureComp.state = 'hunt';
        creatureComp.targetEntityId = target.entityId;
      }

      // Calculate direction toward player
      const dx = target.position.x - creaturePosition.x;
      const dy = target.position.y - creaturePosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        // Chase at full speed
        const acceleration = GAME_CONFIG.JUNGLE_CREATURE_SPEED * 8;
        velComp.x += (dx / dist) * acceleration * deltaTime;
        velComp.y += (dy / dist) * acceleration * deltaTime;
      }

      // Check for melee contact damage
      if (dist < creatureComp.size + GAME_CONFIG.JUNGLE_CREATURE_COLLISION_RADIUS) {
        this.dealContactDamage(
          world,
          io,
          target.entityId,
          target.socketId,
          creatureComp,
          deltaTime
        );
      }
    } else {
      // No target - patrol territory
      if (creatureComp.state === 'hunt') {
        creatureComp.state = 'patrol';
        creatureComp.targetEntityId = undefined;
      }

      this.doPatrol(world, deltaTime, posComp, velComp, creatureComp);
    }

    // Clamp speed
    const velocityMagnitude = Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y);
    const maxSpeed =
      creatureComp.state === 'hunt'
        ? GAME_CONFIG.JUNGLE_CREATURE_SPEED * 1.2
        : GAME_CONFIG.JUNGLE_CREATURE_SPEED * 0.6;

    if (velocityMagnitude > maxSpeed) {
      velComp.x = (velComp.x / velocityMagnitude) * maxSpeed;
      velComp.y = (velComp.y / velocityMagnitude) * maxSpeed;
    }
  }

  /**
   * Ambusher behavior: Waits idle, attacks when player gets very close
   */
  private updateAmbusher(
    world: World,
    deltaTime: number,
    io: Server,
    entity: EntityId,
    posComp: PositionComponent,
    velComp: VelocityComponent,
    creatureComp: JungleCreatureComponent
  ): void {
    const creaturePosition = { x: posComp.x, y: posComp.y };
    // Ambushers have shorter aggression range but attack suddenly
    const aggressionRange =
      (creatureComp.aggressionRange ?? GAME_CONFIG.JUNGLE_CREATURE_AGGRO_RADIUS) * 0.5;

    // Look for nearby targets (shorter range than stalkers)
    const target = findNearestTarget(creaturePosition, aggressionRange, world);

    if (target) {
      // HUNT: Spring the ambush!
      if (creatureComp.state !== 'hunt') {
        creatureComp.state = 'hunt';
        creatureComp.targetEntityId = target.entityId;
      }

      // Calculate direction toward player
      const dx = target.position.x - creaturePosition.x;
      const dy = target.position.y - creaturePosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        // Chase at high speed (ambush burst)
        const acceleration = GAME_CONFIG.JUNGLE_CREATURE_SPEED * 12;
        velComp.x += (dx / dist) * acceleration * deltaTime;
        velComp.y += (dy / dist) * acceleration * deltaTime;
      }

      // Check for melee contact damage
      if (dist < creatureComp.size + GAME_CONFIG.JUNGLE_CREATURE_COLLISION_RADIUS) {
        this.dealContactDamage(
          world,
          io,
          target.entityId,
          target.socketId,
          creatureComp,
          deltaTime
        );
      }
    } else {
      // No target - wait in ambush position (mostly idle)
      if (creatureComp.state === 'hunt') {
        creatureComp.state = 'idle';
        creatureComp.targetEntityId = undefined;
      }

      // Ambushers mostly stay still
      velComp.x *= 0.8;
      velComp.y *= 0.8;

      // Occasionally reposition slightly within territory
      if (Math.random() < 0.005) {
        const target = generatePatrolTarget(
          creatureComp.homePosition,
          creatureComp.territoryRadius * 0.3
        );
        const dx = target.x - creaturePosition.x;
        const dy = target.y - creaturePosition.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          const acceleration = GAME_CONFIG.JUNGLE_CREATURE_SPEED * 2;
          velComp.x += (dx / dist) * acceleration * deltaTime;
          velComp.y += (dy / dist) * acceleration * deltaTime;
        }
      }
    }

    // Clamp speed (ambushers are fast when attacking)
    const velocityMagnitude = Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y);
    const maxSpeed =
      creatureComp.state === 'hunt'
        ? GAME_CONFIG.JUNGLE_CREATURE_SPEED * 1.5
        : GAME_CONFIG.JUNGLE_CREATURE_SPEED * 0.3;

    if (velocityMagnitude > maxSpeed) {
      velComp.x = (velComp.x / velocityMagnitude) * maxSpeed;
      velComp.y = (velComp.y / velocityMagnitude) * maxSpeed;
    }
  }

  /**
   * Common patrol behavior for non-hunting creatures
   */
  private doPatrol(
    world: World,
    deltaTime: number,
    posComp: PositionComponent,
    velComp: VelocityComponent,
    creatureComp: JungleCreatureComponent
  ): void {
    const creaturePosition = { x: posComp.x, y: posComp.y };

    // Check distance from home and wander toward a random point
    const distFromHome = distance(creaturePosition, creatureComp.homePosition);

    if (distFromHome > creatureComp.territoryRadius) {
      // Too far from home, return
      const dx = creatureComp.homePosition.x - creaturePosition.x;
      const dy = creatureComp.homePosition.y - creaturePosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        const acceleration = GAME_CONFIG.JUNGLE_CREATURE_SPEED * 6;
        velComp.x += (dx / dist) * acceleration * deltaTime;
        velComp.y += (dy / dist) * acceleration * deltaTime;
      }
    } else {
      // Wander randomly within territory
      if (Math.random() < 0.02) {
        const target = generatePatrolTarget(
          creatureComp.homePosition,
          creatureComp.territoryRadius
        );
        const dx = target.x - creaturePosition.x;
        const dy = target.y - creaturePosition.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          const acceleration = GAME_CONFIG.JUNGLE_CREATURE_SPEED * 4;
          velComp.x += (dx / dist) * acceleration * deltaTime;
          velComp.y += (dy / dist) * acceleration * deltaTime;
        }
      }
    }

    // Apply friction while patrolling
    velComp.x *= 0.95;
    velComp.y *= 0.95;
  }

  /**
   * Deal contact damage to player (energy drain)
   */
  private dealContactDamage(
    world: World,
    io: Server,
    targetEntity: EntityId,
    targetSocketId: string,
    creatureComp: JungleCreatureComponent,
    deltaTime: number
  ): void {
    // Drain energy over time (per-second rate scaled by deltaTime)
    const damagePerSecond = GAME_CONFIG.JUNGLE_CREATURE_DAMAGE_RATE;
    const damage = damagePerSecond * deltaTime;

    // Use negative energy to drain (entity-based)
    addEnergy(world, targetEntity, -damage);

    // Track damage source for death cause (entity-based)
    // Use 'predation' since it's the closest match for creature contact attacks
    const damageTracking = getDamageTracking(world, targetEntity);
    if (damageTracking) {
      damageTracking.lastDamageSource = 'predation';
    }

    // Record damage for drain aura system (melee = creature contact)
    recordDamage(world, targetEntity, damagePerSecond, 'melee');

    // Emit damage event for client feedback
    io.emit('jungleCreatureDamage', {
      type: 'jungleCreatureDamage',
      targetId: targetSocketId,
      variant: creatureComp.variant,
      damage: damage,
    });
  }

  /**
   * Update creature positions based on velocity and broadcast to clients
   * Creatures are clamped to jungle region bounds
   */
  private updatePositions(world: World, deltaTime: number, io: Server): void {
    // JungleCreatures live in the jungle region (jungle starts at 0,0)
    const jungleMinX = 0;
    const jungleMaxX = GAME_CONFIG.JUNGLE_WIDTH;
    const jungleMinY = 0;
    const jungleMaxY = GAME_CONFIG.JUNGLE_HEIGHT;

    forEachJungleCreature(world, (entity, creatureId, posComp, creatureComp) => {
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!velComp) return;

      // Update position based on velocity
      posComp.x += velComp.x * deltaTime;
      posComp.y += velComp.y * deltaTime;

      forEachTree(world, (_entity, _id, treePos, tree) => {
        const dx = posComp.x - treePos.x,
          dy = posComp.y - treePos.y,
          d = Math.hypot(dx, dy);
        const radius = tree.radius + creatureComp.size;
        if (d < radius) {
          posComp.x = treePos.x + (d > 0 ? dx / d : 1) * radius;
          posComp.y = treePos.y + (d > 0 ? dy / d : 0) * radius;
          velComp.x = velComp.y = 0;
          creatureComp.patrolTarget = undefined;
        }
      });
      // Keep creatures within jungle bounds
      const padding = creatureComp.size;
      posComp.x = Math.max(jungleMinX + padding, Math.min(jungleMaxX - padding, posComp.x));
      posComp.y = Math.max(jungleMinY + padding, Math.min(jungleMaxY - padding, posComp.y));

      // Broadcast position update to all clients
      const movedMessage: JungleCreatureMovedMessage = {
        type: 'jungleCreatureMoved',
        creatureId,
        position: { x: posComp.x, y: posComp.y },
        state: creatureComp.state,
        variant: creatureComp.variant,
        health: creatureComp.health,
        maxHealth: creatureComp.maxHealth,
      };
      io.emit('jungleCreatureMoved', movedMessage);
    });
  }
}
