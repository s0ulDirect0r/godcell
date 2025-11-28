// ============================================
// Network Broadcast System
// Handles all network broadcasts at end of tick
// ============================================
//
// This system demonstrates the ECS approach to network serialization:
// - Queries entities directly from ECS World
// - Uses serialization utilities to build messages
// - Owns its own throttle state (tick counters)
//
// The drain state broadcast still uses GameContext because that
// state (activeDamageThisTick, pseudopodHitDecays) hasn't been
// migrated to ECS yet.

import type { System } from './types';
import type { GameContext } from './GameContext';
import { GAME_CONFIG } from '@godcell/shared';
import {
  buildAllEnergyUpdates,
  buildDetectionUpdateMessage,
} from '../serialization';

// Throttle intervals (in ticks)
// Energy updates: ~6 times/sec at 60fps
const ENERGY_UPDATE_INTERVAL = 10;
// Detection updates: ~4 times/sec at 60fps
const DETECTION_UPDATE_INTERVAL = 15;

/**
 * NetworkBroadcastSystem - Handles end-of-tick broadcasts
 *
 * Broadcasts:
 * - Energy updates (throttled) - uses ECS queries
 * - Detection updates (throttled) - uses ECS queries
 * - Drain state updates - uses GameContext (legacy)
 *
 * This system runs last (highest priority number).
 */
export class NetworkBroadcastSystem implements System {
  readonly name = 'NetworkBroadcastSystem';

  // Tick counters for throttling
  private energyUpdateTicks = 0;
  private detectionUpdateTicks = 0;

  update(ctx: GameContext): void {
    this.broadcastEnergyUpdates(ctx);
    this.broadcastDetectionUpdates(ctx);
    this.broadcastDrainState(ctx);
  }

  /**
   * Broadcast energy updates to all clients (throttled).
   * Uses ECS queries to get player energy data.
   */
  private broadcastEnergyUpdates(ctx: GameContext): void {
    this.energyUpdateTicks++;

    if (this.energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
      this.energyUpdateTicks = 0;

      // Build energy messages from ECS
      const messages = buildAllEnergyUpdates(ctx.world);

      // Broadcast each message
      for (const msg of messages) {
        ctx.io.emit('energyUpdate', msg);
      }
    }
  }

  /**
   * Broadcast detection updates to multi-cell+ players (throttled).
   * Each player gets their own private detection message.
   * Uses ECS queries for detection range calculations.
   */
  private broadcastDetectionUpdates(ctx: GameContext): void {
    this.detectionUpdateTicks++;

    if (this.detectionUpdateTicks >= DETECTION_UPDATE_INTERVAL) {
      this.detectionUpdateTicks = 0;

      const detectionRadius = GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS;

      // Iterate all players and build detection messages
      ctx.world.forEachWithTag('player', (entity) => {
        const result = buildDetectionUpdateMessage(ctx.world, entity, detectionRadius);

        if (result) {
          // Send to specific socket (private information)
          const socket = ctx.io.sockets.sockets.get(result.socketId);
          if (socket) {
            socket.emit('detectionUpdate', result.message);
          }
        }
      });
    }
  }

  /**
   * Broadcast drain state updates to clients.
   * Still uses GameContext for legacy state (activeDamage, swarm drains).
   *
   * This will be migrated to ECS once damage tracking moves to components.
   */
  private broadcastDrainState(ctx: GameContext): void {
    // Delegate to legacy function for now
    ctx.broadcastDrainState();
  }
}
