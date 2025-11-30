// ============================================
// Bot AI System
// Handles bot decision making and target selection
// ============================================

import type { World } from '@godcell/shared';
import type { System } from './types';
import { getAllSwarmSnapshots } from '../factories';
import { updateBots } from '../../bots';
import { abilitySystem } from '../../index';

/**
 * BotAISystem - Manages AI decision making for bots
 *
 * Calls updateBots directly (imported from bots.ts).
 * The updateBots function operates on ECS components as source of truth.
 */
export class BotAISystem implements System {
  readonly name = 'BotAISystem';

  update(world: World): void {
    // Get swarms from ECS (source of truth)
    const swarms = getAllSwarmSnapshots(world);

    // updateBots now queries nutrients, obstacles, and swarms from ECS
    // abilitySystem is imported directly as a module singleton
    updateBots(
      Date.now(),
      world,
      swarms,
      abilitySystem
    );
  }
}
