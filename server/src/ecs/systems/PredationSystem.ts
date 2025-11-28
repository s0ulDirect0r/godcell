// ============================================
// Predation System
// Handles predator-prey interactions (engulfing, draining)
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * PredationSystem - Manages predation between players
 *
 * Currently wraps the existing checkPredationCollisions() function.
 * Future: Move to operate on ECS Stage/Energy components directly.
 */
export class PredationSystem implements System {
  readonly name = 'PredationSystem';

  update(ctx: GameContext): void {
    ctx.checkPredationCollisions(ctx.deltaTime);
  }
}
