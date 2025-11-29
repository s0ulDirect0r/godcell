// ============================================
// Bot AI System
// Handles bot decision making and target selection
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * BotAISystem - Manages AI decision making for bots
 *
 * Currently wraps the existing updateBots() function.
 * Future: Move bot AI logic to operate on ECS components directly.
 */
export class BotAISystem implements System {
  readonly name = 'BotAISystem';

  update(ctx: GameContext): void {
    const { updateBots, nutrients, obstacles, getSwarms, players, abilitySystem, world } = ctx;

    updateBots(
      Date.now(),
      nutrients,
      obstacles,
      Array.from(getSwarms().values()),
      players,
      abilitySystem,
      world
    );
  }
}
