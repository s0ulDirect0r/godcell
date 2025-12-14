// ============================================
// NutrientCollisionSystem Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NutrientCollisionSystem } from '../NutrientCollisionSystem';
import {
  createTestWorld,
  createTestPlayer,
  createTestNutrient,
  createMockIO,
  clearLookups,
  SOUP_CENTER,
  COLLECTION_RADIUS,
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
    clearLookups();
  });

  describe('nutrient collection', () => {
    it('collects nutrient when player overlaps', () => {
      // Create player and nutrient at same position (default: SOUP_CENTER)
      const player = createTestPlayer(world, { socketId: 'player-1' });
      const nutrient = createTestNutrient(world, { value: 20, capacityIncrease: 10 });
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
      // Create player at max energy (default position: SOUP_CENTER)
      const player = createTestPlayer(world);
      const energy = requireEnergy(world, player);
      energy.current = energy.max; // At max

      createTestNutrient(world, { value: 50 });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Energy should increase by capacity, then be capped
      // max increased by capacityIncrease, current stays at old max
      expect(energy.current).toBeLessThanOrEqual(energy.max);
    });

    it('ignores nutrients outside collision radius', () => {
      // Player at soup center, nutrient far away
      createTestPlayer(world);
      const nutrient = createTestNutrient(world, {
        x: SOUP_CENTER.x + 1000,
        y: SOUP_CENTER.y + 1000,
        value: 20,
      });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Nutrient should still exist
      expect(world.hasEntity(nutrient)).toBe(true);
    });

    it('broadcasts nutrientCollected message', () => {
      createTestPlayer(world, { socketId: 'player-1' });
      createTestNutrient(world, { id: 'nutrient-1' });
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
      const player = createTestPlayer(world);
      const nutrient = createTestNutrient(world);
      const mockIO = createMockIO();

      // Kill the player
      const energy = requireEnergy(world, player);
      energy.current = 0;

      system.update(world, 0.016, mockIO);

      // Nutrient should still exist (dead player can't collect)
      expect(world.hasEntity(nutrient)).toBe(true);
    });

    it('skips players during evolution', () => {
      const player = createTestPlayer(world);
      const nutrient = createTestNutrient(world);
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
      createTestPlayer(world);
      const nutrient1 = createTestNutrient(world, { id: 'n1' });
      const nutrient2 = createTestNutrient(world, { id: 'n2' });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Only one nutrient should be collected
      const collected = [nutrient1, nutrient2].filter((n) => !world.hasEntity(n));
      expect(collected.length).toBe(1);
    });
  });

  describe('multiple players', () => {
    it('allows multiple players to collect different nutrients', () => {
      // Two players in different spots, each with their own nutrient
      createTestPlayer(world, { socketId: 'p1' });
      createTestPlayer(world, {
        socketId: 'p2',
        x: SOUP_CENTER.x + 200,
        y: SOUP_CENTER.y + 200,
      });
      const nutrient1 = createTestNutrient(world);
      const nutrient2 = createTestNutrient(world, {
        x: SOUP_CENTER.x + 200,
        y: SOUP_CENTER.y + 200,
      });
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

  describe('collision radius edge cases', () => {
    it('collects nutrient at exact collision radius boundary', () => {
      // Player at center, nutrient exactly at COLLECTION_RADIUS distance
      createTestPlayer(world);
      const nutrient = createTestNutrient(world, {
        x: SOUP_CENTER.x + COLLECTION_RADIUS - 0.1, // Just inside
        y: SOUP_CENTER.y,
      });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Should be collected (just inside radius)
      expect(world.hasEntity(nutrient)).toBe(false);
    });

    it('does not collect nutrient just outside collision radius', () => {
      // Player at center, nutrient just outside COLLECTION_RADIUS
      createTestPlayer(world);
      const nutrient = createTestNutrient(world, {
        x: SOUP_CENTER.x + COLLECTION_RADIUS + 1, // Just outside
        y: SOUP_CENTER.y,
      });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Should NOT be collected (just outside radius)
      expect(world.hasEntity(nutrient)).toBe(true);
    });

    it('collects nutrient at diagonal distance within radius', () => {
      // Test diagonal (Pythagorean) - both x and y offset
      // For radius 27: sqrt(19^2 + 19^2) ≈ 26.87 < 27
      const offset = Math.floor(COLLECTION_RADIUS / Math.sqrt(2)) - 1;
      createTestPlayer(world);
      const nutrient = createTestNutrient(world, {
        x: SOUP_CENTER.x + offset,
        y: SOUP_CENTER.y + offset,
      });
      const mockIO = createMockIO();

      system.update(world, 0.016, mockIO);

      // Should be collected (within diagonal distance)
      expect(world.hasEntity(nutrient)).toBe(false);
    });
  });
});
