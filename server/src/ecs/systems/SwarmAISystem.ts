// ============================================
// Swarm AI System
// Handles entropy swarm decision making and behavior
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * SwarmAISystem - Manages AI for entropy swarms
 *
 * Currently wraps existing swarm functions.
 * Future: Move swarm AI to operate on ECS Swarm components.
 */
export class SwarmAISystem implements System {
  readonly name = 'SwarmAISystem';

  update(ctx: GameContext): void {
    const { world, updateSwarms, updateSwarmPositions, processSwarmRespawns, obstacles, io, deltaTime } = ctx;

    // Update swarm AI decisions (now uses ECS for player queries)
    updateSwarms(Date.now(), world, obstacles, deltaTime);

    // Update swarm positions based on velocity
    updateSwarmPositions(deltaTime, io);

    // Handle swarm respawning
    processSwarmRespawns(io);
  }
}
