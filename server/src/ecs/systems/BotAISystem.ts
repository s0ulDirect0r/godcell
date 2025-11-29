// ============================================
// Bot AI System
// Handles bot decision making and target selection
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import { getAllSwarmSnapshots } from '../factories';

/**
 * BotAISystem - Manages AI decision making for bots
 *
 * Currently wraps the existing updateBots() function.
 * Future: Move bot AI logic to operate on ECS components directly.
 */
export class BotAISystem implements System {
  readonly name = 'BotAISystem';

  update(ctx: GameContext): void {
    const { updateBots, abilitySystem, world } = ctx;

    // Get swarms from ECS (source of truth)
    const swarms = getAllSwarmSnapshots(world);

    // updateBots now queries nutrients, obstacles, and swarms from ECS
    updateBots(
      Date.now(),
      world,
      swarms,
      abilitySystem
    );
  }
}
