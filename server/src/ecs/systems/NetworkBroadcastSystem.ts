// ============================================
// Network Broadcast System
// Handles all network broadcasts at end of tick
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * NetworkBroadcastSystem - Handles end-of-tick broadcasts
 *
 * This system runs last and broadcasts:
 * - Energy updates (throttled)
 * - Detection updates (for multi-cells)
 * - Drain state updates
 *
 * Currently wraps existing broadcast functions.
 * Future: Build broadcast messages directly from ECS state.
 */
export class NetworkBroadcastSystem implements System {
  readonly name = 'NetworkBroadcastSystem';

  update(ctx: GameContext): void {
    ctx.broadcastEnergyUpdates();
    ctx.broadcastDetectionUpdates();
    ctx.broadcastDrainState();
  }
}
