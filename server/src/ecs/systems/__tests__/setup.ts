// ============================================
// Shared Test Setup
// Runs before each test file via vitest setupFiles
// ============================================

import { vi } from 'vitest';

// Mock the main server entry point to prevent side effects
vi.mock('../../../index', () => ({
  abilitySystem: {},
}));

// Mock the bots module
vi.mock('../../../bots', () => ({
  isBot: vi.fn(() => false),
  updateBots: vi.fn(),
}));

// Mock the nutrients module to prevent respawn timer side effects
vi.mock('../../../nutrients', () => ({
  respawnNutrient: vi.fn(),
}));

// Mock the logger to prevent file system operations
vi.mock('../../../logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  perfLogger: { info: vi.fn() },
  clientLogger: { info: vi.fn() },
  recordEvolution: vi.fn(),
  recordNutrientCollection: vi.fn(),
}));
