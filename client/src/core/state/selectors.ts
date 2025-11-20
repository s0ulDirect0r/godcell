/**
 * Read-only selectors for deriving data from GameState.
 * These are pure functions with no side effects.
 */

import type { Player, Nutrient, Obstacle, EntropySwarm, Pseudopod, Position } from '@godcell/shared';
import type { GameState } from './GameState';

/**
 * Get the local player (the one controlled by this client)
 */
export function getLocalPlayer(state: GameState): Player | undefined {
  return state.getLocalPlayer();
}

/**
 * Get all players as an array
 */
export function getAllPlayers(state: GameState): Player[] {
  return Array.from(state.players.values());
}

/**
 * Get all nutrients as an array
 */
export function getAllNutrients(state: GameState): Nutrient[] {
  return Array.from(state.nutrients.values());
}

/**
 * Get all obstacles as an array
 */
export function getAllObstacles(state: GameState): Obstacle[] {
  return Array.from(state.obstacles.values());
}

/**
 * Get all swarms as an array
 */
export function getAllSwarms(state: GameState): EntropySwarm[] {
  return Array.from(state.swarms.values());
}

/**
 * Get all pseudopods as an array
 */
export function getAllPseudopods(state: GameState): Pseudopod[] {
  return Array.from(state.pseudopods.values());
}

/**
 * Get all players within a certain radius of a position
 */
export function getPlayersInRange(
  state: GameState,
  position: Position,
  radius: number
): Player[] {
  const players = getAllPlayers(state);
  return players.filter((player) => {
    const dx = player.position.x - position.x;
    const dy = player.position.y - position.y;
    const distanceSquared = dx * dx + dy * dy;
    return distanceSquared <= radius * radius;
  });
}

/**
 * Get all nutrients within a certain radius of a position
 */
export function getNutrientsInRange(
  state: GameState,
  position: Position,
  radius: number
): Nutrient[] {
  const nutrients = getAllNutrients(state);
  return nutrients.filter((nutrient) => {
    const dx = nutrient.position.x - position.x;
    const dy = nutrient.position.y - position.y;
    const distanceSquared = dx * dx + dy * dy;
    return distanceSquared <= radius * radius;
  });
}

/**
 * Get the closest player to a position (excluding a specific player ID)
 */
export function getClosestPlayer(
  state: GameState,
  position: Position,
  excludeId?: string
): Player | undefined {
  const players = getAllPlayers(state);
  let closest: Player | undefined;
  let closestDistanceSquared = Infinity;

  for (const player of players) {
    if (excludeId && player.id === excludeId) continue;

    const dx = player.position.x - position.x;
    const dy = player.position.y - position.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < closestDistanceSquared) {
      closest = player;
      closestDistanceSquared = distanceSquared;
    }
  }

  return closest;
}

/**
 * Get the closest nutrient to a position
 */
export function getClosestNutrient(
  state: GameState,
  position: Position
): Nutrient | undefined {
  const nutrients = getAllNutrients(state);
  let closest: Nutrient | undefined;
  let closestDistanceSquared = Infinity;

  for (const nutrient of nutrients) {
    const dx = nutrient.position.x - position.x;
    const dy = nutrient.position.y - position.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < closestDistanceSquared) {
      closest = nutrient;
      closestDistanceSquared = distanceSquared;
    }
  }

  return closest;
}

/**
 * Check if the local player is alive
 */
export function isLocalPlayerAlive(state: GameState): boolean {
  const localPlayer = getLocalPlayer(state);
  return localPlayer !== undefined && localPlayer.health > 0;
}

/**
 * Get the total number of players
 */
export function getPlayerCount(state: GameState): number {
  return state.players.size;
}

/**
 * Get the total number of nutrients
 */
export function getNutrientCount(state: GameState): number {
  return state.nutrients.size;
}
