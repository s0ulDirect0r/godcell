// ============================================
// Swarm AI System
// Handles entropy swarm decision making and behavior
// ============================================

import type { Server } from 'socket.io';
import type { World } from '@godcell/shared';
import type { System } from './types';
import { updateSwarms, updateSwarmPositions, processSwarmRespawns } from '../../swarms';

/**
 * SwarmAISystem - Manages AI for entropy swarms
 *
 * Calls swarm behavior functions directly (imported from swarms.ts).
 * These functions operate on ECS components as their source of truth.
 */
export class SwarmAISystem implements System {
  readonly name = 'SwarmAISystem';

  update(world: World, deltaTime: number, io: Server): void {
    // Update swarm AI decisions (ECS is source of truth)
    updateSwarms(Date.now(), world, deltaTime);

    // Update swarm positions based on velocity (ECS components)
    updateSwarmPositions(world, deltaTime, io);

    // Handle swarm respawning (creates in ECS)
    processSwarmRespawns(world, io);
  }
}
