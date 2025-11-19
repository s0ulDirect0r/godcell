// ============================================
// Shared Types & Constants
// Used by both client and server
// ============================================

// Player position in the game world
export interface Position {
  x: number;
  y: number;
}

// Death causes for players
export type DeathCause = 'starvation' | 'singularity' | 'swarm' | 'obstacle';

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
  value: number; // Immediate energy value when collected (scales with proximity: 25/50/75/125)
  capacityIncrease: number; // Permanent maxEnergy increase (scales with proximity: 10/20/30/50)
  valueMultiplier: number; // Proximity multiplier (1/2/3/5) - determines color
  isHighValue?: boolean; // True if spawned near obstacle (multiplier > 1)
}

// A gravity distortion obstacle (mini black hole)
export interface Obstacle {
  id: string;
  position: Position;
  radius: number; // Gravity influence radius (600px - escapable zone)
  strength: number; // Gravity force multiplier
  damageRate: number; // Health damage per second at center
}

// An entropy swarm (virus enemy)
export interface EntropySwarm {
  id: string;
  position: Position;
  velocity: { x: number; y: number }; // Current movement direction/speed
  size: number; // Radius for collision detection
  state: 'patrol' | 'chase'; // AI state
  targetPlayerId?: string; // Player being chased (if state === 'chase')
  patrolTarget?: Position; // Where swarm is wandering toward (if state === 'patrol')
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
  swarms: Record<string, EntropySwarm>; // Map of swarmId → EntropySwarm
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
  cause: DeathCause; // What killed the player
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

export interface SwarmSpawnedMessage {
  type: 'swarmSpawned';
  swarm: EntropySwarm;
}

export interface SwarmMovedMessage {
  type: 'swarmMoved';
  swarmId: string;
  position: Position;
  state: 'patrol' | 'chase';
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
  | PlayerEvolvedMessage
  | SwarmSpawnedMessage
  | SwarmMovedMessage;

// ============================================
// Game Constants
// ============================================

export const GAME_CONFIG = {
  // Movement
  PLAYER_SPEED: 336, // Pixels per second (tuned for feel with momentum system)
  PLAYER_SIZE: 24,   // Radius of cyber-cell (circular)
  MOVEMENT_FRICTION: 0.85, // Velocity decay per second (0 = instant stop, 1 = no friction)

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
  NUTRIENT_COUNT: 26,           // Initial spawn count (doubled for stage 1 tuning)
  NUTRIENT_RESPAWN_TIME: 30000, // 30 seconds in milliseconds
  NUTRIENT_SIZE: 8,             // Radius
  NUTRIENT_COLOR: 0x00ff00,     // Green data crystals (base 1x)
  NUTRIENT_ENERGY_VALUE: 25,    // Immediate energy gain
  NUTRIENT_CAPACITY_INCREASE: 10, // Permanent maxEnergy increase

  // Gradient nutrient colors (based on proximity to distortion cores)
  NUTRIENT_2X_COLOR: 0x00ffff,  // Cyan (2x value, outer gravity well)
  NUTRIENT_3X_COLOR: 0xffff00,  // Gold (3x value, inner gravity well)
  NUTRIENT_5X_COLOR: 0xff00ff,  // Magenta (5x value, event horizon edge - extreme risk!)

  // Gravity Obstacles (mini black holes)
  OBSTACLE_COUNT: 12,           // Number of distortions to spawn
  OBSTACLE_GRAVITY_RADIUS: 600, // Full gravity influence zone (escapable with effort)
  OBSTACLE_EVENT_HORIZON: 180,  // Inescapable zone (magenta filled - 30% of gravity radius)
  OBSTACLE_CORE_RADIUS: 60,     // Instant-death singularity core
  OBSTACLE_GRAVITY_STRENGTH: 0.72, // Force multiplier for inverse-square gravity (12x original to compensate for higher speeds + momentum)
  OBSTACLE_DAMAGE_RATE: 10,     // Health damage per second at center (scales down with distance)
  OBSTACLE_NUTRIENT_ATTRACTION_SPEED: 50, // Pixels per second that nutrients move toward obstacles
  OBSTACLE_MIN_SEPARATION: 900, // Minimum distance between obstacles (pixels)

  // Metabolism & Health
  SINGLE_CELL_HEALTH: 100,
  SINGLE_CELL_MAX_HEALTH: 100,
  SINGLE_CELL_ENERGY: 100,
  SINGLE_CELL_MAX_ENERGY: 100,

  // Decay rates (units per second) - stage-specific metabolic efficiency
  SINGLE_CELL_ENERGY_DECAY_RATE: 2.66,  // ~37.5 seconds to starvation (100 energy / 2.66 = 37.5s)
  MULTI_CELL_ENERGY_DECAY_RATE: 2.1,    // ~119 seconds to starvation (250 energy / 2.1 = 119s ≈ 2 minutes)
  CYBER_ORGANISM_ENERGY_DECAY_RATE: 2.8,  // ~178 seconds (500 / 2.8 ≈ 3 minutes)
  HUMANOID_ENERGY_DECAY_RATE: 3.3,        // ~303 seconds (1000 / 3.3 ≈ 5 minutes)
  GODCELL_ENERGY_DECAY_RATE: 0,           // Godcells transcend thermodynamics (no passive decay)

  STARVATION_DAMAGE_RATE: 5,    // Health damage per second when energy = 0
  MOVEMENT_ENERGY_COST: 0.005,  // Energy cost per pixel moved (start low, tune upward based on playtesting)

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

  // Size multipliers (visual presence and intimidation)
  SINGLE_CELL_SIZE_MULTIPLIER: 1,       // Base size (24px radius)
  MULTI_CELL_SIZE_MULTIPLIER: 4,        // 4x larger (96px radius) - multi-cellular organism
  CYBER_ORGANISM_SIZE_MULTIPLIER: 6,    // 6x larger (144px radius)
  HUMANOID_SIZE_MULTIPLIER: 8,          // 8x larger (192px radius)
  GODCELL_SIZE_MULTIPLIER: 12,          // 12x larger (288px radius) - transcendent scale

  // Entropy Swarms (virus enemies)
  SWARM_COUNT: 18,                   // Number of swarms to spawn (doubled for stage 1 threat)
  SWARM_SIZE: 47,                    // Radius for collision detection (20% larger, more threatening)
  SWARM_SPEED: 242,                  // Tuned with new player speed (still slower than players)
  SWARM_SLOW_EFFECT: 0.6,            // Speed multiplier when player is in contact with swarm (40% slow)
  SWARM_DETECTION_RADIUS: 700,       // How far swarms can detect players - extended pursuit range
  SWARM_DAMAGE_RATE: 30,            // Health damage per second on contact (doubled for stage 1 tuning)
  SWARM_PATROL_RADIUS: 400,          // How far swarms wander from spawn point
  SWARM_PATROL_CHANGE_INTERVAL: 3000, // Time between random patrol direction changes (ms)
};
