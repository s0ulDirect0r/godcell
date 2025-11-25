// ============================================
// Dev Panel - Unified Development Tools UI
// Live config tweaking, entity spawning, debug viz
// ============================================

import GUI from 'lil-gui';
import type { Socket } from 'socket.io-client';
import {
  GAME_CONFIG,
  DEV_TUNABLE_CONFIGS,
  EvolutionStage,
  type DevCommand,
  type DevConfigUpdatedMessage,
  type DevStateMessage,
  type Position,
  type TunableConfigKey,
} from '@godcell/shared';
import type { GameState } from '../core/state/GameState';
import type { ThreeRenderer } from '../render/three/ThreeRenderer';

// ============================================
// Types
// ============================================

interface DevPanelOptions {
  socket: Socket;
  gameState: GameState;
  renderer?: ThreeRenderer;
}

interface ConfigValue {
  value: number;
  min: number;
  max: number;
  step: number;
}

// Config ranges for sliders (min, max, step)
const CONFIG_RANGES: Partial<Record<TunableConfigKey, ConfigValue>> = {
  // Movement
  PLAYER_SPEED: { value: GAME_CONFIG.PLAYER_SPEED, min: 100, max: 1000, step: 10 },
  MOVEMENT_FRICTION: { value: GAME_CONFIG.MOVEMENT_FRICTION, min: 0.1, max: 0.99, step: 0.01 },
  MOVEMENT_ENERGY_COST: { value: GAME_CONFIG.MOVEMENT_ENERGY_COST, min: 0, max: 0.05, step: 0.001 },

  // Energy Decay
  SINGLE_CELL_ENERGY_DECAY_RATE: { value: GAME_CONFIG.SINGLE_CELL_ENERGY_DECAY_RATE, min: 0, max: 10, step: 0.1 },
  MULTI_CELL_ENERGY_DECAY_RATE: { value: GAME_CONFIG.MULTI_CELL_ENERGY_DECAY_RATE, min: 0, max: 10, step: 0.1 },
  CYBER_ORGANISM_ENERGY_DECAY_RATE: { value: GAME_CONFIG.CYBER_ORGANISM_ENERGY_DECAY_RATE, min: 0, max: 10, step: 0.1 },
  HUMANOID_ENERGY_DECAY_RATE: { value: GAME_CONFIG.HUMANOID_ENERGY_DECAY_RATE, min: 0, max: 10, step: 0.1 },

  // Evolution
  EVOLUTION_MULTI_CELL: { value: GAME_CONFIG.EVOLUTION_MULTI_CELL, min: 100, max: 1000, step: 50 },
  EVOLUTION_CYBER_ORGANISM: { value: GAME_CONFIG.EVOLUTION_CYBER_ORGANISM, min: 500, max: 10000, step: 100 },
  EVOLUTION_HUMANOID: { value: GAME_CONFIG.EVOLUTION_HUMANOID, min: 1000, max: 20000, step: 100 },
  EVOLUTION_GODCELL: { value: GAME_CONFIG.EVOLUTION_GODCELL, min: 2000, max: 50000, step: 500 },
  EVOLUTION_MOLTING_DURATION: { value: GAME_CONFIG.EVOLUTION_MOLTING_DURATION, min: 500, max: 5000, step: 100 },

  // Nutrients
  NUTRIENT_ENERGY_VALUE: { value: GAME_CONFIG.NUTRIENT_ENERGY_VALUE, min: 5, max: 100, step: 5 },
  NUTRIENT_CAPACITY_INCREASE: { value: GAME_CONFIG.NUTRIENT_CAPACITY_INCREASE, min: 1, max: 50, step: 1 },
  NUTRIENT_RESPAWN_TIME: { value: GAME_CONFIG.NUTRIENT_RESPAWN_TIME, min: 5000, max: 120000, step: 1000 },

  // Obstacles
  OBSTACLE_GRAVITY_STRENGTH: { value: GAME_CONFIG.OBSTACLE_GRAVITY_STRENGTH, min: 0.1, max: 2, step: 0.05 },
  OBSTACLE_GRAVITY_RADIUS: { value: GAME_CONFIG.OBSTACLE_GRAVITY_RADIUS, min: 200, max: 1200, step: 50 },
  OBSTACLE_EVENT_HORIZON: { value: GAME_CONFIG.OBSTACLE_EVENT_HORIZON, min: 50, max: 400, step: 10 },
  OBSTACLE_CORE_RADIUS: { value: GAME_CONFIG.OBSTACLE_CORE_RADIUS, min: 20, max: 150, step: 5 },

  // Swarms
  SWARM_SPEED: { value: GAME_CONFIG.SWARM_SPEED, min: 50, max: 500, step: 10 },
  SWARM_DAMAGE_RATE: { value: GAME_CONFIG.SWARM_DAMAGE_RATE, min: 10, max: 200, step: 5 },
  SWARM_DETECTION_RADIUS: { value: GAME_CONFIG.SWARM_DETECTION_RADIUS, min: 200, max: 1500, step: 50 },
  SWARM_SLOW_EFFECT: { value: GAME_CONFIG.SWARM_SLOW_EFFECT, min: 0.1, max: 1, step: 0.05 },

  // Combat
  CONTACT_DRAIN_RATE: { value: GAME_CONFIG.CONTACT_DRAIN_RATE, min: 50, max: 500, step: 10 },
  PSEUDOPOD_PROJECTILE_SPEED: { value: GAME_CONFIG.PSEUDOPOD_PROJECTILE_SPEED, min: 1000, max: 8000, step: 100 },
  PSEUDOPOD_DRAIN_RATE: { value: GAME_CONFIG.PSEUDOPOD_DRAIN_RATE, min: 20, max: 300, step: 10 },
  PSEUDOPOD_COOLDOWN: { value: GAME_CONFIG.PSEUDOPOD_COOLDOWN, min: 200, max: 3000, step: 100 },
  PSEUDOPOD_ENERGY_COST: { value: GAME_CONFIG.PSEUDOPOD_ENERGY_COST, min: 5, max: 100, step: 5 },

  // EMP
  EMP_COOLDOWN: { value: GAME_CONFIG.EMP_COOLDOWN, min: 2000, max: 30000, step: 1000 },
  EMP_RANGE: { value: GAME_CONFIG.EMP_RANGE, min: 200, max: 2000, step: 50 },
  EMP_DISABLE_DURATION: { value: GAME_CONFIG.EMP_DISABLE_DURATION, min: 1000, max: 10000, step: 500 },
  EMP_ENERGY_COST: { value: GAME_CONFIG.EMP_ENERGY_COST, min: 10, max: 200, step: 10 },

  // Detection
  MULTI_CELL_DETECTION_RADIUS: { value: GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS, min: 500, max: 4000, step: 100 },
};

// ============================================
// Dev Panel Class
// ============================================

export class DevPanel {
  private gui: GUI;
  private socket: Socket;
  private gameState: GameState;
  private renderer?: ThreeRenderer;

  // Current config values (synced with server)
  private configValues: Record<string, number> = {};

  // Dev state
  private devState = {
    isPaused: false,
    timeScale: 1.0,
    godMode: false,
  };

  // Debug visualization toggles
  private debugViz = {
    showCollisionBoxes: false,
    showDetectionRanges: false,
    showGravityWells: false,
    showVelocityVectors: false,
    showAIState: false,
  };

  // Spawn controls
  private spawnControls = {
    entityType: 'nutrient' as 'nutrient' | 'swarm' | 'single-cell' | 'multi-cell',
    nutrientMultiplier: 1 as 1 | 2 | 3 | 5,
    spawnAtCursor: false,
  };

  // Player controls
  private playerControls = {
    selectedPlayerId: '',
    targetEnergy: 100,
    targetStage: EvolutionStage.SINGLE_CELL,
  };

  // Click spawn handlers (stored for cleanup)
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuHandler: ((e: MouseEvent) => void) | null = null;

  constructor(options: DevPanelOptions) {
    this.socket = options.socket;
    this.gameState = options.gameState;
    this.renderer = options.renderer;

    // Initialize config values from GAME_CONFIG
    for (const key of DEV_TUNABLE_CONFIGS) {
      this.configValues[key] = GAME_CONFIG[key] as number;
    }

    // Create lil-gui instance
    this.gui = new GUI({ title: 'Dev Panel', width: 320 });
    this.gui.domElement.style.zIndex = '10001';

    // Build UI
    this.buildConfigFolder();
    this.buildSpawnFolder();
    this.buildPlayerFolder();
    this.buildDebugFolder();
    this.buildGameControlFolder();

    // Listen for server updates
    this.setupSocketListeners();

    // Close by default (press 'H' to toggle)
    this.gui.close();
  }

  // ============================================
  // UI Building
  // ============================================

  private buildConfigFolder(): void {
    const configFolder = this.gui.addFolder('Config Tweaking');

    // Movement subfolder
    const movementFolder = configFolder.addFolder('Movement');
    this.addConfigControl(movementFolder, 'PLAYER_SPEED');
    this.addConfigControl(movementFolder, 'MOVEMENT_FRICTION');
    this.addConfigControl(movementFolder, 'MOVEMENT_ENERGY_COST');
    movementFolder.close();

    // Energy Decay subfolder
    const decayFolder = configFolder.addFolder('Energy Decay');
    this.addConfigControl(decayFolder, 'SINGLE_CELL_ENERGY_DECAY_RATE');
    this.addConfigControl(decayFolder, 'MULTI_CELL_ENERGY_DECAY_RATE');
    this.addConfigControl(decayFolder, 'CYBER_ORGANISM_ENERGY_DECAY_RATE');
    this.addConfigControl(decayFolder, 'HUMANOID_ENERGY_DECAY_RATE');
    decayFolder.close();

    // Evolution subfolder
    const evolutionFolder = configFolder.addFolder('Evolution');
    this.addConfigControl(evolutionFolder, 'EVOLUTION_MULTI_CELL');
    this.addConfigControl(evolutionFolder, 'EVOLUTION_CYBER_ORGANISM');
    this.addConfigControl(evolutionFolder, 'EVOLUTION_HUMANOID');
    this.addConfigControl(evolutionFolder, 'EVOLUTION_GODCELL');
    this.addConfigControl(evolutionFolder, 'EVOLUTION_MOLTING_DURATION');
    evolutionFolder.close();

    // Nutrients subfolder
    const nutrientsFolder = configFolder.addFolder('Nutrients');
    this.addConfigControl(nutrientsFolder, 'NUTRIENT_ENERGY_VALUE');
    this.addConfigControl(nutrientsFolder, 'NUTRIENT_CAPACITY_INCREASE');
    this.addConfigControl(nutrientsFolder, 'NUTRIENT_RESPAWN_TIME');
    nutrientsFolder.close();

    // Obstacles subfolder
    const obstaclesFolder = configFolder.addFolder('Gravity Wells');
    this.addConfigControl(obstaclesFolder, 'OBSTACLE_GRAVITY_STRENGTH');
    this.addConfigControl(obstaclesFolder, 'OBSTACLE_GRAVITY_RADIUS');
    this.addConfigControl(obstaclesFolder, 'OBSTACLE_EVENT_HORIZON');
    this.addConfigControl(obstaclesFolder, 'OBSTACLE_CORE_RADIUS');
    obstaclesFolder.close();

    // Swarms subfolder
    const swarmsFolder = configFolder.addFolder('Entropy Swarms');
    this.addConfigControl(swarmsFolder, 'SWARM_SPEED');
    this.addConfigControl(swarmsFolder, 'SWARM_DAMAGE_RATE');
    this.addConfigControl(swarmsFolder, 'SWARM_DETECTION_RADIUS');
    this.addConfigControl(swarmsFolder, 'SWARM_SLOW_EFFECT');
    swarmsFolder.close();

    // Combat subfolder
    const combatFolder = configFolder.addFolder('Combat');
    this.addConfigControl(combatFolder, 'CONTACT_DRAIN_RATE');
    this.addConfigControl(combatFolder, 'PSEUDOPOD_PROJECTILE_SPEED');
    this.addConfigControl(combatFolder, 'PSEUDOPOD_DRAIN_RATE');
    this.addConfigControl(combatFolder, 'PSEUDOPOD_COOLDOWN');
    this.addConfigControl(combatFolder, 'PSEUDOPOD_ENERGY_COST');
    combatFolder.close();

    // EMP subfolder
    const empFolder = configFolder.addFolder('EMP');
    this.addConfigControl(empFolder, 'EMP_COOLDOWN');
    this.addConfigControl(empFolder, 'EMP_RANGE');
    this.addConfigControl(empFolder, 'EMP_DISABLE_DURATION');
    this.addConfigControl(empFolder, 'EMP_ENERGY_COST');
    empFolder.close();

    // Detection subfolder
    const detectionFolder = configFolder.addFolder('Detection');
    this.addConfigControl(detectionFolder, 'MULTI_CELL_DETECTION_RADIUS');
    detectionFolder.close();

    configFolder.close();
  }

  private addConfigControl(folder: GUI, key: TunableConfigKey): void {
    const range = CONFIG_RANGES[key];
    if (!range) return;

    folder.add(this.configValues, key, range.min, range.max, range.step)
      .name(this.formatConfigName(key))
      .onChange((value: number) => {
        this.sendDevCommand({
          action: 'updateConfig',
          key,
          value,
        });
      });
  }

  private formatConfigName(key: string): string {
    // Convert SCREAMING_SNAKE to Title Case
    return key
      .toLowerCase()
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private buildSpawnFolder(): void {
    const spawnFolder = this.gui.addFolder('Entity Spawning');

    spawnFolder.add(this.spawnControls, 'entityType', ['nutrient', 'swarm', 'single-cell', 'multi-cell'])
      .name('Entity Type');

    spawnFolder.add(this.spawnControls, 'nutrientMultiplier', [1, 2, 3, 5])
      .name('Nutrient Value');

    // Click-to-spawn mode toggle
    spawnFolder.add(this.spawnControls, 'spawnAtCursor')
      .name('Click to Spawn')
      .onChange((enabled: boolean) => {
        if (enabled) {
          this.enableClickSpawn();
        } else {
          this.disableClickSpawn();
        }
      });

    spawnFolder.add({ spawn: () => this.spawnAtCenter() }, 'spawn')
      .name('Spawn at Center');

    spawnFolder.add({ spawnAtPlayer: () => this.spawnAtPlayer() }, 'spawnAtPlayer')
      .name('Spawn at Player');

    spawnFolder.add({ spawn5: () => this.spawnMultiple(5) }, 'spawn5')
      .name('Spawn 5 Random');

    spawnFolder.close();
  }

  private buildPlayerFolder(): void {
    const playerFolder = this.gui.addFolder('Player Controls');

    // God mode toggle
    playerFolder.add(this.devState, 'godMode')
      .name('God Mode')
      .onChange((enabled: boolean) => {
        const playerId = this.gameState.myPlayerId;
        if (playerId) {
          this.sendDevCommand({
            action: 'setGodMode',
            playerId,
            enabled,
          });
        }
      });

    // Energy slider
    playerFolder.add(this.playerControls, 'targetEnergy', 0, 10000, 10)
      .name('Set Energy')
      .onFinishChange((value: number) => {
        const playerId = this.gameState.myPlayerId;
        if (playerId) {
          this.sendDevCommand({
            action: 'setPlayerEnergy',
            playerId,
            energy: value,
          });
        }
      });

    // Stage selector
    playerFolder.add(this.playerControls, 'targetStage', {
      'Single Cell': EvolutionStage.SINGLE_CELL,
      'Multi Cell': EvolutionStage.MULTI_CELL,
      'Cyber Organism': EvolutionStage.CYBER_ORGANISM,
      'Humanoid': EvolutionStage.HUMANOID,
      'Godcell': EvolutionStage.GODCELL,
    })
      .name('Set Stage')
      .onChange((stage: EvolutionStage) => {
        const playerId = this.gameState.myPlayerId;
        if (playerId) {
          this.sendDevCommand({
            action: 'setPlayerStage',
            playerId,
            stage,
          });
        }
      });

    // Refill energy button
    playerFolder.add({ refill: () => this.refillEnergy() }, 'refill')
      .name('Refill Energy');

    // Max energy button
    playerFolder.add({ maxAll: () => this.maxEverything() }, 'maxAll')
      .name('Max Energy + Stage 5');

    playerFolder.close();
  }

  private buildDebugFolder(): void {
    const debugFolder = this.gui.addFolder('Debug Visualization');

    debugFolder.add(this.debugViz, 'showCollisionBoxes')
      .name('Collision Boxes')
      .onChange((show: boolean) => this.updateDebugViz('collisionBoxes', show));

    debugFolder.add(this.debugViz, 'showDetectionRanges')
      .name('Detection Ranges')
      .onChange((show: boolean) => this.updateDebugViz('detectionRanges', show));

    debugFolder.add(this.debugViz, 'showGravityWells')
      .name('Gravity Wells')
      .onChange((show: boolean) => this.updateDebugViz('gravityWells', show));

    debugFolder.add(this.debugViz, 'showVelocityVectors')
      .name('Velocity Vectors')
      .onChange((show: boolean) => this.updateDebugViz('velocityVectors', show));

    debugFolder.add(this.debugViz, 'showAIState')
      .name('AI State')
      .onChange((show: boolean) => this.updateDebugViz('aiState', show));

    debugFolder.close();
  }

  private buildGameControlFolder(): void {
    const gameFolder = this.gui.addFolder('Game Control');

    // Pause toggle
    gameFolder.add(this.devState, 'isPaused')
      .name('Paused')
      .onChange((paused: boolean) => {
        this.sendDevCommand({
          action: 'pauseGame',
          paused,
        });
      });

    // Time scale slider
    gameFolder.add(this.devState, 'timeScale', 0, 5, 0.25)
      .name('Time Scale')
      .onChange((scale: number) => {
        this.sendDevCommand({
          action: 'setTimeScale',
          scale,
        });
      });

    // Step tick button
    gameFolder.add({ step: () => this.stepTick() }, 'step')
      .name('Step Tick');

    // Clear world button (for playground mode)
    gameFolder.add({ clear: () => this.clearWorld() }, 'clear')
      .name('Clear World');

    // Export config button
    gameFolder.add({ export: () => this.exportConfig() }, 'export')
      .name('Export Config');

    gameFolder.open();
  }

  // ============================================
  // Actions
  // ============================================

  private spawnAtCenter(): void {
    const position: Position = {
      x: GAME_CONFIG.WORLD_WIDTH / 2,
      y: GAME_CONFIG.WORLD_HEIGHT / 2,
    };
    this.spawnEntity(position);
  }

  private spawnAtPlayer(): void {
    const player = this.gameState.myPlayerId
      ? this.gameState.players.get(this.gameState.myPlayerId)
      : null;

    if (player) {
      // Offset slightly from player
      const offset = 50;
      const angle = Math.random() * Math.PI * 2;
      const position: Position = {
        x: player.position.x + Math.cos(angle) * offset,
        y: player.position.y + Math.sin(angle) * offset,
      };
      this.spawnEntity(position);
    }
  }

  private spawnMultiple(count: number): void {
    for (let i = 0; i < count; i++) {
      const position: Position = {
        x: Math.random() * GAME_CONFIG.WORLD_WIDTH,
        y: Math.random() * GAME_CONFIG.WORLD_HEIGHT,
      };
      this.spawnEntity(position);
    }
  }

  private spawnEntity(position: Position): void {
    this.sendDevCommand({
      action: 'spawnEntity',
      entityType: this.spawnControls.entityType,
      position,
      options: {
        nutrientMultiplier: this.spawnControls.nutrientMultiplier,
      },
    });
  }

  private refillEnergy(): void {
    const player = this.gameState.myPlayerId
      ? this.gameState.players.get(this.gameState.myPlayerId)
      : null;

    if (player) {
      this.sendDevCommand({
        action: 'setPlayerEnergy',
        playerId: player.id,
        energy: player.maxEnergy,
      });
    }
  }

  private maxEverything(): void {
    const playerId = this.gameState.myPlayerId;
    if (playerId) {
      // Set to godcell stage
      this.sendDevCommand({
        action: 'setPlayerStage',
        playerId,
        stage: EvolutionStage.GODCELL,
      });
      // Max energy
      this.sendDevCommand({
        action: 'setPlayerEnergy',
        playerId,
        energy: 10000,
        maxEnergy: 10000,
      });
    }
  }

  private stepTick(): void {
    this.sendDevCommand({ action: 'stepTick' });
  }

  private exportConfig(): void {
    const config: Record<string, number> = {};
    for (const key of DEV_TUNABLE_CONFIGS) {
      config[key] = this.configValues[key];
    }
    console.log('Current config values:', JSON.stringify(config, null, 2));
    navigator.clipboard?.writeText(JSON.stringify(config, null, 2));
    console.log('Config copied to clipboard!');
  }

  private clearWorld(): void {
    this.sendDevCommand({ action: 'clearWorld' });
    console.log('[DevPanel] Clearing world (nutrients + swarms)');
  }

  private updateDebugViz(type: string, show: boolean): void {
    // Emit event for renderer to handle
    if (this.renderer) {
      // The renderer will need to implement these debug visualizations
      console.log(`Debug viz ${type}: ${show}`);
    }
  }

  // ============================================
  // Network
  // ============================================

  private sendDevCommand(command: DevCommand): void {
    this.socket.emit('devCommand', {
      type: 'devCommand',
      command,
    });
  }

  // ============================================
  // Click-to-Spawn Mode
  // ============================================

  private enableClickSpawn(): void {
    // Clean up any existing handlers first to prevent duplicates
    this.disableClickSpawn();

    if (!this.renderer) {
      console.warn('[DevPanel] Cannot enable click spawn: no renderer');
      return;
    }

    const cameraProjection = this.renderer.getCameraProjection();

    // Left click: spawn entity
    this.clickHandler = (e: MouseEvent) => {
      // Ignore clicks on the GUI panel itself
      if ((e.target as HTMLElement).closest('.lil-gui')) return;
      // Ignore clicks on other UI elements
      if ((e.target as HTMLElement).closest('button, input, select')) return;

      const worldPos = cameraProjection.screenToWorld(e.clientX, e.clientY);
      this.spawnEntity(worldPos);
    };

    // Right click: delete nearest entity
    this.contextMenuHandler = (e: MouseEvent) => {
      // Ignore clicks on the GUI panel itself
      if ((e.target as HTMLElement).closest('.lil-gui')) return;

      e.preventDefault();
      const worldPos = cameraProjection.screenToWorld(e.clientX, e.clientY);
      this.deleteNearestEntity(worldPos);
    };

    document.addEventListener('click', this.clickHandler);
    document.addEventListener('contextmenu', this.contextMenuHandler);

    console.log('[DevPanel] Click-to-spawn enabled (left=spawn, right=delete)');
  }

  private disableClickSpawn(): void {
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
    if (this.contextMenuHandler) {
      document.removeEventListener('contextmenu', this.contextMenuHandler);
      this.contextMenuHandler = null;
    }
    console.log('[DevPanel] Click-to-spawn disabled');
  }

  private deleteNearestEntity(position: Position): void {
    // Find nearest entity of selected type and delete it
    // For now, just send a deleteAt command - server will find nearest
    this.sendDevCommand({
      action: 'deleteAt',
      position,
      entityType: this.spawnControls.entityType,
    });
  }

  private setupSocketListeners(): void {
    // Listen for config updates from server
    this.socket.on('devConfigUpdated', (message: DevConfigUpdatedMessage) => {
      if (message.key in this.configValues) {
        this.configValues[message.key] = message.value;
        // Update GUI controller
        this.gui.controllersRecursive().forEach(controller => {
          if (controller.property === message.key) {
            controller.setValue(message.value);
          }
        });
      }
    });

    // Listen for dev state updates
    this.socket.on('devState', (state: DevStateMessage) => {
      this.devState.isPaused = state.isPaused;
      this.devState.timeScale = state.timeScale;
      this.devState.godMode = state.godModePlayers.includes(this.gameState.myPlayerId || '');
      // Refresh GUI
      this.gui.controllersRecursive().forEach(controller => {
        controller.updateDisplay();
      });
    });
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Toggle panel visibility
   */
  toggle(): void {
    if (this.gui._closed) {
      this.gui.open();
    } else {
      this.gui.close();
    }
  }

  /**
   * Show the panel
   */
  show(): void {
    this.gui.show();
    this.gui.open();
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.gui.hide();
  }

  /**
   * Destroy the panel
   */
  destroy(): void {
    this.gui.destroy();
  }

  /**
   * Get debug visualization state
   */
  getDebugVizState(): typeof this.debugViz {
    return { ...this.debugViz };
  }
}
