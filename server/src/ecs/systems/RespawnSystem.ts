// ============================================
// Respawn System
// Processes deferred entity spawns via ECS
// ============================================

import type { Server } from 'socket.io';
import type { World, PendingRespawnComponent } from '@godcell/shared';
import { Components } from '@godcell/shared';
import type { System } from './types';
import { respawnBotNow } from '../../bots';

/**
 * RespawnSystem - Processes pending respawn entities
 *
 * Replaces setTimeout patterns with ECS-native deferred actions.
 * Benefits:
 * - All pending respawns visible in ECS (queryable, debuggable)
 * - No orphaned timers on server shutdown
 * - Consistent with ECS architecture
 *
 * Priority: 50 (runs early, before AI systems)
 */
export class RespawnSystem implements System {
  readonly name = 'RespawnSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    const now = Date.now();

    // Query all entities with PendingRespawn component
    const pendingEntities = world.query(Components.PendingRespawn);

    for (const entity of pendingEntities) {
      const pending = world.getComponent<PendingRespawnComponent>(entity, Components.PendingRespawn);
      if (!pending) continue;

      // Check if respawn time has been reached
      if (now >= pending.respawnAt) {
        // Process respawn based on entity type
        if (pending.entityType === 'bot') {
          const botId = pending.metadata?.botId as string;
          const stage = pending.stage ?? 1;

          if (botId) {
            // Call bot respawn handler
            respawnBotNow(botId, stage, io, world);
          }
        }
        // Future: handle 'swarm' and 'nutrient' respawns here

        // Destroy the pending respawn entity (timer completed)
        world.destroyEntity(entity);
      }
    }
  }
}
