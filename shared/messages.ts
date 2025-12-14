// ============================================
// Network Messages
// Client ↔ Server communication types
// ============================================

import type {
  Position,
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
  Tree,
  DataFruit,
  CyberBug,
  JungleCreature,
  EntropySerpent,
  Projectile,
  Trap,
  DeathCause,
  DamageSource,
  CombatSpecialization,
  MeleeAttackType,
  EvolutionStage,
  SpawnableEntityType,
} from './types';

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
  targetX: number; // World position to fire towards
  targetY: number;
}

export interface EMPActivateMessage {
  type: 'empActivate';
}

// Stage 3 projectile fire (ranged specialization)
export interface ProjectileFireMessage {
  type: 'projectileFire';
  targetX: number; // World position to fire towards
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
  targetX: number; // Direction to attack towards
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
  entropySerpents?: Record<string, EntropySerpent>;
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
  energy?: number; // Current energy for visual scaling (swarms grow as they drain)
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
  position: Position; // For visual effect
  energyGained: number; // How much predator gained
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
  energyGained: number;
  maxEnergyGained: number;
}

export interface PlayerDrainStateMessage {
  type: 'playerDrainState';
  drainedPlayerIds: string[]; // DEPRECATED - kept for backward compat
  drainedSwarmIds: string[]; // DEPRECATED - kept for backward compat

  // NEW: Comprehensive damage tracking per entity
  damageInfo: Record<
    string,
    {
      totalDamageRate: number; // Combined damage per second from all sources
      primarySource: DamageSource; // Dominant damage source (for color)
      proximityFactor?: number; // 0-1 for gradient effects (gravity wells)
    }
  >;

  swarmDamageInfo: Record<
    string,
    {
      totalDamageRate: number;
      primarySource: DamageSource;
    }
  >;
}

export interface PseudopodHitMessage {
  type: 'pseudopodHit';
  beamId: string; // Which beam hit
  targetId: string; // Which entity was hit
  hitPosition: Position; // Where the hit occurred
}

// Pseudopod Strike (energy whip AoE attack)
export interface PseudopodStrikeMessage {
  type: 'pseudopodStrike';
  strikerId: string; // Who fired the strike
  strikerPosition: Position; // Where the attacker is (start of lightning)
  targetPosition: Position; // Where the strike landed (end of lightning + AoE center)
  aoeRadius: number; // Radius of the impact zone
  hitTargetIds: string[]; // List of entities hit by the AoE
  totalDrained: number; // Total energy drained (for visual intensity)
  color: string; // Striker's color for the lightning visual
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
  position: Position; // For death effect
  energyGained: number;
  capacityGained: number;
}

export interface CyberBugMovedMessage {
  type: 'cyberBugMoved';
  bugId: string;
  position: Position;
  state: string; // 'idle' | 'patrol' | 'flee'
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
  position: Position; // For death effect
  energyGained: number;
  capacityGained: number;
}

export interface JungleCreatureMovedMessage {
  type: 'jungleCreatureMoved';
  creatureId: string;
  position: Position;
  state: string; // 'idle' | 'patrol' | 'hunt' | 'flee'
  variant: string; // 'grazer' | 'stalker' | 'ambusher'
}

// EntropySerpent spawn/move messages
export interface EntropySerpentSpawnedMessage {
  type: 'entropySerpentSpawned';
  serpent: EntropySerpent;
}

export interface EntropySerpentMovedMessage {
  type: 'entropySerpentMoved';
  serpentId: string;
  position: Position;
  state: 'patrol' | 'chase' | 'attack';
  heading: number;
  targetPlayerId?: string;
}

export interface EntropySerpentAttackMessage {
  type: 'entropySerpentAttack';
  serpentId: string;
  targetId: string;
  position: Position; // Target position (where attack lands)
  serpentPosition: Position; // Serpent position (attack origin)
  attackDirection: number; // Direction of attack in radians
  damage: number;
}

export interface EntropySerpentDamagedMessage {
  type: 'entropySerpentDamaged';
  serpentId: string;
  damage: number;
  currentEnergy: number;
  attackerId: string;
}

export interface EntropySerpentKilledMessage {
  type: 'entropySerpentKilled';
  serpentId: string;
  position: Position;
}

export interface EntropySerpentRespawnedMessage {
  type: 'entropySerpentSpawned'; // Server emits this type
  serpentId: string;
  position: Position;
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
  targetType: 'player' | 'cyberbug' | 'junglecreature' | 'serpent';
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
  deadline: number; // Timestamp when auto-assign triggers
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
  direction: { x: number; y: number }; // Normalized direction
  hitPlayerIds: string[]; // Who got hit
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

// ============================================
// Dev Panel Messages (Client ↔ Server)
// ============================================

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
  key: string; // e.g., 'PLAYER_SPEED'
  value: number; // New value
}

// Spawn an entity at position
export interface DevSpawnEntityCommand {
  action: 'spawnEntity';
  entityType: SpawnableEntityType;
  position: Position;
  options?: {
    nutrientMultiplier?: 1 | 2 | 3 | 5; // For nutrients
    botStage?: EvolutionStage; // For bots
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
  entityType: 'nutrient' | 'swarm' | 'single-cell' | 'multi-cell' | 'cyber-organism'; // Deletable entity types
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
  | EntropySerpentSpawnedMessage
  | EntropySerpentMovedMessage
  | EntropySerpentAttackMessage
  | EntropySerpentDamagedMessage
  | EntropySerpentKilledMessage
  | EntropySerpentRespawnedMessage
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
