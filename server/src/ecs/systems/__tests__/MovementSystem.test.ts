// ============================================
// MovementSystem Unit Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Components, Tags, GAME_CONFIG, magnitude } from '#shared';
import { MovementSystem } from '../MovementSystem';
import {
  createTestWorld,
  createTestPlayer,
  createMockIO,
  clearLookups,
} from './testUtils';
import { setInput, requirePosition, requireVelocity, requireEnergy } from '../../factories';

describe('MovementSystem', () => {
  let world: ReturnType<typeof createTestWorld>;
  let system: MovementSystem;

  beforeEach(() => {
    world = createTestWorld();
    system = new MovementSystem();
  });

  afterEach(() => {
    clearLookups();
  });

  describe('basic movement', () => {
    it('applies input to velocity (tangent direction on sphere)', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // At position (R, 0, 0), Y direction is tangent to sphere surface
      // X direction is radial and gets zeroed by tangent constraint
      setInput(world, entity, 0, 1); // Move in Y direction (tangent)

      // Run the system for a small time step
      system.update(world, 0.016, mockIO);

      // Velocity should have increased in Y direction (tangent to sphere at this position)
      const vel = requireVelocity(world, entity);
      expect(vel.y).toBeGreaterThan(0);
    });

    it('updates position based on velocity (constrained to sphere surface)', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set velocity in Y direction (tangent at position (R, 0, 0))
      const vel = requireVelocity(world, entity);
      vel.x = 0;
      vel.y = 50;
      vel.z = 0;

      const initialPos = { ...requirePosition(world, entity) };

      // Run the system
      system.update(world, 0.1, mockIO);

      const newPos = requirePosition(world, entity);
      // Position should have moved along sphere surface
      // Y should increase, and position should remain on sphere
      expect(newPos.y).toBeGreaterThan(initialPos.y);
      expect(magnitude(newPos)).toBeCloseTo(GAME_CONFIG.PLANET_RADIUS, 1);
    });

    it('broadcasts playerMoved message', () => {
      const entity = createTestPlayer(world, { socketId: 'player-1' });
      const mockIO = createMockIO();

      // Set velocity to trigger movement
      const vel = requireVelocity(world, entity);
      vel.x = 100;

      system.update(world, 0.016, mockIO);

      // Should have emitted a playerMoved message
      const moveEvents = mockIO.emittedEvents.filter((e) => e.event === 'playerMoved');
      expect(moveEvents.length).toBe(1);
      expect(moveEvents[0].data).toMatchObject({
        type: 'playerMoved',
        playerId: 'player-1',
      });
    });
  });

  describe('SlowedThisTick debuff', () => {
    it('reduces acceleration when slowed', () => {
      // Create two players with same input
      const normalEntity = createTestPlayer(world, { socketId: 'normal' });
      const slowedEntity = createTestPlayer(world, { socketId: 'slowed' });
      const mockIO = createMockIO();

      // Apply slow tag to one player
      world.addTag(slowedEntity, Tags.SlowedThisTick);

      // Give both same input (Y direction is tangent at position R, 0, 0)
      setInput(world, normalEntity, 0, 1);
      setInput(world, slowedEntity, 0, 1);

      // Run system
      system.update(world, 0.1, mockIO);

      const normalVel = requireVelocity(world, normalEntity);
      const slowedVel = requireVelocity(world, slowedEntity);

      // Slowed player should have less velocity
      expect(slowedVel.y).toBeLessThan(normalVel.y);
    });
  });

  describe('friction', () => {
    it('applies friction to reduce velocity over time', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set initial velocity with no input
      const vel = requireVelocity(world, entity);
      vel.x = 100;
      vel.y = 100;

      // No input (should just apply friction)
      setInput(world, entity, 0, 0);

      system.update(world, 0.1, mockIO);

      // Velocity should be reduced by friction
      expect(vel.x).toBeLessThan(100);
      expect(vel.y).toBeLessThan(100);
    });
  });

  describe('energy cost', () => {
    it('deducts energy for movement', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      const initialEnergy = requireEnergy(world, entity).current;

      // Set velocity to trigger movement
      const vel = requireVelocity(world, entity);
      vel.x = 100;

      system.update(world, 0.1, mockIO);

      const newEnergy = requireEnergy(world, entity).current;
      expect(newEnergy).toBeLessThan(initialEnergy);
    });

    it('does not move dead players', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Kill the player
      const energy = requireEnergy(world, entity);
      energy.current = 0;

      // Set velocity (would normally cause movement)
      const vel = requireVelocity(world, entity);
      vel.x = 100;

      const initialPos = { ...requirePosition(world, entity) };

      system.update(world, 0.1, mockIO);

      const newPos = requirePosition(world, entity);
      // Position should not have changed
      expect(newPos.x).toBe(initialPos.x);
      expect(newPos.y).toBe(initialPos.y);
    });
  });

  describe('stunned players', () => {
    it('stops movement for stunned players', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Stun the player (stun ends in the future)
      world.addComponent(entity, Components.Stunned, {
        until: Date.now() + 10000,
        source: 'test',
      });

      // Set velocity
      const vel = requireVelocity(world, entity);
      vel.x = 100;
      vel.y = 100;

      system.update(world, 0.1, mockIO);

      // Velocity should be zeroed out
      expect(vel.x).toBe(0);
      expect(vel.y).toBe(0);
    });

    it('allows movement after stun expires', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Stun already expired (in the past)
      world.addComponent(entity, Components.Stunned, {
        until: Date.now() - 1000,
        source: 'test',
      });

      // Set input direction (Y is tangent at position R, 0, 0)
      setInput(world, entity, 0, 1);

      system.update(world, 0.1, mockIO);

      // Velocity should have increased (stun expired, can move)
      const vel = requireVelocity(world, entity);
      expect(vel.y).toBeGreaterThan(0);
    });
  });

  describe('world bounds', () => {
    it('clamps position to soup Y-bounds for single-cell', () => {
      // Create player at soup center (on sphere surface)
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set huge velocity in Y direction trying to escape soup toward pole
      // (Y velocity is tangent at position (R, 0, 0))
      const vel = requireVelocity(world, entity);
      vel.y = 100000;

      system.update(world, 1, mockIO);

      // Position Y should be clamped to soup Y-bound
      const pos = requirePosition(world, entity);
      expect(Math.abs(pos.y)).toBeLessThanOrEqual(GAME_CONFIG.SOUP_Y_BOUND + 1);
      // Should still be on sphere surface
      expect(magnitude(pos)).toBeCloseTo(GAME_CONFIG.PLANET_RADIUS, 1);
    });
  });

  describe('spherical movement', () => {
    it('constrains player to sphere surface', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set velocity in tangent direction
      const vel = requireVelocity(world, entity);
      vel.y = 100;
      vel.z = 50;

      // Run several updates
      for (let i = 0; i < 10; i++) {
        system.update(world, 0.016, mockIO);
      }

      // Position should remain on sphere surface
      const pos = requirePosition(world, entity);
      expect(magnitude(pos)).toBeCloseTo(GAME_CONFIG.PLANET_RADIUS, 1);
    });

    it('makes velocity tangent to surface after update', () => {
      const entity = createTestPlayer(world);
      const mockIO = createMockIO();

      // Set velocity with radial component (X at position R, 0, 0)
      const vel = requireVelocity(world, entity);
      vel.x = 100; // Radial (will be zeroed)
      vel.y = 50; // Tangent (will remain)

      system.update(world, 0.016, mockIO);

      // X velocity (radial at this position) should be near zero
      // Y velocity (tangent) should remain
      expect(Math.abs(vel.x)).toBeLessThan(10); // Near zero (some drift from sphere projection)
      expect(vel.y).toBeGreaterThan(0);
    });
  });
});
