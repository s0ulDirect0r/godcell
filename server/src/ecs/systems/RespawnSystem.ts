// ============================================
// Respawn System
// Processes deferred entity spawns via ECS
// ============================================

import type { Server } from 'socket.io';
import type { World, PendingRespawnComponent } from '#shared';
import { Components } from '#shared';
import type { System } from './types';
import { respawnBotNow } from '../../bots';
import { logger } from '../../logger';

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
          const botId = pending.metadata?.botId;
          const stage = pending.stage ?? 1;

          if (typeof botId === 'string') {
            try {
              respawnBotNow(botId, stage, io, world);
              logger.debug({ event: 'pending_respawn_processed', entityType: 'bot', botId, stage });
            } catch (error) {
              logger.error({ event: 'pending_respawn_failed', entityType: 'bot', botId, stage, error });
            }
          } else {
            logger.warn({ event: 'pending_respawn_invalid_botId', metadata: pending.metadata });
          }
        }
        // Future: handle 'swarm' and 'nutrient' respawns here

        // Destroy the pending respawn entity (timer completed)
        world.destroyEntity(entity);
      }
    }
  }
}
