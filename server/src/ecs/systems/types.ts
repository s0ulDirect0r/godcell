// ============================================
// ECS System Types
// ============================================

import type { Server } from 'socket.io';
import type { World } from '@godcell/shared';

/**
 * Base System interface
 * All game systems implement this interface
 */
export interface System {
  /** System name for debugging/logging */
  readonly name: string;

  /**
   * Called every game tick
   * @param world The ECS World containing all entities and components
   * @param deltaTime Time since last tick in seconds
   * @param io Socket.io server for network broadcasts
   */
  update(world: World, deltaTime: number, io: Server): void;
}

/**
 * System priority - determines update order
 * Lower numbers run first
 *
 * Order matches the original game loop:
 * 1. Bot AI (before movement)
 * 2. Gravity (affects velocity)
 * 3. Swarm AI (swarm movement, respawns)
 * 4. Pseudopod (beam physics)
 * 5. Predation (player-player eating)
 * 6. Swarm collision (damage + sets slowedPlayerIds for movement)
 * 7. Movement (uses slowedPlayerIds)
 * 8. Metabolism (energy decay)
 * 9. Nutrient collision (pickup)
 * 10. Nutrient attraction (visual)
 * 11. Death (check deaths)
 * 12. Network (broadcast state)
 */
export const SystemPriority = {
  // AI decisions - before physics
  BOT_AI: 100,
  SWARM_AI: 110,

  // Physics and forces
  GRAVITY: 200,

  // Abilities (pseudopods, EMP effects)
  PSEUDOPOD: 300,

  // Collisions and interactions (before movement)
  PREDATION: 400,
  SWARM_COLLISION: 410,
  TREE_COLLISION: 480, // After swarm, before movement - pushes jungle players out of trees

  // Movement (after collisions set slow debuffs)
  MOVEMENT: 500,

  // Life cycle
  METABOLISM: 600,
  NUTRIENT_COLLISION: 610,
  NUTRIENT_ATTRACTION: 620,
  DEATH: 700,

  // Network broadcasting - runs last
  NETWORK: 900,
} as const;
