import { describe, it, expect, beforeEach } from 'vitest';
import { GameState } from './GameState';
import {
  getAllPlayers,
  getAllNutrients,
  getPlayersInRange,
  getNutrientsInRange,
  getClosestPlayer,
  getClosestNutrient,
  isLocalPlayerAlive,
  getPlayerCount,
  getNutrientCount,
} from './selectors';
import { EvolutionStage, type Player, type Nutrient } from '@godcell/shared';

describe('Selectors', () => {
  let state: GameState;

  // Helper to create a mock player
  const createPlayer = (id: string, x: number, y: number, health = 100): Player => ({
    id,
    position: { x, y },
    color: '#00ffff',
    health,
    maxHealth: 100,
    energy: 100,
    maxEnergy: 100,
    stage: EvolutionStage.SINGLE_CELL,
    isEvolving: false,
  });

  // Helper to create a mock nutrient
  const createNutrient = (id: string, x: number, y: number): Nutrient => ({
    id,
    position: { x, y },
    value: 25,
    capacityIncrease: 10,
    valueMultiplier: 1,
  });

  beforeEach(() => {
    state = new GameState();
  });

  describe('getAllPlayers', () => {
    it('should return all players as array', () => {
      state.updatePlayer(createPlayer('p1', 0, 0));
      state.updatePlayer(createPlayer('p2', 100, 100));

      const players = getAllPlayers(state);
      expect(players.length).toBe(2);
    });

    it('should return empty array if no players', () => {
      const players = getAllPlayers(state);
      expect(players.length).toBe(0);
    });
  });

  describe('getAllNutrients', () => {
    it('should return all nutrients as array', () => {
      state.updateNutrient(createNutrient('n1', 0, 0));
      state.updateNutrient(createNutrient('n2', 100, 100));

      const nutrients = getAllNutrients(state);
      expect(nutrients.length).toBe(2);
    });
  });

  describe('getPlayersInRange', () => {
    it('should return players within radius', () => {
      state.updatePlayer(createPlayer('p1', 0, 0));
      state.updatePlayer(createPlayer('p2', 50, 0)); // 50 units away
      state.updatePlayer(createPlayer('p3', 200, 0)); // 200 units away

      const nearby = getPlayersInRange(state, { x: 0, y: 0 }, 100);
      expect(nearby.length).toBe(2); // p1 and p2
      expect(nearby.find((p) => p.id === 'p3')).toBeUndefined();
    });
  });

  describe('getNutrientsInRange', () => {
    it('should return nutrients within radius', () => {
      state.updateNutrient(createNutrient('n1', 0, 0));
      state.updateNutrient(createNutrient('n2', 30, 0));
      state.updateNutrient(createNutrient('n3', 200, 0));

      const nearby = getNutrientsInRange(state, { x: 0, y: 0 }, 50);
      expect(nearby.length).toBe(2); // n1 and n2
    });
  });

  describe('getClosestPlayer', () => {
    it('should return the closest player', () => {
      state.updatePlayer(createPlayer('p1', 100, 0));
      state.updatePlayer(createPlayer('p2', 50, 0));
      state.updatePlayer(createPlayer('p3', 200, 0));

      const closest = getClosestPlayer(state, { x: 0, y: 0 });
      expect(closest?.id).toBe('p2');
    });

    it('should exclude specified player', () => {
      state.updatePlayer(createPlayer('p1', 100, 0));
      state.updatePlayer(createPlayer('p2', 50, 0));

      const closest = getClosestPlayer(state, { x: 0, y: 0 }, 'p2');
      expect(closest?.id).toBe('p1');
    });

    it('should return undefined if no players', () => {
      const closest = getClosestPlayer(state, { x: 0, y: 0 });
      expect(closest).toBeUndefined();
    });
  });

  describe('getClosestNutrient', () => {
    it('should return the closest nutrient', () => {
      state.updateNutrient(createNutrient('n1', 100, 0));
      state.updateNutrient(createNutrient('n2', 50, 0));
      state.updateNutrient(createNutrient('n3', 200, 0));

      const closest = getClosestNutrient(state, { x: 0, y: 0 });
      expect(closest?.id).toBe('n2');
    });
  });

  describe('isLocalPlayerAlive', () => {
    it('should return true if local player is alive', () => {
      const player = createPlayer('local', 0, 0, 100);
      state.updatePlayer(player);
      state.localPlayerId = 'local';

      expect(isLocalPlayerAlive(state)).toBe(true);
    });

    it('should return false if local player is dead', () => {
      const player = createPlayer('local', 0, 0, 0);
      state.updatePlayer(player);
      state.localPlayerId = 'local';

      expect(isLocalPlayerAlive(state)).toBe(false);
    });

    it('should return false if no local player', () => {
      expect(isLocalPlayerAlive(state)).toBe(false);
    });
  });

  describe('getPlayerCount', () => {
    it('should return the number of players', () => {
      state.updatePlayer(createPlayer('p1', 0, 0));
      state.updatePlayer(createPlayer('p2', 100, 100));

      expect(getPlayerCount(state)).toBe(2);
    });
  });

  describe('getNutrientCount', () => {
    it('should return the number of nutrients', () => {
      state.updateNutrient(createNutrient('n1', 0, 0));
      state.updateNutrient(createNutrient('n2', 100, 100));
      state.updateNutrient(createNutrient('n3', 200, 200));

      expect(getNutrientCount(state)).toBe(3);
    });
  });
});
