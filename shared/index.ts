// ============================================
// Shared Types & Constants
// Used by both client and server
// ============================================

// ECS Module - Entity Component System shared between client and server
export * from './ecs';

// Math utilities - geometry and spatial algorithms
export * from './math';

// Player position in the game world
// z-axis: Height in 3D space (0 = ground, used for Stage 5 flying)
// z is optional for backwards compatibility - defaults to 0 when not specified
export interface Position {
  x: number;
  y: number;
  z?: number;  // Optional, defaults to 0 (ground level)
}

// Death causes for players
export type DeathCause = 'starvation' | 'singularity' | 'swarm' | 'obstacle' | 'predation' | 'beam' | 'gravity' | 'consumption';

// Damage sources for visual feedback (drain auras)
export type DamageSource =
  | 'predation'   // Red (multi-cell contact drain)
  | 'swarm'       // Red (entropy swarm attacks)
  | 'beam'        // Red (pseudopod projectiles)
  | 'gravity'     // Red (gravity well crushing)
  | 'starvation'  // Yellow/orange (zero energy)
  | 'melee'       // Red (Stage 3 melee attacks)
  | 'trap';       // Red (Stage 3 trap detonation)

// ============================================
// Stage 3 Combat Specialization
// Chosen at evolution to Stage 3, locked for that life
// ============================================

// Combat pathway chosen at Stage 3 evolution
export type CombatSpecialization = 'melee' | 'ranged' | 'traps' | null;

// Melee attack types for the melee pathway
export type MeleeAttackType = 'swipe' | 'thrust';

// Evolution stages
export enum EvolutionStage {
  SINGLE_CELL = 'single_cell',
  MULTI_CELL = 'multi_cell',
  CYBER_ORGANISM = 'cyber_organism',
  HUMANOID = 'humanoid',
  GODCELL = 'godcell',
}

// Entity scale - determines which render layer an entity belongs to
// Used for filtering visuals (auras, effects) by viewer's scale
//   soup   - Stage 1-2 (single-cell, multi-cell) - microscopic primordial ocean
//   jungle - Stage 3-4 (cyber-organism, humanoid) - digital jungle ecosystem
//   world  - Stage 5 (godcell) - transcendent global scale
export type EntityScale = 'soup' | 'jungle' | 'world';

/**
 * Get the scale of an entity based on its evolution stage.
 * Used for filtering visual effects - entities only see effects
 * from other entities at the same scale.
 */
export function getEntityScale(stage: EvolutionStage): EntityScale {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
    case EvolutionStage.MULTI_CELL:
      return 'soup';
    case EvolutionStage.CYBER_ORGANISM:
    case EvolutionStage.HUMANOID:
      return 'jungle';
    case EvolutionStage.GODCELL:
      return 'world';
  }
}

// A player in the game
export interface Player {
  id: string;
  position: Position;
  color: string; // Hex color like "#FF5733"

  // Energy-Only System
  // Energy is the sole resource: fuel, life, survival
  // 0 energy = instant death (dilution)
  energy: number;      // Current energy - decays over time, drained by threats
  maxEnergy: number;   // Capacity - grows with nutrients collected

  // Evolution
  stage: EvolutionStage;
  isEvolving: boolean; // True during molting animation
  radius: number;      // Collision/visual radius in pixels (derived from stage)

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
  damageRate: number; // UNUSED - gravity wells are physics-only (singularity = instant death)
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
  energy?: number; // Energy pool during consumption (set to SWARM_ENERGY when disabled by EMP)
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

// A digital jungle tree (Stage 3+ environment obstacle)
export interface Tree {
  id: string;
  position: Position;
  radius: number;   // Collision radius (trunk size)
  height: number;   // Visual height for rendering
  variant: number;  // Seed for procedural generation (0-1)
}

// ============================================
// Stage 3+ Macro-Resources (Digital Jungle Ecosystem)
// ============================================

// DataFruit - harvestable resource that grows near digital trees
export interface DataFruit {
  id: string;
  position: Position;
  treeEntityId: number;       // EntityId of parent tree (0 if fallen/detached)
  value: number;              // Energy gain on collection
  capacityIncrease: number;   // maxEnergy increase (evolution progress)
  ripeness: number;           // 0-1, affects visual glow intensity
  fallenAt?: number;          // Timestamp when fruit fell (undefined = still on tree)
}

// CyberBug - small skittish prey in swarms
export interface CyberBug {
  id: string;
  position: Position;
  swarmId: string;            // Groups bugs into swarms
  state: 'idle' | 'patrol' | 'flee';
  value: number;              // Energy gain on kill
  capacityIncrease: number;   // maxEnergy increase on kill
}

// JungleCreature - larger NPC fauna with variant behaviors
export interface JungleCreature {
  id: string;
  position: Position;
  variant: 'grazer' | 'stalker' | 'ambusher';
  state: 'idle' | 'patrol' | 'hunt' | 'flee';
  value: number;              // Energy gain on kill
  capacityIncrease: number;   // maxEnergy increase on kill
}

// Projectile - Stage 3 ranged specialization attack
export interface Projectile {
  id: string;
  ownerId: string;            // Socket ID of player who fired
  position: Position;         // Current position
  targetPosition: Position;   // Where it's heading
  state: 'traveling' | 'hit' | 'missed';
  color: string;              // Owner's color (for rendering)
}

// Trap - Stage 3 traps pathway disguised mine
export interface Trap {
  id: string;
  ownerId: string;            // Socket ID of player who placed
  position: Position;
  triggerRadius: number;      // Activation distance
  damage: number;             // Energy damage on trigger
  stunDuration: number;       // Stun duration in ms
  placedAt: number;           // Timestamp for lifetime tracking
  lifetime: number;           // Max lifetime in ms
  color: string;              // Owner's color (for rendering)
}

// ============================================
// Network Messages (Client → Server)
// ============================================

export interface PlayerMoveMessage {
  type: 'playerMove';
  direction: {
    x: number; // -1, 0, or 1
    y: number; // -1, 0, or 1
    z?: number; // -1, 0, or 1 (vertical: Q=ascend, E=descend, Stage 5 only, optional)
  };
}

export interface PlayerRespawnRequestMessage {
  type: 'playerRespawnRequest';
}

export interface PlayerSprintMessage {
  type: 'playerSprint';
  sprinting: boolean;
}

export interface PseudopodFireMessage {
  type: 'pseudopodFire';
  targetX: number;  // World position to fire towards
  targetY: number;
}

export interface EMPActivateMessage {
  type: 'empActivate';
}

// Stage 3 projectile fire (ranged specialization)
export interface ProjectileFireMessage {
  type: 'projectileFire';
  targetX: number;  // World position to fire towards
  targetY: number;
}

// ============================================
// Stage 3 Combat Specialization Messages (Client → Server)
// ============================================

// Player selects combat specialization at Stage 3 evolution
export interface SelectSpecializationMessage {
  type: 'selectSpecialization';
  specialization: CombatSpecialization;
}

// Melee attack (swipe or thrust)
export interface MeleeAttackMessage {
  type: 'meleeAttack';
  attackType: MeleeAttackType;
  targetX: number;  // Direction to attack towards
  targetY: number;
}

// Place a trap at position
export interface PlaceTrapMessage {
  type: 'placeTrap';
  x: number;
  y: number;
}

// ============================================
// Network Messages (Server → Client)
// ============================================

// WorldSnapshot: Sent once on connect with full world state (not continuous)
export interface WorldSnapshotMessage {
  type: 'worldSnapshot';
  players: Record<string, Player>; // Map of playerId → Player
  nutrients: Record<string, Nutrient>; // Map of nutrientId → Nutrient
  obstacles: Record<string, Obstacle>; // Map of obstacleId → Obstacle
  swarms: Record<string, EntropySwarm>; // Map of swarmId → EntropySwarm
  trees?: Record<string, Tree>; // Map of treeId → Tree (Stage 3+ jungle environment)
  // Stage 3+ macro-resources (jungle ecosystem)
  dataFruits?: Record<string, DataFruit>;
  cyberBugs?: Record<string, CyberBug>;
  jungleCreatures?: Record<string, JungleCreature>;
  projectiles?: Record<string, Projectile>;
  traps?: Record<string, Trap>;
}

// Backwards compat alias
export type GameStateMessage = WorldSnapshotMessage;

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
  // health field removed - energy-only system
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
  radius: number;
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

// Pseudopod Strike (energy whip AoE attack)
export interface PseudopodStrikeMessage {
  type: 'pseudopodStrike';
  strikerId: string;         // Who fired the strike
  strikerPosition: Position; // Where the attacker is (start of lightning)
  targetPosition: Position;  // Where the strike landed (end of lightning + AoE center)
  aoeRadius: number;         // Radius of the impact zone
  hitTargetIds: string[];    // List of entities hit by the AoE
  totalDrained: number;      // Total energy drained (for visual intensity)
  color: string;             // Striker's color for the lightning visual
}

// ============================================
// Stage 3+ Macro-Resource Messages
// ============================================

// DataFruit spawn/collect messages
export interface DataFruitSpawnedMessage {
  type: 'dataFruitSpawned';
  dataFruit: DataFruit;
}

export interface DataFruitCollectedMessage {
  type: 'dataFruitCollected';
  fruitId: string;
  playerId: string;
  energyGained: number;
  capacityGained: number;
}

export interface DataFruitDespawnedMessage {
  type: 'dataFruitDespawned';
  fruitId: string;
}

// CyberBug spawn/kill messages
export interface CyberBugSpawnedMessage {
  type: 'cyberBugSpawned';
  cyberBug: CyberBug;
}

export interface CyberBugKilledMessage {
  type: 'cyberBugKilled';
  bugId: string;
  killerId: string;
  position: Position;     // For death effect
  energyGained: number;
  capacityGained: number;
}

export interface CyberBugMovedMessage {
  type: 'cyberBugMoved';
  bugId: string;
  position: Position;
  state: string;  // 'idle' | 'patrol' | 'flee'
}

// JungleCreature spawn/kill messages
export interface JungleCreatureSpawnedMessage {
  type: 'jungleCreatureSpawned';
  jungleCreature: JungleCreature;
}

export interface JungleCreatureKilledMessage {
  type: 'jungleCreatureKilled';
  creatureId: string;
  killerId: string;
  position: Position;     // For death effect
  energyGained: number;
  capacityGained: number;
}

export interface JungleCreatureMovedMessage {
  type: 'jungleCreatureMoved';
  creatureId: string;
  position: Position;
  state: string;  // 'idle' | 'patrol' | 'hunt' | 'flee'
  variant: string;  // 'grazer' | 'stalker' | 'ambusher'
}

// Projectile messages (ranged specialization)
export interface ProjectileSpawnedMessage {
  type: 'projectileSpawned';
  projectile: Projectile;
}

export interface ProjectileHitMessage {
  type: 'projectileHit';
  projectileId: string;
  targetId: string;
  targetType: 'player' | 'cyberbug' | 'junglecreature';
  hitPosition: Position;
  damage: number;
  killed: boolean;
}

export interface ProjectileRetractedMessage {
  type: 'projectileRetracted';
  projectileId: string;
}

// ============================================
// Stage 3 Combat Specialization Messages (Server → Client)
// ============================================

// Server prompts client to choose specialization (on Stage 3 evolution)
export interface SpecializationPromptMessage {
  type: 'specializationPrompt';
  playerId: string;
  deadline: number;  // Timestamp when auto-assign triggers
}

// Server confirms specialization choice
export interface SpecializationSelectedMessage {
  type: 'specializationSelected';
  playerId: string;
  specialization: CombatSpecialization;
}

// Melee attack executed (for visual effects on all clients)
export interface MeleeAttackExecutedMessage {
  type: 'meleeAttackExecuted';
  playerId: string;
  attackType: MeleeAttackType;
  position: Position;
  direction: { x: number; y: number };  // Normalized direction
  hitPlayerIds: string[];               // Who got hit
}

// Trap placed in world
export interface TrapPlacedMessage {
  type: 'trapPlaced';
  trap: Trap;
}

// Trap triggered by a player
export interface TrapTriggeredMessage {
  type: 'trapTriggered';
  trapId: string;
  victimId: string;
  position: Position;
  damage: number;
  stunDuration: number;
  killed: boolean;
}

// Trap despawned (timeout or triggered)
export interface TrapDespawnedMessage {
  type: 'trapDespawned';
  trapId: string;
  reason: 'expired' | 'triggered';
}

// Knockback applied to a player
export interface KnockbackAppliedMessage {
  type: 'knockbackApplied';
  playerId: string;
  forceX: number;
  forceY: number;
}

// Union type of all possible server messages
export type ServerMessage =
  | WorldSnapshotMessage
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
  | PseudopodHitMessage
  | PseudopodStrikeMessage
  // Stage 3+ macro-resource messages
  | DataFruitSpawnedMessage
  | DataFruitCollectedMessage
  | DataFruitDespawnedMessage
  | CyberBugSpawnedMessage
  | CyberBugKilledMessage
  | CyberBugMovedMessage
  | JungleCreatureSpawnedMessage
  | JungleCreatureKilledMessage
  | JungleCreatureMovedMessage
  | ProjectileSpawnedMessage
  | ProjectileHitMessage
  | ProjectileRetractedMessage
  // Stage 3 combat specialization messages
  | SpecializationPromptMessage
  | SpecializationSelectedMessage
  | MeleeAttackExecutedMessage
  | TrapPlacedMessage
  | TrapTriggeredMessage
  | TrapDespawnedMessage
  | KnockbackAppliedMessage
  | DevConfigUpdatedMessage;

// ============================================
// Dev Panel Messages (Client ↔ Server)
// ============================================

// Entity types that can be spawned via dev panel
export type SpawnableEntityType = 'nutrient' | 'swarm' | 'obstacle' | 'single-cell' | 'multi-cell' | 'cyber-organism';

// Dev command from client to server
export interface DevCommandMessage {
  type: 'devCommand';
  command: DevCommand;
}

// All possible dev commands
export type DevCommand =
  | DevUpdateConfigCommand
  | DevSpawnEntityCommand
  | DevDeleteEntityCommand
  | DevDeleteAtCommand
  | DevClearWorldCommand
  | DevSetGodModeCommand
  | DevSetTimeScaleCommand
  | DevTeleportPlayerCommand
  | DevSetPlayerEnergyCommand
  | DevSetPlayerStageCommand
  | DevEvolveNextCommand
  | DevDevolvePrevCommand
  | DevPauseGameCommand
  | DevStepTickCommand;

// Update a GAME_CONFIG value
export interface DevUpdateConfigCommand {
  action: 'updateConfig';
  key: string;      // e.g., 'PLAYER_SPEED'
  value: number;    // New value
}

// Spawn an entity at position
export interface DevSpawnEntityCommand {
  action: 'spawnEntity';
  entityType: SpawnableEntityType;
  position: Position;
  options?: {
    nutrientMultiplier?: 1 | 2 | 3 | 5;  // For nutrients
    botStage?: EvolutionStage;            // For bots
  };
}

// Delete an entity by ID
export interface DevDeleteEntityCommand {
  action: 'deleteEntity';
  entityType: 'nutrient' | 'swarm' | 'obstacle' | 'player';
  entityId: string;
}

// Delete nearest entity at position (for click-to-delete)
export interface DevDeleteAtCommand {
  action: 'deleteAt';
  position: Position;
  entityType: 'nutrient' | 'swarm' | 'single-cell' | 'multi-cell' | 'cyber-organism';  // Deletable entity types
}

// Clear all entities from the world (playground mode)
export interface DevClearWorldCommand {
  action: 'clearWorld';
}

// Toggle god mode for a player
export interface DevSetGodModeCommand {
  action: 'setGodMode';
  playerId: string;
  enabled: boolean;
}

// Set game time scale (0 = paused, 1 = normal, 2 = fast)
export interface DevSetTimeScaleCommand {
  action: 'setTimeScale';
  scale: number;
}

// Teleport a player
export interface DevTeleportPlayerCommand {
  action: 'teleportPlayer';
  playerId: string;
  position: Position;
}

// Set player energy
export interface DevSetPlayerEnergyCommand {
  action: 'setPlayerEnergy';
  playerId: string;
  energy: number;
  maxEnergy?: number;
}

// Set player evolution stage
export interface DevSetPlayerStageCommand {
  action: 'setPlayerStage';
  playerId: string;
  stage: EvolutionStage;
}

// Evolve player to next stage (dev shortcut)
export interface DevEvolveNextCommand {
  action: 'evolveNext';
  playerId: string;
}

// Devolve player to previous stage (dev shortcut)
export interface DevDevolvePrevCommand {
  action: 'devolvePrev';
  playerId: string;
}

// Pause/unpause game
export interface DevPauseGameCommand {
  action: 'pauseGame';
  paused: boolean;
}

// Step a single tick (when paused)
export interface DevStepTickCommand {
  action: 'stepTick';
}

// Server broadcasts config updates to all clients
export interface DevConfigUpdatedMessage {
  type: 'devConfigUpdated';
  key: string;
  value: number;
}

// Server broadcasts dev state to clients
export interface DevStateMessage {
  type: 'devState';
  isPaused: boolean;
  timeScale: number;
}

// Runtime config that can be modified (subset of GAME_CONFIG keys)
export const DEV_TUNABLE_CONFIGS = [
  // Movement (Soup)
  'PLAYER_SPEED',
  'MOVEMENT_FRICTION',
  'MOVEMENT_ENERGY_COST',

  // Movement (Stage 3 - Cyber-Organism)
  'CYBER_ORGANISM_ACCELERATION_MULT',
  'CYBER_ORGANISM_MAX_SPEED_MULT',
  'CYBER_ORGANISM_FRICTION',
  'CYBER_ORGANISM_SPRINT_SPEED_MULT',
  'CYBER_ORGANISM_SPRINT_ENERGY_COST',

  // Movement (Stage 4 - Humanoid)
  'HUMANOID_ACCELERATION_MULT',
  'HUMANOID_MAX_SPEED_MULT',
  'HUMANOID_FRICTION',
  'HUMANOID_SPRINT_SPEED_MULT',
  'HUMANOID_SPRINT_ENERGY_COST',
  'HUMANOID_CAMERA_HEIGHT',

  // Energy & Decay
  'SINGLE_CELL_ENERGY_DECAY_RATE',
  'MULTI_CELL_ENERGY_DECAY_RATE',
  'CYBER_ORGANISM_ENERGY_DECAY_RATE',
  'HUMANOID_ENERGY_DECAY_RATE',

  // Evolution
  'EVOLUTION_MULTI_CELL',
  'EVOLUTION_CYBER_ORGANISM',
  'EVOLUTION_HUMANOID',
  'EVOLUTION_GODCELL',
  'EVOLUTION_MOLTING_DURATION',

  // Nutrients
  'NUTRIENT_ENERGY_VALUE',
  'NUTRIENT_CAPACITY_INCREASE',
  'NUTRIENT_RESPAWN_TIME',

  // Obstacles
  'OBSTACLE_GRAVITY_STRENGTH',
  'OBSTACLE_GRAVITY_RADIUS',
  'OBSTACLE_EVENT_HORIZON',
  'OBSTACLE_CORE_RADIUS',
  'OBSTACLE_SPARK_RADIUS',
  'OBSTACLE_ENERGY_DRAIN_RATE',

  // Swarms
  'SWARM_SPEED',
  'SWARM_DAMAGE_RATE',
  'SWARM_DETECTION_RADIUS',
  'SWARM_SLOW_EFFECT',

  // Combat
  'CONTACT_DRAIN_RATE',
  'PSEUDOPOD_RANGE',
  'PSEUDOPOD_AOE_RADIUS',
  'PSEUDOPOD_PROJECTILE_SPEED',
  'PSEUDOPOD_DRAIN_RATE',
  'PSEUDOPOD_COOLDOWN',
  'PSEUDOPOD_ENERGY_COST',

  // EMP
  'EMP_COOLDOWN',
  'EMP_RANGE',
  'EMP_DISABLE_DURATION',
  'EMP_ENERGY_COST',

  // Detection
  'MULTI_CELL_DETECTION_RADIUS',
] as const;

export type TunableConfigKey = typeof DEV_TUNABLE_CONFIGS[number];

// ============================================
// Game Constants
// ============================================

export const GAME_CONFIG = {
  // Movement (Soup - Stage 1-2)
  PLAYER_SPEED: 403, // Pixels per second (20% boost for faster, more responsive feel)
  MOVEMENT_FRICTION: 0.66, // Velocity decay per second (tighter handling for precise nutrient targeting)

  // Stage 3 Movement (Cyber-Organism): Grounded hexapod with momentum
  CYBER_ORGANISM_ACCELERATION_MULT: 1.5,   // Punchy acceleration (feel the push)
  CYBER_ORGANISM_MAX_SPEED_MULT: 1.56,     // 30% faster (zippy)
  CYBER_ORGANISM_FRICTION: 0.25,           // Grounded momentum (0.25=quick stop, 0.66=soup, 0.85=heavy glide)
  CYBER_ORGANISM_SPRINT_SPEED_MULT: 1.8,   // Sprint burst multiplier
  CYBER_ORGANISM_SPRINT_ENERGY_COST: 0.5,  // Energy/sec while sprinting

  // Stage 4 Movement (Humanoid): First-person FPS-style controls
  HUMANOID_ACCELERATION_MULT: 1.2,    // Responsive acceleration
  HUMANOID_MAX_SPEED_MULT: 0.8,       // Slower than cyber-organism (more deliberate)
  HUMANOID_FRICTION: 0.35,            // Quick stop (FPS-style tight control)
  HUMANOID_SPRINT_SPEED_MULT: 1.6,    // Sprint burst multiplier
  HUMANOID_SPRINT_ENERGY_COST: 0.8,   // Higher energy cost for humanoid sprint
  HUMANOID_CAMERA_HEIGHT: 160,        // First-person eye level (game units above ground)

  // Stage 5 Movement (Godcell): 3D flight with Q/E for vertical
  GODCELL_ACCELERATION_MULT: 1.5,   // Responsive 3D acceleration
  GODCELL_MAX_SPEED_MULT: 1.0,      // Full speed (transcendent movement)
  GODCELL_FRICTION: 0.4,            // Smooth glide (floaty, godlike)
  GODCELL_Z_MIN: 0,                 // Ground level (can't go below)
  GODCELL_Z_MAX: 2000,              // Sky ceiling

  // World dimensions - Soup (Stage 1-2 play area)
  WORLD_WIDTH: 4800,   // Soup width (backward compat alias)
  WORLD_HEIGHT: 3200,  // Soup height (backward compat alias)
  VIEWPORT_WIDTH: 1200,  // What you see on screen
  VIEWPORT_HEIGHT: 800,

  // Jungle dimensions (Stage 3+ play area) - 4x larger than soup
  JUNGLE_WIDTH: 19200,   // 4x soup width
  JUNGLE_HEIGHT: 12800,  // 4x soup height

  // Soup region within jungle (centered)
  // Soup exists as a small region in the middle of the jungle
  SOUP_ORIGIN_X: 7200,   // (19200 - 4800) / 2 = 7200
  SOUP_ORIGIN_Y: 4800,   // (12800 - 3200) / 2 = 4800
  SOUP_WIDTH: 4800,      // Same as WORLD_WIDTH
  SOUP_HEIGHT: 3200,     // Same as WORLD_HEIGHT

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
  NUTRIENT_RESPAWN_TIME: 10000, // 10 seconds in milliseconds
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
  OBSTACLE_CORE_RADIUS: 60,     // Visual dark void sphere
  OBSTACLE_SPARK_RADIUS: 18,    // Lethal inner spark (instant death zone)
  OBSTACLE_GRAVITY_STRENGTH: 1.0, // Force multiplier for inverse-square gravity
  OBSTACLE_ENERGY_DRAIN_RATE: 7.5,  // Energy/sec drain rate when inside gravity well (scaled by proximity)
  OBSTACLE_DAMAGE_RATE: 10,     // UNUSED - legacy field, energy drain now handled by OBSTACLE_ENERGY_DRAIN_RATE
  OBSTACLE_NUTRIENT_ATTRACTION_SPEED: 50, // Pixels per second that nutrients move toward obstacles
  OBSTACLE_MIN_SEPARATION: 900, // Minimum distance between obstacles (pixels)

  // ============================================
  // Energy-Only System
  // Energy is the sole resource: fuel, life, survival
  // 0 energy = instant death (dilution)
  // ============================================

  // Stage-specific energy pools (combined old health + energy)
  SINGLE_CELL_ENERGY: 100,       // Stage 1: 100 energy (harsh, must feed quickly)
  SINGLE_CELL_MAX_ENERGY: 100,   // No buffer - evolution is the only way to grow capacity
  MULTI_CELL_ENERGY: 300,        // Stage 2: starts at evolution threshold
  MULTI_CELL_MAX_ENERGY: 300,
  CYBER_ORGANISM_ENERGY: 3000,   // Stage 3: starts at evolution threshold
  CYBER_ORGANISM_MAX_ENERGY: 3000,
  HUMANOID_ENERGY: 30000,        // Stage 4: starts at evolution threshold
  HUMANOID_MAX_ENERGY: 30000,
  GODCELL_ENERGY: 100000,        // Stage 5: starts at evolution threshold (transcendent)
  GODCELL_MAX_ENERGY: 100000,

  // Decay rates (units per second) - stage-specific metabolic efficiency
  // These drain energy passively - no damage resistance applies
  SINGLE_CELL_ENERGY_DECAY_RATE: 2.66,    // ~37 seconds to starvation from spawn (100 / 2.66 ≈ 37s) - harsh!
  MULTI_CELL_ENERGY_DECAY_RATE: 2.1,      // ~190 seconds (400 / 2.1 ≈ 190s ≈ 3 minutes)
  CYBER_ORGANISM_ENERGY_DECAY_RATE: 12.0, // ~250 seconds (3000 / 12.0 ≈ 4.2 minutes) - doubled for urgency
  HUMANOID_ENERGY_DECAY_RATE: 3.3,        // ~606 seconds (2000 / 3.3 ≈ 10 minutes)
  GODCELL_ENERGY_DECAY_RATE: 0,           // Godcells transcend thermodynamics

  MOVEMENT_ENERGY_COST: 0.005,  // Energy cost per pixel moved

  // Evolution thresholds (maxEnergy required)
  EVOLUTION_MULTI_CELL: 300,       // Stage 1→2: ~20 nutrients (easy access to EMP)
  EVOLUTION_CYBER_ORGANISM: 3000,  // Stage 2→3: Major grind - swarm hunting essential
  EVOLUTION_HUMANOID: 30000,       // Stage 3→4: Full jungle ecosystem grind (fruits, bugs, creatures, PvP)
  EVOLUTION_GODCELL: 100000,       // Stage 4→5: Transcendence is earned

  // Evolution
  EVOLUTION_MOLTING_DURATION: 2500, // 2.5 seconds invulnerable animation (ms)

  // Health multipliers removed - energy-only system
  // Stage-specific energy pools defined above

  // Stage radii (collision/visual size in pixels)
  SINGLE_CELL_RADIUS: 15,      // Tiny single cell
  MULTI_CELL_RADIUS: 100,      // Order of magnitude jump - multi-cell organism
  CYBER_ORGANISM_RADIUS: 101,  // Jungle scale (similar to multi-cell, different world)
  HUMANOID_RADIUS: 192,        // Humanoid scale
  GODCELL_RADIUS: 288,         // Transcendent scale

  // Multi-cell detection (chemical sensing)
  MULTI_CELL_DETECTION_RADIUS: 1800,    // Can detect entities within 1800px (chemical sensing range)

  // Contact Predation (multi-cell engulfs single-cell)
  CONTACT_DRAIN_RATE: 150,               // Energy drained per second on contact (kills in ~1-2s)
  CONTACT_MAXENERGY_GAIN: 0.3,           // Gain 30% of victim's maxEnergy on kill
  NUTRIENT_DROP_ON_DEATH: 0.5,           // Victim drops 50% of collected nutrients (maxEnergy → nutrient count)

  // Pseudopod Strike (energy whip - medium range AoE attack)
  PSEUDOPOD_MODE: 'strike' as 'hitscan' | 'projectile' | 'strike', // 'strike' = instant AoE at target location
  PSEUDOPOD_RANGE: 250,                  // Max range in pixels (close quarters energy whip)
  PSEUDOPOD_AOE_RADIUS: 50,              // Impact zone radius for AoE damage
  PSEUDOPOD_PROJECTILE_SPEED: 3600,      // (legacy) Pixels per second beam travel speed
  PSEUDOPOD_WIDTH: 20,                   // (legacy) Beam collision width in pixels
  PSEUDOPOD_ENERGY_COST: 30,             // Energy cost per strike
  PSEUDOPOD_DRAIN_RATE: 200,             // Energy drained per hit (attacker absorbs this)
  PSEUDOPOD_COOLDOWN: 1000,              // Milliseconds between strikes
  MULTICELL_KILL_ABSORPTION: 0.8,        // Gain 80% of victim's maxEnergy when killing another multi-cell

  // Digital Jungle Trees (Stage 3+ environment obstacles)
  TREE_COUNT: 80,                     // Number of trees to spawn (~75-100 for medium density)
  TREE_MIN_RADIUS: 80,                // Small bush collision radius
  TREE_MAX_RADIUS: 360,               // Large ancient tree collision radius
  TREE_MIN_HEIGHT: 200,               // Small bush visual height
  TREE_MAX_HEIGHT: 2400,              // Large ancient tree visual height
  TREE_MIN_SPACING: 800,              // Minimum distance between trees (Poisson disc fills naturally)
  SOUP_POOL_RADIUS: 300,              // Visual pool radius in jungle (represents soup world)
  TREE_POOL_BUFFER: 100,              // Buffer around soup pool for tree spawning

  // Entropy Swarms (virus enemies)
  SWARM_COUNT: 18,                   // Number of swarms to spawn (doubled for stage 1 threat)
  SWARM_SIZE: 47,                    // Radius for collision detection (20% larger, more threatening)
  SWARM_SPEED: 290,                  // 20% boost to match faster player speed (still slower than players)
  SWARM_SLOW_EFFECT: 0.6,            // Speed multiplier when player is in contact with swarm (40% slow)
  SWARM_DETECTION_RADIUS: 700,       // How far swarms can detect players - extended pursuit range
  SWARM_DAMAGE_RATE: 60,             // Energy drain per second on contact (applies damage resistance)
  SWARM_PATROL_RADIUS: 400,          // How far swarms wander from spawn point
  SWARM_PATROL_CHANGE_INTERVAL: 3000, // Time between random patrol direction changes (ms)

  // EMP Ability (Multi-cell defensive/offensive pulse)
  EMP_COOLDOWN: 10000,              // 10 seconds between uses (milliseconds)
  EMP_RANGE: 768,                   // 8x multi-cell radius (8 * 96px = 768px) - AoE pulse range
  EMP_DISABLE_DURATION: 3000,       // 3 seconds paralysis for affected entities (milliseconds)
  EMP_ENERGY_COST: 80,              // Energy cost to activate
  EMP_MULTI_CELL_ENERGY_DRAIN: 80,  // Energy drained from hit multi-cells (applies damage resistance)
  EMP_SINGLE_CELL_ENERGY_DRAIN: 40, // Energy drained from hit single-cells (20% of their pool)

  // Swarm Consumption (EMP-enabled swarm hunting)
  SWARM_CONSUMPTION_RATE: 200,      // Energy drained per second during engulfment (0.5 seconds to consume)
  SWARM_ENERGY_GAIN: 150,           // Energy gained per swarm consumed (net +70 after 80 cost)
  SWARM_MAX_ENERGY_GAIN: 75,        // MaxEnergy capacity increase per swarm consumed (evolution accelerator)
  SWARM_BEAM_KILL_MAX_ENERGY_GAIN: 50, // MaxEnergy from beam-killing swarm (less than contact - nutrient loss)
  SWARM_ENERGY: 100,                // Swarm energy pool (set when disabled by EMP)

  // ============================================
  // Stage 3+ Macro-Resources (Digital Jungle Ecosystem)
  // Energy values are % of Stage 3→4 threshold (30,000 maxEnergy)
  // ============================================

  // DataFruit - passive foraging (2% of 30,000 = 600)
  DATAFRUIT_VALUE: 600,              // Energy on collection
  DATAFRUIT_CAPACITY: 600,           // maxEnergy increase (evolution progress)
  DATAFRUIT_RIPENESS_TIME: 30000,    // 30s to ripen on tree (ms)
  DATAFRUIT_GROUND_LIFETIME: 60000,  // 60s before fallen fruit despawns (ms)
  DATAFRUIT_COLLISION_RADIUS: 40,    // Collection/visual radius (2x for visibility)
  DATAFRUIT_SPAWN_OFFSET: 60,        // Random offset from tree center (legacy, not used)
  DATAFRUIT_TREE_SPAWN_INTERVAL: 45000, // 45s between tree fruit spawns (ms)

  // CyberBug - skittish prey in swarms (5% of 30,000 = 1,500)
  CYBERBUG_VALUE: 1500,              // Energy on kill
  CYBERBUG_CAPACITY: 1500,           // maxEnergy increase on kill
  CYBERBUG_SWARM_SIZE_MIN: 3,        // Minimum bugs per swarm
  CYBERBUG_SWARM_SIZE_MAX: 5,        // Maximum bugs per swarm
  CYBERBUG_SWARM_COUNT: 12,          // Number of swarms to spawn in jungle
  CYBERBUG_FLEE_TRIGGER_RADIUS: 300, // Start fleeing at this distance from player
  CYBERBUG_FLEE_SPEED: 350,          // Fast when scared (px/s)
  CYBERBUG_PATROL_SPEED: 100,        // Slow when calm (px/s)
  CYBERBUG_COLLISION_RADIUS: 15,     // Hit detection radius
  CYBERBUG_PATROL_RADIUS: 200,       // How far bugs wander from home
  CYBERBUG_SWARM_RESPAWN_DELAY: 30000, // 30s before swarm respawns after all bugs killed

  // JungleCreature - larger NPC fauna (10% of 30,000 = 3,000)
  JUNGLE_CREATURE_VALUE: 3000,       // Energy on kill
  JUNGLE_CREATURE_CAPACITY: 3000,    // maxEnergy increase on kill
  JUNGLE_CREATURE_COUNT: 8,          // Number of creatures to spawn
  JUNGLE_CREATURE_PATROL_RADIUS: 500, // How far creatures wander from home
  JUNGLE_CREATURE_AGGRO_RADIUS: 250, // Distance at which stalker/ambusher attacks
  JUNGLE_CREATURE_COLLISION_RADIUS: 40, // Hit detection radius (larger than bugs)
  JUNGLE_CREATURE_SPEED: 180,        // Base movement speed (px/s)
  JUNGLE_CREATURE_CHASE_SPEED: 280,  // Speed when hunting (stalker/ambusher)
  JUNGLE_CREATURE_DAMAGE_RATE: 80,   // Energy drain per second on player contact (stalker/ambusher)
  JUNGLE_CREATURE_RESPAWN_DELAY: 45000, // 45s before creature respawns after killed

  // Projectile - Stage 3 ranged specialization attack
  // Values scaled for jungle view (camera frustum ~4800 wide)
  PROJECTILE_SPEED: 7200,            // Pixels per second (2x pseudopod speed)
  PROJECTILE_MAX_DISTANCE: 10800,    // ~10,800px range (1.5s * 7200 px/s)
  PROJECTILE_COOLDOWN: 333,          // ms between shots (3 shots/sec)
  PROJECTILE_DAMAGE: 150,            // 5% of Stage 3 maxEnergy
  PROJECTILE_CAPACITY_STEAL: 0,      // No capacity steal from fauna (for now)
  PROJECTILE_COLLISION_RADIUS: 21,   // Hit detection radius (30% smaller)
  PROJECTILE_ENERGY_COST: 30,        // 1% of Stage 3 maxEnergy
  PROJECTILE_LIFETIME: 1500,         // ms before despawn

  // ============================================
  // Stage 3 Combat Specialization System
  // Base values calculated from Stage 3 initial maxEnergy (3000)
  // ============================================

  // Specialization selection
  SPECIALIZATION_SELECTION_DURATION: 5000,  // 5 seconds to choose before auto-assign

  // Melee Pathway - close-range swipe and thrust attacks
  // Energy costs: 0.5% of 3000 = 15
  // Damage: 5% of 3000 = 150
  MELEE_SWIPE_RANGE: 512,             // Max range (30% smaller)
  MELEE_SWIPE_ARC: 90,                // degrees (quarter arc)
  MELEE_SWIPE_DAMAGE: 150,            // 5% of Stage 3 maxEnergy
  MELEE_SWIPE_KNOCKBACK: 200,         // pixels push distance
  MELEE_SWIPE_ENERGY_COST: 15,        // 0.5% of Stage 3 maxEnergy
  MELEE_SWIPE_COOLDOWN: 200,          // ms between attacks (very fast)

  MELEE_THRUST_RANGE: 512,            // Max range (30% smaller)
  MELEE_THRUST_ARC: 30,               // degrees (narrow cone)
  MELEE_THRUST_DAMAGE: 150,           // 5% of Stage 3 maxEnergy
  MELEE_THRUST_KNOCKBACK: 200,        // pixels push distance
  MELEE_THRUST_ENERGY_COST: 15,       // 0.5% of Stage 3 maxEnergy
  MELEE_THRUST_COOLDOWN: 200,         // ms between attacks

  MELEE_KNOCKBACK_DECAY_RATE: 2000,   // Knockback force decay per second

  // Traps Pathway - disguised mines that stun victims
  // Energy cost: 5% of 3000 = 150
  // Damage: 12.5% of 3000 = 375
  TRAP_MAX_ACTIVE: 5,                 // Max traps per player
  TRAP_LIFETIME: 120000,              // 120 seconds before auto-despawn
  TRAP_TRIGGER_RADIUS: 101,           // 30% smaller trigger radius
  TRAP_DAMAGE: 375,                   // 12.5% of Stage 3 maxEnergy
  TRAP_STUN_DURATION: 1000,           // 1 second stun
  TRAP_ENERGY_COST: 150,              // 5% of Stage 3 maxEnergy
  TRAP_COOLDOWN: 1000,                // 1 second between placements
};
