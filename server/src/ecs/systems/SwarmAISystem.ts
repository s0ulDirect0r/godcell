// ============================================
// Swarm AI System
// Handles entropy swarm decision making and behavior
// ============================================

import type { Server } from 'socket.io';
import { Resources, type World, type TimeResource } from '@godcell/shared';
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

  update(world: World): void {
    const time = world.getResource<TimeResource>(Resources.Time)!;
    const { io } = world.getResource<{ io: Server }>(Resources.Network)!;

    // Update swarm AI decisions (ECS is source of truth)
    updateSwarms(Date.now(), world, time.delta);

    // Update swarm positions based on velocity (ECS components)
    updateSwarmPositions(world, time.delta, io);

    // Handle swarm respawning (creates in ECS)
    processSwarmRespawns(world, io);
  }
}
