// ============================================
// Shared Types & Interfaces
// Game entities, enums, and type definitions
// ============================================

// Player position in the game world
// z-axis: Height in 3D space (0 = ground, used for Stage 5 flying)
// z is optional for backwards compatibility - defaults to 0 when not specified
export interface Position {
  x: number;
  y: number;
  z?: number; // Optional, defaults to 0 (ground level)
}

// Velocity vector (units per second)
// Same shape as Position but represents rate of change, not location
export interface Velocity {
  x: number;
  y: number;
  z?: number; // Optional, defaults to 0
}

// Death causes for players
export type DeathCause =
  | 'starvation'
  | 'singularity'
  | 'swarm'
  | 'obstacle'
  | 'predation'
  | 'beam'
  | 'gravity'
  | 'consumption';

// Damage sources for visual feedback (drain auras)
export type DamageSource =
  | 'predation' // Red (multi-cell contact drain)
  | 'swarm' // Red (entropy swarm attacks)
  | 'beam' // Red (pseudopod projectiles)
  | 'gravity' // Red (gravity well crushing)
  | 'starvation' // Yellow/orange (zero energy)
  | 'melee' // Red (Stage 3 melee attacks)
  | 'trap'; // Red (Stage 3 trap detonation)

// ============================================
// Stage 3 Combat Specialization
// Chosen at evolution to Stage 3, locked for that life
// ============================================

// Combat pathway chosen at Stage 3 evolution
export type CombatSpecialization = 'melee' | 'ranged' | 'traps' | null;

// Melee attack types for the melee pathway
export type MeleeAttackType = 'swipe' | 'thrust';

// Evolution stages
export enum EvolutionStage {
  SINGLE_CELL = 'single_cell',
  MULTI_CELL = 'multi_cell',
  CYBER_ORGANISM = 'cyber_organism',
  HUMANOID = 'humanoid',
  GODCELL = 'godcell',
}

// Entity scale - determines which render layer an entity belongs to
// Used for filtering visuals (auras, effects) by viewer's scale
//   soup   - Stage 1-2 (single-cell, multi-cell) - microscopic primordial ocean
//   jungle - Stage 3-4 (cyber-organism, humanoid) - digital jungle ecosystem
//   world  - Stage 5 (godcell) - transcendent global scale
export type EntityScale = 'soup' | 'jungle' | 'world';

/**
 * Get the scale of an entity based on its evolution stage.
 * Used for filtering visual effects - entities only see effects
 * from other entities at the same scale.
 */
export function getEntityScale(stage: EvolutionStage): EntityScale {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
    case EvolutionStage.MULTI_CELL:
      return 'soup';
    case EvolutionStage.CYBER_ORGANISM:
    case EvolutionStage.HUMANOID:
      return 'jungle';
    case EvolutionStage.GODCELL:
      return 'world';
  }
}

// A player in the game
export interface Player {
  id: string;
  position: Position;
  velocity: Velocity; // Current movement (units/sec) - used for client-side visual effects
  color: string; // Hex color like "#FF5733"

  // Energy-Only System
  // Energy is the sole resource: fuel, life, survival
  // 0 energy = instant death (dilution)
  energy: number; // Current energy - decays over time, drained by threats
  maxEnergy: number; // Capacity - grows with nutrients collected

  // Evolution
  stage: EvolutionStage;
  isEvolving: boolean; // True during molting animation
  radius: number; // Collision/visual radius in pixels (derived from stage)

  // EMP Ability (Multi-cell+)
  lastEMPTime?: number; // Timestamp of last EMP use (for cooldown tracking)
  stunnedUntil?: number; // Timestamp when stun expires (if hit by another player's EMP)
}

// A nutrient (data packet) that players can collect
export interface Nutrient {
  id: string;
  position: Position;
  value: number; // Immediate energy value when collected (scales with proximity: 25/50/75/125)
  capacityIncrease: number; // Permanent maxEnergy increase (scales with proximity: 10/20/30/50)
  valueMultiplier: number; // Proximity multiplier (1/2/3/5) - determines color
  isHighValue?: boolean; // True if spawned near obstacle (multiplier > 1)
}

// A gravity distortion obstacle (mini black hole)
export interface Obstacle {
  id: string;
  position: Position;
  radius: number; // Gravity influence radius (600px - escapable zone)
  strength: number; // Gravity force multiplier
  damageRate: number; // UNUSED - gravity wells are physics-only (singularity = instant death)
}

// An entropy swarm (virus enemy)
export interface EntropySwarm {
  id: string;
  position: Position;
  velocity: { x: number; y: number }; // Current movement direction/speed
  size: number; // Radius for collision detection
  state: 'patrol' | 'chase'; // AI state
  targetPlayerId?: string; // Player being chased (if state === 'chase')
  patrolTarget?: Position; // Where swarm is wandering toward (if state === 'patrol')
  disabledUntil?: number; // Timestamp when EMP stun expires (if disabled)
  energy?: number; // Energy pool during consumption (set to SWARM_ENERGY when disabled by EMP)
}

// A pseudopod beam (lightning projectile fired by multi-cells)
export interface Pseudopod {
  id: string;
  ownerId: string; // Player who fired it
  position: Position; // Current beam position
  velocity: { x: number; y: number }; // Travel direction and speed
  width: number; // Beam collision width
  maxDistance: number; // Max travel distance (3x multi-cell radius)
  distanceTraveled: number; // How far it's traveled
  createdAt: number; // Timestamp for tracking
  color: string; // Owner's color (for rendering)
}

// A digital jungle tree (Stage 3+ environment obstacle)
export interface Tree {
  id: string;
  position: Position;
  radius: number; // Collision radius (trunk size)
  height: number; // Visual height for rendering
  variant: number; // Seed for procedural generation (0-1)
}

// ============================================
// Stage 3+ Macro-Resources (Digital Jungle Ecosystem)
// ============================================

// DataFruit - harvestable resource that grows near digital trees
export interface DataFruit {
  id: string;
  position: Position;
  treeEntityId: number; // EntityId of parent tree (0 if fallen/detached)
  value: number; // Energy gain on collection
  capacityIncrease: number; // maxEnergy increase (evolution progress)
  ripeness: number; // 0-1, affects visual glow intensity
  fallenAt?: number; // Timestamp when fruit fell (undefined = still on tree)
}

// CyberBug - small skittish prey in swarms
export interface CyberBug {
  id: string;
  position: Position;
  swarmId: string; // Groups bugs into swarms
  state: 'idle' | 'patrol' | 'flee';
  value: number; // Energy gain on kill
  capacityIncrease: number; // maxEnergy increase on kill
}

// JungleCreature - larger NPC fauna with variant behaviors
export interface JungleCreature {
  id: string;
  position: Position;
  variant: 'grazer' | 'stalker' | 'ambusher';
  state: 'idle' | 'patrol' | 'hunt' | 'flee';
  value: number; // Energy gain on kill
  capacityIncrease: number; // maxEnergy increase on kill
}

// EntropySerpent - apex predator of the jungle
export interface EntropySerpent {
  id: string;
  position: Position;
  state: 'patrol' | 'chase' | 'attack';
  heading: number; // Facing direction in radians
  targetPlayerId?: string; // Player being hunted (if chasing/attacking)
}

// Projectile - Stage 3 ranged specialization attack
export interface Projectile {
  id: string;
  ownerId: string; // Socket ID of player who fired
  position: Position; // Current position
  targetPosition: Position; // Where it's heading
  state: 'traveling' | 'hit' | 'missed';
  color: string; // Owner's color (for rendering)
}

// Trap - Stage 3 traps pathway disguised mine
export interface Trap {
  id: string;
  ownerId: string; // Socket ID of player who placed
  position: Position;
  triggerRadius: number; // Activation distance
  damage: number; // Energy damage on trigger
  stunDuration: number; // Stun duration in ms
  placedAt: number; // Timestamp for lifetime tracking
  lifetime: number; // Max lifetime in ms
  color: string; // Owner's color (for rendering)
}

// Entity types that can be spawned via dev panel
export type SpawnableEntityType =
  | 'nutrient'
  | 'swarm'
  | 'obstacle'
  | 'single-cell'
  | 'multi-cell'
  | 'cyber-organism';
