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
export type DeathCause = 'starvation' | 'singularity' | 'swarm' | 'obstacle' | 'predation' | 'beam';

// Damage sources for visual feedback (drain auras)
export type DamageSource =
  | 'predation'   // Red (multi-cell contact drain)
  | 'swarm'       // Red (entropy swarm attacks)
  | 'beam'        // Red (pseudopod projectiles)
  | 'gravity'     // Red (gravity well crushing)
  | 'starvation'; // Yellow/orange (zero energy)

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

  // EMP Ability (Multi-cell+)
  lastEMPTime?: number;  // Timestamp of last EMP use (for cooldown tracking)
  stunnedUntil?: number; // Timestamp when stun expires (if hit by another player's EMP)
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
  disabledUntil?: number; // Timestamp when EMP stun expires (if disabled)
  currentHealth?: number; // Health during consumption (starts at SWARM_INITIAL_HEALTH when disabled)
}

// A pseudopod beam (lightning projectile fired by multi-cells)
export interface Pseudopod {
  id: string;
  ownerId: string;          // Player who fired it
  position: Position;       // Current beam position
  velocity: { x: number; y: number }; // Travel direction and speed
  width: number;            // Beam collision width
  maxDistance: number;      // Max travel distance (3x multi-cell radius)
  distanceTraveled: number; // How far it's traveled
  createdAt: number;        // Timestamp for tracking
  color: string;            // Owner's color (for rendering)
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

export interface PseudopodFireMessage {
  type: 'pseudopodFire';
  targetX: number;  // World position to fire towards
  targetY: number;
}

export interface EMPActivateMessage {
  type: 'empActivate';
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

export interface PlayerEvolutionStartedMessage {
  type: 'playerEvolutionStarted';
  playerId: string;
  currentStage: EvolutionStage;
  targetStage: EvolutionStage;
  duration: number;
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
  disabledUntil?: number; // Timestamp when EMP stun expires (if disabled)
}

export interface PseudopodSpawnedMessage {
  type: 'pseudopodSpawned';
  pseudopod: Pseudopod;
}

export interface PseudopodMovedMessage {
  type: 'pseudopodMoved';
  pseudopodId: string;
  position: Position;
}

export interface PseudopodRetractedMessage {
  type: 'pseudopodRetracted';
  pseudopodId: string;
}

export interface PlayerEngulfedMessage {
  type: 'playerEngulfed';
  predatorId: string;
  preyId: string;
  position: Position;       // For visual effect
  energyGained: number;     // How much predator gained
}

export interface DetectedEntity {
  id: string;
  position: Position;
  entityType: 'player' | 'nutrient' | 'swarm';
  stage?: EvolutionStage; // For players only
}

export interface DetectionUpdateMessage {
  type: 'detectionUpdate';
  detected: DetectedEntity[];
}

export interface EMPActivatedMessage {
  type: 'empActivated';
  playerId: string;
  position: Position;
  affectedSwarmIds: string[];
  affectedPlayerIds: string[];
}

export interface SwarmConsumedMessage {
  type: 'swarmConsumed';
  swarmId: string;
  consumerId: string;
}

export interface PlayerDrainStateMessage {
  type: 'playerDrainState';
  drainedPlayerIds: string[]; // DEPRECATED - kept for backward compat
  drainedSwarmIds: string[]; // DEPRECATED - kept for backward compat

  // NEW: Comprehensive damage tracking per entity
  damageInfo: Record<string, {
    totalDamageRate: number;    // Combined damage per second from all sources
    primarySource: DamageSource; // Dominant damage source (for color)
    proximityFactor?: number;    // 0-1 for gradient effects (gravity wells)
  }>;

  swarmDamageInfo: Record<string, {
    totalDamageRate: number;
    primarySource: DamageSource;
  }>;
}

export interface PseudopodHitMessage {
  type: 'pseudopodHit';
  beamId: string;       // Which beam hit
  targetId: string;     // Which entity was hit
  hitPosition: Position; // Where the hit occurred
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
  | PlayerEvolutionStartedMessage
  | PlayerEvolvedMessage
  | SwarmSpawnedMessage
  | SwarmMovedMessage
  | PseudopodSpawnedMessage
  | PseudopodMovedMessage
  | PseudopodRetractedMessage
  | PlayerEngulfedMessage
  | DetectionUpdateMessage
  | EMPActivatedMessage
  | SwarmConsumedMessage
  | PlayerDrainStateMessage
  | PseudopodHitMessage;

// ============================================
// Game Constants
// ============================================

export const GAME_CONFIG = {
  // Movement
  PLAYER_SPEED: 403, // Pixels per second (20% boost for faster, more responsive feel)
  PLAYER_SIZE: 10,   // Radius of single-cell (tiny for order of magnitude evolution jump)
  MOVEMENT_FRICTION: 0.66, // Velocity decay per second (tighter handling for precise nutrient targeting)

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
  MAX_PARTICLES: 600,          // Number of background particles (doubled for more visual density)
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
  NUTRIENT_COUNT: 32,           // Initial spawn count (balanced for stage 1-2)
  NUTRIENT_RESPAWN_TIME: 30000, // 30 seconds in milliseconds
  NUTRIENT_SIZE: 12,            // Radius (balanced for collection difficulty)
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
  EVOLUTION_MULTI_CELL: 300,      // Stage 1→2: ~20 nutrients (easy access to EMP)
  EVOLUTION_CYBER_ORGANISM: 800,  // Stage 2→3: Swarm hunting path (+50 maxEnergy per swarm consumed)
  EVOLUTION_HUMANOID: 1000,       // ~90 nutrients total
  EVOLUTION_GODCELL: 2000,        // ~190 nutrients total

  // Evolution
  EVOLUTION_MOLTING_DURATION: 2500, // 2.5 seconds invulnerable animation (ms)

  // Stage-specific stats multipliers
  MULTI_CELL_HEALTH_MULTIPLIER: 1.5,    // 150 health
  CYBER_ORGANISM_HEALTH_MULTIPLIER: 2,  // 200 health
  HUMANOID_HEALTH_MULTIPLIER: 3,        // 300 health
  GODCELL_HEALTH_MULTIPLIER: 5,         // 500 health

  // Size multipliers (visual presence and intimidation)
  SINGLE_CELL_SIZE_MULTIPLIER: 1,       // Base size (10px radius)
  MULTI_CELL_SIZE_MULTIPLIER: 10,       // 10x larger (100px radius) - order of magnitude jump!
  CYBER_ORGANISM_SIZE_MULTIPLIER: 14.4, // 14.4x larger (144px radius)
  HUMANOID_SIZE_MULTIPLIER: 19.2,       // 19.2x larger (192px radius)
  GODCELL_SIZE_MULTIPLIER: 28.8,        // 28.8x larger (288px radius) - transcendent scale

  // Multi-cell detection (chemical sensing)
  MULTI_CELL_DETECTION_RADIUS: 1800,    // Can detect entities within 1800px (chemical sensing range)

  // Contact Predation (multi-cell engulfs single-cell)
  CONTACT_DRAIN_RATE: 150,               // Energy drained per second on contact (kills in ~1-2s)
  CONTACT_MAXENERGY_GAIN: 0.3,           // Gain 30% of victim's maxEnergy on kill
  NUTRIENT_DROP_ON_DEATH: 0.5,           // Victim drops 50% of collected nutrients (maxEnergy → nutrient count)

  // Pseudopod Beam (lightning projectile for PvP)
  PSEUDOPOD_MODE: 'projectile' as 'hitscan' | 'projectile', // 'hitscan' = instant hit, 'projectile' = travels
  PSEUDOPOD_RANGE: 9999,                 // Max range in pixels (9999 = unlimited for testing)
  PSEUDOPOD_PROJECTILE_SPEED: 3600,      // Pixels per second beam travel speed (2x faster)
  PSEUDOPOD_WIDTH: 20,                   // Beam collision width in pixels
  PSEUDOPOD_ENERGY_COST: 30,             // Energy cost per shot
  PSEUDOPOD_DRAIN_RATE: 100,             // Energy drained per hit
  PSEUDOPOD_COOLDOWN: 1000,              // Milliseconds between beam fires
  MULTICELL_KILL_ABSORPTION: 0.8,        // Gain 80% of victim's maxEnergy when killing another multi-cell

  // Entropy Swarms (virus enemies)
  SWARM_COUNT: 18,                   // Number of swarms to spawn (doubled for stage 1 threat)
  SWARM_SIZE: 47,                    // Radius for collision detection (20% larger, more threatening)
  SWARM_SPEED: 290,                  // 20% boost to match faster player speed (still slower than players)
  SWARM_SLOW_EFFECT: 0.6,            // Speed multiplier when player is in contact with swarm (40% slow)
  SWARM_DETECTION_RADIUS: 700,       // How far swarms can detect players - extended pursuit range
  SWARM_DAMAGE_RATE: 60,            // Health damage per second on contact (brutal - getting caught is deadly)
  SWARM_PATROL_RADIUS: 400,          // How far swarms wander from spawn point
  SWARM_PATROL_CHANGE_INTERVAL: 3000, // Time between random patrol direction changes (ms)

  // EMP Ability (Multi-cell defensive/offensive pulse)
  EMP_COOLDOWN: 10000,              // 10 seconds between uses (milliseconds)
  EMP_RANGE: 768,                   // 8x multi-cell radius (8 * 96px = 768px) - AoE pulse range
  EMP_DISABLE_DURATION: 3000,       // 3 seconds paralysis for affected entities (milliseconds)
  EMP_ENERGY_COST: 80,              // Energy cost to activate (27% of 300 pool)
  EMP_MULTI_CELL_ENERGY_DRAIN: 80,  // Energy drained from hit multi-cells

  // Swarm Consumption (EMP-enabled swarm hunting)
  SWARM_CONSUMPTION_RATE: 200,      // Health drained per second during engulfment (0.5 seconds to fully consume)
  SWARM_ENERGY_GAIN: 150,           // Energy gained per swarm consumed (net +70 after 80 cost)
  SWARM_MAX_ENERGY_GAIN: 50,        // MaxEnergy capacity increase per swarm consumed (evolution accelerator)
  SWARM_INITIAL_HEALTH: 100,        // Health pool for swarms (set when disabled by EMP)
};
