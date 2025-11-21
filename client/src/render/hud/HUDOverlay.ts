// ============================================
// HUD Overlay - DOM-based UI (renderer-agnostic)
// ============================================

import type { GameState } from '../../core/state/GameState';
import { eventBus } from '../../core/events/EventBus';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { DeathCause } from '@godcell/shared';

export class HUDOverlay {
  private container: HTMLDivElement;
  private countdown!: HTMLDivElement;
  private deathOverlay?: HTMLElement;
  private gameState?: GameState;

  // Session stats
  private sessionStats = {
    spawnTime: 0,
    nutrientsCollected: 0,
    highestStage: EvolutionStage.SINGLE_CELL,
  };

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'hud-overlay';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
      font-family: monospace;
    `;
    // Append to game container instead of body to position relative to canvas
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.appendChild(this.container);
    } else {
      document.body.appendChild(this.container);
    }

    this.createCountdown();
    this.setupDeathOverlay();
    this.setupEventHandlers();
  }

  private createCountdown(): void {
    this.countdown = document.createElement('div');
    this.countdown.style.cssText = `
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 32px;
      color: #00ffff;
      text-shadow: 0 0 10px #00ffff;
      font-family: monospace;
      font-weight: bold;
    `;
    this.container.appendChild(this.countdown);
  }

  private setupDeathOverlay(): void {
    // Get existing death overlay from HTML (may be null if markup is missing)
    const overlay = document.getElementById('death-overlay');
    if (!overlay) {
      console.warn('Death overlay element not found in DOM - death screen will not display');
      return;
    }
    this.deathOverlay = overlay;

    // Wire up respawn button
    const respawnButton = document.getElementById('respawn-btn');
    if (respawnButton) {
      respawnButton.onclick = () => {
        eventBus.emit({ type: 'client:inputRespawn' });
      };
    }
  }

  private setupEventHandlers(): void {
    // Death/respawn events (only for MY player)
    eventBus.on('playerDied', (event) => {
      if (this.gameState && event.playerId === this.gameState.myPlayerId) {
        this.showDeathOverlay(event.cause);
      }
    });

    eventBus.on('playerRespawned', (event) => {
      if (this.gameState && event.player.id === this.gameState.myPlayerId) {
        this.hideDeathOverlay();
        this.resetSessionStats();
      }
    });

    // Track nutrients collected
    eventBus.on('nutrientCollected', (event) => {
      if (this.gameState && event.playerId === this.gameState.myPlayerId) {
        this.sessionStats.nutrientsCollected++;
      }
    });

    // Track highest evolution stage
    eventBus.on('playerEvolved', (event) => {
      if (this.gameState && event.playerId === this.gameState.myPlayerId) {
        this.sessionStats.highestStage = event.newStage;
      }
    });

    // Initialize session stats on first game state
    eventBus.on('gameState', () => {
      this.resetSessionStats();
    });
  }

  /**
   * Update HUD from current game state
   * Call this every frame
   */
  update(state: GameState): void {
    // Store state reference for event handlers
    this.gameState = state;

    const myPlayer = state.getMyPlayer();
    if (!myPlayer) return;

    // Update countdown (time until starvation)
    const decayRate = this.getStageDecayRate(myPlayer.stage);
    const secondsRemaining = decayRate > 0 ? myPlayer.energy / decayRate : Infinity;

    let timeString: string;
    if (secondsRemaining === Infinity) {
      timeString = '∞∞:∞∞';
    } else {
      const seconds = Math.floor(secondsRemaining);
      const hundredths = Math.floor((secondsRemaining - seconds) * 100);
      timeString = `${String(seconds).padStart(2, '0')}:${String(hundredths).padStart(2, '0')}`;
    }

    this.countdown.textContent = timeString;

    // Color changes when low
    let timerColor: string;
    if (secondsRemaining > 30) {
      timerColor = '#00ffff';
    } else if (secondsRemaining > 15) {
      timerColor = '#ffff00';
    } else {
      timerColor = '#ff0000';
    }
    this.countdown.style.color = timerColor;
    this.countdown.style.textShadow = `0 0 10px ${timerColor}`;
  }

  private getStageDecayRate(stage: EvolutionStage): number {
    switch (stage) {
      case EvolutionStage.SINGLE_CELL:
        return GAME_CONFIG.SINGLE_CELL_ENERGY_DECAY_RATE;
      case EvolutionStage.MULTI_CELL:
        return GAME_CONFIG.MULTI_CELL_ENERGY_DECAY_RATE;
      case EvolutionStage.CYBER_ORGANISM:
        return GAME_CONFIG.CYBER_ORGANISM_ENERGY_DECAY_RATE;
      case EvolutionStage.HUMANOID:
        return GAME_CONFIG.HUMANOID_ENERGY_DECAY_RATE;
      case EvolutionStage.GODCELL:
        return GAME_CONFIG.GODCELL_ENERGY_DECAY_RATE;
      default:
        return GAME_CONFIG.SINGLE_CELL_ENERGY_DECAY_RATE;
    }
  }

  private showDeathOverlay(cause?: DeathCause): void {
    // No-op if death overlay is not available
    if (!this.deathOverlay) return;

    // Calculate time alive
    const timeAlive = Date.now() - this.sessionStats.spawnTime;
    const minutes = Math.floor(timeAlive / 60000);
    const seconds = Math.floor((timeAlive % 60000) / 1000);
    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Stage names
    const stageNames: Record<EvolutionStage, string> = {
      [EvolutionStage.SINGLE_CELL]: 'Single-Cell',
      [EvolutionStage.MULTI_CELL]: 'Multi-Cell',
      [EvolutionStage.CYBER_ORGANISM]: 'Cyber-Organism',
      [EvolutionStage.HUMANOID]: 'Humanoid',
      [EvolutionStage.GODCELL]: 'Godcell',
    };

    // Death cause names
    const causeNames: Record<string, string> = {
      starvation: 'Starvation',
      singularity: 'Crushed by Singularity',
      swarm: 'Entropy Swarm',
      obstacle: 'Gravity Distortion',
      predation: 'Predation',
    };

    // Update stat elements
    const timeEl = document.getElementById('stat-time');
    const nutrientsEl = document.getElementById('stat-nutrients');
    const stageEl = document.getElementById('stat-stage');
    const causeEl = document.getElementById('stat-cause');

    if (timeEl) timeEl.textContent = timeString;
    if (nutrientsEl) nutrientsEl.textContent = this.sessionStats.nutrientsCollected.toString();
    if (stageEl) stageEl.textContent = stageNames[this.sessionStats.highestStage];
    if (causeEl) {
      causeEl.textContent = cause ? causeNames[cause] : 'Unknown';
    }

    // Show overlay
    this.deathOverlay.classList.add('show');
  }

  private hideDeathOverlay(): void {
    // No-op if death overlay is not available
    if (!this.deathOverlay) return;

    this.deathOverlay.classList.remove('show');
  }

  private resetSessionStats(): void {
    this.sessionStats.spawnTime = Date.now();
    this.sessionStats.nutrientsCollected = 0;
    this.sessionStats.highestStage = EvolutionStage.SINGLE_CELL;
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.container.remove();
  }
}
