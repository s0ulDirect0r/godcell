// ============================================
// Nutrient Collision System
// Handles nutrient collection by players
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * NutrientCollisionSystem - Handles nutrient pickup
 *
 * Currently wraps the existing checkNutrientCollisions() function.
 * Future: Move to operate on ECS Position/Energy/Nutrient components.
 */
export class NutrientCollisionSystem implements System {
  readonly name = 'NutrientCollisionSystem';

  update(ctx: GameContext): void {
    ctx.checkNutrientCollisions();
  }
}
