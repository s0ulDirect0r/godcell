// ============================================
// Shared Types & Constants
// Used by both client and server
// ============================================

// ECS Module - Entity Component System shared between client and server
export * from './ecs';

// Math utilities - geometry and spatial algorithms
export * from './math';

// Sphere math utilities - spherical world physics
export * from './sphereMath';

// Game constants (GAME_CONFIG, DEV_TUNABLE_CONFIGS)
export * from './constants';

// Type definitions (Player, Nutrient, etc.)
export * from './types';

// Network message types (Client ↔ Server)
export * from './messages';
