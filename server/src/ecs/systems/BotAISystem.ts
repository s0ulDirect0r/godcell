// ============================================
// Bot AI System
// Handles bot decision making and target selection
// ============================================

import type { Server } from 'socket.io';
import type { World } from '#shared';
import type { System } from './types';
import { getAllSwarmSnapshots } from '../factories';
import { updateBots } from '../../bots';

/**
 * BotAISystem - Manages AI decision making for bots
 *
 * Calls updateBots directly (imported from bots.ts).
 * The updateBots function operates on ECS components as source of truth.
 * Bots add AbilityIntent components instead of calling ability functions directly.
 */
export class BotAISystem implements System {
  readonly name = 'BotAISystem';

  update(world: World, _deltaTime: number, _io: Server): void {
    // Get swarms from ECS (source of truth)
    const swarms = getAllSwarmSnapshots(world);

    // updateBots queries nutrients, obstacles, and swarms from ECS
    // Bots add AbilityIntent components, processed by AbilityIntentSystem
    updateBots(Date.now(), world, swarms);
  }
}
