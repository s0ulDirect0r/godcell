// ============================================
// System Context
// Minimal context passed to all ECS systems
// ============================================
//
// All legacy helper functions have been migrated to direct imports.
// Systems now receive only the essential context: World, io, and deltaTime.

import type { Server } from 'socket.io';
import type { World } from '@godcell/shared';

/**
 * SystemContext - Minimal context for ECS systems
 *
 * This is the streamlined context that all systems receive.
 * Systems import any helpers they need directly from their source modules.
 *
 * Migration complete:
 * - abilitySystem → direct import from ../../index
 * - updateBots → direct import from ../../bots
 * - updateSwarms, updateSwarmPositions, processSwarmRespawns → direct import from ../../swarms
 * - respawnNutrient → direct import from ../../nutrients
 * - recordDamage, applyDamageWithResistance → direct import from ../factories
 * - checkSwarmCollisions → inlined into SwarmCollisionSystem
 * - removeSwarm → direct import from ../../swarms
 * - Per-tick transient data → ECS tags (Tags.SlowedThisTick, Tags.DamagedThisTick)
 */
export interface SystemContext {
  // ECS World (source of truth for all game state)
  world: World;

  // Socket.io server for broadcasting
  io: Server;

  // Delta time for this tick (seconds)
  deltaTime: number;
}

// Legacy alias for backwards compatibility during migration
export type GameContext = SystemContext;
