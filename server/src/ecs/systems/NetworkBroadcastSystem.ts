// ============================================
// Network Broadcast System
// Handles all network broadcasts at end of tick
// ============================================
//
// During ECS migration, this system delegates to legacy broadcast functions
// in GameContext. The game logic still writes to legacy Maps, so we must
// read from those Maps for accurate data.
//
// Once game logic (metabolism, damage, etc.) moves to ECS, we can switch
// to the ECS serialization utilities in ../serialization/.

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * NetworkBroadcastSystem - Handles end-of-tick broadcasts
 *
 * Broadcasts:
 * - Energy updates (throttled)
 * - Detection updates (throttled)
 * - Drain state updates
 *
 * This system runs last (highest priority number).
 * Currently delegates to legacy functions until game logic is in ECS.
 */
export class NetworkBroadcastSystem implements System {
  readonly name = 'NetworkBroadcastSystem';

  update(ctx: GameContext): void {
    // Delegate to legacy functions that read from the legacy Maps
    // These have the correct, up-to-date energy values
    ctx.broadcastEnergyUpdates();
    ctx.broadcastDetectionUpdates();
    ctx.broadcastDrainState();
  }
}
