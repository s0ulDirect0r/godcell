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
  DamageTrackingComponent,
} from '#shared';
import type { System } from './types';
import {
  forEachEntropySerpent,
  getSocketIdByEntity,
  getStringIdByEntity,
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
      // Find nearest Stage 3+ player (target)
      const target = this.findNearestTarget(world, pos.x, pos.y);

      if (target) {
        // Distance from BODY CENTER to target (for reachability check)
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const bodyToTargetDist = Math.sqrt(dx * dx + dy * dy);

        // Turn gradually toward target (not instant snap)
        const targetHeading = Math.atan2(dy, dx);
        const headingDiff = Math.atan2(
          Math.sin(targetHeading - serpent.heading),
          Math.cos(targetHeading - serpent.heading)
        );
        // Turn rate: ~180° per second
        const maxTurn = Math.PI * deltaTime;
        if (Math.abs(headingDiff) <= maxTurn) {
          serpent.heading = targetHeading;
        } else {
          serpent.heading += Math.sign(headingDiff) * maxTurn;
        }

        // Attack mode entry: target is REACHABLE if body is close enough
        // that the head CAN reach (body distance <= attack range + head offset)
        // Head offset matches mesh geometry (precomputed constant)
        const headOffset = GAME_CONFIG.ENTROPY_SERPENT_HEAD_OFFSET;
        const attackReachDist = GAME_CONFIG.ENTROPY_SERPENT_ATTACK_RANGE + headOffset;

        if (bodyToTargetDist <= attackReachDist) {
          // ATTACK MODE - target is reachable, try to strike!
          serpent.state = 'attack';
          serpent.targetEntityId = target.entity;

          // Check attack cooldown
          const canAttack = !serpent.lastAttackTime ||
            (now - serpent.lastAttackTime) >= GAME_CONFIG.ENTROPY_SERPENT_ATTACK_COOLDOWN;

          // Recalculate facing after heading update
          const currentHeadingDiff = Math.atan2(
            Math.sin(targetHeading - serpent.heading),
            Math.cos(targetHeading - serpent.heading)
          );

          // Only attack if facing the target (within 30° of target direction)
          const facingThreshold = Math.PI / 6; // 30°
          const isFacingTarget = Math.abs(currentHeadingDiff) <= facingThreshold;

          if (canAttack && isFacingTarget) {
            // Facing target - strike!
            this.performAttack(world, io, entity, id, serpent, now);
            serpent.lastAttackTime = now;
          }

          // Maintain attack distance - stop when in good position
          // Ideal distance: attack range from head (which is headOffset from body)
          const idealDist = GAME_CONFIG.ENTROPY_SERPENT_ATTACK_RANGE + headOffset * 0.5;
          const attackSpeed = GAME_CONFIG.ENTROPY_SERPENT_ATTACK_SPEED;

          if (bodyToTargetDist < idealDist * 0.7) {
            // Too close - back away slightly
            vel.x = -(dx / bodyToTargetDist) * attackSpeed * 0.3;
            vel.y = -(dy / bodyToTargetDist) * attackSpeed * 0.3;
          } else if (bodyToTargetDist > idealDist) {
            // Too far - close in slowly
            vel.x = (dx / bodyToTargetDist) * attackSpeed * 0.5;
            vel.y = (dy / bodyToTargetDist) * attackSpeed * 0.5;
          } else {
            // Good distance - stop moving, just attack
            vel.x = 0;
            vel.y = 0;
          }

        } else {
          // CHASE MODE - pursue relentlessly
          serpent.state = 'chase';
          serpent.targetEntityId = target.entity;

          const chaseSpeed = GAME_CONFIG.ENTROPY_SERPENT_CHASE_SPEED;
          vel.x = (dx / bodyToTargetDist) * chaseSpeed;
          vel.y = (dy / bodyToTargetDist) * chaseSpeed;
        }
      } else {
        // PATROL MODE - wander around home
        serpent.state = 'patrol';
        serpent.targetEntityId = undefined;

        this.updatePatrol(pos, vel, serpent, deltaTime);
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
      if (stage.stage !== EvolutionStage.CYBER_ORGANISM &&
          stage.stage !== EvolutionStage.HUMANOID &&
          stage.stage !== EvolutionStage.GODCELL) {
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
    now: number
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

    // Debug: Log attack origin (server console)
    const actualHeadOffset = GAME_CONFIG.ENTROPY_SERPENT_HEAD_OFFSET;
    console.log('[SerpentAttack SERVER] Attack initiated:', {
      bodyPos: { x: serpentPos.x.toFixed(1), y: serpentPos.y.toFixed(1) },
      headPos: { x: headPos.x.toFixed(1), y: headPos.y.toFixed(1) },
      headingDeg: (serpent.heading * 180 / Math.PI).toFixed(1) + '°',
      headOffset: actualHeadOffset,
    });
    logger.info({
      event: 'serpent_attack_debug',
      serpentId,
      bodyPos: { x: serpentPos.x, y: serpentPos.y },
      headPos,
      heading: serpent.heading,
      headingDeg: (serpent.heading * 180 / Math.PI).toFixed(1),
      attackRange,
    }, 'Serpent attack initiated');

    // Check all players for hits
    world.forEachWithTag(Tags.Player, (playerEntity) => {
      const playerPos = world.getComponent<PositionComponent>(playerEntity, Components.Position);
      const playerEnergy = world.getComponent<EnergyComponent>(playerEntity, Components.Energy);
      const playerStage = world.getComponent<StageComponent>(playerEntity, Components.Stage);

      if (!playerPos || !playerEnergy || !playerStage) return;
      if (playerEnergy.current <= 0) return;
      if (playerStage.isEvolving) return;

      // Distance from HEAD to player
      const dx = playerPos.x - headPos.x;
      const dy = playerPos.y - headPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const playerId = getSocketIdByEntity(playerEntity);

      // Debug: Log every player check
      logger.info({
        event: 'serpent_attack_check',
        serpentId,
        playerId,
        playerPos: { x: playerPos.x, y: playerPos.y },
        headPos,
        distFromHead: dist.toFixed(1),
        attackRange,
        inRange: dist <= attackRange,
      }, 'Checking player for attack hit');

      // Must be within attack range of HEAD
      if (dist > attackRange) return;

      // Must be within 120° frontal arc
      const angleToPlayer = Math.atan2(dy, dx);
      const angleDiff = Math.atan2(
        Math.sin(angleToPlayer - serpent.heading),
        Math.cos(angleToPlayer - serpent.heading)
      );

      // Debug: Log arc check
      logger.info({
        event: 'serpent_attack_arc_check',
        serpentId,
        playerId,
        angleToPlayer: (angleToPlayer * 180 / Math.PI).toFixed(1),
        serpentHeading: (serpent.heading * 180 / Math.PI).toFixed(1),
        angleDiff: (angleDiff * 180 / Math.PI).toFixed(1),
        halfArcDeg: (halfArc * 180 / Math.PI).toFixed(1),
        inArc: Math.abs(angleDiff) <= halfArc,
      }, 'Arc check');

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
        const playerEntity = world.forEachWithTag(Tags.Player, (entity) => {
          if (getSocketIdByEntity(entity) === playerId) return entity;
        });

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

      logger.info({
        event: 'entropy_serpent_attack',
        serpentId,
        hitPlayerIds,
        damage,
        headPos,
      }, 'Entropy serpent melee attack');
    }
  }

  /**
   * Update patrol behavior
   */
  private updatePatrol(
    pos: PositionComponent,
    vel: VelocityComponent,
    serpent: EntropySerpentComponent,
    deltaTime: number
  ): void {
    const patrolRadius = GAME_CONFIG.ENTROPY_SERPENT_PATROL_RADIUS;
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

    logger.info({
      event: 'entropy_serpent_killed',
      serpentId,
      position,
    }, 'Entropy serpent killed');

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
          serpentId,
          position: respawn.homePosition,
        });

        logger.info({
          event: 'entropy_serpent_respawned',
          serpentId,
          position: respawn.homePosition,
        }, 'Entropy serpent respawned');
      }
    }
  }
}
