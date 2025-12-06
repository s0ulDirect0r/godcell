// ============================================
// Trap System
// Handles Stage 3 traps specialization trap detection, damage, and lifetime
// ============================================

import type { Server } from 'socket.io';
import { GAME_CONFIG, Tags, type World, Components } from '#shared';
import type {
  PositionComponent,
  TrapComponent,
  StunnedComponent,
  EntityId,
} from '#shared';
import type { System } from './types';
import {
  getStringIdByEntity,
  destroyEntity,
  forEachTrap,
  forEachPlayer,
  getPosition,
  getStage,
  getEnergy,
  subtractEnergy,
  getEntityBySocketId,
} from '../factories';
import { distance } from '../../helpers';
import { isJungleStage } from '../../helpers/stages';
import { logger } from '../../logger';

/**
 * TrapSystem - Manages Stage 3 traps specialization mines
 *
 * Handles:
 * - Trigger detection when enemies enter radius
 * - Damage application and stun effect
 * - Lifetime tracking and auto-despawn
 */
export class TrapSystem implements System {
  readonly name = 'TrapSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    const now = Date.now();
    const toRemove = new Set<EntityId>();
    const triggeredTraps: {
      entity: EntityId;
      id: string;
      victimSocketId: string;
      victimEntity: EntityId;
      pos: { x: number; y: number };
      damage: number;
      stunDuration: number;
      ownerSocketId: string;
    }[] = [];

    // Iterate trap entities
    forEachTrap(world, (entity, trapId, posComp, trapComp) => {
      // Check lifetime expiration
      if (now - trapComp.placedAt >= trapComp.lifetime) {
        toRemove.add(entity);
        io.emit('trapDespawned', {
          type: 'trapDespawned',
          trapId,
          reason: 'expired',
        });
        return;
      }

      const trapPos = { x: posComp.x, y: posComp.y };

      // Check collision with players (enemies only)
      forEachPlayer(world, (playerEntity, playerSocketId) => {
        // Skip trap owner
        if (playerSocketId === trapComp.ownerSocketId) return;

        // Only trigger on jungle-scale players (Stage 3+) - entity-based
        const stage = getStage(world, playerEntity);
        if (!stage || !isJungleStage(stage.stage)) return;

        // Get player position (entity-based)
        const playerPos = getPosition(world, playerEntity);
        if (!playerPos) return;

        const playerPosition = { x: playerPos.x, y: playerPos.y };
        const dist = distance(trapPos, playerPosition);

        if (dist < trapComp.triggerRadius) {
          // Trap triggered!
          triggeredTraps.push({
            entity,
            id: trapId,
            victimSocketId: playerSocketId,
            victimEntity: playerEntity,
            pos: trapPos,
            damage: trapComp.damage,
            stunDuration: trapComp.stunDuration,
            ownerSocketId: trapComp.ownerSocketId,
          });
        }
      });
    });

    // Process triggered traps (after iteration to avoid mutation during iteration)
    const processedTrapIds = new Set<string>();
    for (const trap of triggeredTraps) {
      // Skip if trap already processed (can only trigger once)
      if (processedTrapIds.has(trap.id)) continue;
      processedTrapIds.add(trap.id);

      // Apply damage to victim (entity-based)
      subtractEnergy(world, trap.victimEntity, trap.damage);

      // Apply stun to victim (already have entity)
      const stunned = world.getComponent<StunnedComponent>(trap.victimEntity, Components.Stunned);
      if (stunned) {
        // Extend stun if already stunned
        stunned.until = Math.max(stunned.until || 0, now + trap.stunDuration);
      } else {
        // Add stun component
        world.addComponent<StunnedComponent>(trap.victimEntity, Components.Stunned, {
          until: now + trap.stunDuration,
        });
      }

      // Check if victim died (entity-based)
      const victimEnergy = getEnergy(world, trap.victimEntity);
      const killed = victimEnergy ? victimEnergy.current <= 0 : false;

      // Emit trigger event
      io.emit('trapTriggered', {
        type: 'trapTriggered',
        trapId: trap.id,
        victimId: trap.victimSocketId,
        position: trap.pos,
        damage: trap.damage,
        stunDuration: trap.stunDuration,
        killed,
      });

      logger.info({
        event: 'player_trap_triggered',
        trapId: trap.id,
        owner: trap.ownerSocketId,
        victim: trap.victimSocketId,
        damage: trap.damage,
        stunDuration: trap.stunDuration,
        killed,
      });

      // Emit despawn event for the triggered trap
      io.emit('trapDespawned', {
        type: 'trapDespawned',
        trapId: trap.id,
        reason: 'triggered',
      });

      // Mark trap for removal
      toRemove.add(trap.entity);
    }

    // Remove expired and triggered traps
    for (const entity of toRemove) {
      destroyEntity(world, entity);
    }
  }
}
