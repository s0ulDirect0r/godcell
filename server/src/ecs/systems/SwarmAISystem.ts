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
    const { world, updateSwarms, updateSwarmPositions, processSwarmRespawns, io, deltaTime } = ctx;

    // Update swarm AI decisions (ECS is source of truth)
    updateSwarms(Date.now(), world, deltaTime);

    // Update swarm positions based on velocity (ECS components)
    updateSwarmPositions(world, deltaTime, io);

    // Handle swarm respawning (creates in ECS)
    processSwarmRespawns(world, io);
  }
}
