// ============================================
// Game Context
// Bridge between legacy state and ECS systems
// ============================================
//
// During the ECS migration, systems need access to game state that's
// currently stored in module-level Maps. This context holds references
// to all shared state and helper functions.
//
// As we migrate more logic into ECS components, this context will shrink.
// Eventually, systems will only need the ECS World.

import type { Server } from 'socket.io';
import type {
  World,
  Player,
  Nutrient,
  Obstacle,
  Position,
  EntropySwarm,
  Pseudopod,
  EvolutionStage,
  DamageSource,
  DeathCause,
} from '@godcell/shared';
import type { AbilitySystem } from '../../abilities';

/**
 * Active damage record for tracking damage sources (matches index.ts ActiveDamage)
 */
export interface ActiveDamageRecord {
  damageRate: number;
  source: DamageSource;
  proximityFactor?: number;
}

/**
 * GameContext - Shared state for all systems
 *
 * This is the bridge between legacy Map-based state and ECS.
 * Systems receive this context and can access whatever they need.
 */
export interface GameContext {
  // ECS World
  world: World;

  // Socket.io server for broadcasting
  io: Server;

  // Delta time for this tick (seconds)
  deltaTime: number;

  // ============================================
  // Entity Collections (legacy Maps)
  // ============================================
  players: Map<string, Player>;
  nutrients: Map<string, Nutrient>;
  obstacles: Map<string, Obstacle>;

  // Swarm access (through getter because it's in swarms.ts)
  getSwarms: () => Map<string, EntropySwarm>;

  // Pseudopod state
  pseudopods: Map<string, Pseudopod>;
  pseudopodHits: Map<string, Set<string>>;

  // ============================================
  // Player State Maps
  // ============================================
  playerVelocities: Map<string, { x: number; y: number }>;
  playerInputDirections: Map<string, { x: number; y: number }>;
  playerSprintState: Map<string, boolean>;
  playerLastDamageSource: Map<string, DeathCause>;

  // Cooldown tracking
  playerEMPCooldowns: Map<string, number>;
  playerPseudopodCooldowns: Map<string, number>;

  // Drain state tracking
  activeDrains: Set<string>; // Set of prey IDs being drained
  activeSwarmDrains: Set<string>;
  lastBroadcastedDrains: Set<string>;

  // Active damage tracking for HUD
  activeDamage: Map<string, ActiveDamageRecord[]>;

  // ============================================
  // Per-Tick Transient Data (set by systems, read by later systems)
  // ============================================
  tickData: {
    // Set by SwarmCollisionSystem, read by MovementSystem
    damagedPlayerIds: Set<string>;
    slowedPlayerIds: Set<string>;
  };

  // ============================================
  // Ability System
  // ============================================
  abilitySystem: AbilitySystem;

  // ============================================
  // Helper Functions
  // ============================================

  // Geometry helpers
  distance: (p1: Position, p2: Position) => number;
  getPlayerRadius: (stage: EvolutionStage) => number;
  getWorldBoundsForStage: (stage: EvolutionStage) => {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };

  // Damage helpers
  applyDamageWithResistance: (player: Player, baseDamage: number) => number;
  recordDamage: (
    entityId: string,
    damageRate: number,
    source: DamageSource,
    proximityFactor?: number
  ) => void;

  // Stage helpers
  getStageMaxEnergy: (stage: EvolutionStage) => number;
  getDamageResistance: (stage: EvolutionStage) => number;
  getEnergyDecayRate: (stage: EvolutionStage) => number;
  isSoupStage: (stage: EvolutionStage) => boolean;
  isJungleStage: (stage: EvolutionStage) => boolean;

  // Entity lifecycle
  isBot: (playerId: string) => boolean;

  // ============================================
  // Legacy Functions (to be migrated into systems)
  // ============================================

  // These exist so systems can call existing logic during migration.
  // As systems mature, the logic moves INTO the system and these
  // references are removed.

  updateBots: (
    timestamp: number,
    nutrients: Map<string, Nutrient>,
    obstacles: Map<string, Obstacle>,
    swarms: EntropySwarm[],
    players: Map<string, Player>,
    abilitySystem: AbilitySystem,
    ecsWorld: World
  ) => void;

  updateSwarms: (
    timestamp: number,
    players: Map<string, Player>,
    obstacles: Map<string, Obstacle>,
    deltaTime: number
  ) => void;
  updateSwarmPositions: (deltaTime: number, io: Server) => void;
  processSwarmRespawns: (io: Server) => void;
  updatePseudopods: (deltaTime: number, io: Server) => void;
  checkPredationCollisions: (deltaTime: number) => void;
  checkSwarmCollisions: (
    players: Map<string, Player>,
    deltaTime: number,
    recordDamage?: (
      entityId: string,
      damageRate: number,
      source: DamageSource
    ) => void,
    applyDamage?: (player: Player, baseDamage: number) => number
  ) => { damagedPlayerIds: Set<string>; slowedPlayerIds: Set<string> };
  respawnNutrient: (nutrientId: string) => void;
  handlePlayerDeath: (player: Player, cause: DeathCause) => void;
  broadcastEnergyUpdates: () => void;
  broadcastDetectionUpdates: () => void;
  broadcastDrainState: () => void;
  removeSwarm: (swarmId: string) => void;
}

/**
 * Create a minimal SystemContext from GameContext for systems that
 * only need World, io, and deltaTime.
 */
export function toSystemContext(ctx: GameContext) {
  return {
    world: ctx.world,
    io: ctx.io,
    deltaTime: ctx.deltaTime,
  };
}
