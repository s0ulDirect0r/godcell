// ============================================
// Pseudopod System
// Handles pseudopod (beam) movement and collision
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * PseudopodSystem - Manages pseudopod projectiles
 *
 * Currently wraps the existing updatePseudopods() function.
 * Future: Move to operate on ECS Pseudopod components directly.
 */
export class PseudopodSystem implements System {
  readonly name = 'PseudopodSystem';

  update(ctx: GameContext): void {
    ctx.updatePseudopods(ctx.deltaTime, ctx.io);
  }
}
