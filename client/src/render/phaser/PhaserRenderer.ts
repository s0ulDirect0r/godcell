// ============================================
// Phaser Renderer - Phaser Implementation of Renderer Contract
// ============================================

import Phaser from 'phaser';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
  DeathCause,
  DetectedEntity,
} from '@godcell/shared';
import { eventBus } from '../../core/events/EventBus';

// ============================================
// Data Particle Interface
// ============================================

interface DataParticle {
  sprite: Phaser.GameObjects.Arc;
  velocity: { x: number; y: number };
}

// ============================================
// Phaser Renderer
// ============================================

/**
 * Phaser-based renderer (temporary during migration)
 * Eventually this will be deleted in favor of ThreeRenderer
 */
export class PhaserRenderer implements Renderer {
  private game!: Phaser.Game;
  private scene!: PhaserRenderScene;

  init(container: HTMLElement, width: number, height: number): void {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: container,
      width,
      height,
      backgroundColor: GAME_CONFIG.BACKGROUND_COLOR,
      scene: [PhaserRenderScene],
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
        },
      },
    };

    this.game = new Phaser.Game(config);

    // Wait for scene to be created
    this.game.events.once('ready', () => {
      this.scene = this.game.scene.getScene('PhaserRenderScene') as PhaserRenderScene;
    });
  }

  render(state: GameState, _dt: number): void {
    // Phaser handles rendering in its own update loop
    // Scene has access to state via reference
    if (this.scene) {
      this.scene.gameState = state;
    }
  }

  resize(width: number, height: number): void {
    this.game.scale.resize(width, height);
  }

  getCameraCapabilities(): CameraCapabilities {
    return {
      mode: 'topdown',
      supports3D: false,
    };
  }

  getCameraProjection() {
    if (!this.scene) {
      return {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      };
    }

    const cam = this.scene.cameras.main;
    return {
      screenToWorld: (screenX: number, screenY: number) => ({
        x: cam.scrollX + screenX / cam.zoom,
        y: cam.scrollY + screenY / cam.zoom,
      }),
      worldToScreen: (worldX: number, worldY: number) => ({
        x: (worldX - cam.scrollX) * cam.zoom,
        y: (worldY - cam.scrollY) * cam.zoom,
      }),
    };
  }

  dispose(): void {
    this.game.destroy(true);
  }
}

// ============================================
// Phaser Render Scene
// ============================================

/**
 * Internal Phaser scene for rendering
 * Contains all sprite management, trails, particles, camera, UI
 */
class PhaserRenderScene extends Phaser.Scene {
  // Reference to game state (set by renderer)
  gameState!: GameState;

  // Our player's stats (for UI display)
  private myPlayerStats = {
    health: 100,
    maxHealth: 100,
    energy: 100,
    maxEnergy: 100,
    stage: EvolutionStage.SINGLE_CELL,
  };

  // Session stats (for death screen)
  private sessionStats = {
    spawnTime: 0,
    nutrientsCollected: 0,
    highestStage: EvolutionStage.SINGLE_CELL,
  };

  // Visual representations
  private playerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private playerColors: Map<string, Phaser.Display.Color> = new Map();
  private playerTrails: Map<string, { x: number; y: number }[]> = new Map();
  private trailGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private lastPlayerPositions: Map<string, { x: number; y: number }> = new Map();
  private playerTargetPositions: Map<string, { x: number; y: number }> = new Map();
  private swarmTargetPositions: Map<string, { x: number; y: number }> = new Map();
  private obstacleSprites: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private swarmSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private nutrientSprites: Map<string, Phaser.GameObjects.Polygon> = new Map();

  // Environment
  private dataParticles: DataParticle[] = [];
  private gridGraphics!: Phaser.GameObjects.Graphics;

  // UI
  private healthBar?: Phaser.GameObjects.Graphics;
  private energyBar?: Phaser.GameObjects.Graphics;
  private healthText?: Phaser.GameObjects.Text;
  private energyText?: Phaser.GameObjects.Text;
  private countdownTimer?: Phaser.GameObjects.Text;
  private uiCamera?: Phaser.Cameras.Scene2D.Camera;
  private connectionText?: Phaser.GameObjects.Text;

  // Death UI (DOM elements)
  private deathOverlay?: HTMLElement;
  private respawnButton?: HTMLButtonElement;

  // Detection system
  private detectedEntities: DetectedEntity[] = [];
  private detectionIndicators: Phaser.GameObjects.Graphics[] = [];

  // Pseudopod system
  private pseudopods: Map<string, Pseudopod> = new Map();
  private pseudopodGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

  constructor() {
    super({ key: 'PhaserRenderScene' });
  }

  create() {
    const config = GAME_CONFIG;

    // Set world bounds
    this.physics.world.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);

    // Create particle texture
    this.createParticleTexture();

    // Create environment
    this.createDigitalOcean();

    // Create UI
    this.createMetabolismUI();
    this.setupUICamera();
    this.setupDeathUI();

    // Add connection text
    this.connectionText = this.add
      .text(10, 10, 'Connecting to server...', {
        fontSize: '14px',
        color: '#00ffff',
        fontFamily: 'monospace',
      })
      .setDepth(1000);

    // Subscribe to game events
    this.setupEventHandlers();
  }

  update(_time: number, delta: number) {
    // Update countdown timer
    this.updateCountdownTimer();

    // Update flowing particles
    this.updateDataParticles(delta);

    // Interpolate positions
    this.interpolatePlayerPositions();

    // Render trails
    this.renderTrails();

    // Fade trails for stationary players
    this.updateTrailFading();

    // Render detection indicators
    this.renderDetectionIndicators();

    // Render pseudopods
    this.renderPseudopods();
  }

  // ============================================
  // Environment Creation
  // ============================================

  private createParticleTexture() {
    const graphics = this.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(8, 8, 8);
    graphics.generateTexture('particle', 16, 16);
    graphics.destroy();
  }

  private createDigitalOcean() {
    const config = GAME_CONFIG;

    // Grid
    this.gridGraphics = this.add.graphics();
    this.gridGraphics.lineStyle(1, config.GRID_COLOR, 0.3);

    const gridSize = 50;
    for (let x = 0; x <= config.WORLD_WIDTH; x += gridSize) {
      this.gridGraphics.lineBetween(x, 0, x, config.WORLD_HEIGHT);
    }
    for (let y = 0; y <= config.WORLD_HEIGHT; y += gridSize) {
      this.gridGraphics.lineBetween(0, y, config.WORLD_WIDTH, y);
    }

    this.gridGraphics.setDepth(-100);
    this.gridGraphics.setAlpha(0.15);

    // Particles
    for (let i = 0; i < config.MAX_PARTICLES; i++) {
      this.createDataParticle();
    }
  }

  private createDataParticle() {
    const config = GAME_CONFIG;

    const x = Math.random() * config.WORLD_WIDTH;
    const y = Math.random() * config.WORLD_HEIGHT;
    const size = config.PARTICLE_MIN_SIZE + Math.random() * (config.PARTICLE_MAX_SIZE - config.PARTICLE_MIN_SIZE);

    const sprite = this.add.circle(x, y, size, config.PARTICLE_COLOR, 0.6);
    sprite.setDepth(-50);

    const baseAngle = Math.PI / 4;
    const variance = (Math.random() - 0.5) * Math.PI / 2;
    const angle = baseAngle + variance;
    const speed = config.PARTICLE_SPEED_MIN + Math.random() * (config.PARTICLE_SPEED_MAX - config.PARTICLE_SPEED_MIN);

    const velocity = {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    };

    this.dataParticles.push({ sprite, velocity });
  }

  private updateDataParticles(delta: number) {
    const config = GAME_CONFIG;
    const deltaSeconds = delta / 1000;

    for (const particle of this.dataParticles) {
      particle.sprite.x += particle.velocity.x * deltaSeconds;
      particle.sprite.y += particle.velocity.y * deltaSeconds;

      if (particle.sprite.x > config.WORLD_WIDTH + 10) particle.sprite.x = -10;
      if (particle.sprite.y > config.WORLD_HEIGHT + 10) particle.sprite.y = -10;
      if (particle.sprite.x < -10) particle.sprite.x = config.WORLD_WIDTH + 10;
      if (particle.sprite.y < -10) particle.sprite.y = config.WORLD_HEIGHT + 10;
    }
  }

  // ============================================
  // UI Creation
  // ============================================

  private createMetabolismUI() {
    // Health bar
    this.healthBar = this.add.graphics();
    this.healthBar.setScrollFactor(0);
    this.healthBar.setDepth(1000);

    // Energy bar
    this.energyBar = this.add.graphics();
    this.energyBar.setScrollFactor(0);
    this.energyBar.setDepth(1000);

    // Health text
    this.healthText = this.add
      .text(110, 20, '', {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(1001);

    // Energy text
    this.energyText = this.add
      .text(110, 45, '', {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(1001);

    // Countdown timer
    this.countdownTimer = this.add
      .text(GAME_CONFIG.VIEWPORT_WIDTH / 2, 20, '00:00', {
        fontSize: '32px',
        color: '#00ffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(1000);
  }

  private setupUICamera() {
    this.uiCamera = this.cameras.add(0, 0, GAME_CONFIG.VIEWPORT_WIDTH, GAME_CONFIG.VIEWPORT_HEIGHT);
    this.uiCamera.setName('uiCamera');
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setZoom(1);

    const uiElements = [
      this.healthBar!,
      this.energyBar!,
      this.healthText!,
      this.energyText!,
      this.countdownTimer!,
    ];
    this.cameras.main.ignore(uiElements);

    const worldObjects = [
      this.gridGraphics,
      ...this.dataParticles.map(p => p.sprite),
    ];
    this.uiCamera.ignore(worldObjects);
  }

  private setupDeathUI() {
    this.deathOverlay = document.getElementById('death-overlay') as HTMLElement;
    this.respawnButton = document.getElementById('respawn-btn') as HTMLButtonElement;

    if (this.respawnButton) {
      this.respawnButton.addEventListener('click', () => {
        eventBus.emit({ type: 'client:inputRespawn' });
        console.log('🔄 Respawn requested');
      });
    }
  }

  private updateCountdownTimer() {
    if (!this.countdownTimer) return;

    const energy = this.myPlayerStats.energy;
    const decayRate = this.getStageDecayRate(this.myPlayerStats.stage);
    const secondsRemaining = decayRate > 0 ? energy / decayRate : Infinity;

    let timeString: string;
    if (secondsRemaining === Infinity) {
      timeString = '∞∞:∞∞';
    } else {
      const seconds = Math.floor(secondsRemaining);
      const hundredths = Math.floor((secondsRemaining - seconds) * 100);
      timeString = `${String(seconds).padStart(2, '0')}:${String(hundredths).padStart(2, '0')}`;
    }

    this.countdownTimer.setText(timeString);

    let timerColor: string;
    if (secondsRemaining > 30) {
      timerColor = '#00ffff';
    } else if (secondsRemaining > 15) {
      timerColor = '#ffff00';
    } else {
      timerColor = '#ff0000';
    }
    this.countdownTimer.setColor(timerColor);

    if (secondsRemaining < 15) {
      const pulseScale = 1 + Math.sin(Date.now() / 200) * 0.1;
      this.countdownTimer.setScale(pulseScale);
    } else {
      this.countdownTimer.setScale(1);
    }
  }

  private updateMetabolismUI(health: number, maxHealth: number, energy: number, maxEnergy: number) {
    if (!this.healthBar || !this.energyBar || !this.healthText || !this.energyText) return;

    const barWidth = 200;
    const barHeight = 20;
    const barX = 10;
    const healthBarY = 10;
    const energyBarY = 35;

    this.healthBar.clear();
    this.energyBar.clear();

    // Health bar
    this.healthBar.fillStyle(0x330000, 0.8);
    this.healthBar.fillRect(barX, healthBarY, barWidth, barHeight);

    const healthPercent = health / maxHealth;
    const healthColor = healthPercent < 0.3 ? 0xff0000 : 0xff4444;
    this.healthBar.fillStyle(healthColor, 1);
    this.healthBar.fillRect(barX, healthBarY, barWidth * healthPercent, barHeight);

    this.healthBar.lineStyle(2, 0xff0000, 1);
    this.healthBar.strokeRect(barX, healthBarY, barWidth, barHeight);

    // Energy bar
    this.energyBar.fillStyle(0x003333, 0.8);
    this.energyBar.fillRect(barX, energyBarY, barWidth, barHeight);

    const energyPercent = energy / maxEnergy;
    const energyColor = energyPercent < 0.3 ? 0x00cccc : 0x00ffff;
    this.energyBar.fillStyle(energyColor, 1);
    this.energyBar.fillRect(barX, energyBarY, barWidth * energyPercent, barHeight);

    this.energyBar.lineStyle(2, 0x00ffff, 1);
    this.energyBar.strokeRect(barX, energyBarY, barWidth, barHeight);

    this.healthText.setText(`${Math.ceil(health)}/${maxHealth}`);
    this.energyText.setText(`${Math.ceil(energy)}/${maxEnergy}`);

    // Dim player glow when low energy
    const myPlayerId = this.gameState.myPlayerId;
    if (myPlayerId) {
      const mySprite = this.playerSprites.get(myPlayerId);
      if (mySprite && energyPercent < 0.3) {
        mySprite.setAlpha(0.6 + energyPercent * 0.4);
      } else if (mySprite) {
        mySprite.setAlpha(1);
      }
    }
  }

  // ============================================
  // Death UI Methods
  // ============================================

  private showDeathUI(cause?: DeathCause) {
    if (!this.deathOverlay) return;

    const timeAlive = Date.now() - this.sessionStats.spawnTime;
    const minutes = Math.floor(timeAlive / 60000);
    const seconds = Math.floor((timeAlive % 60000) / 1000);
    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const stageNames: Record<EvolutionStage, string> = {
      [EvolutionStage.SINGLE_CELL]: 'Single-Cell',
      [EvolutionStage.MULTI_CELL]: 'Multi-Cell',
      [EvolutionStage.CYBER_ORGANISM]: 'Cyber-Organism',
      [EvolutionStage.HUMANOID]: 'Humanoid',
      [EvolutionStage.GODCELL]: 'Godcell',
    };

    const causeNames: Record<string, string> = {
      starvation: 'Starvation',
      singularity: 'Crushed by Singularity',
      swarm: 'Entropy Swarm',
      obstacle: 'Gravity Distortion',
      predation: 'Predation',
    };

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

    this.deathOverlay.classList.add('show');
  }

  private hideDeathUI() {
    if (!this.deathOverlay) return;
    this.deathOverlay.classList.remove('show');
  }

  private resetSessionStats() {
    this.sessionStats.spawnTime = Date.now();
    this.sessionStats.nutrientsCollected = 0;
    this.sessionStats.highestStage = EvolutionStage.SINGLE_CELL;
  }

  private createDilutionEffect(position: { x: number; y: number }, color: string) {
    const particleCount = 25;
    const playerColor = Phaser.Display.Color.HexStringToColor(color);

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.2;
      const distance = 50 + Math.random() * 100;
      const endX = position.x + Math.cos(angle) * distance;
      const endY = position.y + Math.sin(angle) * distance;
      const size = 3 + Math.random() * 5;

      const particle = this.add.circle(position.x, position.y, size, playerColor.color, 0.9);
      particle.setDepth(100);

      this.tweens.add({
        targets: particle,
        x: endX,
        y: endY,
        alpha: 0,
        scale: 0.2,
        duration: 2000,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          particle.destroy();
        },
      });
    }
  }

  // ============================================
  // Entity Creation Methods
  // ============================================

  private createNutrient(nutrient: Nutrient) {
    if (this.nutrientSprites.has(nutrient.id)) return;

    const config = GAME_CONFIG;

    let color: number;
    switch (nutrient.valueMultiplier) {
      case 5:
        color = config.NUTRIENT_5X_COLOR;
        break;
      case 3:
        color = config.NUTRIENT_3X_COLOR;
        break;
      case 2:
        color = config.NUTRIENT_2X_COLOR;
        break;
      default:
        color = config.NUTRIENT_COLOR;
        break;
    }

    const hexagon = new Phaser.Geom.Polygon([
      { x: 0, y: -config.NUTRIENT_SIZE },
      { x: config.NUTRIENT_SIZE * 0.866, y: -config.NUTRIENT_SIZE * 0.5 },
      { x: config.NUTRIENT_SIZE * 0.866, y: config.NUTRIENT_SIZE * 0.5 },
      { x: 0, y: config.NUTRIENT_SIZE },
      { x: -config.NUTRIENT_SIZE * 0.866, y: config.NUTRIENT_SIZE * 0.5 },
      { x: -config.NUTRIENT_SIZE * 0.866, y: -config.NUTRIENT_SIZE * 0.5 },
    ]);

    const sprite = this.add.polygon(
      nutrient.position.x,
      nutrient.position.y,
      hexagon.points,
      color,
      0.8
    );

    const strokeWidth = 1 + nutrient.valueMultiplier;
    sprite.setStrokeStyle(strokeWidth, color, 1);

    const pulseScale = 1.1 + (nutrient.valueMultiplier * 0.05);
    this.tweens.add({
      targets: sprite,
      scaleX: pulseScale,
      scaleY: pulseScale,
      alpha: 1,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    sprite.setDepth(-25);
    this.nutrientSprites.set(nutrient.id, sprite);

    if (this.uiCamera) {
      this.uiCamera.ignore(sprite);
    }
  }

  private createObstacle(obstacle: Obstacle) {
    if (this.obstacleSprites.has(obstacle.id)) return;

    const graphics = this.add.graphics();
    const config = GAME_CONFIG;

    graphics.lineStyle(2, 0x00ffff, 0.3);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, obstacle.radius);

    graphics.lineStyle(2, 0x00ffff, 0.5);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, obstacle.radius * 0.6);

    graphics.lineStyle(3, 0xff0088, 0.8);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, obstacle.radius * 0.3);
    graphics.fillStyle(0xff0088, 0.1);
    graphics.fillCircle(obstacle.position.x, obstacle.position.y, obstacle.radius * 0.3);

    graphics.lineStyle(4, 0xff0000, 1.0);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, config.OBSTACLE_CORE_RADIUS);
    graphics.fillStyle(0xff0000, 0.3);
    graphics.fillCircle(obstacle.position.x, obstacle.position.y, config.OBSTACLE_CORE_RADIUS);

    graphics.setDepth(-50);
    this.obstacleSprites.set(obstacle.id, graphics);

    if (this.uiCamera) {
      this.uiCamera.ignore(graphics);
    }
  }

  private createSwarm(swarm: EntropySwarm) {
    if (this.swarmSprites.has(swarm.id)) return;

    const container = this.add.container(swarm.position.x, swarm.position.y);

    const core = this.add.circle(0, 0, swarm.size, 0xff0088, 0.6);
    core.setStrokeStyle(3, 0xff00ff, 0.9);
    container.add(core);

    const circle = new Phaser.Geom.Circle(0, 0, swarm.size);
    const zoneSource = {
      getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * circle.radius;
        point.x = circle.x + Math.cos(angle) * radius;
        point.y = circle.y + Math.sin(angle) * radius;
      }
    };

    const particles = this.add.particles(0, 0, 'particle', {
      speed: { min: 30, max: 100 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0.5 },
      alpha: { start: 1, end: 0 },
      lifespan: 1200,
      frequency: 40,
      tint: [0xff0088, 0xff00ff, 0x8800ff],
      blendMode: 'ADD',
      emitZone: new Phaser.GameObjects.Particles.Zones.RandomZone(zoneSource),
    });
    container.add(particles);

    container.setDepth(-30);

    this.tweens.add({
      targets: core,
      scaleX: 1.2,
      scaleY: 1.2,
      alpha: 0.4,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.swarmSprites.set(swarm.id, container);
    this.swarmTargetPositions.set(swarm.id, { x: swarm.position.x, y: swarm.position.y });

    if (this.uiCamera) {
      this.uiCamera.ignore(container);
    }
  }

  private updateSwarm(swarmId: string, position: { x: number; y: number }, state: 'patrol' | 'chase') {
    const container = this.swarmSprites.get(swarmId);
    if (!container) return;

    this.swarmTargetPositions.set(swarmId, { x: position.x, y: position.y });

    const core = container.list[0] as Phaser.GameObjects.Arc;
    if (state === 'chase') {
      core.setFillStyle(0xff0044, 0.8);
      core.setStrokeStyle(4, 0xff0000, 1.0);
    } else {
      core.setFillStyle(0xff0088, 0.6);
      core.setStrokeStyle(3, 0xff00ff, 0.9);
    }
  }

  private removeNutrient(id: string, showEffect: boolean = false) {
    const sprite = this.nutrientSprites.get(id);
    if (!sprite) return;

    if (showEffect) {
      const particles = this.add.particles(sprite.x, sprite.y, 'particle', {
        speed: { min: 50, max: 150 },
        angle: { min: 0, max: 360 },
        scale: { start: 1, end: 0 },
        alpha: { start: 0.8, end: 0 },
        lifespan: 600,
        quantity: 12,
        tint: GAME_CONFIG.NUTRIENT_COLOR,
      });

      this.time.delayedCall(700, () => particles.destroy());
    }

    sprite.destroy();
    this.nutrientSprites.delete(id);
  }

  // ============================================
  // Player Sprite Methods
  // ============================================

  private getStageScale(stage: EvolutionStage): number {
    switch (stage) {
      case EvolutionStage.SINGLE_CELL:
        return GAME_CONFIG.SINGLE_CELL_SIZE_MULTIPLIER;
      case EvolutionStage.MULTI_CELL:
        return GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER;
      case EvolutionStage.CYBER_ORGANISM:
        return GAME_CONFIG.CYBER_ORGANISM_SIZE_MULTIPLIER;
      case EvolutionStage.HUMANOID:
        return GAME_CONFIG.HUMANOID_SIZE_MULTIPLIER;
      case EvolutionStage.GODCELL:
        return GAME_CONFIG.GODCELL_SIZE_MULTIPLIER;
    }
  }

  private getStageZoom(stage: EvolutionStage): number {
    switch (stage) {
      case EvolutionStage.SINGLE_CELL:
        return 1.0;
      case EvolutionStage.MULTI_CELL:
        return 0.67;
      case EvolutionStage.CYBER_ORGANISM:
        return 0.5;
      case EvolutionStage.HUMANOID:
        return 0.4;
      case EvolutionStage.GODCELL:
        return 0.33;
    }
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
    }
  }

  private buildStageVisuals(stage: EvolutionStage, color: number): Phaser.GameObjects.GameObject[] {
    const visuals: Phaser.GameObjects.GameObject[] = [];

    switch (stage) {
      case EvolutionStage.SINGLE_CELL: {
        const circle = this.add.circle(0, 0, GAME_CONFIG.PLAYER_SIZE, color, 1);
        circle.setStrokeStyle(3, color, 0.8);
        visuals.push(circle);
        break;
      }

      case EvolutionStage.MULTI_CELL:
      case EvolutionStage.CYBER_ORGANISM:
      case EvolutionStage.HUMANOID:
      case EvolutionStage.GODCELL: {
        const circleRadius = 8;
        const starRadius = 8;
        const numPoints = 5;

        for (let i = 0; i < numPoints; i++) {
          const angle = (i * Math.PI * 2) / numPoints - Math.PI / 2;
          const x = Math.cos(angle) * starRadius;
          const y = Math.sin(angle) * starRadius;

          const pointCircle = this.add.circle(x, y, circleRadius, color, 1);
          pointCircle.setStrokeStyle(2, color, 0.8);
          visuals.push(pointCircle);
        }

        const centerCircle = this.add.circle(0, 0, circleRadius, color, 1);
        centerCircle.setStrokeStyle(2, color, 0.8);
        visuals.push(centerCircle);

        break;
      }
    }

    return visuals;
  }

  private createCyberCell(playerId: string, player: Player) {
    if (this.playerSprites.has(playerId)) return;

    const color = Phaser.Display.Color.HexStringToColor(player.color).color;

    const cellContainer = this.add.container(player.position.x, player.position.y);

    const visuals = this.buildStageVisuals(player.stage, color);
    cellContainer.add(visuals);

    const initialScale = this.getStageScale(player.stage);
    cellContainer.setScale(initialScale);

    if (playerId === this.gameState.myPlayerId) {
      cellContainer.list.forEach((child) => {
        (child as Phaser.GameObjects.Arc).setStrokeStyle(3, 0xffffff, 1);
      });

      this.tweens.add({
        targets: cellContainer,
        scaleX: initialScale * 1.1,
        scaleY: initialScale * 1.1,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.playerSprites.set(playerId, cellContainer);
    this.playerColors.set(playerId, Phaser.Display.Color.HexStringToColor(player.color));

    const trailGraphic = this.add.graphics();
    trailGraphic.setDepth(-10);
    this.trailGraphics.set(playerId, trailGraphic);

    this.playerTrails.set(playerId, []);
    this.lastPlayerPositions.set(playerId, { x: player.position.x, y: player.position.y });
    this.playerTargetPositions.set(playerId, { x: player.position.x, y: player.position.y });

    if (this.uiCamera) {
      this.uiCamera.ignore([cellContainer, trailGraphic]);
    }
  }

  private removeCyberCell(playerId: string) {
    const sprite = this.playerSprites.get(playerId);
    if (sprite) {
      sprite.destroy();
      this.playerSprites.delete(playerId);
    }

    this.playerColors.delete(playerId);

    const trailGraphic = this.trailGraphics.get(playerId);
    if (trailGraphic) {
      trailGraphic.destroy();
      this.trailGraphics.delete(playerId);
    }

    this.playerTrails.delete(playerId);
    this.lastPlayerPositions.delete(playerId);
    this.playerTargetPositions.delete(playerId);
  }

  private updateCyberCellPosition(playerId: string, position: { x: number; y: number }) {
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    this.playerTargetPositions.set(playerId, { x: position.x, y: position.y });

    const trail = this.playerTrails.get(playerId);
    if (trail) {
      trail.push({ x: sprite.x, y: sprite.y });

      const maxTrailLength = 90;
      if (trail.length > maxTrailLength) {
        trail.shift();
      }
    }
  }

  private interpolatePlayerPositions() {
    const lerpFactor = 0.3;

    for (const [playerId, sprite] of this.playerSprites) {
      const targetPos = this.playerTargetPositions.get(playerId);
      if (!targetPos) continue;

      sprite.x += (targetPos.x - sprite.x) * lerpFactor;
      sprite.y += (targetPos.y - sprite.y) * lerpFactor;
    }

    for (const [swarmId, container] of this.swarmSprites) {
      const targetPos = this.swarmTargetPositions.get(swarmId);
      if (!targetPos) continue;

      container.x += (targetPos.x - container.x) * lerpFactor;
      container.y += (targetPos.y - container.y) * lerpFactor;
    }
  }

  private updateTrailFading() {
    for (const [playerId, sprite] of this.playerSprites) {
      const lastPos = this.lastPlayerPositions.get(playerId);
      const trail = this.playerTrails.get(playerId);

      if (!lastPos || !trail) continue;

      const currentX = sprite.x;
      const currentY = sprite.y;

      const hasMoved = Math.abs(currentX - lastPos.x) > 1 || Math.abs(currentY - lastPos.y) > 1;

      if (!hasMoved && trail.length > 0) {
        trail.shift();
      }

      lastPos.x = currentX;
      lastPos.y = currentY;
    }
  }

  private renderTrails() {
    for (const [playerId, trail] of this.playerTrails) {
      const trailGraphic = this.trailGraphics.get(playerId);
      const sprite = this.playerSprites.get(playerId);
      const playerColor = this.playerColors.get(playerId);

      if (!trailGraphic || !sprite || !playerColor || trail.length === 0) continue;

      trailGraphic.clear();

      for (let i = 0; i < trail.length; i++) {
        const pos = trail[i];
        const alpha = (i / trail.length) * 0.7;
        const size = 8 + (i / trail.length) * 18;

        trailGraphic.fillStyle(playerColor.color, alpha);
        trailGraphic.fillCircle(pos.x, pos.y, size);
      }
    }
  }

  private renderDetectionIndicators() {
    this.detectionIndicators.forEach((indicator) => indicator.destroy());
    this.detectionIndicators = [];

    if (this.myPlayerStats.stage === EvolutionStage.SINGLE_CELL) return;

    const myPlayerId = this.gameState.myPlayerId;
    const mySprite = myPlayerId ? this.playerSprites.get(myPlayerId) : null;
    if (!mySprite) return;

    const camera = this.cameras.main;
    const viewportCenterX = camera.scrollX + camera.width / 2;
    const viewportCenterY = camera.scrollY + camera.height / 2;

    const maxDetectionRange = GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS;

    for (const entity of this.detectedEntities) {
      const dx = entity.position.x - viewportCenterX;
      const dy = entity.position.y - viewportCenterY;
      const angle = Math.atan2(dy, dx);
      const distance = Math.sqrt(dx * dx + dy * dy);

      const normalizedDistance = Math.min(distance / maxDetectionRange, 1.0);
      const arrowScale = 0.5 + (1.0 - normalizedDistance) * 1.5;

      const color = entity.entityType === 'player' ? 0xff00ff : 0x00ff00;

      const edgeX = viewportCenterX + Math.cos(angle) * (camera.width / 2 - 40);
      const edgeY = viewportCenterY + Math.sin(angle) * (camera.height / 2 - 40);

      const indicator = this.add.graphics();
      indicator.setScrollFactor(0);
      indicator.setDepth(999);

      this.cameras.main.ignore(indicator);

      const screenX = edgeX - camera.scrollX;
      const screenY = edgeY - camera.scrollY;

      const tipLength = 15 * arrowScale;
      const baseLength = 8 * arrowScale;

      indicator.fillStyle(color, 0.8);
      indicator.beginPath();
      indicator.moveTo(screenX + Math.cos(angle) * tipLength, screenY + Math.sin(angle) * tipLength);
      indicator.lineTo(
        screenX + Math.cos(angle + 2.5) * baseLength,
        screenY + Math.sin(angle + 2.5) * baseLength
      );
      indicator.lineTo(
        screenX + Math.cos(angle - 2.5) * baseLength,
        screenY + Math.sin(angle - 2.5) * baseLength
      );
      indicator.closePath();
      indicator.fillPath();

      this.detectionIndicators.push(indicator);
    }
  }

  private renderPseudopods() {
    for (const [id, pseudopod] of this.pseudopods) {
      const graphic = this.pseudopodGraphics.get(id);
      if (!graphic) continue;

      graphic.clear();

      const dx = pseudopod.endPosition.x - pseudopod.startPosition.x;
      const dy = pseudopod.endPosition.y - pseudopod.startPosition.y;
      const progress = Math.min(pseudopod.currentLength / pseudopod.maxLength, 1.0);

      const currentEndX = pseudopod.startPosition.x + (dx * progress);
      const currentEndY = pseudopod.startPosition.y + (dy * progress);

      const color = Phaser.Display.Color.HexStringToColor(pseudopod.color).color;

      graphic.lineStyle(GAME_CONFIG.PSEUDOPOD_WIDTH * 2.5, color, 0.2);
      graphic.lineBetween(
        pseudopod.startPosition.x,
        pseudopod.startPosition.y,
        currentEndX,
        currentEndY
      );

      graphic.lineStyle(GAME_CONFIG.PSEUDOPOD_WIDTH * 1.5, color, 0.4);
      graphic.lineBetween(
        pseudopod.startPosition.x,
        pseudopod.startPosition.y,
        currentEndX,
        currentEndY
      );

      graphic.lineStyle(GAME_CONFIG.PSEUDOPOD_WIDTH, color, 0.9);
      graphic.lineBetween(
        pseudopod.startPosition.x,
        pseudopod.startPosition.y,
        currentEndX,
        currentEndY
      );

      const tipRadius = GAME_CONFIG.PSEUDOPOD_WIDTH * 1.5;
      const tipPulse = 1 + Math.sin(Date.now() / 150) * 0.3;

      graphic.fillStyle(color, 0.3);
      graphic.fillCircle(currentEndX, currentEndY, tipRadius * 2 * tipPulse);

      graphic.fillStyle(color, 0.7);
      graphic.fillCircle(currentEndX, currentEndY, tipRadius * tipPulse);
    }
  }

  // ============================================
  // Event Handlers
  // ============================================

  private setupEventHandlers() {
    // Socket connected
    eventBus.on('client:socketConnected', () => {
      console.log('✅ Connected to digital ocean');
    });

    // Socket disconnected
    eventBus.on('client:socketDisconnected', () => {
      console.log('❌ Disconnected from digital ocean');
    });

    // Socket failed
    eventBus.on('client:socketFailed', (event) => {
      console.error('❌ Socket connection failed:', event.error);
    });

    // Initial game state
    eventBus.on('gameState', () => {
      if (this.connectionText) {
        this.connectionText.destroy();
        this.connectionText = undefined;
      }

      const myPlayerId = this.gameState.myPlayerId;
      if (!myPlayerId) return;

      const myPlayer = this.gameState.players.get(myPlayerId);
      if (myPlayer) {
        this.myPlayerStats.health = myPlayer.health;
        this.myPlayerStats.maxHealth = myPlayer.maxHealth;
        this.myPlayerStats.energy = myPlayer.energy;
        this.myPlayerStats.maxEnergy = myPlayer.maxEnergy;
        this.myPlayerStats.stage = myPlayer.stage;

        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );

        this.resetSessionStats();
      }

      for (const [playerId, player] of this.gameState.players) {
        this.createCyberCell(playerId, player);
      }

      for (const [, nutrient] of this.gameState.nutrients) {
        this.createNutrient(nutrient);
      }

      for (const [, obstacle] of this.gameState.obstacles) {
        this.createObstacle(obstacle);
      }

      for (const [, swarm] of this.gameState.swarms) {
        this.createSwarm(swarm);
      }

      const mySprite = this.playerSprites.get(myPlayerId);
      if (mySprite && myPlayer) {
        const config = GAME_CONFIG;

        this.cameras.main.startFollow(mySprite, true, 0.2, 0.2);
        this.cameras.main.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);

        const zoom = this.getStageZoom(myPlayer.stage);
        this.cameras.main.setZoom(zoom);
      }
    });

    // Player joined
    eventBus.on('playerJoined', (message) => {
      this.createCyberCell(message.player.id, message.player);
    });

    // Player left
    eventBus.on('playerLeft', (message) => {
      this.removeCyberCell(message.playerId);
    });

    // Player moved
    eventBus.on('playerMoved', (message) => {
      this.updateCyberCellPosition(message.playerId, message.position);
    });

    // Nutrient spawned
    eventBus.on('nutrientSpawned', (message) => {
      this.createNutrient(message.nutrient);
    });

    // Nutrient moved
    eventBus.on('nutrientMoved', (message) => {
      const sprite = this.nutrientSprites.get(message.nutrientId);
      if (sprite) {
        sprite.setPosition(message.position.x, message.position.y);
      }
    });

    // Swarm spawned
    eventBus.on('swarmSpawned', (message) => {
      this.createSwarm(message.swarm);
    });

    // Swarm moved
    eventBus.on('swarmMoved', (message) => {
      this.updateSwarm(message.swarmId, message.position, message.state);
    });

    // Nutrient collected
    eventBus.on('nutrientCollected', (message) => {
      this.removeNutrient(message.nutrientId, true);

      if (message.playerId === this.gameState.myPlayerId) {
        this.myPlayerStats.energy = message.collectorEnergy;
        this.myPlayerStats.maxEnergy = message.collectorMaxEnergy;

        this.sessionStats.nutrientsCollected++;

        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }
    });

    // Energy update
    eventBus.on('energyUpdate', (message) => {
      if (message.playerId === this.gameState.myPlayerId) {
        this.myPlayerStats.health = message.health;
        this.myPlayerStats.energy = message.energy;

        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }
    });

    // Player died
    eventBus.on('playerDied', (message) => {
      console.log(`💀 Player ${message.playerId} died`);

      this.createDilutionEffect(message.position, message.color);

      if (message.playerId === this.gameState.myPlayerId) {
        this.time.delayedCall(500, () => {
          this.showDeathUI(message.cause);
        });
      }

      this.removeCyberCell(message.playerId);
    });

    // Player respawned
    eventBus.on('playerRespawned', (message) => {
      console.log(`🔄 Player ${message.player.id} respawned`);

      if (message.player.id === this.gameState.myPlayerId) {
        this.myPlayerStats.health = message.player.health;
        this.myPlayerStats.maxHealth = message.player.maxHealth;
        this.myPlayerStats.energy = message.player.energy;
        this.myPlayerStats.maxEnergy = message.player.maxEnergy;
        this.myPlayerStats.stage = message.player.stage;

        this.resetSessionStats();
        this.hideDeathUI();

        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }

      this.createCyberCell(message.player.id, message.player);

      if (message.player.id === this.gameState.myPlayerId) {
        const mySprite = this.playerSprites.get(message.player.id);
        if (mySprite) {
          const config = GAME_CONFIG;

          this.cameras.main.startFollow(mySprite, true, 0.2, 0.2);
          this.cameras.main.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);

          const resetZoom = this.getStageZoom(EvolutionStage.SINGLE_CELL);
          this.cameras.main.setZoom(resetZoom);

          console.log('📷 Camera re-attached after respawn');
        }
      }
    });

    // Player evolved
    eventBus.on('playerEvolved', (message) => {
      console.log(`🧬 Player ${message.playerId} evolved to ${message.newStage}`);

      if (message.playerId === this.gameState.myPlayerId) {
        this.myPlayerStats.health = message.newMaxHealth;
        this.myPlayerStats.maxHealth = message.newMaxHealth;
        this.myPlayerStats.maxEnergy = message.newMaxEnergy;
        this.myPlayerStats.stage = message.newStage;

        this.sessionStats.highestStage = message.newStage;

        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }

      const container = this.playerSprites.get(message.playerId);
      if (container && container instanceof Phaser.GameObjects.Container) {
        const playerColor = this.playerColors.get(message.playerId);
        if (!playerColor) return;

        this.tweens.killTweensOf(container as any);

        container.removeAll(true);

        const newVisuals = this.buildStageVisuals(message.newStage, playerColor.color);
        container.add(newVisuals);

        if (message.playerId === this.gameState.myPlayerId) {
          container.list.forEach((child) => {
            (child as Phaser.GameObjects.Arc).setStrokeStyle(3, 0xffffff, 1);
          });
        }

        const newScale = this.getStageScale(message.newStage);

        this.tweens.add({
          targets: container,
          scaleX: newScale,
          scaleY: newScale,
          duration: 500,
          ease: 'Back.easeOut',
          onComplete: () => {
            if (message.playerId === this.gameState.myPlayerId) {
              this.tweens.add({
                targets: container,
                scaleX: newScale * 1.1,
                scaleY: newScale * 1.1,
                duration: 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
              });
            }
          },
        });

        if (message.playerId === this.gameState.myPlayerId) {
          const newZoom = this.getStageZoom(message.newStage);
          this.tweens.add({
            targets: this.cameras.main,
            zoom: newZoom,
            duration: 1000,
            ease: 'Sine.easeInOut',
          });
        }

        this.tweens.add({
          targets: container,
          alpha: 0.5,
          duration: 100,
          yoyo: true,
          repeat: 3,
        });
      }
    });

    // Detection update
    eventBus.on('detectionUpdate', (message) => {
      this.detectedEntities = message.detected;
    });

    // Pseudopod spawned
    eventBus.on('pseudopodSpawned', (message) => {
      this.pseudopods.set(message.pseudopod.id, message.pseudopod);

      const graphic = this.add.graphics();
      graphic.setDepth(5);
      this.pseudopodGraphics.set(message.pseudopod.id, graphic);

      if (this.uiCamera) {
        this.uiCamera.ignore(graphic);
      }
    });

    // Pseudopod retracted
    eventBus.on('pseudopodRetracted', (message) => {
      const graphic = this.pseudopodGraphics.get(message.pseudopodId);
      if (graphic) {
        graphic.destroy();
        this.pseudopodGraphics.delete(message.pseudopodId);
      }
      this.pseudopods.delete(message.pseudopodId);
    });

    // Player engulfed
    eventBus.on('playerEngulfed', (message) => {
      const preySprite = this.playerSprites.get(message.preyId);
      const predatorSprite = this.playerSprites.get(message.predatorId);

      if (preySprite && predatorSprite) {
        this.tweens.add({
          targets: preySprite,
          x: predatorSprite.x,
          y: predatorSprite.y,
          scaleX: 0,
          scaleY: 0,
          alpha: 0,
          duration: 300,
          ease: 'Power2',
        });
      }
    });
  }
}
