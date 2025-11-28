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

  // Entity-type components
  Nutrient: 'Nutrient',
  Obstacle: 'Obstacle',
  Swarm: 'Swarm',
  Pseudopod: 'Pseudopod',

  // Ability components (added/removed on evolution)
  CanFireEMP: 'CanFireEMP',
  CanFirePseudopod: 'CanFirePseudopod',
  CanSprint: 'CanSprint',
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
} as const;
