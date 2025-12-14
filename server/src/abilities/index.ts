// ============================================
// Ability System - Manages all player/bot abilities
// ============================================

import type { MeleeAttackType, EntityId } from '#shared';
import type { AbilityContext } from './types';

// Re-export types
export type { AbilityContext } from './types';

// Re-export standalone functions
export { fireEMP, canFireEMP } from './emp';
export { firePseudopod, canFirePseudopod } from './pseudopod';
export { fireProjectile, canFireProjectile } from './projectile';
export { fireMeleeAttack } from './melee';
export { placeTrap, canPlaceTrap } from './trap';

// Import for class delegation
import { fireEMP, canFireEMP } from './emp';
import { firePseudopod, canFirePseudopod } from './pseudopod';
import { fireProjectile, canFireProjectile } from './projectile';
import { fireMeleeAttack } from './melee';
import { placeTrap, canPlaceTrap } from './trap';

/**
 * AbilitySystem manages all active abilities in the game.
 *
 * Stage-ability mapping:
 * - Stage 1 (Single-Cell): No abilities
 * - Stage 2 (Multi-Cell): EMP, Pseudopod
 * - Stage 3 (Cyber-Organism): Sprint, Projectiles (future)
 * - Stage 4 (Humanoid): TBD
 * - Stage 5 (Godcell): TBD
 */
export class AbilitySystem {
  constructor(private ctx: AbilityContext) {}

  // Stage 2: Multi-Cell Abilities
  fireEMP(entity: EntityId, playerId: string): boolean {
    return fireEMP(this.ctx, entity, playerId);
  }

  canFireEMP(entity: EntityId): boolean {
    return canFireEMP(this.ctx, entity);
  }

  firePseudopod(entity: EntityId, playerId: string, targetX: number, targetY: number): boolean {
    return firePseudopod(this.ctx, entity, playerId, targetX, targetY);
  }

  canFirePseudopod(entity: EntityId): boolean {
    return canFirePseudopod(this.ctx, entity);
  }

  // Stage 3: Cyber-Organism Abilities
  fireProjectile(entity: EntityId, playerId: string, targetX: number, targetY: number): boolean {
    return fireProjectile(this.ctx, entity, playerId, targetX, targetY);
  }

  canFireProjectile(entity: EntityId): boolean {
    return canFireProjectile(this.ctx, entity);
  }

  fireMeleeAttack(
    entity: EntityId,
    playerId: string,
    attackType: MeleeAttackType,
    targetX: number,
    targetY: number
  ): boolean {
    return fireMeleeAttack(this.ctx, entity, playerId, attackType, targetX, targetY);
  }

  placeTrap(entity: EntityId, playerId: string): boolean {
    return placeTrap(this.ctx, entity, playerId);
  }

  canPlaceTrap(entity: EntityId, playerId: string): boolean {
    return canPlaceTrap(this.ctx, entity, playerId);
  }
}
