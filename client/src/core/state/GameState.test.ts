// ============================================
// GameState Unit Tests
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { GameState } from './GameState';
import type { Player, Nutrient, EntropySwarm, Pseudopod, GameStateMessage } from '@godcell/shared';
import { EvolutionStage } from '@godcell/shared';

describe('GameState', () => {
  let state: GameState;

  beforeEach(() => {
    state = new GameState();
  });

  describe('applySnapshot', () => {
    it('should populate all entity maps from snapshot', () => {
      const snapshot: GameStateMessage = {
        type: 'gameState',
        players: {
          p1: {
            id: 'p1',
            position: { x: 100, y: 200 },
            color: '#ff0000',
            health: 100,
            maxHealth: 100,
            energy: 100,
            maxEnergy: 100,
            stage: EvolutionStage.SINGLE_CELL,
            isEvolving: false,
          },
        },
        nutrients: {
          n1: {
            id: 'n1',
            position: { x: 300, y: 400 },
            value: 25,
            capacityIncrease: 10,
            valueMultiplier: 1,
          },
        },
        obstacles: {
          o1: {
            id: 'o1',
            position: { x: 500, y: 600 },
            radius: 600,
            strength: 0.72,
            damageRate: 10,
          },
        },
        swarms: {
          s1: {
            id: 's1',
            position: { x: 700, y: 800 },
            velocity: { x: 0, y: 0 },
            size: 47,
            state: 'patrol',
          },
        },
      };

      state.applySnapshot(snapshot);

      expect(state.players.size).toBe(1);
      expect(state.nutrients.size).toBe(1);
      expect(state.obstacles.size).toBe(1);
      expect(state.swarms.size).toBe(1);
      expect(state.playerTargets.size).toBe(1);
      expect(state.swarmTargets.size).toBe(1);
    });

    it('should clear existing state before applying snapshot', () => {
      // Pre-populate
      state.upsertPlayer({
        id: 'old',
        position: { x: 0, y: 0 },
        color: '#ff0000',
        health: 100,
        maxHealth: 100,
        energy: 100,
        maxEnergy: 100,
        stage: EvolutionStage.SINGLE_CELL,
        isEvolving: false,
      });

      // Apply new snapshot
      state.applySnapshot({
        type: 'gameState',
        players: {},
        nutrients: {},
        obstacles: {},
        swarms: {},
      });

      expect(state.players.size).toBe(0);
    });
  });

  describe('Player operations', () => {
    it('should upsert player', () => {
      const player: Player = {
        id: 'p1',
        position: { x: 100, y: 200 },
        color: '#ff0000',
        health: 100,
        maxHealth: 100,
        energy: 100,
        maxEnergy: 100,
        stage: EvolutionStage.SINGLE_CELL,
        isEvolving: false,
      };
      state.upsertPlayer(player);

      expect(state.players.get('p1')).toEqual(player);
      expect(state.playerTargets.has('p1')).toBe(true);
    });

    it('should remove player', () => {
      state.upsertPlayer({
        id: 'p1',
        position: { x: 100, y: 200 },
        color: '#ff0000',
        health: 100,
        maxHealth: 100,
        energy: 100,
        maxEnergy: 100,
        stage: EvolutionStage.SINGLE_CELL,
        isEvolving: false,
      });
      state.removePlayer('p1');

      expect(state.players.has('p1')).toBe(false);
      expect(state.playerTargets.has('p1')).toBe(false);
    });

    it('should update player target position', () => {
      state.upsertPlayer({
        id: 'p1',
        position: { x: 100, y: 200 },
        color: '#ff0000',
        health: 100,
        maxHealth: 100,
        energy: 100,
        maxEnergy: 100,
        stage: EvolutionStage.SINGLE_CELL,
        isEvolving: false,
      });
      state.updatePlayerTarget('p1', 150, 250);

      const target = state.playerTargets.get('p1');
      expect(target?.x).toBe(150);
      expect(target?.y).toBe(250);

      const player = state.players.get('p1');
      expect(player?.position.x).toBe(150);
      expect(player?.position.y).toBe(250);
    });

    it('should get my player', () => {
      state.upsertPlayer({
        id: 'me',
        position: { x: 100, y: 200 },
        color: '#ff0000',
        health: 100,
        maxHealth: 100,
        energy: 100,
        maxEnergy: 100,
        stage: EvolutionStage.SINGLE_CELL,
        isEvolving: false,
      });
      state.myPlayerId = 'me';

      const myPlayer = state.getMyPlayer();
      expect(myPlayer?.id).toBe('me');
    });
  });

  describe('Nutrient operations', () => {
    it('should upsert nutrient', () => {
      const nutrient: Nutrient = {
        id: 'n1',
        position: { x: 300, y: 400 },
        value: 25,
        capacityIncrease: 10,
        valueMultiplier: 1,
      };
      state.upsertNutrient(nutrient);

      expect(state.nutrients.get('n1')).toEqual(nutrient);
    });

    it('should remove nutrient', () => {
      state.upsertNutrient({
        id: 'n1',
        position: { x: 300, y: 400 },
        value: 25,
        capacityIncrease: 10,
        valueMultiplier: 1,
      });
      state.removeNutrient('n1');

      expect(state.nutrients.has('n1')).toBe(false);
    });

    it('should update nutrient position', () => {
      state.upsertNutrient({
        id: 'n1',
        position: { x: 300, y: 400 },
        value: 25,
        capacityIncrease: 10,
        valueMultiplier: 1,
      });
      state.updateNutrientPosition('n1', 350, 450);

      const nutrient = state.nutrients.get('n1');
      expect(nutrient?.position.x).toBe(350);
      expect(nutrient?.position.y).toBe(450);
    });
  });

  describe('Swarm operations', () => {
    it('should upsert swarm', () => {
      const swarm: EntropySwarm = {
        id: 's1',
        position: { x: 700, y: 800 },
        velocity: { x: 0, y: 0 },
        size: 47,
        state: 'patrol',
      };
      state.upsertSwarm(swarm);

      expect(state.swarms.get('s1')).toEqual(swarm);
      expect(state.swarmTargets.has('s1')).toBe(true);
    });

    it('should remove swarm', () => {
      state.upsertSwarm({
        id: 's1',
        position: { x: 700, y: 800 },
        velocity: { x: 0, y: 0 },
        size: 47,
        state: 'patrol',
      });
      state.removeSwarm('s1');

      expect(state.swarms.has('s1')).toBe(false);
      expect(state.swarmTargets.has('s1')).toBe(false);
    });

    it('should update swarm target position', () => {
      state.upsertSwarm({
        id: 's1',
        position: { x: 700, y: 800 },
        velocity: { x: 0, y: 0 },
        size: 47,
        state: 'patrol',
      });
      state.updateSwarmTarget('s1', 750, 850);

      const target = state.swarmTargets.get('s1');
      expect(target?.x).toBe(750);
      expect(target?.y).toBe(850);

      const swarm = state.swarms.get('s1');
      expect(swarm?.position.x).toBe(750);
      expect(swarm?.position.y).toBe(850);
    });
  });

  describe('Pseudopod operations', () => {
    it('should upsert pseudopod', () => {
      const pseudopod: Pseudopod = {
        id: 'ps1',
        ownerId: 'p1',
        startPosition: { x: 100, y: 200 },
        endPosition: { x: 150, y: 250 },
        currentLength: 0,
        maxLength: 200,
        createdAt: Date.now(),
        color: '#ff0000',
      };
      state.upsertPseudopod(pseudopod);

      expect(state.pseudopods.get('ps1')).toEqual(pseudopod);
    });

    it('should remove pseudopod', () => {
      state.upsertPseudopod({
        id: 'ps1',
        ownerId: 'p1',
        startPosition: { x: 100, y: 200 },
        endPosition: { x: 150, y: 250 },
        currentLength: 0,
        maxLength: 200,
        createdAt: Date.now(),
        color: '#ff0000',
      });
      state.removePseudopod('ps1');

      expect(state.pseudopods.has('ps1')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      // Populate state
      state.upsertPlayer({
        id: 'p1',
        position: { x: 100, y: 200 },
        color: '#ff0000',
        health: 100,
        maxHealth: 100,
        energy: 100,
        maxEnergy: 100,
        stage: EvolutionStage.SINGLE_CELL,
        isEvolving: false,
      });
      state.upsertNutrient({
        id: 'n1',
        position: { x: 300, y: 400 },
        value: 25,
        capacityIncrease: 10,
        valueMultiplier: 1,
      });
      state.myPlayerId = 'p1';

      // Reset
      state.reset();

      expect(state.players.size).toBe(0);
      expect(state.nutrients.size).toBe(0);
      expect(state.obstacles.size).toBe(0);
      expect(state.swarms.size).toBe(0);
      expect(state.pseudopods.size).toBe(0);
      expect(state.playerTargets.size).toBe(0);
      expect(state.swarmTargets.size).toBe(0);
      expect(state.myPlayerId).toBe(null);
    });
  });
});
