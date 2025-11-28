// ============================================
// Death System
// Handles player death checks and processing
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * DeathSystem - Checks for and processes player deaths
 *
 * Currently wraps the existing checkPlayerDeaths() function.
 * Future: Move to operate on ECS Energy/Player components.
 */
export class DeathSystem implements System {
  readonly name = 'DeathSystem';

  update(ctx: GameContext): void {
    ctx.checkPlayerDeaths();
  }
}
