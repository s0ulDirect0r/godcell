// ============================================
// ECS Core Types
// ============================================

/**
 * Entity ID - just a number.
 * Entities have no data themselves, they're just IDs that
 * components are attached to.
 */
export type EntityId = number;

/**
 * Component type identifier - string key for component stores.
 * Using strings for readability and TypeScript ergonomics.
 */
export type ComponentType = string;

/**
 * Standard component types used throughout the ECS.
 * Using const object for type safety while keeping string values.
 */
export const Components = {
  // Core components (all entities may have)
  Position: 'Position',
  Velocity: 'Velocity',
  Energy: 'Energy',

  // Player-specific components
  Player: 'Player',
  Stage: 'Stage',
  Input: 'Input',
  Sprint: 'Sprint',
  Stunned: 'Stunned',
  Cooldowns: 'Cooldowns',
  DamageTracking: 'DamageTracking',
  DrainTarget: 'DrainTarget',

  // Entity-type components
  Nutrient: 'Nutrient',
  Obstacle: 'Obstacle',
  Swarm: 'Swarm',
  Pseudopod: 'Pseudopod',

  // Ability components (added/removed on evolution)
  CanFireEMP: 'CanFireEMP',
  CanFirePseudopod: 'CanFirePseudopod',
  CanSprint: 'CanSprint',
  CanEngulf: 'CanEngulf',
  CanDetect: 'CanDetect',

  // Client-only components (for interpolation and visual feedback)
  InterpolationTarget: 'InterpolationTarget',
  ClientDamageInfo: 'ClientDamageInfo',
} as const;

/**
 * Entity tags for quick type identification.
 * Tags are lightweight - just a Set<string> per entity.
 */
export const Tags = {
  Player: 'player',
  Bot: 'bot',
  Nutrient: 'nutrient',
  Obstacle: 'obstacle',
  Swarm: 'swarm',
  Pseudopod: 'pseudopod',

  // Transient per-tick tags (cleared at end of each tick)
  // Used for cross-system communication within a single game loop iteration
  SlowedThisTick: 'slowed_this_tick',
  DamagedThisTick: 'damaged_this_tick',
} as const;

// ============================================
// Resource Keys
// ============================================

/**
 * Standard resource keys for world.getResource/setResource.
 * Resources are singleton data not tied to entities.
 * Currently empty - available for future game resources
 * (global cooldowns, world events, etc.)
 */
export const Resources = {
  // Add game resources here as needed
} as const;
