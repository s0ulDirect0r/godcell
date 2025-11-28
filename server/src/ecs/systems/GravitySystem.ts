// ============================================
// Gravity System
// Applies gravitational forces from obstacles to entities
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * GravitySystem - Applies gravity forces from obstacles
 *
 * Currently wraps the existing applyGravityForces() function.
 * Future: Read from ECS Obstacle/Position components, write to Velocity components.
 */
export class GravitySystem implements System {
  readonly name = 'GravitySystem';

  update(ctx: GameContext): void {
    ctx.applyGravityForces(ctx.deltaTime);
  }
}
