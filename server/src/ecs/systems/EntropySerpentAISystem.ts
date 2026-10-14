import { blockedByTree } from '../../abilities/fauna';
// ============================================
// Entropy Serpent AI System
// SUPER AGGRESSIVE apex predator that hunts Stage 3+ players
// ============================================

import type { Server } from 'socket.io';
import {
  World,
  Components,
  Tags,
  GAME_CONFIG,
  EvolutionStage,
  type Position,
  type EntropySerpentMovedMessage,
} from '#shared';
import type {
  PositionComponent,
  VelocityComponent,
  StageComponent,
  EnergyComponent,
  EntropySerpentComponent,
} from '#shared';
import type { System } from './types';
import {
  forEachEntropySerpent,
  getSocketIdByEntity,
  recordDamage,
  createEntropySerpent,
  destroyEntity,
  getSerpentHeadPosition,
} from '../factories';
import { logger } from '../../logger';

// Pending respawns (serpentId -> respawnTime)
const pendingRespawns: Map<string, { respawnAt: number; homePosition: Position }> = new Map();

/**
 * EntropySerpentAISystem - SUPER AGGRESSIVE apex predator
 *
 * Behavior:
 * - Patrols jungle area looking for Stage 3+ players
 * - Instantly detects and chases any cyber-organism or humanoid
 * - Attacks when in range, dealing heavy damage
 * - Faster than players - creates real threat
 */
export class EntropySerpentAISystem implements System {
  readonly name = 'EntropySerpentAISystem';

  update(world: World, deltaTime: number, io: Server): void {
    const now = Date.now();

    // Process pending respawns
    this.processRespawns(world, now, io);

    // Check for dead serpents and handle death
    const deadSerpents: Array<{ entity: number; id: string; homePosition: Position }> = [];
    forEachEntropySerpent(world, (entity, id, pos, vel, serpent) => {
      const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
      if (energy && energy.current <= 0) {
        deadSerpents.push({ entity, id, homePosition: { ...serpent.homePosition } });
      }
    });

    // Handle deaths (separate loop to avoid modifying during iteration)
    for (const dead of deadSerpents) {
      this.handleDeath(world, dead.entity, dead.id, dead.homePosition, now, io);
    }

    // Update living serpents
    forEachEntropySerpent(world, (entity, id, pos, vel, serpent) => {
      // Telegraph and recovery are committed: neither position nor aim tracks the player.
      const phase = serpent.state;
      if (phase === 'windup') {
        vel.x = vel.y = 0;
        if (now >= (serpent.phaseUntil ?? 0)) {
          this.performAttack(world, io, entity, id, serpent, now);
          serpent.state = 'attack';
          serpent.phaseUntil = now + 180;
        }
      } else if (phase === 'attack' || phase === 'recover') {
        vel.x = vel.y = 0;
        if (now >= (serpent.phaseUntil ?? 0)) {
          serpent.state = phase === 'attack' ? 'recover' : 'patrol';
          serpent.phaseUntil = now + 1200;
        }
      } else {
        const target = this.findNearestTarget(world, pos.x, pos.y);
        const homeDistance = Math.hypot(
          pos.x - serpent.homePosition.x,
          pos.y - serpent.homePosition.y
        );
        const targetAtHome =
          target &&
          Math.hypot(target.x - serpent.homePosition.x, target.y - serpent.homePosition.y) < 2100;
        if (target && targetAtHome && homeDistance < 2400) {
          const dx = target.x - pos.x,
            dy = target.y - pos.y,
            dist = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);
          const turn = Math.atan2(
            Math.sin(angle - serpent.heading),
            Math.cos(angle - serpent.heading)
          );
          serpent.heading += Math.max(-Math.PI * deltaTime, Math.min(Math.PI * deltaTime, turn));
          serpent.targetEntityId = target.entity;
          const reach =
            GAME_CONFIG.ENTROPY_SERPENT_HEAD_OFFSET + GAME_CONFIG.ENTROPY_SERPENT_ATTACK_RANGE;
          if (
            dist < reach - 60 &&
            dist > GAME_CONFIG.ENTROPY_SERPENT_HEAD_OFFSET &&
            Math.abs(turn) < 0.2
          ) {
            serpent.state = 'windup';
            serpent.phaseUntil = now + 900;
            vel.x = vel.y = 0;
          } else {
            serpent.state = 'chase';
            const direction = dist < GAME_CONFIG.ENTROPY_SERPENT_HEAD_OFFSET + 100 ? -0.6 : 1;
            const speed = GAME_CONFIG.ENTROPY_SERPENT_CHASE_SPEED * direction;
            vel.x = dist > 0 ? (dx / dist) * speed : 0;
            vel.y = dist > 0 ? (dy / dist) * speed : 0;
          }
        } else {
          serpent.state = 'patrol';
          serpent.targetEntityId = undefined;
          if (homeDistance > 1000) serpent.patrolTarget = { ...serpent.homePosition };
          this.updatePatrol(pos, vel, serpent, deltaTime);
        }
      }

      // Apply velocity to position
      pos.x += vel.x * deltaTime;
      pos.y += vel.y * deltaTime;

      // Clamp to jungle bounds
      pos.x = Math.max(0, Math.min(GAME_CONFIG.JUNGLE_WIDTH, pos.x));
      pos.y = Math.max(0, Math.min(GAME_CONFIG.JUNGLE_HEIGHT, pos.y));

      // Get target player ID for client (if chasing)
      let targetPlayerId: string | undefined;
      if (serpent.targetEntityId !== undefined) {
        targetPlayerId = getSocketIdByEntity(serpent.targetEntityId);
      }

      // Broadcast position update to all clients
      const movedMessage: EntropySerpentMovedMessage = {
        type: 'entropySerpentMoved',
        serpentId: id,
        position: { x: pos.x, y: pos.y },
        state: serpent.state,
        heading: serpent.heading,
        targetPlayerId,
      };
      io.emit('entropySerpentMoved', movedMessage);
    });
  }

  /**
   * Find nearest Stage 3+ player within detection range
   */
  private findNearestTarget(
    world: World,
    serpentX: number,
    serpentY: number
  ): { entity: number; x: number; y: number; socketId: string } | null {
    let nearest: { entity: number; x: number; y: number; socketId: string } | null = null;
    let nearestDist = GAME_CONFIG.ENTROPY_SERPENT_DETECTION_RADIUS;

    world.forEachWithTag(Tags.Player, (entity) => {
      const stage = world.getComponent<StageComponent>(entity, Components.Stage);
      const pos = world.getComponent<PositionComponent>(entity, Components.Position);
      const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);

      if (!stage || !pos || !energy) return;

      // Only hunt Stage 3+ (cyber-organism, humanoid, godcell)
      if (
        stage.stage !== EvolutionStage.CYBER_ORGANISM &&
        stage.stage !== EvolutionStage.HUMANOID &&
        stage.stage !== EvolutionStage.GODCELL
      ) {
        return;
      }

      // Skip dead players
      if (energy.current <= 0) return;

      // Skip evolving players (invulnerable)
      if (stage.isEvolving) return;

      const dx = pos.x - serpentX;
      const dy = pos.y - serpentY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < nearestDist) {
        nearestDist = dist;
        const socketId = getSocketIdByEntity(entity);
        if (socketId) {
          nearest = { entity, x: pos.x, y: pos.y, socketId };
        }
      }
    });

    return nearest;
  }

  /**
   * Perform area attack - damages all players in the 120° frontal arc.
   *
   * Attack hitbox:
   * - ORIGIN: Head position (body center + heading * SERPENT_SIZE)
   * - RANGE: ENTROPY_SERPENT_ATTACK_RANGE (90px) from head
   * - ARC: 120° cone (60° each side of heading)
   */
  private performAttack(
    world: World,
    io: Server,
    serpentEntity: number,
    serpentId: string,
    serpent: EntropySerpentComponent,
    _now: number
  ): void {
    const serpentPos = world.getComponent<PositionComponent>(serpentEntity, Components.Position);
    if (!serpentPos) return;

    // Get head position using helper
    const headPos = getSerpentHeadPosition(serpentPos.x, serpentPos.y, serpent.heading);

    // Attack parameters
    const attackRange = GAME_CONFIG.ENTROPY_SERPENT_ATTACK_RANGE;
    const halfArc = Math.PI / 3; // 60° each side = 120° total
    const damage = GAME_CONFIG.ENTROPY_SERPENT_DAMAGE;
    const hitPlayerIds: string[] = [];

    // Check all players for hits
    world.forEachWithTag(Tags.Player, (playerEntity) => {
      const playerPos = world.getComponent<PositionComponent>(playerEntity, Components.Position);
      const playerEnergy = world.getComponent<EnergyComponent>(playerEntity, Components.Energy);
      const playerStage = world.getComponent<StageComponent>(playerEntity, Components.Stage);

      if (!playerPos || !playerEnergy || !playerStage) return;
      if (
        playerStage.stage === EvolutionStage.SINGLE_CELL ||
        playerStage.stage === EvolutionStage.MULTI_CELL
      )
        return;
      if (playerEnergy.current <= 0) return;
      if (playerStage.isEvolving) return;

      // Distance from HEAD to player
      const dx = playerPos.x - headPos.x;
      const dy = playerPos.y - headPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Must be within attack range of HEAD
      if (dist > attackRange || blockedByTree(world, headPos, playerPos)) return;

      // Must be within 120° frontal arc
      const angleToPlayer = Math.atan2(dy, dx);
      const angleDiff = Math.atan2(
        Math.sin(angleToPlayer - serpent.heading),
        Math.cos(angleToPlayer - serpent.heading)
      );

      if (Math.abs(angleDiff) <= halfArc) {
        // HIT! Deal damage
        playerEnergy.current = Math.max(0, playerEnergy.current - damage);
        recordDamage(world, playerEntity, damage, 'swarm');

        const playerId = getSocketIdByEntity(playerEntity);
        if (playerId) hitPlayerIds.push(playerId);
      }
    });

    // Emit attack event for each hit player (for visuals)
    // Always emit at least one event for the slash animation, even if no hits
    if (hitPlayerIds.length === 0) {
      // No hits - emit attack event with no target for slash visual only
      io.emit('entropySerpentAttack', {
        type: 'entropySerpentAttack',
        serpentId,
        targetId: '',
        position: { x: headPos.x, y: headPos.y }, // Attack position (head)
        serpentPosition: { x: headPos.x, y: headPos.y },
        attackDirection: serpent.heading,
        damage,
      });
    } else {
      // Emit one event per hit player
      for (const playerId of hitPlayerIds) {
        // Get player position for hit effect
        let hitPos = { x: headPos.x, y: headPos.y };
        world.forEachWithTag(Tags.Player, (entity) => {
          if (getSocketIdByEntity(entity) === playerId) {
            const pos = world.getComponent<PositionComponent>(entity, Components.Position);
            if (pos) hitPos = { x: pos.x, y: pos.y };
          }
        });

        io.emit('entropySerpentAttack', {
          type: 'entropySerpentAttack',
          serpentId,
          targetId: playerId,
          position: hitPos, // Where the hit landed (player position)
          serpentPosition: { x: headPos.x, y: headPos.y },
          attackDirection: serpent.heading,
          damage,
        });
      }

      logger.info(
        {
          event: 'entropy_serpent_attack',
          serpentId,
          hitPlayerIds,
          damage,
          headPos,
        },
        'Entropy serpent melee attack'
      );
    }
  }

  /**
   * Update patrol behavior
   */
  private updatePatrol(
    pos: PositionComponent,
    vel: VelocityComponent,
    serpent: EntropySerpentComponent,
    _deltaTime: number
  ): void {
    const patrolRadius = 350;
    const patrolSpeed = GAME_CONFIG.ENTROPY_SERPENT_SPEED;

    // Generate new patrol target if needed
    if (!serpent.patrolTarget) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * patrolRadius;
      serpent.patrolTarget = {
        x: serpent.homePosition.x + Math.cos(angle) * dist,
        y: serpent.homePosition.y + Math.sin(angle) * dist,
      };
    }

    // Move toward patrol target
    const dx = serpent.patrolTarget.x - pos.x;
    const dy = serpent.patrolTarget.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 50) {
      // Reached patrol target, pick new one
      serpent.patrolTarget = undefined;
      vel.x = vel.y = 0;
    } else {
      // Move toward patrol target
      vel.x = (dx / dist) * patrolSpeed;
      vel.y = (dy / dist) * patrolSpeed;

      // Update heading
      serpent.heading = Math.atan2(dy, dx);
    }
  }

  /**
   * Handle serpent death - destroy entity and schedule respawn
   */
  private handleDeath(
    world: World,
    entity: number,
    serpentId: string,
    homePosition: Position,
    now: number,
    io: Server
  ): void {
    const pos = world.getComponent<PositionComponent>(entity, Components.Position);
    const position = pos ? { x: pos.x, y: pos.y } : homePosition;

    // Emit death event for client visuals
    io.emit('entropySerpentKilled', {
      type: 'entropySerpentKilled',
      serpentId,
      position,
    });

    logger.info(
      {
        event: 'entropy_serpent_killed',
        serpentId,
        position,
      },
      'Entropy serpent killed'
    );

    // Schedule respawn
    pendingRespawns.set(serpentId, {
      respawnAt: now + GAME_CONFIG.ENTROPY_SERPENT_RESPAWN_DELAY,
      homePosition,
    });

    // Destroy entity
    destroyEntity(world, entity);
  }

  /**
   * Process pending respawns
   */
  private processRespawns(world: World, now: number, io: Server): void {
    for (const [serpentId, respawn] of pendingRespawns) {
      if (now >= respawn.respawnAt) {
        // Respawn serpent at home position
        createEntropySerpent(world, serpentId, respawn.homePosition, respawn.homePosition);
        pendingRespawns.delete(serpentId);

        // Emit respawn event
        io.emit('entropySerpentSpawned', {
          type: 'entropySerpentSpawned',
          serpent: { id: serpentId, position: respawn.homePosition, state: 'patrol', heading: 0 },
        });

        logger.info(
          {
            event: 'entropy_serpent_respawned',
            serpentId,
            position: respawn.homePosition,
          },
          'Entropy serpent respawned'
        );
      }
    }
  }
}
