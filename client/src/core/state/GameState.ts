// ============================================
// Game State - Normalized Entity Storage
// ============================================

import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
  GameStateMessage,
} from '@godcell/shared';

export interface InterpolationTarget {
  x: number;
  y: number;
  timestamp: number;
}

export class GameState {
  // Entity maps (normalized storage)
  readonly players: Map<string, Player> = new Map();
  readonly nutrients: Map<string, Nutrient> = new Map();
  readonly obstacles: Map<string, Obstacle> = new Map();
  readonly swarms: Map<string, EntropySwarm> = new Map();
  readonly pseudopods: Map<string, Pseudopod> = new Map();

  // Interpolation targets (for smooth movement)
  readonly playerTargets: Map<string, InterpolationTarget> = new Map();
  readonly swarmTargets: Map<string, InterpolationTarget> = new Map();

  // Local player reference
  myPlayerId: string | null = null;

  /**
   * Apply full game state snapshot from server
   */
  applySnapshot(snapshot: GameStateMessage): void {
    // Clear existing state
    this.players.clear();
    this.nutrients.clear();
    this.obstacles.clear();
    this.swarms.clear();

    // Populate from snapshot (convert Record to Map)
    Object.values(snapshot.players).forEach(p => this.players.set(p.id, p));
    Object.values(snapshot.nutrients).forEach(n => this.nutrients.set(n.id, n));
    Object.values(snapshot.obstacles).forEach(o => this.obstacles.set(o.id, o));
    Object.values(snapshot.swarms).forEach(s => this.swarms.set(s.id, s));

    // Initialize interpolation targets
    Object.values(snapshot.players).forEach(p => {
      this.playerTargets.set(p.id, { x: p.position.x, y: p.position.y, timestamp: Date.now() });
    });
    Object.values(snapshot.swarms).forEach(s => {
      this.swarmTargets.set(s.id, { x: s.position.x, y: s.position.y, timestamp: Date.now() });
    });
  }

  /**
   * Upsert player (add or update)
   */
  upsertPlayer(player: Player): void {
    this.players.set(player.id, player);
    this.playerTargets.set(player.id, {
      x: player.position.x,
      y: player.position.y,
      timestamp: Date.now()
    });
  }

  /**
   * Remove player
   */
  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.playerTargets.delete(playerId);
  }

  /**
   * Update player position target (for interpolation)
   */
  updatePlayerTarget(playerId: string, x: number, y: number): void {
    const player = this.players.get(playerId);
    if (player) {
      player.position.x = x;
      player.position.y = y;
      this.playerTargets.set(playerId, { x, y, timestamp: Date.now() });
    }
  }

  /**
   * Upsert nutrient
   */
  upsertNutrient(nutrient: Nutrient): void {
    this.nutrients.set(nutrient.id, nutrient);
  }

  /**
   * Remove nutrient
   */
  removeNutrient(nutrientId: string): void {
    this.nutrients.delete(nutrientId);
  }

  /**
   * Update nutrient position (for animated nutrients)
   */
  updateNutrientPosition(nutrientId: string, x: number, y: number): void {
    const nutrient = this.nutrients.get(nutrientId);
    if (nutrient) {
      nutrient.position.x = x;
      nutrient.position.y = y;
    }
  }

  /**
   * Upsert swarm
   */
  upsertSwarm(swarm: EntropySwarm): void {
    this.swarms.set(swarm.id, swarm);
    this.swarmTargets.set(swarm.id, {
      x: swarm.position.x,
      y: swarm.position.y,
      timestamp: Date.now()
    });
  }

  /**
   * Remove swarm
   */
  removeSwarm(swarmId: string): void {
    this.swarms.delete(swarmId);
    this.swarmTargets.delete(swarmId);
  }

  /**
   * Update swarm position target (for interpolation)
   */
  updateSwarmTarget(swarmId: string, x: number, y: number, disabledUntil?: number): void {
    const swarm = this.swarms.get(swarmId);
    if (swarm) {
      swarm.position.x = x;
      swarm.position.y = y;
      swarm.disabledUntil = disabledUntil; // Update EMP stun state
      this.swarmTargets.set(swarmId, { x, y, timestamp: Date.now() });
    }
  }

  /**
   * Upsert pseudopod
   */
  upsertPseudopod(pseudopod: Pseudopod): void {
    this.pseudopods.set(pseudopod.id, pseudopod);
  }

  /**
   * Remove pseudopod
   */
  removePseudopod(pseudopodId: string): void {
    this.pseudopods.delete(pseudopodId);
  }

  /**
   * Update pseudopod position
   */
  updatePseudopodPosition(pseudopodId: string, x: number, y: number): void {
    const pseudopod = this.pseudopods.get(pseudopodId);
    if (pseudopod) {
      pseudopod.position.x = x;
      pseudopod.position.y = y;
    }
  }

  /**
   * Get local player
   */
  getMyPlayer(): Player | null {
    return this.myPlayerId ? this.players.get(this.myPlayerId) || null : null;
  }

  /**
   * Reset all state (for cleanup/testing)
   */
  reset(): void {
    this.players.clear();
    this.nutrients.clear();
    this.obstacles.clear();
    this.swarms.clear();
    this.pseudopods.clear();
    this.playerTargets.clear();
    this.swarmTargets.clear();
    this.myPlayerId = null;
  }
}
