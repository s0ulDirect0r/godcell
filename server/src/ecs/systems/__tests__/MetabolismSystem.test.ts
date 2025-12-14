// ============================================
// MetabolismSystem Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetabolismSystem } from '../MetabolismSystem';
import { createTestWorld, createTestPlayer, createMockIO, clearLookups } from './testUtils';
import { requireEnergy, requireStage, getDamageTracking } from '../../factories';

describe('MetabolismSystem', () => {
  let world: ReturnType<typeof createTestWorld>;
  let system: MetabolismSystem;

  beforeEach(() => {
    world = createTestWorld();
    system = new MetabolismSystem();
  });

  afterEach(() => {
    clearLookups();
  });

  describe('energy decay', () => {
    it('decays energy over time', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      const initialEnergy = requireEnergy(world, entity).current;

      // Run metabolism for 1 second
      system.update(world, 1, mockIO);

      const newEnergy = requireEnergy(world, entity).current;
      expect(newEnergy).toBeLessThan(initialEnergy);
    });

    it('does not go below zero', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set energy very low
      const energy = requireEnergy(world, entity);
      energy.current = 1;

      // Run metabolism for a long time (would drain way more than 1 energy)
      system.update(world, 100, mockIO);

      expect(energy.current).toBeGreaterThanOrEqual(0);
    });

    it('marks player for death when energy hits zero', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set energy very low
      const energy = requireEnergy(world, entity);
      energy.current = 0.01;

      // Run metabolism
      system.update(world, 10, mockIO);

      // Should have set death cause to starvation
      const tracking = getDamageTracking(world, entity);
      expect(tracking?.lastDamageSource).toBe('starvation');
    });
  });

  describe('skip conditions', () => {
    it('skips players that are already dead', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set energy below zero (already dead, waiting for respawn)
      const energy = requireEnergy(world, entity);
      energy.current = -1;

      // Run metabolism
      system.update(world, 1, mockIO);

      // Energy should remain unchanged (still negative)
      expect(energy.current).toBe(-1);
    });

    it('skips players during evolution molting', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      const initialEnergy = requireEnergy(world, entity).current;

      // Mark as evolving
      const stage = requireStage(world, entity);
      stage.isEvolving = true;

      // Run metabolism
      system.update(world, 1, mockIO);

      // Energy should not have decayed
      const newEnergy = requireEnergy(world, entity).current;
      expect(newEnergy).toBe(initialEnergy);
    });
  });

  describe('multiple players', () => {
    it('processes all players', () => {
      const entity1 = createTestPlayer(world, { socketId: 'player-1' });
      const entity2 = createTestPlayer(world, { socketId: 'player-2' });
      const mockIO = createMockIO();

      const initial1 = requireEnergy(world, entity1).current;
      const initial2 = requireEnergy(world, entity2).current;

      system.update(world, 1, mockIO);

      const new1 = requireEnergy(world, entity1).current;
      const new2 = requireEnergy(world, entity2).current;

      // Both should have decayed
      expect(new1).toBeLessThan(initial1);
      expect(new2).toBeLessThan(initial2);
    });
  });

  describe('starvation tracking', () => {
    it('sets starvation cause when energy reaches exactly zero', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set energy to exactly zero (edge case: hit zero from other source)
      const energy = requireEnergy(world, entity);
      energy.current = 0;

      // Clear any existing damage tracking
      const tracking = getDamageTracking(world, entity);
      if (tracking) {
        tracking.lastDamageSource = undefined;
      }

      // Run metabolism
      system.update(world, 1, mockIO);

      // Should have set starvation as the cause
      const newTracking = getDamageTracking(world, entity);
      expect(newTracking?.lastDamageSource).toBe('starvation');
    });
  });
});
