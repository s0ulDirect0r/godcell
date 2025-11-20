/**
 * Single source of truth for client-side game state.
 * Owns all entity maps and interpolation buffer.
 * Updated by MessageProcessor, read by renderer and UI.
 */

import type { Player, Nutrient, Obstacle, EntropySwarm, Pseudopod } from '@godcell/shared';
import { InterpolationBuffer } from './interpolation';

/**
 * Client-side canonical game state
 */
export class GameState {
  // Entity maps (normalized by ID)
  players = new Map<string, Player>();
  nutrients = new Map<string, Nutrient>();
  obstacles = new Map<string, Obstacle>();
  swarms = new Map<string, EntropySwarm>();
  pseudopods = new Map<string, Pseudopod>();

  // Local player tracking
  localPlayerId: string | null = null;

  // Time synchronization
  currentTick = 0;
  serverTimeOffset = 0; // Client time = performance.now() + offset → server time

  // Interpolation buffer
  interpolationBuffer = new InterpolationBuffer();

  // Connection state
  isConnected = false;
  roomId: string | null = null;

  /**
   * Reset all state (on disconnect or game restart)
   */
  reset(): void {
    this.players.clear();
    this.nutrients.clear();
    this.obstacles.clear();
    this.swarms.clear();
    this.pseudopods.clear();
    this.localPlayerId = null;
    this.currentTick = 0;
    this.serverTimeOffset = 0;
    this.interpolationBuffer.clear();
    this.isConnected = false;
    this.roomId = null;
  }

  /**
   * Get a player by ID
   */
  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  /**
   * Get the local player
   */
  getLocalPlayer(): Player | undefined {
    if (!this.localPlayerId) return undefined;
    return this.players.get(this.localPlayerId);
  }

  /**
   * Get a nutrient by ID
   */
  getNutrient(id: string): Nutrient | undefined {
    return this.nutrients.get(id);
  }

  /**
   * Get an obstacle by ID
   */
  getObstacle(id: string): Obstacle | undefined {
    return this.obstacles.get(id);
  }

  /**
   * Get a swarm by ID
   */
  getSwarm(id: string): EntropySwarm | undefined {
    return this.swarms.get(id);
  }

  /**
   * Get a pseudopod by ID
   */
  getPseudopod(id: string): Pseudopod | undefined {
    return this.pseudopods.get(id);
  }

  /**
   * Update or add a player
   */
  updatePlayer(player: Player): void {
    this.players.set(player.id, player);
  }

  /**
   * Remove a player
   */
  removePlayer(id: string): void {
    this.players.delete(id);
  }

  /**
   * Update or add a nutrient
   */
  updateNutrient(nutrient: Nutrient): void {
    this.nutrients.set(nutrient.id, nutrient);
  }

  /**
   * Remove a nutrient
   */
  removeNutrient(id: string): void {
    this.nutrients.delete(id);
  }

  /**
   * Update or add an obstacle
   */
  updateObstacle(obstacle: Obstacle): void {
    this.obstacles.set(obstacle.id, obstacle);
  }

  /**
   * Remove an obstacle
   */
  removeObstacle(id: string): void {
    this.obstacles.delete(id);
  }

  /**
   * Update or add a swarm
   */
  updateSwarm(swarm: EntropySwarm): void {
    this.swarms.set(swarm.id, swarm);
  }

  /**
   * Remove a swarm
   */
  removeSwarm(id: string): void {
    this.swarms.delete(id);
  }

  /**
   * Update or add a pseudopod
   */
  updatePseudopod(pseudopod: Pseudopod): void {
    this.pseudopods.set(pseudopod.id, pseudopod);
  }

  /**
   * Remove a pseudopod
   */
  removePseudopod(id: string): void {
    this.pseudopods.delete(id);
  }
}
