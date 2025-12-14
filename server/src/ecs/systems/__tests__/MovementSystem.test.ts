// ============================================
// MovementSystem Unit Tests
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

// Mock the logger to prevent file system operations
vi.mock('../../../logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  perfLogger: { info: vi.fn() },
  recordEvolution: vi.fn(),
}));

import { Components, Tags } from '#shared';
import { MovementSystem } from '../MovementSystem';
import { createTestWorld, createTestPlayer, cleanupTestWorld, createMockIO } from './testUtils';
import { setInput, requirePosition, requireVelocity, requireEnergy } from '../../factories';

describe('MovementSystem', () => {
  let world: ReturnType<typeof createTestWorld>;
  let system: MovementSystem;

  beforeEach(() => {
    world = createTestWorld();
    system = new MovementSystem();
  });

  afterEach(() => {
    cleanupTestWorld();
  });

  describe('basic movement', () => {
    it('applies input to velocity', () => {
      const entity = createTestPlayer(world, { x: 0, y: 0 });
      const mockIO = createMockIO();

      // Set input direction (wants to move right)
      setInput(world, entity, 1, 0);

      // Run the system for a small time step
      system.update(world, 0.016, mockIO);

      // Velocity should have increased in x direction
      const vel = requireVelocity(world, entity);
      expect(vel.x).toBeGreaterThan(0);
      expect(vel.y).toBe(0);
    });

    it('updates position based on velocity', () => {
      // Use position within soup bounds (soup starts at 7200, 4800)
      const entity = createTestPlayer(world, { x: 8000, y: 6000 });
      const mockIO = createMockIO();

      // Set velocity directly (to bypass acceleration calculations)
      const vel = requireVelocity(world, entity);
      vel.x = 50;
      vel.y = 0;

      const initialPos = { ...requirePosition(world, entity) };

      // Run the system
      system.update(world, 0.1, mockIO);

      const newPos = requirePosition(world, entity);
      // Position should have increased (though friction reduces velocity)
      expect(newPos.x).toBeGreaterThan(initialPos.x);
      expect(newPos.y).toBe(initialPos.y);
    });

    it('broadcasts playerMoved message', () => {
      const entity = createTestPlayer(world, { x: 0, y: 0, socketId: 'player-1' });
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
      // Create two players at same position with same input
      const normalEntity = createTestPlayer(world, { x: 0, y: 0, socketId: 'normal' });
      const slowedEntity = createTestPlayer(world, { x: 0, y: 0, socketId: 'slowed' });
      const mockIO = createMockIO();

      // Apply slow tag to one player
      world.addTag(slowedEntity, Tags.SlowedThisTick);

      // Give both same input
      setInput(world, normalEntity, 1, 0);
      setInput(world, slowedEntity, 1, 0);

      // Run system
      system.update(world, 0.1, mockIO);

      const normalVel = requireVelocity(world, normalEntity);
      const slowedVel = requireVelocity(world, slowedEntity);

      // Slowed player should have less velocity
      expect(slowedVel.x).toBeLessThan(normalVel.x);
    });
  });

  describe('friction', () => {
    it('applies friction to reduce velocity over time', () => {
      const entity = createTestPlayer(world, { x: 0, y: 0 });
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
      const entity = createTestPlayer(world, { x: 0, y: 0 });
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
      const entity = createTestPlayer(world, { x: 100, y: 100 });
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
      const entity = createTestPlayer(world, { x: 100, y: 100 });
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
  });
});
