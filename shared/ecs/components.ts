// ============================================
// ECS Component Interfaces
// All component data shapes for the ECS
// ============================================

import type { EvolutionStage, DeathCause, DamageSource, Position } from '../index';

// ============================================
// Core Components (shared by multiple entity types)
// ============================================

/**
 * Position - where an entity exists in the world.
 * Used by: Players, Nutrients, Obstacles, Swarms, Pseudopods
 */
export interface PositionComponent {
  x: number;
  y: number;
}

/**
 * Velocity - current movement direction and speed.
 * Used by: Players, Swarms, Pseudopods
 *
 * Stored separately from Position for physics system to process.
 * Units: pixels per second.
 */
export interface VelocityComponent {
  x: number;
  y: number;
}

/**
 * Energy - the single resource that drives survival.
 * 0 energy = instant death (dilution).
 * Used by: Players, Swarms (when disabled)
 */
export interface EnergyComponent {
  current: number;  // Current energy level
  max: number;      // Maximum energy capacity (grows with nutrients)
}

// ============================================
// Player-Specific Components
// ============================================

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
  // Pseudopod hit decay - brief damage display after beam hit
  pseudopodHitRate?: number;      // Damage rate to display
  pseudopodHitExpiresAt?: number; // Timestamp when decay expires
}

/**
 * Active drain state - when a multi-cell is draining a prey.
 * Maps this entity (prey) to the predator.
 */
export interface DrainTargetComponent {
  predatorId: number; // EntityId of the predator draining this entity
}

// ============================================
// Entity Type Components
// ============================================

/**
 * Nutrient - data packet that players collect.
 * Collection increases energy and maxEnergy.
 */
export interface NutrientComponent {
  value: number;            // Immediate energy gain
  capacityIncrease: number; // Permanent maxEnergy increase
  valueMultiplier: number;  // Proximity multiplier (1/2/3/5) - determines color
  isHighValue: boolean;     // True if spawned near obstacle
}

/**
 * Obstacle - gravity distortion (mini black hole).
 * Attracts entities toward its center.
 */
export interface ObstacleComponent {
  radius: number;    // Gravity influence radius (escapable zone)
  strength: number;  // Gravity force multiplier
  // Note: Event horizon and core radius are derived from GAME_CONFIG
}

/**
 * Swarm - entropy swarm (virus enemy).
 * Hunts players and drains their energy.
 */
export interface SwarmComponent {
  size: number;                    // Radius for collision detection
  state: 'patrol' | 'chase';       // Current AI state
  targetPlayerId?: string;         // Socket ID being chased (if state === 'chase')
  patrolTarget?: Position;         // Where swarm is wandering toward
  homePosition: Position;          // Spawn point (for patrol radius)
  disabledUntil?: number;          // Timestamp when EMP stun expires
  beingConsumedBy?: string;        // Player socketId currently consuming this swarm
  // Note: Swarm energy is stored in EnergyComponent when disabled
}

/**
 * Pseudopod - lightning projectile fired by multi-cells.
 * Travels toward target and drains energy on hit.
 */
export interface PseudopodComponent {
  ownerId: number;         // EntityId of player who fired
  ownerSocketId: string;   // For quick lookup and network messages
  width: number;           // Beam collision width
  maxDistance: number;     // Max travel distance
  distanceTraveled: number; // How far it's traveled
  createdAt: number;       // Timestamp for tracking
  color: string;           // Owner's color (for rendering)
  hitEntities: Set<number>; // EntityIds already hit (prevent double-hit)
}

// ============================================
// Ability Marker Components
// ============================================

// Note: These are "marker" components - they have no data,
// but their presence/absence on an entity determines capabilities.
// Systems check for these components to allow/disallow actions.

/**
 * CanFireEMP - entity can use EMP pulse ability.
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Stuns nearby swarms and players, drains energy
 */
export interface CanFireEMPComponent {
  // Marker component - presence enables EMP ability
  // Cooldown tracked in CooldownsComponent
}

/**
 * CanFirePseudopod - entity can fire pseudopod beam.
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Long-range energy drain projectile
 */
export interface CanFirePseudopodComponent {
  // Marker component - presence enables pseudopod ability
  // Cooldown tracked in CooldownsComponent
}

/**
 * CanSprint - entity can use sprint speed boost.
 * Granted at: Stage 3 (Cyber-organism) and above
 * Effect: Increased speed at energy cost
 */
export interface CanSprintComponent {
  // Marker component - presence enables sprint ability
  // Active state tracked in SprintComponent
}

/**
 * CanEngulf - entity can drain smaller entities on contact.
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Contact with smaller stage entities drains their energy
 */
export interface CanEngulfComponent {
  // Marker component - presence enables contact predation
}

/**
 * CanDetect - entity has chemical sensing (radar).
 * Granted at: Stage 2 (Multi-cell) and above
 * Effect: Can see entities within detection radius
 *
 * NOTE: Unlike other ability components, this is NOT a pure marker —
 * it carries data (radius). This is an exception to the marker pattern.
 */
export interface CanDetectComponent {
  radius: number; // Detection range in pixels
}

// ============================================
// Client-Only Components
// ============================================

/**
 * InterpolationTarget - client-side smooth movement target.
 * Stores the target position for interpolation between server updates.
 * Used by: Players, Swarms (entities that move)
 */
export interface InterpolationTargetComponent {
  targetX: number;        // Target X position from server
  targetY: number;        // Target Y position from server
  timestamp: number;      // When this target was received
}

/**
 * ClientDamageInfo - client-side damage info for visual feedback.
 * Stores damage rates and sources for drain aura rendering.
 * Used by: Players, Swarms (entities that can be damaged)
 */
export interface ClientDamageInfoComponent {
  totalDamageRate: number;       // Combined damage rate from all sources
  primarySource: DamageSource;   // Main damage source type (for color)
  proximityFactor?: number;      // For gradient effects (0-1)
}
