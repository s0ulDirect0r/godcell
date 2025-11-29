// ============================================
// Game State - ECS-Backed Entity Storage
// Bridge layer: maintains old Map-based API while
// using ECS World as the underlying data store
// ============================================

import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
  GameStateMessage,
  DamageSource,
  EvolutionStage,
} from '@godcell/shared';
import {
  World,
  Tags,
  Components,
  createClientWorld,
  upsertPlayer,
  updatePlayerTarget,
  removePlayer as ecsRemovePlayer,
  updatePlayerEnergy as ecsUpdatePlayerEnergy,
  setPlayerEvolving as ecsSetPlayerEvolving,
  updatePlayerEvolved as ecsUpdatePlayerEvolved,
  getPlayer,
  upsertNutrient,
  updateNutrientPosition,
  removeNutrient as ecsRemoveNutrient,
  upsertObstacle,
  upsertSwarm,
  updateSwarmTarget,
  removeSwarm as ecsRemoveSwarm,
  upsertPseudopod,
  updatePseudopodPosition,
  removePseudopod as ecsRemovePseudopod,
  setPlayerDamageInfo,
  clearPlayerDamageInfo,
  setSwarmDamageInfo,
  clearLookups,
  getStringIdByEntity,
} from '../../ecs';
import type {
  PositionComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  InterpolationTargetComponent,
  ClientDamageInfoComponent,
} from '../../ecs';

export interface InterpolationTarget {
  x: number;
  y: number;
  timestamp: number;
}

/**
 * GameState - bridge between network messages and ECS World.
 *
 * This class maintains backward compatibility with existing code that
 * expects Map-based entity storage, while actually storing everything
 * in the ECS World. The Maps are now computed views over ECS data.
 */
export class GameState {
  // The underlying ECS World - single source of truth
  readonly world: World;

  // Status tracking (DEPRECATED - use damage info maps below)
  readonly drainedPlayerIds: Set<string> = new Set();
  readonly drainedSwarmIds: Set<string> = new Set();

  // Local player reference
  myPlayerId: string | null = null;

  constructor() {
    this.world = createClientWorld();
  }

  // ============================================
  // Computed Map Views
  // These getters query the ECS World and return Map-compatible views
  // ============================================

  /**
   * Get all players as a Map.
   * NOTE: This creates a new Map each call - cache if needed for performance.
   */
  get players(): Map<string, Player> {
    const result = new Map<string, Player>();
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (!playerId) return;
      const player = getPlayer(this.world, playerId);
      if (player) {
        result.set(playerId, player);
      }
    });
    return result;
  }

  /**
   * Get all nutrients as a Map.
   */
  get nutrients(): Map<string, Nutrient> {
    const result = new Map<string, Nutrient>();
    this.world.forEachWithTag(Tags.Nutrient, (entity) => {
      const nutrientId = getStringIdByEntity(entity);
      if (!nutrientId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const nutrient = this.world.getComponent<NutrientComponent>(entity, Components.Nutrient);
      if (pos && nutrient) {
        result.set(nutrientId, {
          id: nutrientId,
          position: { x: pos.x, y: pos.y },
          value: nutrient.value,
          capacityIncrease: nutrient.capacityIncrease,
          valueMultiplier: nutrient.valueMultiplier,
          isHighValue: nutrient.isHighValue,
        });
      }
    });
    return result;
  }

  /**
   * Get all obstacles as a Map.
   */
  get obstacles(): Map<string, Obstacle> {
    const result = new Map<string, Obstacle>();
    this.world.forEachWithTag(Tags.Obstacle, (entity) => {
      const obstacleId = getStringIdByEntity(entity);
      if (!obstacleId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const obstacle = this.world.getComponent<ObstacleComponent>(entity, Components.Obstacle);
      if (pos && obstacle) {
        result.set(obstacleId, {
          id: obstacleId,
          position: { x: pos.x, y: pos.y },
          radius: obstacle.radius,
          strength: obstacle.strength,
          damageRate: 0, // Not used
        });
      }
    });
    return result;
  }

  /**
   * Get all swarms as a Map.
   */
  get swarms(): Map<string, EntropySwarm> {
    const result = new Map<string, EntropySwarm>();
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      const swarmId = getStringIdByEntity(entity);
      if (!swarmId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const swarm = this.world.getComponent<SwarmComponent>(entity, Components.Swarm);
      if (pos && swarm) {
        result.set(swarmId, {
          id: swarmId,
          position: { x: pos.x, y: pos.y },
          velocity: { x: 0, y: 0 }, // Client doesn't need velocity
          size: swarm.size,
          state: swarm.state,
          disabledUntil: swarm.disabledUntil,
        });
      }
    });
    return result;
  }

  /**
   * Get all pseudopods as a Map.
   */
  get pseudopods(): Map<string, Pseudopod> {
    const result = new Map<string, Pseudopod>();
    this.world.forEachWithTag(Tags.Pseudopod, (entity) => {
      const beamId = getStringIdByEntity(entity);
      if (!beamId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const beam = this.world.getComponent<PseudopodComponent>(entity, Components.Pseudopod);
      if (pos && beam) {
        result.set(beamId, {
          id: beamId,
          ownerId: beam.ownerSocketId,
          position: { x: pos.x, y: pos.y },
          velocity: { x: 0, y: 0 }, // Client doesn't need velocity
          width: beam.width,
          maxDistance: beam.maxDistance,
          distanceTraveled: beam.distanceTraveled,
          createdAt: beam.createdAt,
          color: beam.color,
        });
      }
    });
    return result;
  }

  /**
   * Get interpolation targets for players.
   */
  get playerTargets(): Map<string, InterpolationTarget> {
    const result = new Map<string, InterpolationTarget>();
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (!playerId) return;

      const interp = this.world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
      if (interp) {
        result.set(playerId, {
          x: interp.targetX,
          y: interp.targetY,
          timestamp: interp.timestamp,
        });
      }
    });
    return result;
  }

  /**
   * Get interpolation targets for swarms.
   */
  get swarmTargets(): Map<string, InterpolationTarget> {
    const result = new Map<string, InterpolationTarget>();
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      const swarmId = getStringIdByEntity(entity);
      if (!swarmId) return;

      const interp = this.world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
      if (interp) {
        result.set(swarmId, {
          x: interp.targetX,
          y: interp.targetY,
          timestamp: interp.timestamp,
        });
      }
    });
    return result;
  }

  /**
   * Get damage info for players.
   */
  get playerDamageInfo(): Map<string, {
    totalDamageRate: number;
    primarySource: DamageSource;
    proximityFactor?: number;
  }> {
    const result = new Map<string, {
      totalDamageRate: number;
      primarySource: DamageSource;
      proximityFactor?: number;
    }>();
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (!playerId) return;

      const damage = this.world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);
      if (damage) {
        result.set(playerId, {
          totalDamageRate: damage.totalDamageRate,
          primarySource: damage.primarySource,
          proximityFactor: damage.proximityFactor,
        });
      }
    });
    return result;
  }

  /**
   * Get damage info for swarms.
   */
  get swarmDamageInfo(): Map<string, {
    totalDamageRate: number;
    primarySource: DamageSource;
  }> {
    const result = new Map<string, {
      totalDamageRate: number;
      primarySource: DamageSource;
    }>();
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      const swarmId = getStringIdByEntity(entity);
      if (!swarmId) return;

      const damage = this.world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);
      if (damage) {
        result.set(swarmId, {
          totalDamageRate: damage.totalDamageRate,
          primarySource: damage.primarySource,
        });
      }
    });
    return result;
  }

  // ============================================
  // Public API - Mutation Methods
  // These delegate to the ECS factories
  // ============================================

  /**
   * Apply full game state snapshot from server
   */
  applySnapshot(snapshot: GameStateMessage): void {
    // Clear existing state
    this.reset();

    // Populate from snapshot
    Object.values(snapshot.players).forEach(p => upsertPlayer(this.world, p));
    Object.values(snapshot.nutrients).forEach(n => upsertNutrient(this.world, n));
    Object.values(snapshot.obstacles).forEach(o => upsertObstacle(this.world, o));
    Object.values(snapshot.swarms).forEach(s => upsertSwarm(this.world, s));
  }

  /**
   * Upsert player (add or update)
   */
  upsertPlayer(player: Player): void {
    upsertPlayer(this.world, player);
  }

  /**
   * Remove player
   */
  removePlayer(playerId: string): void {
    ecsRemovePlayer(this.world, playerId);
  }

  /**
   * Update player position target (for interpolation)
   */
  updatePlayerTarget(playerId: string, x: number, y: number): void {
    updatePlayerTarget(this.world, playerId, x, y);
  }

  /**
   * Update player energy (and optionally max energy)
   */
  updatePlayerEnergy(playerId: string, energy: number, maxEnergy?: number): void {
    ecsUpdatePlayerEnergy(this.world, playerId, energy, maxEnergy);
  }

  /**
   * Set player evolving state (for molting animation)
   */
  setPlayerEvolving(playerId: string, isEvolving: boolean): void {
    ecsSetPlayerEvolving(this.world, playerId, isEvolving);
  }

  /**
   * Update player after evolution completes
   */
  updatePlayerEvolved(playerId: string, newStage: EvolutionStage, newMaxEnergy: number): void {
    ecsUpdatePlayerEvolved(this.world, playerId, newStage, newMaxEnergy);
  }

  /**
   * Upsert nutrient
   */
  upsertNutrient(nutrient: Nutrient): void {
    upsertNutrient(this.world, nutrient);
  }

  /**
   * Remove nutrient
   */
  removeNutrient(nutrientId: string): void {
    ecsRemoveNutrient(this.world, nutrientId);
  }

  /**
   * Update nutrient position (for animated nutrients)
   */
  updateNutrientPosition(nutrientId: string, x: number, y: number): void {
    updateNutrientPosition(this.world, nutrientId, x, y);
  }

  /**
   * Upsert swarm
   */
  upsertSwarm(swarm: EntropySwarm): void {
    upsertSwarm(this.world, swarm);
  }

  /**
   * Remove swarm
   */
  removeSwarm(swarmId: string): void {
    ecsRemoveSwarm(this.world, swarmId);
  }

  /**
   * Update swarm position target (for interpolation)
   */
  updateSwarmTarget(swarmId: string, x: number, y: number, disabledUntil?: number): void {
    updateSwarmTarget(this.world, swarmId, x, y, disabledUntil);
  }

  /**
   * Upsert pseudopod
   */
  upsertPseudopod(pseudopod: Pseudopod): void {
    upsertPseudopod(this.world, pseudopod);
  }

  /**
   * Remove pseudopod
   */
  removePseudopod(pseudopodId: string): void {
    ecsRemovePseudopod(this.world, pseudopodId);
  }

  /**
   * Update pseudopod position
   */
  updatePseudopodPosition(pseudopodId: string, x: number, y: number): void {
    updatePseudopodPosition(this.world, pseudopodId, x, y);
  }

  /**
   * Get local player
   */
  getMyPlayer(): Player | null {
    return this.myPlayerId ? getPlayer(this.world, this.myPlayerId) : null;
  }

  /**
   * Update sets of players/swarms being drained (for visual feedback)
   * DEPRECATED: Use updateDamageInfo instead
   */
  updateDrainedPlayers(playerIds: string[], swarmIds: string[] = []): void {
    this.drainedPlayerIds.clear();
    playerIds.forEach(id => this.drainedPlayerIds.add(id));

    this.drainedSwarmIds.clear();
    swarmIds.forEach(id => this.drainedSwarmIds.add(id));
  }

  /**
   * Update damage info maps for variable-intensity drain auras
   */
  updateDamageInfo(
    damageInfo: Record<string, { totalDamageRate: number; primarySource: DamageSource; proximityFactor?: number }>,
    swarmDamageInfo: Record<string, { totalDamageRate: number; primarySource: DamageSource }>
  ): void {
    // Clear existing damage info from all players
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (playerId) {
        clearPlayerDamageInfo(this.world, playerId);
      }
    });

    // Set new damage info
    for (const [id, info] of Object.entries(damageInfo)) {
      setPlayerDamageInfo(this.world, id, info.totalDamageRate, info.primarySource, info.proximityFactor);
    }

    // Clear existing damage info from all swarms
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      const swarmId = getStringIdByEntity(entity);
      if (swarmId && this.world.hasComponent(entity, Components.ClientDamageInfo)) {
        this.world.removeComponent(entity, Components.ClientDamageInfo);
      }
    });

    // Set new swarm damage info
    for (const [id, info] of Object.entries(swarmDamageInfo)) {
      setSwarmDamageInfo(this.world, id, info.totalDamageRate, info.primarySource);
    }
  }

  /**
   * Reset all state (for cleanup/testing)
   */
  reset(): void {
    // Destroy all entities
    this.world.forEachWithTag(Tags.Player, (entity) => {
      this.world.destroyEntity(entity);
    });
    this.world.forEachWithTag(Tags.Nutrient, (entity) => {
      this.world.destroyEntity(entity);
    });
    this.world.forEachWithTag(Tags.Obstacle, (entity) => {
      this.world.destroyEntity(entity);
    });
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      this.world.destroyEntity(entity);
    });
    this.world.forEachWithTag(Tags.Pseudopod, (entity) => {
      this.world.destroyEntity(entity);
    });

    // Clear lookups
    clearLookups();

    // Clear deprecated sets
    this.drainedPlayerIds.clear();
    this.drainedSwarmIds.clear();

    this.myPlayerId = null;
  }
}
