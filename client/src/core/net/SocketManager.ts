// ============================================
// Socket Manager - Network Connection & Message Handling
// ============================================

import { io, Socket } from 'socket.io-client';
import type {
  GameStateMessage,
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
  PlayerEngulfedMessage,
  DetectionUpdateMessage,
  EMPActivatedMessage,
  SwarmConsumedMessage,
  PlayerDrainStateMessage,
} from '@godcell/shared';
import { GameState } from '../state/GameState';
import { eventBus } from '../events/EventBus';

export class SocketManager {
  private socket: Socket;
  private gameState: GameState;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(serverUrl: string, gameState: GameState) {
    this.gameState = gameState;

    // Check for playground mode - connects to separate server on port 3001
    const isPlayground = new URLSearchParams(window.location.search).has('playground');
    const targetUrl = isPlayground
      ? serverUrl.replace(':3000', ':3001')
      : serverUrl;

    this.socket = io(targetUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
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
   * Get the underlying socket (for dev tools)
   */
  getSocket(): Socket {
    return this.socket;
  }

  /**
   * Send player move intent
   */
  sendMove(direction: { x: number; y: number }): void {
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
      this.gameState.myPlayerId = this.socket.id || null;
      eventBus.emit({ type: 'client:socketConnected', socketId: this.socket.id || '' });
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      eventBus.emit({ type: 'client:socketDisconnected' });
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      console.error(`[Socket] Connection error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        eventBus.emit({ type: 'client:socketFailed', error: 'Max reconnect attempts reached' });
      }
    });

    // Game state snapshot
    this.socket.on('gameState', (data: GameStateMessage) => {
      this.gameState.applySnapshot(data);
      this.gameState.myPlayerId = this.socket.id || null;
      eventBus.emit(data);
    });

    // Player events
    this.socket.on('playerJoined', (data: PlayerJoinedMessage) => {
      this.gameState.upsertPlayer(data.player);
      eventBus.emit(data);
    });

    this.socket.on('playerLeft', (data: PlayerLeftMessage) => {
      this.gameState.removePlayer(data.playerId);
      eventBus.emit(data);
    });

    this.socket.on('playerMoved', (data: PlayerMovedMessage) => {
      this.gameState.updatePlayerTarget(data.playerId, data.position.x, data.position.y);
      eventBus.emit(data);
    });

    this.socket.on('playerRespawned', (data: PlayerRespawnedMessage) => {
      this.gameState.upsertPlayer(data.player);
      eventBus.emit(data);
    });

    this.socket.on('playerDied', (data: PlayerDiedMessage) => {
      // Remove dead player from game state so they don't get rendered
      this.gameState.removePlayer(data.playerId);
      eventBus.emit(data);
    });

    this.socket.on('playerEvolutionStarted', (data: PlayerEvolutionStartedMessage) => {
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.isEvolving = true;
      }
      eventBus.emit(data);
    });

    this.socket.on('playerEvolved', (data: PlayerEvolvedMessage) => {
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.stage = data.newStage;
        player.maxEnergy = data.newMaxEnergy;
        player.isEvolving = false;
      }
      eventBus.emit(data);
    });

    this.socket.on('playerEngulfed', (data: PlayerEngulfedMessage) => {
      eventBus.emit(data);
    });

    // Nutrient events
    this.socket.on('nutrientSpawned', (data: NutrientSpawnedMessage) => {
      this.gameState.upsertNutrient(data.nutrient);
      eventBus.emit(data);
    });

    this.socket.on('nutrientCollected', (data: NutrientCollectedMessage) => {
      this.gameState.removeNutrient(data.nutrientId);
      // Update collector's energy and maxEnergy
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.energy = data.collectorEnergy;
        player.maxEnergy = data.collectorMaxEnergy;
      }
      eventBus.emit(data);
    });

    this.socket.on('nutrientMoved', (data: NutrientMovedMessage) => {
      this.gameState.updateNutrientPosition(data.nutrientId, data.position.x, data.position.y);
      eventBus.emit(data);
    });

    // Energy updates (energy is the sole life resource)
    this.socket.on('energyUpdate', (data: EnergyUpdateMessage) => {
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.energy = data.energy;
      }
      eventBus.emit(data);
    });

    // Swarm events
    this.socket.on('swarmSpawned', (data: SwarmSpawnedMessage) => {
      this.gameState.upsertSwarm(data.swarm);
      eventBus.emit(data);
    });

    this.socket.on('swarmMoved', (data: SwarmMovedMessage) => {
      this.gameState.updateSwarmTarget(data.swarmId, data.position.x, data.position.y, data.disabledUntil);
      eventBus.emit(data);
    });

    // Pseudopod events
    this.socket.on('pseudopodSpawned', (data: PseudopodSpawnedMessage) => {
      this.gameState.upsertPseudopod(data.pseudopod);
      eventBus.emit(data);
    });

    this.socket.on('pseudopodMoved', (data: PseudopodMovedMessage) => {
      this.gameState.updatePseudopodPosition(data.pseudopodId, data.position.x, data.position.y);
      eventBus.emit(data);
    });

    this.socket.on('pseudopodRetracted', (data: PseudopodRetractedMessage) => {
      this.gameState.removePseudopod(data.pseudopodId);
      eventBus.emit(data);
    });

    this.socket.on('pseudopodHit', (data: PseudopodHitMessage) => {
      // Emit to EventBus for visual effects (particle burst, drain aura flash)
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
      this.gameState.removeSwarm(data.swarmId);
      eventBus.emit(data);
    });

    this.socket.on('playerDrainState', (data: PlayerDrainStateMessage) => {
      // Update game state with damage info for variable-intensity drain auras
      this.gameState.updateDamageInfo(data.damageInfo, data.swarmDamageInfo);

      // DEPRECATED: Also update old drain sets for backwards compatibility
      this.gameState.updateDrainedPlayers(data.drainedPlayerIds, data.drainedSwarmIds);

      eventBus.emit(data);
    });
  }
}
