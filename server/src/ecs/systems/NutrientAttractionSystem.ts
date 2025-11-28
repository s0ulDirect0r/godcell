// ============================================
// Nutrient Attraction System
// Attracts nutrients toward gravity wells (visual effect)
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * NutrientAttractionSystem - Attracts nutrients to obstacles
 *
 * Currently wraps the existing attractNutrientsToObstacles() function.
 * Future: Move to operate on ECS Position/Obstacle components.
 */
export class NutrientAttractionSystem implements System {
  readonly name = 'NutrientAttractionSystem';

  update(ctx: GameContext): void {
    ctx.attractNutrientsToObstacles(ctx.deltaTime);
  }
}
