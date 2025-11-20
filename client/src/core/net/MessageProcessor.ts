/**
 * Processes incoming server messages and updates GameState.
 * This is the bridge between network layer and state layer.
 */

import type { GameState } from '../state/GameState';
import type { StateSnapshot } from '../state/interpolation';
import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  NutrientMovedMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PlayerEvolvedMessage,
  SwarmSpawnedMessage,
  SwarmMovedMessage,
  DetectionUpdateMessage,
  PseudopodSpawnedMessage,
  PseudopodRetractedMessage,
  PlayerEngulfedMessage,
} from '@godcell/shared';

/**
 * Handles server message processing and state updates
 */
export class MessageProcessor {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  /**
   * Process a message from the server
   */
  processMessage(type: string, data: any): void {
    switch (type) {
      case 'gameState':
        this.handleGameState(data);
        break;
      case 'playerJoined':
        this.handlePlayerJoined(data);
        break;
      case 'playerLeft':
        this.handlePlayerLeft(data);
        break;
      case 'playerMoved':
        this.handlePlayerMoved(data);
        break;
      case 'nutrientSpawned':
        this.handleNutrientSpawned(data);
        break;
      case 'nutrientCollected':
        this.handleNutrientCollected(data);
        break;
      case 'nutrientMoved':
        this.handleNutrientMoved(data);
        break;
      case 'energyUpdate':
        this.handleEnergyUpdate(data);
        break;
      case 'playerDied':
        this.handlePlayerDied(data);
        break;
      case 'playerRespawned':
        this.handlePlayerRespawned(data);
        break;
      case 'playerEvolved':
        this.handlePlayerEvolved(data);
        break;
      case 'swarmSpawned':
        this.handleSwarmSpawned(data);
        break;
      case 'swarmMoved':
        this.handleSwarmMoved(data);
        break;
      case 'detectionUpdate':
        this.handleDetectionUpdate(data);
        break;
      case 'pseudopodSpawned':
        this.handlePseudopodSpawned(data);
        break;
      case 'pseudopodRetracted':
        this.handlePseudopodRetracted(data);
        break;
      case 'playerEngulfed':
        this.handlePlayerEngulfed(data);
        break;
      default:
        console.warn('Unknown message type:', type);
    }
  }

  /**
   * Handle initial game state snapshot
   */
  private handleGameState(message: GameStateMessage): void {
    console.log('📦 Received initial game state');

    // Update all entities (convert Record to Map)
    Object.values(message.players).forEach((player) => {
      this.state.updatePlayer(player);
    });

    Object.values(message.nutrients).forEach((nutrient) => {
      this.state.updateNutrient(nutrient);
    });

    Object.values(message.obstacles).forEach((obstacle) => {
      this.state.updateObstacle(obstacle);
    });

    Object.values(message.swarms).forEach((swarm) => {
      this.state.updateSwarm(swarm);
    });

    // Store snapshot in interpolation buffer
    this.addSnapshot();
  }

  /**
   * Handle player joined
   */
  private handlePlayerJoined(message: PlayerJoinedMessage): void {
    this.state.updatePlayer(message.player);
    this.addSnapshot();
  }

  /**
   * Handle player left
   */
  private handlePlayerLeft(message: PlayerLeftMessage): void {
    this.state.removePlayer(message.playerId);
    this.addSnapshot();
  }

  /**
   * Handle player moved
   */
  private handlePlayerMoved(message: PlayerMovedMessage): void {
    const player = this.state.getPlayer(message.playerId);
    if (player) {
      player.position = message.position;
      this.state.updatePlayer(player);
      this.addSnapshot();
    }
  }

  /**
   * Handle nutrient spawned
   */
  private handleNutrientSpawned(message: NutrientSpawnedMessage): void {
    this.state.updateNutrient(message.nutrient);
    this.addSnapshot();
  }

  /**
   * Handle nutrient collected
   */
  private handleNutrientCollected(message: NutrientCollectedMessage): void {
    this.state.removeNutrient(message.nutrientId);
    this.addSnapshot();
  }

  /**
   * Handle nutrient moved (attracted by obstacles)
   */
  private handleNutrientMoved(message: NutrientMovedMessage): void {
    const nutrient = this.state.getNutrient(message.nutrientId);
    if (nutrient) {
      nutrient.position = message.position;
      this.state.updateNutrient(nutrient);
      this.addSnapshot();
    }
  }

  /**
   * Handle energy update
   */
  private handleEnergyUpdate(message: EnergyUpdateMessage): void {
    const player = this.state.getPlayer(message.playerId);
    if (player) {
      player.energy = message.energy;
      player.health = message.health;
      this.state.updatePlayer(player);
      // Don't snapshot for every energy update (too frequent)
    }
  }

  /**
   * Handle player died
   */
  private handlePlayerDied(message: PlayerDiedMessage): void {
    this.state.removePlayer(message.playerId);
    this.addSnapshot();
  }

  /**
   * Handle player respawned
   */
  private handlePlayerRespawned(message: PlayerRespawnedMessage): void {
    this.state.updatePlayer(message.player);
    this.addSnapshot();
  }

  /**
   * Handle player evolved
   */
  private handlePlayerEvolved(message: PlayerEvolvedMessage): void {
    const player = this.state.getPlayer(message.playerId);
    if (player) {
      player.stage = message.newStage;
      player.maxEnergy = message.newMaxEnergy;
      player.maxHealth = message.newMaxHealth;
      this.state.updatePlayer(player);
      this.addSnapshot();
    }
  }

  /**
   * Handle swarm spawned
   */
  private handleSwarmSpawned(message: SwarmSpawnedMessage): void {
    this.state.updateSwarm(message.swarm);
    this.addSnapshot();
  }

  /**
   * Handle swarm moved
   */
  private handleSwarmMoved(message: SwarmMovedMessage): void {
    const swarm = this.state.getSwarm(message.swarmId);
    if (swarm) {
      swarm.position = message.position;
      swarm.state = message.state;
      this.state.updateSwarm(swarm);
      this.addSnapshot();
    }
  }

  /**
   * Handle detection update (chemical sensing)
   */
  private handleDetectionUpdate(_message: DetectionUpdateMessage): void {
    // Store detected entities (used by UI/renderer for indicators)
    // For now, just log it - renderer will handle visualization
    // TODO: Add detection data to GameState if needed
  }

  /**
   * Handle pseudopod spawned
   */
  private handlePseudopodSpawned(message: PseudopodSpawnedMessage): void {
    this.state.updatePseudopod(message.pseudopod);
    this.addSnapshot();
  }

  /**
   * Handle pseudopod retracted
   */
  private handlePseudopodRetracted(message: PseudopodRetractedMessage): void {
    this.state.removePseudopod(message.pseudopodId);
    this.addSnapshot();
  }

  /**
   * Handle player engulfed (eaten by pseudopod)
   */
  private handlePlayerEngulfed(_message: PlayerEngulfedMessage): void {
    // Player death is handled by playerDied message
    // This is just for visual effects (not yet implemented)
  }

  /**
   * Add current state as a snapshot to interpolation buffer
   */
  private addSnapshot(): void {
    const snapshot: StateSnapshot = {
      tick: this.state.currentTick++,
      timestamp: performance.now(),
      serverTime: 0, // TODO: Calculate server time offset
      players: new Map(
        [...this.state.players].map(([id, player]) => [id, this.clonePlayer(player)])
      ),
      nutrients: new Map(
        [...this.state.nutrients].map(([id, nutrient]) => [id, this.cloneNutrient(nutrient)])
      ),
      obstacles: new Map(
        [...this.state.obstacles].map(([id, obstacle]) => [id, this.cloneObstacle(obstacle)])
      ),
      swarms: new Map(
        [...this.state.swarms].map(([id, swarm]) => [id, this.cloneSwarm(swarm)])
      ),
      pseudopods: new Map(
        [...this.state.pseudopods].map(([id, pseudopod]) => [
          id,
          this.clonePseudopod(pseudopod),
        ])
      ),
    };

    this.state.interpolationBuffer.addSnapshot(snapshot);
  }

  private clonePlayer(player: Player): Player {
    return {
      ...player,
      position: { ...player.position },
    };
  }

  private cloneNutrient(nutrient: Nutrient): Nutrient {
    return {
      ...nutrient,
      position: { ...nutrient.position },
    };
  }

  private cloneObstacle(obstacle: Obstacle): Obstacle {
    return {
      ...obstacle,
      position: { ...obstacle.position },
    };
  }

  private cloneSwarm(swarm: EntropySwarm): EntropySwarm {
    return {
      ...swarm,
      position: { ...swarm.position },
      velocity: { ...swarm.velocity },
      patrolTarget: swarm.patrolTarget ? { ...swarm.patrolTarget } : undefined,
    };
  }

  private clonePseudopod(pseudopod: Pseudopod): Pseudopod {
    return {
      ...pseudopod,
      startPosition: { ...pseudopod.startPosition },
      endPosition: { ...pseudopod.endPosition },
    };
  }
}
