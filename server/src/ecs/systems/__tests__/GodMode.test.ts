// ============================================
// God Mode (dev cheat) Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Tags, Components } from '#shared';
import { DeathSystem } from '../DeathSystem';
import { GravitySystem } from '../GravitySystem';
import {
  createTestWorld,
  createTestPlayer,
  createMockIO,
  clearLookups,
  SOUP_CENTER,
} from './testUtils';
import { requireEnergy, getDamageTracking, createObstacle } from '../../factories';

describe('God mode', () => {
  let world: ReturnType<typeof createTestWorld>;

  beforeEach(() => {
    world = createTestWorld();
  });

  afterEach(() => {
    clearLookups();
  });

  function createGodPlayer() {
    const entity = createTestPlayer(world);
    world.removeComponent(entity, Components.SpawnImmunity);
    world.addTag(entity, Tags.GodMode);
    return entity;
  }

  describe('DeathSystem', () => {
    it('refills a god-mode player instead of killing them', () => {
      const entity = createGodPlayer();
      const energy = requireEnergy(world, entity);
      energy.current = 0;
      getDamageTracking(world, entity)!.lastDamageSource = 'singularity';
      const io = createMockIO();

      new DeathSystem().update(world, 1 / 60, io);

      expect(energy.current).toBe(energy.max);
      expect(getDamageTracking(world, entity)!.lastDamageSource).toBeUndefined();
      expect(io.emittedEvents.some((e) => e.event === 'playerDied')).toBe(false);
    });

    it('still kills players without god mode', () => {
      const entity = createTestPlayer(world);
      requireEnergy(world, entity).current = 0;
      getDamageTracking(world, entity)!.lastDamageSource = 'starvation';
      const io = createMockIO();

      new DeathSystem().update(world, 1 / 60, io);

      expect(io.emittedEvents.some((e) => e.event === 'playerDied')).toBe(true);
    });
  });

  describe('GravitySystem', () => {
    it('does not pull, drain, or crush a god-mode player', () => {
      const entity = createGodPlayer();
      createObstacle(world, 'well-1', { x: SOUP_CENTER.x + 5, y: SOUP_CENTER.y }, 600, 0.05);
      const energy = requireEnergy(world, entity);
      const energyBefore = energy.current;

      new GravitySystem().update(world, 1 / 60, createMockIO());

      expect(energy.current).toBe(energyBefore);
      expect(
        world.getComponent<{ x: number; y: number }>(entity, Components.Velocity)
      ).toMatchObject({ x: 0, y: 0 });
      expect(getDamageTracking(world, entity)!.lastDamageSource).toBeUndefined();
    });

    it('still crushes players without god mode at the core', () => {
      const entity = createTestPlayer(world);
      world.removeComponent(entity, Components.SpawnImmunity);
      createObstacle(world, 'well-1', { x: SOUP_CENTER.x + 5, y: SOUP_CENTER.y }, 600, 0.05);

      new GravitySystem().update(world, 1 / 60, createMockIO());

      expect(requireEnergy(world, entity).current).toBe(0);
      expect(getDamageTracking(world, entity)!.lastDamageSource).toBe('singularity');
    });
  });
});
