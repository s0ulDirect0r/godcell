// ============================================
// HUD Overlay - DOM-based UI (renderer-agnostic)
// ============================================

import { eventBus } from '../../core/events/EventBus';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import { type World, getLocalPlayerId, getLocalPlayer } from '../../ecs';
import type { DeathCause } from '@godcell/shared';

export class HUDOverlay {
  private container: HTMLDivElement;
  private countdown!: HTMLDivElement;
  private empCooldown!: HTMLDivElement;
  private deathOverlay?: HTMLElement;
  private world?: World;

  // Event subscriptions for cleanup
  private eventSubscriptions: Array<() => void> = [];

  // Keyboard handler reference for cleanup
  private deathSpaceHandler: ((e: KeyboardEvent) => void) | null = null;

  // Session stats
  private sessionStats = {
    spawnTime: 0,
    nutrientsCollected: 0,
    highestStage: EvolutionStage.SINGLE_CELL,
  };

  // Local EMP cooldown tracking
  private localEMPTime: number = 0;

  // Detection indicators moved to ThreeRenderer (compass on white circle)
  // private detectionCanvas!: HTMLCanvasElement;
  // private detectionCtx!: CanvasRenderingContext2D;

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
    this.createEMPCooldown();
    // Detection canvas moved to ThreeRenderer (compass on white circle)
    // this.createDetectionCanvas();
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

  private createEMPCooldown(): void {
    this.empCooldown = document.createElement('div');
    this.empCooldown.style.cssText = `
      position: absolute;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 20px;
      color: #00ffff;
      text-shadow: 0 0 8px #00ffff;
      font-family: monospace;
      font-weight: bold;
      display: none;
    `;
    this.container.appendChild(this.empCooldown);
  }

  /* Detection canvas moved to ThreeRenderer (compass on white circle)
  private createDetectionCanvas(): void {
    this.detectionCanvas = document.createElement('canvas');
    this.detectionCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999;
    `;

    // Set canvas resolution to match display size
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      this.detectionCanvas.width = gameContainer.clientWidth;
      this.detectionCanvas.height = gameContainer.clientHeight;
    } else {
      this.detectionCanvas.width = window.innerWidth;
      this.detectionCanvas.height = window.innerHeight;
    }

    this.container.appendChild(this.detectionCanvas);

    const ctx = this.detectionCanvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get 2D context for detection canvas');
      return;
    }
    this.detectionCtx = ctx;
  }
  */

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

    // Wire up spacebar for respawn (only when death overlay is visible)
    this.deathSpaceHandler = (e: KeyboardEvent) => {
      if (this.deathOverlay?.classList.contains('show') && (e.key === ' ' || e.key === 'Space')) {
        e.preventDefault(); // Prevent page scroll
        eventBus.emit({ type: 'client:inputRespawn' });
      }
    };
    window.addEventListener('keydown', this.deathSpaceHandler);
  }

  private setupEventHandlers(): void {
    // Death/respawn events (only for MY player)
    this.eventSubscriptions.push(eventBus.on('playerDied', (event) => {
      const myPlayerId = this.world ? getLocalPlayerId(this.world) : null;
      if (myPlayerId && event.playerId === myPlayerId) {
        this.showDeathOverlay(event.cause);
      }
    }));

    this.eventSubscriptions.push(eventBus.on('playerRespawned', (event) => {
      const myPlayerId = this.world ? getLocalPlayerId(this.world) : null;
      if (myPlayerId && event.player.id === myPlayerId) {
        this.hideDeathOverlay();
        this.resetSessionStats();
      }
    }));

    // Track nutrients collected
    this.eventSubscriptions.push(eventBus.on('nutrientCollected', (event) => {
      const myPlayerId = this.world ? getLocalPlayerId(this.world) : null;
      if (myPlayerId && event.playerId === myPlayerId) {
        this.sessionStats.nutrientsCollected++;
      }
    }));

    // Track highest evolution stage
    this.eventSubscriptions.push(eventBus.on('playerEvolved', (event) => {
      const myPlayerId = this.world ? getLocalPlayerId(this.world) : null;
      if (myPlayerId && event.playerId === myPlayerId) {
        this.sessionStats.highestStage = event.newStage;
      }
    }));

    // Initialize session stats on first world snapshot
    this.eventSubscriptions.push(eventBus.on('worldSnapshot', () => {
      this.resetSessionStats();
    }));

    // Track EMP usage for cooldown display
    this.eventSubscriptions.push(eventBus.on('empActivated', (event) => {
      const myPlayerId = this.world ? getLocalPlayerId(this.world) : null;
      if (myPlayerId && event.playerId === myPlayerId) {
        this.localEMPTime = Date.now();
      }
    }));

    /* Detection update moved to ThreeRenderer (compass on white circle)
    // Detection updates (chemical sensing for Stage 2+)
    eventBus.on('detectionUpdate', (event) => {
      this.detectedEntities = event.detected;
    });
    */
  }

  /**
   * Update HUD from current world state
   * Call this every frame
   */
  update(world: World): void {
    // Store world reference for event handlers
    this.world = world;

    const myPlayer = getLocalPlayer(world);
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

    // Update EMP cooldown (Stage 2 / multi-cell only)
    if (myPlayer.stage === EvolutionStage.MULTI_CELL) {
      this.empCooldown.style.display = 'block';

      const now = Date.now();
      const lastUse = this.localEMPTime;
      const cooldownRemaining = Math.max(0, GAME_CONFIG.EMP_COOLDOWN - (now - lastUse));

      if (cooldownRemaining <= 0) {
        // EMP is ready - pulse green
        this.empCooldown.textContent = 'EMP READY [SPACE]';

        // Pulsing effect using sine wave (0.5 - 1.0 opacity range)
        const pulseSpeed = 3; // Pulses per second
        const pulsePhase = (now / 1000) * pulseSpeed * Math.PI * 2;
        const pulseValue = 0.5 + 0.5 * Math.sin(pulsePhase); // 0.0 - 1.0
        const brightness = 0.5 + 0.5 * pulseValue; // 0.5 - 1.0

        const green = Math.floor(255 * brightness);
        const color = `rgb(0, ${green}, 0)`;
        const glowIntensity = 8 + 8 * pulseValue; // 8-16px glow

        this.empCooldown.style.color = color;
        this.empCooldown.style.textShadow = `0 0 ${glowIntensity}px ${color}`;
      } else {
        // EMP on cooldown - gray with countdown
        const secondsRemaining = cooldownRemaining / 1000;
        this.empCooldown.textContent = `EMP: ${secondsRemaining.toFixed(1)}s`;
        this.empCooldown.style.color = '#666666'; // Gray
        this.empCooldown.style.textShadow = '0 0 4px #666666';
      }
    } else {
      // Single-cell - hide EMP UI
      this.empCooldown.style.display = 'none';
    }

    // Detection indicators now rendered in ThreeRenderer (compass on white circle)
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

  // Detection indicators removed - now rendered in ThreeRenderer as compass on white circle

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
    // Clean up event subscriptions
    this.eventSubscriptions.forEach(unsub => unsub());
    this.eventSubscriptions = [];

    // Clean up spacebar handler
    if (this.deathSpaceHandler) {
      window.removeEventListener('keydown', this.deathSpaceHandler);
      this.deathSpaceHandler = null;
    }

    // Remove DOM element
    this.container.remove();
  }
}
