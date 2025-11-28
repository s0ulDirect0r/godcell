// ============================================
// Metabolism System
// Handles energy decay, starvation, and evolution checks
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * MetabolismSystem - Manages player metabolism
 *
 * Currently wraps the existing updateMetabolism() function.
 * Future: Move to operate on ECS Energy/Stage components directly.
 */
export class MetabolismSystem implements System {
  readonly name = 'MetabolismSystem';

  update(ctx: GameContext): void {
    ctx.updateMetabolism(ctx.deltaTime);
  }
}
