// ============================================
// CyberBug AI System
// Handles Stage 3 CyberBug AI behavior: idle, patrol, flee
// CyberBugs are skittish prey that flee when players approach
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Tags, Components, type World } from '#shared';
import type {
  PositionComponent,
  VelocityComponent,
  CyberBugComponent,
  StageComponent,
  EnergyComponent,
  EntityId,
  CyberBugMovedMessage,
} from '#shared';
import type { System } from './types';
import { forEachCyberBug, forEachPlayer, getStringIdByEntity } from '../factories';
import { processCyberBugRespawns } from '../../jungleFauna';
import { isJungleStage } from '../../helpers/stages';

/**
 * Generate a random patrol target within territory radius
 */
function generatePatrolTarget(homePosition: { x: number; y: number }): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * GAME_CONFIG.CYBERBUG_PATROL_RADIUS;
  return {
    x: homePosition.x + Math.cos(angle) * radius,
    y: homePosition.y + Math.sin(angle) * radius,
  };
}

// Pre-collected threat snapshot for O(1) lookup per bug
interface ThreatSnapshot {
  entityId: EntityId;
  x: number;
  y: number;
}

/**
 * Find the nearest jungle-stage player from pre-collected threats
 * Uses squared distance to avoid sqrt in hot loop
 */
function findNearestThreatFast(
  bugX: number,
  bugY: number,
  threats: ThreatSnapshot[]
): ThreatSnapshot | null {
  let nearest: ThreatSnapshot | null = null;
  const fleeRadiusSq = GAME_CONFIG.CYBERBUG_FLEE_TRIGGER_RADIUS * GAME_CONFIG.CYBERBUG_FLEE_TRIGGER_RADIUS;
  let nearestDistSq = fleeRadiusSq;

  for (const threat of threats) {
    const dx = bugX - threat.x;
    const dy = bugY - threat.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = threat;
    }
  }

  return nearest;
}

/**
 * CyberBugAISystem - Manages AI for CyberBugs
 *
 * Behavior:
 * - idle: Standing still, occasionally transitions to patrol
 * - patrol: Wandering around home position
 * - flee: Running away from nearby player
 */
export class CyberBugAISystem implements System {
  readonly name = 'CyberBugAISystem';

  update(world: World, deltaTime: number, io: Server): void {
    // Pre-collect jungle-stage players once per tick (avoids O(bugs × players))
    const threats: ThreatSnapshot[] = [];
    forEachPlayer(world, (entity, _playerId) => {
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !posComp || !stageComp) return;
      if (energyComp.current <= 0 || stageComp.isEvolving) return;
      if (!isJungleStage(stageComp.stage)) return;
      threats.push({ entityId: entity, x: posComp.x, y: posComp.y });
    });

    forEachCyberBug(world, (entity, _bugId, posComp, bugComp) => {
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!velComp) return;

      const bugX = posComp.x;
      const bugY = posComp.y;

      // Check for nearby threats from pre-collected array
      const threat = findNearestThreatFast(bugX, bugY, threats);

      if (threat) {
        // FLEE: Player detected within flee range
        if (bugComp.state !== 'flee' || bugComp.fleeingFrom !== threat.entityId) {
          bugComp.state = 'flee';
          bugComp.fleeingFrom = threat.entityId;
          bugComp.patrolTarget = undefined;
        }

        // Calculate direction AWAY from player
        const dx = bugX - threat.x;
        const dy = bugY - threat.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          // Flee at full speed (acceleration-based like swarms)
          const acceleration = GAME_CONFIG.CYBERBUG_FLEE_SPEED * 8;
          velComp.x += (dx / dist) * acceleration * deltaTime;
          velComp.y += (dy / dist) * acceleration * deltaTime;
        }
      } else {
        // No threat - patrol or idle
        if (bugComp.state === 'flee') {
          // Just stopped fleeing, transition to patrol
          bugComp.state = 'patrol';
          bugComp.fleeingFrom = undefined;
          bugComp.patrolTarget = generatePatrolTarget(bugComp.homePosition);
        }

        if (bugComp.state === 'idle') {
          // Random chance to start patrolling (roughly every 3-5 seconds on average)
          if (Math.random() < 0.02) {
            bugComp.state = 'patrol';
            bugComp.patrolTarget = generatePatrolTarget(bugComp.homePosition);
          }
        } else if (bugComp.state === 'patrol') {
          // Check if reached patrol target
          if (bugComp.patrolTarget) {
            const patrolDx = bugComp.patrolTarget.x - bugX;
            const patrolDy = bugComp.patrolTarget.y - bugY;
            const distToTargetSq = patrolDx * patrolDx + patrolDy * patrolDy;

            if (distToTargetSq < 900) { // 30^2 = 900
              // Reached target, maybe go idle or pick new target
              if (Math.random() < 0.3) {
                bugComp.state = 'idle';
                bugComp.patrolTarget = undefined;
              } else {
                bugComp.patrolTarget = generatePatrolTarget(bugComp.homePosition);
              }
            }

            // Move toward patrol target
            if (bugComp.patrolTarget) {
              const dx = bugComp.patrolTarget.x - bugX;
              const dy = bugComp.patrolTarget.y - bugY;
              const dist = Math.sqrt(dx * dx + dy * dy);

              if (dist > 0) {
                // Slower patrol speed
                const patrolAcceleration = GAME_CONFIG.CYBERBUG_PATROL_SPEED * 8;
                velComp.x += (dx / dist) * patrolAcceleration * deltaTime;
                velComp.y += (dy / dist) * patrolAcceleration * deltaTime;
              }
            }
          }
        }
      }

      // Clamp to max speed
      const velocityMagnitude = Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y);
      const maxSpeed = bugComp.state === 'flee'
        ? GAME_CONFIG.CYBERBUG_FLEE_SPEED * 1.2 // Faster when fleeing
        : GAME_CONFIG.CYBERBUG_PATROL_SPEED; // Slower when patrolling

      if (velocityMagnitude > maxSpeed) {
        velComp.x = (velComp.x / velocityMagnitude) * maxSpeed;
        velComp.y = (velComp.y / velocityMagnitude) * maxSpeed;
      }

      // Apply friction when idle
      if (bugComp.state === 'idle') {
        velComp.x *= 0.9;
        velComp.y *= 0.9;
      }
    });

    // Update positions based on velocity and broadcast to clients
    this.updatePositions(world, deltaTime, io);

    // Process pending swarm respawns
    processCyberBugRespawns(world, io);
  }

  /**
   * Update bug positions based on velocity and broadcast to clients
   * Bugs are clamped to jungle region bounds
   */
  private updatePositions(world: World, deltaTime: number, io: Server): void {
    // CyberBugs live in the jungle region (jungle starts at 0,0)
    const jungleMinX = 0;
    const jungleMaxX = GAME_CONFIG.JUNGLE_WIDTH;
    const jungleMinY = 0;
    const jungleMaxY = GAME_CONFIG.JUNGLE_HEIGHT;

    forEachCyberBug(world, (entity, bugId, posComp, bugComp) => {
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!velComp) return;

      // Update position based on velocity
      posComp.x += velComp.x * deltaTime;
      posComp.y += velComp.y * deltaTime;

      // Keep bugs within jungle bounds
      const padding = bugComp.size;
      posComp.x = Math.max(jungleMinX + padding, Math.min(jungleMaxX - padding, posComp.x));
      posComp.y = Math.max(jungleMinY + padding, Math.min(jungleMaxY - padding, posComp.y));

      // Broadcast position update to all clients
      const movedMessage: CyberBugMovedMessage = {
        type: 'cyberBugMoved',
        bugId,
        position: { x: posComp.x, y: posComp.y },
        state: bugComp.state,
      };
      io.emit('cyberBugMoved', movedMessage);
    });
  }
}
