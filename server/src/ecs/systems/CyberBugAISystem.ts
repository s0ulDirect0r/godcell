// ============================================
// CyberBug AI System
// Handles Stage 3 CyberBug AI behavior: idle, patrol, flee
// CyberBugs are skittish prey that flee when players approach
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Tags, Components, type World } from '@godcell/shared';
import type {
  PositionComponent,
  VelocityComponent,
  CyberBugComponent,
  StageComponent,
  EnergyComponent,
  EntityId,
  CyberBugMovedMessage,
} from '@godcell/shared';
import type { System } from './types';
import { forEachCyberBug, forEachPlayer, getStringIdByEntity } from '../factories';
import { processCyberBugRespawns } from '../../jungleFauna';

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate distance between two positions
 */
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if player is in jungle stage (Stage 3+)
 * CyberBugs only flee from jungle-stage players
 */
function isJungleStage(stage: EvolutionStage): boolean {
  return (
    stage === EvolutionStage.CYBER_ORGANISM ||
    stage === EvolutionStage.HUMANOID ||
    stage === EvolutionStage.GODCELL
  );
}

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

/**
 * Find the nearest jungle-stage player within flee range
 */
function findNearestThreat(
  bugPosition: { x: number; y: number },
  world: World
): { entityId: EntityId; position: { x: number; y: number } } | null {
  let nearestThreat: { entityId: EntityId; position: { x: number; y: number } } | null = null;
  let nearestDist = GAME_CONFIG.CYBERBUG_FLEE_TRIGGER_RADIUS;

  forEachPlayer(world, (entity, _playerId) => {
    const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
    const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
    const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
    if (!energyComp || !posComp || !stageComp) return;

    // Skip dead players and evolving players
    if (energyComp.current <= 0 || stageComp.isEvolving) return;

    // CyberBugs only flee from jungle-stage players (Stage 3+)
    if (!isJungleStage(stageComp.stage)) return;

    const playerPosition = { x: posComp.x, y: posComp.y };
    const dist = distance(bugPosition, playerPosition);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestThreat = { entityId: entity, position: playerPosition };
    }
  });

  return nearestThreat;
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
    forEachCyberBug(world, (entity, _bugId, posComp, bugComp) => {
      const velComp = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!velComp) return;

      const bugPosition = { x: posComp.x, y: posComp.y };

      // Check for nearby threats (jungle-stage players)
      const threat = findNearestThreat(bugPosition, world);

      if (threat) {
        // FLEE: Player detected within flee range
        if (bugComp.state !== 'flee' || bugComp.fleeingFrom !== threat.entityId) {
          bugComp.state = 'flee';
          bugComp.fleeingFrom = threat.entityId;
          bugComp.patrolTarget = undefined;
        }

        // Calculate direction AWAY from player
        const dx = bugPosition.x - threat.position.x;
        const dy = bugPosition.y - threat.position.y;
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
            const distToTarget = distance(bugPosition, bugComp.patrolTarget);

            if (distToTarget < 30) {
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
              const dx = bugComp.patrolTarget.x - bugPosition.x;
              const dy = bugComp.patrolTarget.y - bugPosition.y;
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
