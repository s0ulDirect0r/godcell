// ============================================
// Socket Manager - Network Connection & Message Handling
// ============================================

import { io, Socket } from 'socket.io-client';
import type {
  WorldSnapshotMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  PlayerRespawnedMessage,
  PlayerDiedMessage,
  PlayerEvolutionStartedMessage,
  PlayerEvolvedMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  NutrientMovedMessage,
  EnergyUpdateMessage,
  SwarmSpawnedMessage,
  SwarmMovedMessage,
  PseudopodSpawnedMessage,
  PseudopodMovedMessage,
  PseudopodRetractedMessage,
  PseudopodHitMessage,
  PseudopodStrikeMessage,
  PlayerEngulfedMessage,
  DetectionUpdateMessage,
  EMPActivatedMessage,
  SwarmConsumedMessage,
  PlayerDrainStateMessage,
  DamageSource,
  // Stage 3+ macro-resource messages
  DataFruitSpawnedMessage,
  DataFruitCollectedMessage,
  DataFruitDespawnedMessage,
  CyberBugSpawnedMessage,
  CyberBugKilledMessage,
  CyberBugMovedMessage,
  JungleCreatureSpawnedMessage,
  JungleCreatureKilledMessage,
  JungleCreatureMovedMessage,
  EntropySerpentMovedMessage,
  EntropySerpentAttackMessage,
  EntropySerpentDamagedMessage,
  EntropySerpentKilledMessage,
  EntropySerpentRespawnedMessage,
  ProjectileSpawnedMessage,
  ProjectileHitMessage,
  ProjectileRetractedMessage,
  // Trap messages
  TrapPlacedMessage,
  TrapTriggeredMessage,
  TrapDespawnedMessage,
  // Melee attack messages
  MeleeAttackExecutedMessage,
  // Stage 3 specialization messages
  CombatSpecialization,
  SpecializationPromptMessage,
  SpecializationSelectedMessage,
} from '#shared';
import {
  World,
  Tags,
  Components,
  upsertPlayer,
  updatePlayerTarget,
  removePlayer,
  updatePlayerEnergy,
  setPlayerEvolving,
  updatePlayerEvolved,
  upsertNutrient,
  updateNutrientPosition,
  removeNutrient,
  upsertObstacle,
  upsertTree,
  upsertSwarm,
  updateSwarmTarget,
  removeSwarm,
  upsertPseudopod,
  updatePseudopodPosition,
  removePseudopod,
  setPlayerDamageInfo,
  clearPlayerDamageInfo,
  setSwarmDamageInfo,
  setLocalPlayer,
  clearLookups,
  getStringIdByEntity,
  // Stage 3+ macro-resource factories
  upsertDataFruit,
  removeDataFruit,
  upsertCyberBug,
  removeCyberBug,
  updateCyberBugPosition,
  upsertJungleCreature,
  removeJungleCreature,
  updateJungleCreaturePosition,
  upsertProjectile,
  removeProjectile,
  upsertTrap,
  removeTrap,
  upsertEntropySerpent,
  updateEntropySerpentPosition,
} from '../../ecs';
import { eventBus } from '../events/EventBus';

export class SocketManager {
  private socket: Socket;
  private world: World;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  // Local player ID - tracked here instead of GameState
  private _myPlayerId: string | null = null;

  // Local player's combat specialization (Stage 3+)
  private _mySpecialization: CombatSpecialization = null;

  constructor(serverUrl: string, world: World, isPlaygroundParam = false, isSpectatorParam = false) {
    this.world = world;

    // Check for playground mode - connects to separate server on port 3001
    // Can be enabled via URL param (?playground) OR passed directly from start screen
    const isPlayground =
      isPlaygroundParam || new URLSearchParams(window.location.search).has('playground');
    const isSpectator =
      isSpectatorParam || new URLSearchParams(window.location.search).has('spectator');

    let targetUrl = serverUrl;
    if (isPlayground) {
      console.log('[Socket] Playground mode - connecting to port 3001');
      try {
        const url = new URL(serverUrl);
        url.port = '3001';
        targetUrl = url.toString();
      } catch (e) {
        console.warn('[Socket] Failed to parse serverUrl for playground mode:', e);
      }
    }

    if (isSpectator) {
      console.log('[Socket] Spectator mode - no player will be created');
    }

    this.socket = io(targetUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
      auth: {
        spectator: isSpectator,
      },
    });

    this.setupHandlers();
  }

  /**
   * Get socket ID (our player ID)
   */
  getSocketId(): string | undefined {
    return this.socket.id;
  }

  /**
   * Get local player ID
   */
  get myPlayerId(): string | null {
    return this._myPlayerId;
  }

  /**
   * Get the underlying socket (for dev tools)
   */
  getSocket(): Socket {
    return this.socket;
  }

  /**
   * Get local player's combat specialization (Stage 3+)
   * Returns null if not Stage 3+ or specialization not yet selected
   */
  getMySpecialization(): CombatSpecialization {
    return this._mySpecialization;
  }

  /**
   * Send player move intent
   * z is optional for Stage 5 (Godcell) 3D flight
   */
  sendMove(direction: { x: number; y: number; z?: number }): void {
    this.socket.emit('playerMove', {
      type: 'playerMove',
      direction,
    });
  }

  /**
   * Send pseudopod extension intent
   */
  sendPseudopodExtend(targetX: number, targetY: number): void {
    this.socket.emit('pseudopodExtend', {
      type: 'pseudopodExtend',
      targetX,
      targetY,
    });
  }

  /**
   * Send respawn request
   */
  sendRespawn(): void {
    this.socket.emit('playerRespawnRequest', {
      type: 'playerRespawnRequest',
    });
  }

  /**
   * Send EMP activation
   */
  sendEMPActivate(): void {
    this.socket.emit('empActivate', {
      type: 'empActivate',
    });
  }

  /**
   * Send Pseudopod Beam Fire
   */
  sendPseudopodFire(targetX: number, targetY: number): void {
    this.socket.emit('pseudopodFire', {
      type: 'pseudopodFire',
      targetX,
      targetY,
    });
  }

  /**
   * Send sprint state (Stage 3+ ability)
   */
  sendSprint(sprinting: boolean): void {
    this.socket.emit('playerSprint', {
      type: 'playerSprint',
      sprinting,
    });
  }

  /**
   * Send phase shift state (Stage 5 Godcell - pass through sphere surfaces)
   */
  sendPhaseShift(active: boolean): void {
    this.socket.emit('phaseShift', {
      type: 'phaseShift',
      active,
    });
  }

  /**
   * Send camera facing direction (Stage 5 Godcell flight - for server-side input transform)
   */
  sendCameraFacing(yaw: number, pitch: number): void {
    this.socket.emit('cameraFacing', {
      type: 'cameraFacing',
      yaw,
      pitch,
    });
  }

  /**
   * Send projectile fire (Stage 3 ranged specialization attack)
   */
  sendProjectileFire(targetX: number, targetY: number): void {
    this.socket.emit('projectileFire', {
      type: 'projectileFire',
      targetX,
      targetY,
    });
  }

  /**
   * Send combat specialization selection (Stage 3)
   */
  sendSelectSpecialization(specialization: CombatSpecialization): void {
    this.socket.emit('selectSpecialization', {
      type: 'selectSpecialization',
      specialization,
    });
  }

  /**
   * Send melee attack (Stage 3 melee specialization)
   */
  sendMeleeAttack(attackType: 'swipe' | 'thrust', targetX: number, targetY: number): void {
    this.socket.emit('meleeAttack', {
      type: 'meleeAttack',
      attackType,
      targetX,
      targetY,
    });
  }

  /**
   * Send place trap (Stage 3 traps specialization)
   * Trap is placed at player's current position (server-determined)
   */
  sendPlaceTrap(): void {
    this.socket.emit('placeTrap', { type: 'placeTrap' });
  }

  /**
   * Send pause command to server (dev mode)
   */
  sendPause(): void {
    this.socket.emit('devCommand', {
      type: 'devCommand',
      command: { action: 'pauseGame', paused: true },
    });
  }

  /**
   * Send resume command to server (dev mode)
   */
  sendResume(): void {
    this.socket.emit('devCommand', {
      type: 'devCommand',
      command: { action: 'pauseGame', paused: false },
    });
  }

  /**
   * Send evolve to next stage command (dev mode)
   */
  sendEvolveNext(): void {
    this.socket.emit('devCommand', {
      type: 'devCommand',
      command: { action: 'evolveNext', playerId: this.socket.id },
    });
  }

  /**
   * Send devolve to previous stage command (dev mode)
   */
  sendDevolvePrev(): void {
    this.socket.emit('devCommand', {
      type: 'devCommand',
      command: { action: 'devolvePrev', playerId: this.socket.id },
    });
  }

  /**
   * Send client log to server (for debugging)
   */
  sendLog(level: 'log' | 'warn' | 'error', args: unknown[]): void {
    this.socket.emit('clientLog', {
      type: 'clientLog',
      level,
      args: args.map((arg) => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        } catch {
          return '[unserializable]';
        }
      }),
      timestamp: Date.now(),
    });
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private setupHandlers(): void {
    // Connection lifecycle
    this.socket.on('connect', () => {
      console.log('[Socket] Connected:', this.socket.id);
      this.reconnectAttempts = 0;
      this._myPlayerId = this.socket.id || null;
      eventBus.emit({ type: 'client:socketConnected', socketId: this.socket.id || '' });
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      eventBus.emit({ type: 'client:socketDisconnected' });
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      console.error(
        `[Socket] Connection error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`,
        error
      );

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        eventBus.emit({ type: 'client:socketFailed', error: 'Max reconnect attempts reached' });
      }
    });

    // World snapshot (sent once on connect)
    this.socket.on('worldSnapshot', (data: WorldSnapshotMessage) => {
      this.applySnapshot(data);
      this._myPlayerId = this.socket.id || null;
      // Tag local player entity
      if (this._myPlayerId) {
        setLocalPlayer(this.world, this._myPlayerId);
      }
      eventBus.emit(data);
    });

    // Player events
    this.socket.on('playerJoined', (data: PlayerJoinedMessage) => {
      upsertPlayer(this.world, data.player);
      eventBus.emit(data);
    });

    this.socket.on('playerLeft', (data: PlayerLeftMessage) => {
      removePlayer(this.world, data.playerId);
      eventBus.emit(data);
    });

    this.socket.on('playerMoved', (data: PlayerMovedMessage) => {
      updatePlayerTarget(
        this.world,
        data.playerId,
        data.position.x,
        data.position.y,
        data.position.z,
        data.velocity
      );
      eventBus.emit(data);
    });

    this.socket.on('playerRespawned', (data: PlayerRespawnedMessage) => {
      upsertPlayer(this.world, data.player);
      // Re-tag local player if this is us respawning
      if (data.player.id === this._myPlayerId) {
        setLocalPlayer(this.world, this._myPlayerId);
      }
      eventBus.emit(data);
    });

    this.socket.on('playerDied', (data: PlayerDiedMessage) => {
      // Emit event BEFORE removing player so listeners can still query local player ID
      eventBus.emit(data);
      // Remove dead player from game state so they don't get rendered
      removePlayer(this.world, data.playerId);
    });

    this.socket.on('playerEvolutionStarted', (data: PlayerEvolutionStartedMessage) => {
      setPlayerEvolving(this.world, data.playerId, true);
      eventBus.emit(data);
    });

    this.socket.on('playerEvolved', (data: PlayerEvolvedMessage) => {
      updatePlayerEvolved(this.world, data.playerId, data.newStage, data.newMaxEnergy, data.radius);
      eventBus.emit(data);
    });

    this.socket.on('playerEngulfed', (data: PlayerEngulfedMessage) => {
      eventBus.emit(data);
    });

    // Nutrient events
    this.socket.on('nutrientSpawned', (data: NutrientSpawnedMessage) => {
      upsertNutrient(this.world, data.nutrient);
      eventBus.emit(data);
    });

    this.socket.on('nutrientCollected', (data: NutrientCollectedMessage) => {
      removeNutrient(this.world, data.nutrientId);
      // Update collector's energy and maxEnergy
      updatePlayerEnergy(this.world, data.playerId, data.collectorEnergy, data.collectorMaxEnergy);
      eventBus.emit(data);
    });

    this.socket.on('nutrientMoved', (data: NutrientMovedMessage) => {
      updateNutrientPosition(this.world, data.nutrientId, data.position.x, data.position.y);
      eventBus.emit(data);
    });

    // Energy updates (energy is the sole life resource)
    this.socket.on('energyUpdate', (data: EnergyUpdateMessage) => {
      updatePlayerEnergy(this.world, data.playerId, data.energy);
      eventBus.emit(data);
    });

    // Swarm events
    this.socket.on('swarmSpawned', (data: SwarmSpawnedMessage) => {
      upsertSwarm(this.world, data.swarm);
      eventBus.emit(data);
    });

    this.socket.on('swarmMoved', (data: SwarmMovedMessage) => {
      updateSwarmTarget(
        this.world,
        data.swarmId,
        data.position.x,
        data.position.y,
        data.position.z,
        data.disabledUntil,
        data.energy
      );
      eventBus.emit(data);
    });

    // Pseudopod events
    this.socket.on('pseudopodSpawned', (data: PseudopodSpawnedMessage) => {
      upsertPseudopod(this.world, data.pseudopod);
      eventBus.emit(data);
    });

    this.socket.on('pseudopodMoved', (data: PseudopodMovedMessage) => {
      updatePseudopodPosition(this.world, data.pseudopodId, data.position.x, data.position.y);
      eventBus.emit(data);
    });

    this.socket.on('pseudopodRetracted', (data: PseudopodRetractedMessage) => {
      removePseudopod(this.world, data.pseudopodId);
      eventBus.emit(data);
    });

    this.socket.on('pseudopodHit', (data: PseudopodHitMessage) => {
      // Emit to EventBus for visual effects (particle burst, drain aura flash)
      eventBus.emit(data);
    });

    // Pseudopod strike (energy whip AoE attack)
    this.socket.on('pseudopodStrike', (data: PseudopodStrikeMessage) => {
      // Emit to EventBus for visual effects (lightning + impact explosion)
      eventBus.emit(data);
    });

    // Detection updates (for Stage 2+ chemical sensing)
    this.socket.on('detectionUpdate', (data: DetectionUpdateMessage) => {
      eventBus.emit(data);
    });

    // EMP activation (multi-cell AoE stun ability)
    this.socket.on('empActivated', (data: EMPActivatedMessage) => {
      eventBus.emit(data);
    });

    // Swarm consumption (multi-cell eating disabled swarm)
    this.socket.on('swarmConsumed', (data: SwarmConsumedMessage) => {
      // Remove consumed swarm from game state
      removeSwarm(this.world, data.swarmId);
      eventBus.emit(data);
    });

    this.socket.on('playerDrainState', (data: PlayerDrainStateMessage) => {
      // Update damage info for variable-intensity drain auras
      this.updateDamageInfo(data.damageInfo, data.swarmDamageInfo);
      eventBus.emit(data);
    });

    // ============================================
    // Stage 3+ Macro-Resource Events
    // ============================================

    // DataFruit events
    this.socket.on('dataFruitSpawned', (data: DataFruitSpawnedMessage) => {
      upsertDataFruit(this.world, data.dataFruit);
      eventBus.emit(data);
    });

    this.socket.on('dataFruitCollected', (data: DataFruitCollectedMessage) => {
      removeDataFruit(this.world, data.fruitId);
      // Energy update comes via energyUpdate message, just emit event for effects
      eventBus.emit(data);
    });

    this.socket.on('dataFruitDespawned', (data: DataFruitDespawnedMessage) => {
      removeDataFruit(this.world, data.fruitId);
      eventBus.emit(data);
    });

    // CyberBug events
    this.socket.on('cyberBugSpawned', (data: CyberBugSpawnedMessage) => {
      upsertCyberBug(this.world, data.cyberBug);
      eventBus.emit(data);
    });

    this.socket.on('cyberBugKilled', (data: CyberBugKilledMessage) => {
      removeCyberBug(this.world, data.bugId);
      eventBus.emit(data);
    });

    this.socket.on('cyberBugMoved', (data: CyberBugMovedMessage) => {
      updateCyberBugPosition(this.world, data.bugId, data.position.x, data.position.y, data.state);
    });

    // JungleCreature events
    this.socket.on('jungleCreatureSpawned', (data: JungleCreatureSpawnedMessage) => {
      upsertJungleCreature(this.world, data.jungleCreature);
      eventBus.emit(data);
    });

    this.socket.on('jungleCreatureKilled', (data: JungleCreatureKilledMessage) => {
      removeJungleCreature(this.world, data.creatureId);
      eventBus.emit(data);
    });

    this.socket.on('jungleCreatureMoved', (data: JungleCreatureMovedMessage) => {
      updateJungleCreaturePosition(
        this.world,
        data.creatureId,
        data.position.x,
        data.position.y,
        data.state
      );
    });

    // EntropySerpent events (jungle apex predator)
    this.socket.on('entropySerpentMoved', (data: EntropySerpentMovedMessage) => {
      updateEntropySerpentPosition(
        this.world,
        data.serpentId,
        data.position.x,
        data.position.y,
        data.state,
        data.heading
      );
    });

    this.socket.on('entropySerpentAttack', (data: EntropySerpentAttackMessage) => {
      // Emit event for visual effects
      eventBus.emit(data);
    });

    this.socket.on('entropySerpentDamaged', (data: EntropySerpentDamagedMessage) => {
      // Emit event for visual effects (damage flash)
      eventBus.emit(data);
    });

    this.socket.on('entropySerpentKilled', (data: EntropySerpentKilledMessage) => {
      // Emit event for visual effects (death animation)
      eventBus.emit(data);
    });

    this.socket.on('entropySerpentSpawned', (data: EntropySerpentRespawnedMessage) => {
      // Emit event for visual effects (respawn animation)
      eventBus.emit(data);
    });

    // Projectile events (Stage 3 ranged specialization)
    this.socket.on('projectileSpawned', (data: ProjectileSpawnedMessage) => {
      upsertProjectile(this.world, data.projectile);
      eventBus.emit(data);
    });

    this.socket.on('projectileHit', (data: ProjectileHitMessage) => {
      // Remove the projectile entity from ECS (it hit something and is done)
      removeProjectile(this.world, data.projectileId);
      eventBus.emit(data);
    });

    this.socket.on('projectileRetracted', (data: ProjectileRetractedMessage) => {
      removeProjectile(this.world, data.projectileId);
      eventBus.emit(data);
    });

    // ============================================
    // Stage 3 Specialization Events
    // ============================================

    this.socket.on('specializationPrompt', (data: SpecializationPromptMessage) => {
      // Only show modal for local player
      if (data.playerId === this._myPlayerId) {
        eventBus.emit(data);
      }
    });

    this.socket.on('specializationSelected', (data: SpecializationSelectedMessage) => {
      // Track local player's specialization
      if (data.playerId === this._myPlayerId) {
        this._mySpecialization = data.specialization;
      }
      eventBus.emit(data);
    });

    // Trap events (Stage 3 traps specialization)
    this.socket.on('trapPlaced', (data: TrapPlacedMessage) => {
      upsertTrap(this.world, data.trap);
      eventBus.emit(data);
    });

    this.socket.on('trapTriggered', (data: TrapTriggeredMessage) => {
      eventBus.emit(data);
    });

    this.socket.on('trapDespawned', (data: TrapDespawnedMessage) => {
      removeTrap(this.world, data.trapId);
      eventBus.emit(data);
    });

    // Melee attack events (Stage 3 melee specialization)
    this.socket.on('meleeAttackExecuted', (data: MeleeAttackExecutedMessage) => {
      eventBus.emit(data);
    });
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Apply world snapshot from server (sent once on connect).
   * Clears existing state and populates from snapshot.
   */
  private applySnapshot(snapshot: WorldSnapshotMessage): void {
    // Clear existing state
    this.resetWorld();

    // Populate from snapshot
    Object.values(snapshot.players).forEach((p) => upsertPlayer(this.world, p));
    Object.values(snapshot.nutrients).forEach((n) => upsertNutrient(this.world, n));
    Object.values(snapshot.obstacles).forEach((o) => upsertObstacle(this.world, o));
    Object.values(snapshot.swarms).forEach((s) => upsertSwarm(this.world, s));
    // Trees are optional in the message (Stage 3+ environment)
    if (snapshot.trees) {
      Object.values(snapshot.trees).forEach((t) => upsertTree(this.world, t));
    }
    // Stage 3+ macro-resources (optional in message)
    if (snapshot.dataFruits) {
      const fruitCount = Object.keys(snapshot.dataFruits).length;
      console.log('[DEBUG] applySnapshot: received dataFruits count:', fruitCount);
      Object.values(snapshot.dataFruits).forEach((f) => upsertDataFruit(this.world, f));
    } else {
      console.log('[DEBUG] applySnapshot: NO dataFruits in snapshot');
    }
    if (snapshot.cyberBugs) {
      Object.values(snapshot.cyberBugs).forEach((b) => upsertCyberBug(this.world, b));
    }
    if (snapshot.jungleCreatures) {
      Object.values(snapshot.jungleCreatures).forEach((c) => upsertJungleCreature(this.world, c));
    }
    if (snapshot.entropySerpents) {
      Object.values(snapshot.entropySerpents).forEach((s) => upsertEntropySerpent(this.world, s));
    }
    if (snapshot.projectiles) {
      Object.values(snapshot.projectiles).forEach((p) => upsertProjectile(this.world, p));
    }
    if (snapshot.traps) {
      Object.values(snapshot.traps).forEach((t) => upsertTrap(this.world, t));
    }
  }

  /**
   * Reset all world entities (for cleanup/reconnection).
   */
  private resetWorld(): void {
    // Collect entities first to avoid modifying during iteration
    const toDestroy: number[] = [];
    this.world.forEachWithTag(Tags.Player, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Nutrient, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Obstacle, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Swarm, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Pseudopod, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Tree, (entity) => toDestroy.push(entity));
    // Stage 3+ macro-resources
    this.world.forEachWithTag(Tags.DataFruit, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.CyberBug, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.JungleCreature, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.EntropySerpent, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Projectile, (entity) => toDestroy.push(entity));
    this.world.forEachWithTag(Tags.Trap, (entity) => toDestroy.push(entity));
    toDestroy.forEach((entity) => this.world.destroyEntity(entity));

    // Clear string ID lookups
    clearLookups();
  }

  /**
   * Update damage info for players and swarms.
   */
  private updateDamageInfo(
    damageInfo: Record<
      string,
      { totalDamageRate: number; primarySource: DamageSource; proximityFactor?: number }
    >,
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
      setPlayerDamageInfo(
        this.world,
        id,
        info.totalDamageRate,
        info.primarySource,
        info.proximityFactor
      );
    }

    // Clear existing damage info from all swarms
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      if (this.world.hasComponent(entity, Components.ClientDamageInfo)) {
        this.world.removeComponent(entity, Components.ClientDamageInfo);
      }
    });

    // Set new swarm damage info
    for (const [id, info] of Object.entries(swarmDamageInfo)) {
      setSwarmDamageInfo(this.world, id, info.totalDamageRate, info.primarySource);
    }
  }
}
