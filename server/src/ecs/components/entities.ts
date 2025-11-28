// ============================================
// Entity Type Components
// Marker + data components for non-player entities
// ============================================

import type { Position } from '@godcell/shared';

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
  targetPlayerId?: number;         // EntityId being chased (if state === 'chase')
  patrolTarget?: Position;         // Where swarm is wandering toward
  homePosition: Position;          // Spawn point (for patrol radius)
  disabledUntil?: number;          // Timestamp when EMP stun expires
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
