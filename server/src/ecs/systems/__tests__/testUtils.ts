// ============================================
// Test Utilities for ECS System Tests
// ============================================

import type { Server } from 'socket.io';
import type { World } from '#shared';
import { EvolutionStage, GAME_CONFIG } from '#shared';
import {
  createWorld,
  createPlayer,
  createNutrient,
  clearLookups,
} from '../../factories';

// Re-export clearLookups for direct use in afterEach
export { clearLookups };

// ============================================
// Test Constants (from GAME_CONFIG, for clarity)
// ============================================

// Soup center on sphere surface - equatorial point facing +X axis
// This is a valid position within the soup Y-bounds (|y| < SOUP_Y_BOUND)
export const SOUP_CENTER = {
  x: GAME_CONFIG.PLANET_RADIUS, // On equator, facing +X
  y: 0,
  z: 0,
};

// Collision detection
export const PLAYER_RADIUS = GAME_CONFIG.SINGLE_CELL_RADIUS; // 15
export const NUTRIENT_RADIUS = GAME_CONFIG.NUTRIENT_SIZE; // 12
export const COLLECTION_RADIUS = PLAYER_RADIUS + NUTRIENT_RADIUS; // 27

// ============================================
// World Setup
// ============================================

/**
 * Create a fresh ECS World for testing.
 * Clears lookups first to ensure clean state.
 */
export function createTestWorld(): World {
  clearLookups();
  return createWorld();
}

// ============================================
// Entity Factories
// ============================================

/**
 * Create a test player entity.
 * Default position is soup center (valid for single-cell movement).
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
    x = SOUP_CENTER.x,
    y = SOUP_CENTER.y,
    stage = EvolutionStage.SINGLE_CELL,
  } = options;

  return createPlayer(world, socketId, name, color, { x, y }, stage);
}

/**
 * Create a test nutrient entity.
 * Default position is soup center.
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
    x = SOUP_CENTER.x,
    y = SOUP_CENTER.y,
    value = 10,
    capacityIncrease = 5,
  } = options;

  return createNutrient(world, id, { x, y }, value, capacityIncrease, 1.0, false);
}

// ============================================
// Mock IO
// ============================================

/**
 * Create a mock Socket.IO server that captures emitted events.
 */
export function createMockIO(): Server & { emittedEvents: Array<{ event: string; data: unknown }> } {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];

  const mockIO = {
    emittedEvents,
    emit: (event: string, data: unknown) => {
      emittedEvents.push({ event, data });
      return true;
    },
    to: () => mockIO,
    in: () => mockIO,
  } as unknown as Server & { emittedEvents: Array<{ event: string; data: unknown }> };

  return mockIO;
}
