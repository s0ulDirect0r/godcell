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
 *
 * z-axis: Height in 3D space (0 = ground level)
 * - Stage 1-4: z is always 0 (grounded movement)
 * - Stage 5 (Godcell): z can vary (3D flight, range 0-2000)
 * z is optional for backwards compatibility - defaults to 0
 */
export interface PositionComponent {
  x: number;
  y: number;
  z?: number;  // Optional, defaults to 0
}

/**
 * Velocity - current movement direction and speed.
 * Used by: Players, Swarms, Pseudopods
 *
 * Stored separately from Position for physics system to process.
 * Units: pixels per second.
 *
 * z-axis: Vertical velocity for Stage 5 (Godcell) 3D flight.
 * z is optional for backwards compatibility - defaults to 0
 */
export interface VelocityComponent {
  x: number;
  y: number;
  z?: number;  // Optional, defaults to 0
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
  radius: number;         // Collision/visual radius in pixels (computed from stage)
}

/**
 * Input - current movement intent from player.
 * Processed by movement system each tick.
 *
 * z-axis: Vertical input for Stage 5 (Godcell) 3D flight.
 * - Q key = z: 1 (ascend)
 * - E key = z: -1 (descend)
 */
export interface InputComponent {
  direction: { x: number; y: number; z?: number }; // -1, 0, or 1 for each axis (z optional)
  lastInputTimestamp?: number;                     // For debugging/anti-cheat
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
 * Applied by EMP hits and trap detonations.
 */
export interface StunnedComponent {
  until: number; // Timestamp when stun expires
}

/**
 * SpawnImmunity - temporary immunity to gravity after spawning.
 * Gives players time to orient and escape gravity wells.
 */
export interface SpawnImmunityComponent {
  until: number; // Timestamp when immunity expires
}

/**
 * CombatSpecialization - Stage 3 combat pathway choice.
 * Chosen at evolution to Stage 3, locked for that life.
 */
export interface CombatSpecializationComponent {
  specialization: 'melee' | 'ranged' | 'traps' | null;  // Chosen pathway
  selectionPending: boolean;   // True while modal is shown, waiting for choice
  selectionDeadline?: number;  // Timestamp when auto-assign triggers
}

/**
 * Knockback - applied force that decays over time.
 * Used by melee attacks to push targets away.
 */
export interface KnockbackComponent {
  forceX: number;      // Knockback force in X direction (pixels/second)
  forceY: number;      // Knockback force in Y direction (pixels/second)
  decayRate: number;   // Force reduction per second
}

/**
 * Cooldowns - tracks ability usage timing.
 * Prevents ability spam.
 */
export interface CooldownsComponent {
  lastEMPTime?: number;       // Timestamp of last EMP use
  lastPseudopodTime?: number; // Timestamp of last pseudopod fire
  lastOrganismProjectileTime?: number; // Timestamp of last organism projectile fire (Stage 3+)
  lastMeleeSwipeTime?: number;  // Timestamp of last melee swipe
  lastMeleeThrustTime?: number; // Timestamp of last melee thrust
  lastTrapPlaceTime?: number;   // Timestamp of last trap placement
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
 * Tree - digital jungle tree (Stage 3+ environment).
 * Static obstacle that blocks movement for jungle-scale players.
 * Invisible and intangible to soup-scale (Stage 1-2) players.
 */
export interface TreeComponent {
  radius: number;    // Collision radius (trunk size)
  height: number;    // Visual height for rendering
  variant: number;   // Seed for procedural generation (0-1)
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
// Stage 3+ Macro-Resource Components
// ============================================

/**
 * DataFruit - harvestable resource that grows on digital trees.
 * Passive foraging option for Stage 3+ players.
 * Trees produce fruits periodically; bigger trees = more fruit.
 */
export interface DataFruitComponent {
  treeEntityId: number;       // EntityId of parent tree (0 if fallen/detached)
  value: number;              // Energy gain on collection
  capacityIncrease: number;   // maxEnergy increase (evolution progress)
  ripeness: number;           // 0-1, affects visual glow intensity
  fallenAt?: number;          // Timestamp when fruit fell from tree (undefined = still attached)
}

/**
 * CyberBug - small jungle creature that flees when approached.
 * Easy prey, low reward. Travels in swarms of 3-5.
 * Skittish AI: patrol until player approaches, then flee.
 */
export interface CyberBugComponent {
  swarmId: string;            // Groups bugs into swarms (same swarmId = same group)
  size: number;               // Collision radius
  state: 'idle' | 'patrol' | 'flee';
  fleeingFrom?: number;       // EntityId of player being fled from
  homePosition: Position;     // Spawn point for patrol behavior
  patrolTarget?: Position;    // Current wander destination
  value: number;              // Energy gain on kill
  capacityIncrease: number;   // maxEnergy increase on kill
}

/**
 * JungleCreature - larger NPC predator/prey in the digital jungle.
 * Medium risk/reward. Can be aggressive or passive depending on variant.
 * Stage 3 equivalent of soup's entropy swarms but huntable.
 */
export interface JungleCreatureComponent {
  variant: 'grazer' | 'stalker' | 'ambusher';  // Behavior archetype
  size: number;               // Collision radius (larger than bugs)
  state: 'idle' | 'patrol' | 'hunt' | 'flee';
  targetEntityId?: number;    // EntityId being hunted (if state === 'hunt')
  homePosition: Position;     // Spawn territory center
  territoryRadius: number;    // How far it wanders from home
  value: number;              // Energy gain on kill
  capacityIncrease: number;   // maxEnergy increase on kill
  aggressionRange?: number;   // Distance at which it attacks (stalker/ambusher only)
}

/**
 * Projectile - Stage 3 ranged specialization attack.
 * Used by ranged spec to hunt fauna and attack other players.
 */
export interface ProjectileComponent {
  ownerId: number;           // EntityId of player who fired
  ownerSocketId: string;     // For network attribution and rewards
  damage: number;            // Energy drained from target on hit
  capacitySteal: number;     // maxEnergy stolen from target (0 for fauna)
  startX: number;            // Starting position X
  startY: number;            // Starting position Y
  targetX: number;           // Target position X
  targetY: number;           // Target position Y
  speed: number;             // Travel speed (px/s)
  maxDistance: number;       // Max travel distance before despawn
  distanceTraveled: number;  // How far it's traveled
  state: 'traveling' | 'hit' | 'missed';
  hitEntityId?: number;      // EntityId of what was hit (if state === 'hit')
  color: string;             // Owner's color (for rendering)
  createdAt: number;         // Timestamp for tracking
}

/**
 * Trap - Stage 3 traps pathway disguised mine.
 * Looks like a DataFruit but detonates when enemies approach.
 * Applies damage and stun to the victim.
 */
export interface TrapComponent {
  ownerId: number;           // EntityId of player who placed
  ownerSocketId: string;     // For kill attribution
  damage: number;            // Energy damage on detonation
  stunDuration: number;      // Stun duration in ms
  triggerRadius: number;     // Activation distance from trap center
  placedAt: number;          // Timestamp for lifetime tracking
  lifetime: number;          // Max lifetime in ms before auto-despawn
  color: string;             // Owner's color (for rendering)
}

// ============================================
// Server-Only Components (deferred actions, timers)
// ============================================

/**
 * PendingRespawn - deferred entity spawning via ECS.
 * Replaces setTimeout patterns with queryable ECS entities.
 * System checks respawnAt timestamp and spawns when ready.
 *
 * Benefits over setTimeout:
 * - All pending respawns visible in ECS (queryable, debuggable)
 * - No orphaned timers on server shutdown
 * - Consistent with ECS architecture
 */
export interface PendingRespawnComponent {
  respawnAt: number;                    // Server timestamp when to respawn
  entityType: 'bot' | 'swarm' | 'nutrient';  // What to spawn
  stage?: number;                       // Evolution stage for bots (1-5)
  position?: { x: number; y: number };  // Optional spawn position
  metadata?: Record<string, unknown>;   // Extra data (e.g., nutrient value)
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
  targetZ?: number;       // Target Z position from server (height for Stage 5, optional)
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
