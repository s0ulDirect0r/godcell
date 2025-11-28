// ============================================
// Core Components
// Shared by multiple entity types
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
