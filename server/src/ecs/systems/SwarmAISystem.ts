// ============================================
// Swarm AI System
// Handles entropy swarm decision making and behavior
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import { updateSwarms, updateSwarmPositions, processSwarmRespawns } from '../../swarms';

/**
 * SwarmAISystem - Manages AI for entropy swarms
 *
 * Calls swarm behavior functions directly (imported from swarms.ts).
 * These functions operate on ECS components as their source of truth.
 */
export class SwarmAISystem implements System {
  readonly name = 'SwarmAISystem';

  update(ctx: GameContext): void {
    const { world, io, deltaTime } = ctx;

    // Update swarm AI decisions (ECS is source of truth)
    updateSwarms(Date.now(), world, deltaTime);

    // Update swarm positions based on velocity (ECS components)
    updateSwarmPositions(world, deltaTime, io);

    // Handle swarm respawning (creates in ECS)
    processSwarmRespawns(world, io);
  }
}
