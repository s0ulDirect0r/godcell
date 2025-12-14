// ============================================
// Test Utilities for ECS System Tests
// ============================================

import type { Server } from 'socket.io';
import type { World } from '#shared';
import { EvolutionStage } from '#shared';
import {
  createWorld,
  createPlayer,
  createNutrient,
  clearLookups,
} from '../../factories';

/**
 * Create a fresh ECS World for testing.
 * This uses the same createWorld function as production,
 * ensuring all component stores are properly registered.
 */
export function createTestWorld(): World {
  // Clear any existing lookups from previous tests
  clearLookups();
  return createWorld();
}

/**
 * Clean up after tests.
 * Call this in afterEach to reset module-level state.
 */
export function cleanupTestWorld(): void {
  clearLookups();
}

/**
 * Create a test player entity with all necessary components.
 * Uses the real createPlayer factory to ensure consistency.
 *
 * @returns The entity ID of the created player
 */
export function createTestPlayer(
  world: World,
  options: {
    socketId?: string;
    name?: string;
    color?: string;
    x?: number;
    y?: number;
    stage?: EvolutionStage;
  } = {}
): number {
  const {
    socketId = `test-player-${Date.now()}-${Math.random()}`,
    name = 'TestPlayer',
    color = '#00ff00',
    x = 0,
    y = 0,
    stage = EvolutionStage.SINGLE_CELL,
  } = options;

  return createPlayer(world, socketId, name, color, { x, y }, stage);
}

/**
 * Create a test nutrient entity.
 * Uses the real createNutrient factory.
 *
 * @returns The entity ID of the created nutrient
 */
export function createTestNutrient(
  world: World,
  options: {
    id?: string;
    x?: number;
    y?: number;
    value?: number;
    capacityIncrease?: number;
  } = {}
): number {
  const {
    id = `nutrient-${Date.now()}-${Math.random()}`,
    x = 0,
    y = 0,
    value = 10,
    capacityIncrease = 5,
  } = options;

  return createNutrient(
    world,
    id,
    { x, y },
    value,
    capacityIncrease,
    1.0, // valueMultiplier
    false // isHighValue
  );
}

/**
 * Create a mock Socket.IO server for testing.
 * Captures emitted events for assertions.
 */
export function createMockIO(): Server & { emittedEvents: Array<{ event: string; data: unknown }> } {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];

  const mockIO = {
    emittedEvents,
    emit: (event: string, data: unknown) => {
      emittedEvents.push({ event, data });
      return true;
    },
    // Add other methods as needed for tests
    to: () => mockIO,
    in: () => mockIO,
  } as unknown as Server & { emittedEvents: Array<{ event: string; data: unknown }> };

  return mockIO;
}
