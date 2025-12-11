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
  recordDamage,
} from '../factories';
import { logger } from '../../logger';

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

    forEachEntropySerpent(world, (entity, id, pos, vel, serpent) => {
      // Find nearest Stage 3+ player (target)
      const target = this.findNearestTarget(world, pos.x, pos.y);

      if (target) {
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Update heading to face target
        serpent.heading = Math.atan2(dy, dx);

        if (dist <= GAME_CONFIG.ENTROPY_SERPENT_ATTACK_RANGE) {
          // ATTACK MODE - in range, strike!
          serpent.state = 'attack';
          serpent.targetEntityId = target.entity;

          // Check attack cooldown
          const canAttack = !serpent.lastAttackTime ||
            (now - serpent.lastAttackTime) >= GAME_CONFIG.ENTROPY_SERPENT_ATTACK_COOLDOWN;

          if (canAttack) {
            // Deal damage!
            this.performAttack(world, io, entity, id, target, now);
            serpent.lastAttackTime = now;
          }

          // Slow down during attack
          const attackSpeed = GAME_CONFIG.ENTROPY_SERPENT_ATTACK_SPEED;
          vel.x = (dx / dist) * attackSpeed;
          vel.y = (dy / dist) * attackSpeed;

        } else {
          // CHASE MODE - pursue relentlessly
          serpent.state = 'chase';
          serpent.targetEntityId = target.entity;

          const chaseSpeed = GAME_CONFIG.ENTROPY_SERPENT_CHASE_SPEED;
          vel.x = (dx / dist) * chaseSpeed;
          vel.y = (dy / dist) * chaseSpeed;
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

      // NOTE: Position updates are broadcast via the regular snapshot system (buildEntropySerpentsRecord)
      // No need to emit individual movement events - that caused major performance overhead
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
   * Perform attack on target
   */
  private performAttack(
    world: World,
    io: Server,
    serpentEntity: number,
    serpentId: string,
    target: { entity: number; x: number; y: number; socketId: string },
    now: number
  ): void {
    const targetEnergy = world.getComponent<EnergyComponent>(target.entity, Components.Energy);
    const targetPos = world.getComponent<PositionComponent>(target.entity, Components.Position);

    if (!targetEnergy || !targetPos) return;

    const damage = GAME_CONFIG.ENTROPY_SERPENT_DAMAGE;
    targetEnergy.current = Math.max(0, targetEnergy.current - damage);

    // Record damage for visual feedback
    recordDamage(world, target.entity, damage, 'swarm'); // Use swarm color for now

    // Emit attack event for client visuals
    io.emit('message', {
      type: 'entropySerpentAttack',
      serpentId,
      targetId: target.socketId,
      position: { x: targetPos.x, y: targetPos.y },
      damage,
    });

    logger.info({
      event: 'entropy_serpent_attack',
      serpentId,
      targetId: target.socketId,
      damage,
      targetEnergyAfter: targetEnergy.current,
    }, 'Entropy serpent attacked player');
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
}
