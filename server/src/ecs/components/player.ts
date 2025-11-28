// ============================================
// Player Components
// State specific to player entities (human or bot)
// ============================================

import type { EvolutionStage, DeathCause, DamageSource } from '@godcell/shared';

/**
 * Player identity - who this player is.
 * Immutable after creation (except name).
 */
export interface PlayerComponent {
  socketId: string;   // Socket.io connection ID
  name: string;       // Display name
  color: string;      // Hex color like "#FF5733"
}

/**
 * Evolution stage - current form and transition state.
 * Determines: abilities, size, speed, energy capacity.
 */
export interface StageComponent {
  stage: EvolutionStage;
  isEvolving: boolean;    // True during molting animation
  evolvingUntil?: number; // Timestamp when evolution completes (for invulnerability)
}

/**
 * Input - current movement intent from player.
 * Processed by movement system each tick.
 */
export interface InputComponent {
  direction: { x: number; y: number }; // -1, 0, or 1 for each axis
  lastInputTimestamp?: number;         // For debugging/anti-cheat
}

/**
 * Sprint state - Stage 3+ speed boost ability.
 * Consumes energy while active.
 */
export interface SprintComponent {
  isSprinting: boolean;
}

/**
 * Stunned state - entity cannot move or act.
 * Applied by EMP hits.
 */
export interface StunnedComponent {
  until: number; // Timestamp when stun expires
}

/**
 * Cooldowns - tracks ability usage timing.
 * Prevents ability spam.
 */
export interface CooldownsComponent {
  lastEMPTime?: number;       // Timestamp of last EMP use
  lastPseudopodTime?: number; // Timestamp of last pseudopod fire
}

/**
 * Damage tracking - for death cause logging and kill rewards.
 * Tracks what last damaged this entity and who fired the killing blow.
 */
export interface DamageTrackingComponent {
  lastDamageSource?: DeathCause;  // What last damaged this entity
  lastBeamShooter?: string;       // Player ID who fired last beam hit (for kill rewards)
  activeDamage: Array<{           // Current tick's damage sources (for drain auras)
    damageRate: number;
    source: DamageSource;
    proximityFactor?: number;     // For gravity gradient (0-1)
  }>;
}

/**
 * Active drain state - when a multi-cell is draining a prey.
 * Maps this entity (prey) to the predator.
 */
export interface DrainTargetComponent {
  predatorId: number; // EntityId of the predator draining this entity
}
