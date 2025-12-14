// ============================================
// NutrientCollisionSystem Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the main server entry point to prevent side effects
vi.mock('../../../index', () => ({
  abilitySystem: {},
}));

// Mock the bots module
vi.mock('../../../bots', () => ({
  isBot: vi.fn(() => false),
  updateBots: vi.fn(),
}));

// Mock the nutrients module to prevent respawn errors
vi.mock('../../../nutrients', () => ({
  respawnNutrient: vi.fn(),
}));

// Mock the logger to prevent file system operations
vi.mock('../../../logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  perfLogger: { info: vi.fn() },
  recordEvolution: vi.fn(),
  recordNutrientCollection: vi.fn(),
}));

import { NutrientCollisionSystem } from '../NutrientCollisionSystem';
import {
  createTestWorld,
  createTestPlayer,
  createTestNutrient,
  cleanupTestWorld,
  createMockIO,
} from './testUtils';
import { requireEnergy, requireStage } from '../../factories';

describe('NutrientCollisionSystem', () => {
  let world: ReturnType<typeof createTestWorld>;
  let system: NutrientCollisionSystem;

  beforeEach(() => {
    world = createTestWorld();
    system = new NutrientCollisionSystem();
  });

  afterEach(() => {
    cleanupTestWorld();
    vi.clearAllMocks();
  });

  describe('nutrient collection', () => {
    it('collects nutrient when player overlaps', () => {
      // Create player and nutrient at same position
      const player = createTestPlayer(world, { x: 100, y: 100, socketId: 'player-1' });
      const nutrient = createTestNutrient(world, { x: 100, y: 100, value: 20, capacityIncrease: 10 });
      const mockIO = createMockIO();

      // Lower player energy so there's room to gain
      const energyComp = requireEnergy(world, player);
      energyComp.current = 50;
      const initialEnergy = energyComp.current;
      const initialMax = energyComp.max;

      system.update(world, 0.016, mockIO);

      // Nutrient should be destroyed
      expect(world.hasEntity(nutrient)).toBe(false);

      // Player energy should increase
      const energy = requireEnergy(world, player);
      expect(energy.current).toBeGreaterThan(initialEnergy);

      // Max energy should increase (capacity growth)
      expect(energy.max).toBe(initialMax + 10);
    });

    it('caps energy gain at max energy', () => {
      // Create player at max energy
      const player = createTestPlayer(world, { x: 100, y: 100 });
      const energy = requireEnergy(world, player);
      energy.current = energy.max; // At max

      createTestNutrient(world, { x: 100, y: 100, value: 50 });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Energy should increase by capacity, then be capped
      // max increased by capacityIncrease, current stays at old max
      expect(energy.current).toBeLessThanOrEqual(energy.max);
    });

    it('ignores nutrients outside collision radius', () => {
      const player = createTestPlayer(world, { x: 0, y: 0 });
      const nutrient = createTestNutrient(world, { x: 1000, y: 1000, value: 20 }); // Far away
      const mockIO = createMockIO();

      const initialEnergy = requireEnergy(world, player).current;

      system.update(world, 0.016, mockIO);

      // Nutrient should still exist
      expect(world.hasEntity(nutrient)).toBe(true);

      // Player energy unchanged
      const energy = requireEnergy(world, player);
      expect(energy.current).toBe(initialEnergy);
    });

    it('broadcasts nutrientCollected message', () => {
      createTestPlayer(world, { x: 100, y: 100, socketId: 'player-1' });
      createTestNutrient(world, { x: 100, y: 100, id: 'nutrient-1' });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Should have emitted a nutrientCollected message
      const collectEvents = mockIO.emittedEvents.filter((e) => e.event === 'nutrientCollected');
      expect(collectEvents.length).toBe(1);
      expect(collectEvents[0].data).toMatchObject({
        type: 'nutrientCollected',
        nutrientId: 'nutrient-1',
        playerId: 'player-1',
      });
    });
  });

  describe('skip conditions', () => {
    it('skips dead players', () => {
      const player = createTestPlayer(world, { x: 100, y: 100 });
      const nutrient = createTestNutrient(world, { x: 100, y: 100 });
      const mockIO = createMockIO();

      // Kill the player
      const energy = requireEnergy(world, player);
      energy.current = 0;

      system.update(world, 0.016, mockIO);

      // Nutrient should still exist (dead player can't collect)
      expect(world.hasEntity(nutrient)).toBe(true);
    });

    it('skips players during evolution', () => {
      const player = createTestPlayer(world, { x: 100, y: 100 });
      const nutrient = createTestNutrient(world, { x: 100, y: 100 });
      const mockIO = createMockIO();

      // Mark player as evolving
      const stage = requireStage(world, player);
      stage.isEvolving = true;

      system.update(world, 0.016, mockIO);

      // Nutrient should still exist (evolving player can't collect)
      expect(world.hasEntity(nutrient)).toBe(true);
    });
  });

  describe('one nutrient per tick per player', () => {
    it('collects only one nutrient per tick', () => {
      createTestPlayer(world, { x: 100, y: 100 });
      const nutrient1 = createTestNutrient(world, { x: 100, y: 100, id: 'n1' });
      const nutrient2 = createTestNutrient(world, { x: 100, y: 100, id: 'n2' });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Only one nutrient should be collected
      const collected = [nutrient1, nutrient2].filter((n) => !world.hasEntity(n));
      expect(collected.length).toBe(1);
    });
  });

  describe('multiple players', () => {
    it('allows multiple players to collect different nutrients', () => {
      createTestPlayer(world, { x: 100, y: 100, socketId: 'p1' });
      createTestPlayer(world, { x: 200, y: 200, socketId: 'p2' });
      const nutrient1 = createTestNutrient(world, { x: 100, y: 100 });
      const nutrient2 = createTestNutrient(world, { x: 200, y: 200 });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Both nutrients should be collected
      expect(world.hasEntity(nutrient1)).toBe(false);
      expect(world.hasEntity(nutrient2)).toBe(false);

      // Two collection events
      const collectEvents = mockIO.emittedEvents.filter((e) => e.event === 'nutrientCollected');
      expect(collectEvents.length).toBe(2);
    });
  });
});
