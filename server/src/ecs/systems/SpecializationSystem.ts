// ============================================
// Specialization System
// Handles Stage 3 combat specialization selection timeout
// ============================================

import type { Server } from 'socket.io';
import type { World, SpecializationSelectedMessage, CombatSpecialization } from '#shared';
import { Tags } from '#shared';
import type { System } from './types';
import {
  Components,
  getSocketIdByEntity,
  type CombatSpecializationComponent,
} from '../index';
import { logger } from '../../logger';
import { isBot } from '../../bots';

// Valid specialization choices for random assignment
const SPECIALIZATION_CHOICES: CombatSpecialization[] = ['melee', 'ranged', 'traps'];

/**
 * SpecializationSystem - Manages Stage 3 combat specialization timeout
 *
 * When a player evolves to Stage 3, they have a brief window to choose
 * their combat specialization (melee, ranged, or traps). If they don't
 * choose in time, a random specialization is assigned.
 *
 * Priority: 120 (after AI systems, before physics)
 */
export class SpecializationSystem implements System {
  readonly name = 'SpecializationSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    const now = Date.now();

    // Check all players with pending specialization selections
    world.forEachWithTag(Tags.Player, (entity) => {
      const specComp = world.getComponent<CombatSpecializationComponent>(
        entity,
        Components.CombatSpecialization
      );

      // Skip if no specialization component or selection not pending
      if (!specComp || !specComp.selectionPending) return;

      // Check if deadline has passed
      if (specComp.selectionDeadline && now >= specComp.selectionDeadline) {
        // Auto-assign random specialization
        const randomIndex = Math.floor(Math.random() * SPECIALIZATION_CHOICES.length);
        specComp.specialization = SPECIALIZATION_CHOICES[randomIndex];
        specComp.selectionPending = false;

        const socketId = getSocketIdByEntity(entity);
        if (!socketId) return;

        // Broadcast the selection to all clients
        const selectedMessage: SpecializationSelectedMessage = {
          type: 'specializationSelected',
          playerId: socketId,
          specialization: specComp.specialization,
        };
        io.emit('specializationSelected', selectedMessage);

        logger.info({
          event: isBot(socketId) ? 'bot_specialization_auto_assigned' : 'player_specialization_auto_assigned',
          playerId: socketId,
          specialization: specComp.specialization,
        });
      }
    });
  }
}
