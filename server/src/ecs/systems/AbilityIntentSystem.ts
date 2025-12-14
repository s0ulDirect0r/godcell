// ============================================
// AbilityIntentSystem
// Processes ability intents and pending expirations
// ============================================

import type { Server } from 'socket.io';
import type { World, AbilityIntentComponent, PendingExpirationComponent } from '#shared';
import { Components, type PlayerComponent } from '#shared';
import type { System } from './types';
import { logger } from '../../logger';

// Import ability functions
import {
  fireEMP,
  firePseudopod,
  fireProjectile,
  fireMeleeAttack,
  placeTrap,
} from '../../abilities';

/**
 * AbilityIntentSystem - Processes ability intents each tick
 *
 * This system enables tick-based ability execution:
 * - Socket handlers add AbilityIntent components to entities
 * - This system processes intents, validates, executes abilities, removes intents
 * - Ensures consistent timing between player (socket) and bot (AI) ability usage
 *
 * Also handles PendingExpiration for entity cleanup (replaces setTimeout patterns)
 *
 * Priority: 250 (after BotAI at 100, before PseudopodSystem at 300)
 */
export class AbilityIntentSystem implements System {
  readonly name = 'AbilityIntentSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    // Process all ability intents
    this.processAbilityIntents(world, io);

    // Process pending expirations
    this.processPendingExpirations(world);
  }

  /**
   * Process all entities with AbilityIntent components
   */
  private processAbilityIntents(world: World, io: Server): void {
    const entities = world.query(Components.AbilityIntent);

    for (const entity of entities) {
      const intent = world.getComponent<AbilityIntentComponent>(entity, Components.AbilityIntent);
      if (!intent) continue;

      // Get player info for ability execution
      const playerComp = world.getComponent<PlayerComponent>(entity, Components.Player);
      if (!playerComp) {
        // Not a player entity, remove intent and skip
        world.removeComponent(entity, Components.AbilityIntent);
        continue;
      }

      const playerId = playerComp.socketId;

      // Process based on ability type - call ability functions directly
      let success = false;
      switch (intent.abilityType) {
        case 'emp':
          success = fireEMP(world, io, entity, playerId);
          break;

        case 'pseudopod':
          if (intent.targetX !== undefined && intent.targetY !== undefined) {
            success = firePseudopod(world, io, entity, playerId, intent.targetX, intent.targetY);
          }
          break;

        case 'projectile':
          if (intent.targetX !== undefined && intent.targetY !== undefined) {
            success = fireProjectile(world, io, entity, playerId, intent.targetX, intent.targetY);
          }
          break;

        case 'melee':
          if (
            intent.meleeAttackType &&
            intent.targetX !== undefined &&
            intent.targetY !== undefined
          ) {
            success = fireMeleeAttack(
              world,
              io,
              entity,
              playerId,
              intent.meleeAttackType,
              intent.targetX,
              intent.targetY
            );
          }
          break;

        case 'trap':
          success = placeTrap(world, io, entity, playerId);
          break;

        default:
          logger.warn({
            event: 'unknown_ability_intent',
            playerId,
            abilityType: intent.abilityType,
          });
      }

      // Always remove intent after processing (success or failure)
      world.removeComponent(entity, Components.AbilityIntent);

      // Log intent processing (only failures, successes logged by ability functions)
      if (!success) {
        logger.debug({
          event: 'ability_intent_failed',
          playerId,
          abilityType: intent.abilityType,
        });
      }
    }
  }

  /**
   * Process entities with PendingExpiration - destroy when time's up
   */
  private processPendingExpirations(world: World): void {
    const now = Date.now();
    const entities = world.query(Components.PendingExpiration);

    for (const entity of entities) {
      const expiration = world.getComponent<PendingExpirationComponent>(
        entity,
        Components.PendingExpiration
      );
      if (!expiration) continue;

      if (now >= expiration.expiresAt) {
        // Time's up, destroy the entity
        world.destroyEntity(entity);
      }
    }
  }
}
