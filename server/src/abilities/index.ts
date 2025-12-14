// ============================================
// Abilities - Standalone ability functions
// ============================================
//
// Stage-ability mapping:
// - Stage 1 (Single-Cell): No abilities
// - Stage 2 (Multi-Cell): EMP, Pseudopod
// - Stage 3 (Cyber-Organism): Projectile, Melee, Trap
// - Stage 4 (Humanoid): TBD
// - Stage 5 (Godcell): TBD
//
// All abilities are now called via AbilityIntentSystem.
// Socket handlers and bot AI add AbilityIntent components,
// and AbilityIntentSystem processes them each tick.

// Export standalone ability functions
export { fireEMP, canFireEMP } from './emp';
export { firePseudopod, canFirePseudopod } from './pseudopod';
export { fireProjectile, canFireProjectile } from './projectile';
export { fireMeleeAttack } from './melee';
export { placeTrap, canPlaceTrap } from './trap';
