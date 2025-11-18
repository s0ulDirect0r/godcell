// ============================================
// Shared Types & Constants
// Used by both client and server
// ============================================

// Player position in the game world
export interface Position {
  x: number;
  y: number;
}

// Evolution stages
export enum EvolutionStage {
  SINGLE_CELL = 'single_cell',
  MULTI_CELL = 'multi_cell',
  CYBER_ORGANISM = 'cyber_organism',
  HUMANOID = 'humanoid',
  GODCELL = 'godcell',
}

// A player in the game
export interface Player {
  id: string;
  position: Position;
  color: string; // Hex color like "#FF5733"

  // Metabolism & Health
  health: number;
  maxHealth: number;
  energy: number;      // Metabolic energy - decays over time
  maxEnergy: number;   // Capacity - grows with nutrients collected

  // Evolution
  stage: EvolutionStage;
  isEvolving: boolean; // True during molting animation
}

// A nutrient (data packet) that players can collect
export interface Nutrient {
  id: string;
  position: Position;
  value: number; // Energy value when collected (25 or 50 for high-value)
  isHighValue?: boolean; // True if spawned near obstacle (2x value)
}

// A gravity distortion obstacle (mini black hole)
export interface Obstacle {
  id: string;
  position: Position;
  radius: number; // Event horizon size
  strength: number; // Gravity force multiplier
  damageRate: number; // Health damage per second at center
}

// ============================================
// Network Messages (Client → Server)
// ============================================

export interface PlayerMoveMessage {
  type: 'playerMove';
  direction: {
    x: number; // -1, 0, or 1
    y: number; // -1, 0, or 1
  };
}

export interface PlayerRespawnRequestMessage {
  type: 'playerRespawnRequest';
}

// ============================================
// Network Messages (Server → Client)
// ============================================

export interface GameStateMessage {
  type: 'gameState';
  players: Record<string, Player>; // Map of playerId → Player
  nutrients: Record<string, Nutrient>; // Map of nutrientId → Nutrient
  obstacles: Record<string, Obstacle>; // Map of obstacleId → Obstacle
}

export interface PlayerJoinedMessage {
  type: 'playerJoined';
  player: Player;
}

export interface PlayerLeftMessage {
  type: 'playerLeft';
  playerId: string;
}

export interface PlayerMovedMessage {
  type: 'playerMoved';
  playerId: string;
  position: Position;
}

export interface NutrientSpawnedMessage {
  type: 'nutrientSpawned';
  nutrient: Nutrient;
}

export interface NutrientCollectedMessage {
  type: 'nutrientCollected';
  nutrientId: string;
  playerId: string;
  collectorEnergy: number; // New energy level after collection
  collectorMaxEnergy: number; // New max energy after capacity increase
}

export interface EnergyUpdateMessage {
  type: 'energyUpdate';
  playerId: string;
  energy: number;
  health: number;
}

export interface PlayerDiedMessage {
  type: 'playerDied';
  playerId: string;
  position: Position; // For dilution effect
  color: string; // For colored particle effect
}

export interface PlayerRespawnedMessage {
  type: 'playerRespawned';
  player: Player;
}

export interface PlayerEvolvedMessage {
  type: 'playerEvolved';
  playerId: string;
  newStage: EvolutionStage;
  newMaxEnergy: number;
  newMaxHealth: number;
}

export interface NutrientMovedMessage {
  type: 'nutrientMoved';
  nutrientId: string;
  position: Position;
}

// Union type of all possible server messages
export type ServerMessage =
  | GameStateMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerMovedMessage
  | NutrientSpawnedMessage
  | NutrientCollectedMessage
  | NutrientMovedMessage
  | EnergyUpdateMessage
  | PlayerDiedMessage
  | PlayerRespawnedMessage
  | PlayerEvolvedMessage;

// ============================================
// Game Constants
// ============================================

export const GAME_CONFIG = {
  // Movement
  PLAYER_SPEED: 200, // Pixels per second
  PLAYER_SIZE: 24,   // Radius of cyber-cell (circular)

  // World dimensions
  WORLD_WIDTH: 4800,   // Full playable world (doubled for stage 1 difficulty)
  WORLD_HEIGHT: 3200,
  VIEWPORT_WIDTH: 1200,  // What you see on screen
  VIEWPORT_HEIGHT: 800,

  // Visual theme - godcell: Digital Primordial Soup
  BACKGROUND_COLOR: 0x0a0a14, // Deep void
  GRID_COLOR: 0x1a1a3e,       // Subtle grid lines
  PARTICLE_COLOR: 0x00ff88,    // Flowing data particles (cyan)

  // Particle system
  MAX_PARTICLES: 300,          // Number of background particles
  PARTICLE_MIN_SIZE: 1,
  PARTICLE_MAX_SIZE: 3,
  PARTICLE_SPEED_MIN: 10,
  PARTICLE_SPEED_MAX: 40,

  // Cyber-cell colors (neon palette)
  CELL_COLORS: [
    '#00ffff', // Cyan
    '#ff00ff', // Magenta
    '#ffff00', // Yellow
    '#00ff88', // Mint
    '#ff0088', // Hot pink
    '#88ff00', // Lime
    '#0088ff', // Electric blue
  ],

  // Nutrients (data packets)
  NUTRIENT_COUNT: 13,           // Initial spawn count (reduced for stage 1 difficulty)
  NUTRIENT_RESPAWN_TIME: 30000, // 30 seconds in milliseconds
  NUTRIENT_SIZE: 8,             // Radius
  NUTRIENT_COLOR: 0x00ff00,     // Green data crystals
  NUTRIENT_ENERGY_VALUE: 25,    // Immediate energy gain
  NUTRIENT_CAPACITY_INCREASE: 10, // Permanent maxEnergy increase
  NUTRIENT_HIGH_VALUE_MULTIPLIER: 2, // Multiplier for nutrients near obstacles
  NUTRIENT_HIGH_VALUE_COLOR: 0xffff00, // Gold color for high-value nutrients

  // Gravity Obstacles (mini black holes)
  OBSTACLE_COUNT: 12,           // Number of distortions to spawn
  OBSTACLE_BASE_RADIUS: 300,    // Event horizon size (pixels)
  OBSTACLE_CORE_RADIUS: 30,     // Instant-death core radius (singularity)
  OBSTACLE_GRAVITY_STRENGTH: 0.03, // Force multiplier for inverse-square gravity
  OBSTACLE_DAMAGE_RATE: 10,     // Health damage per second at center (scales down with distance)
  OBSTACLE_NUTRIENT_ATTRACTION_SPEED: 50, // Pixels per second that nutrients move toward obstacles
  OBSTACLE_MIN_SEPARATION: 900, // Minimum distance between obstacles (pixels)

  // Metabolism & Health
  SINGLE_CELL_HEALTH: 100,
  SINGLE_CELL_MAX_HEALTH: 100,
  SINGLE_CELL_ENERGY: 100,
  SINGLE_CELL_MAX_ENERGY: 100,

  // Decay rates (units per second)
  ENERGY_DECAY_RATE: 2.22,      // ~45 seconds to starvation for single-cell (doubled for more pressure)
  STARVATION_DAMAGE_RATE: 5,    // Health damage per second when energy = 0

  // Evolution thresholds (maxEnergy required)
  EVOLUTION_MULTI_CELL: 250,      // 15 nutrients needed
  EVOLUTION_CYBER_ORGANISM: 500,  // ~40 nutrients total
  EVOLUTION_HUMANOID: 1000,       // ~90 nutrients total
  EVOLUTION_GODCELL: 2000,        // ~190 nutrients total

  // Evolution costs (% of maxEnergy consumed)
  EVOLUTION_ENERGY_COST_PERCENT: 0.4, // 40% of maxEnergy
  EVOLUTION_FUEL_REQUIREMENT_PERCENT: 0.8, // Must be 80% full to evolve
  EVOLUTION_MOLTING_DURATION: 2500, // 2.5 seconds invulnerable animation (ms)

  // Stage-specific stats multipliers
  MULTI_CELL_HEALTH_MULTIPLIER: 1.5,    // 150 health
  CYBER_ORGANISM_HEALTH_MULTIPLIER: 2,  // 200 health
  HUMANOID_HEALTH_MULTIPLIER: 3,        // 300 health
  GODCELL_HEALTH_MULTIPLIER: 5,         // 500 health
};
