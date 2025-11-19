import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared'
import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  PlayerMoveMessage,
  PlayerRespawnRequestMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  NutrientMovedMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PlayerEvolvedMessage,
  SwarmSpawnedMessage,
  SwarmMovedMessage,
  DetectedEntity,
  DetectionUpdateMessage,
} from '@godcell/shared';

// ============================================
// Flowing Particle (Data Stream)
// ============================================

interface DataParticle {
  sprite: Phaser.GameObjects.Arc;
  velocity: { x: number; y: number };
}

// ============================================
// Game Scene - GODCELL: Digital Primordial Soup
// ============================================

export class GameScene extends Phaser.Scene {
  // Network connection to server
  private socket!: Socket;

  // Our player's ID (assigned by server)
  private myPlayerId?: string;

  // Our player's stats (for UI display)
  private myPlayerStats = {
    health: 100,
    maxHealth: 100,
    energy: 100,
    maxEnergy: 100,
    stage: EvolutionStage.SINGLE_CELL, // Current evolution stage
  };

  // Session stats (for death screen)
  private sessionStats = {
    spawnTime: 0, // Timestamp when player spawned
    nutrientsCollected: 0, // Total nutrients collected this life
    highestStage: EvolutionStage.SINGLE_CELL, // Highest stage reached this life
  };

  // Visual representations of all cyber-cells (players)
  // Maps playerId → Phaser circle sprite
  private playerSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Store player colors for trail rendering (cached as integer values)
  // Maps playerId → Phaser Color object (parsed once, reused every frame)
  private playerColors: Map<string, Phaser.Display.Color> = new Map();

  // Trail system - glowing path left behind by each cyber-cell
  // Maps playerId → array of recent positions
  private playerTrails: Map<string, { x: number; y: number }[]> = new Map();

  // Graphics objects for rendering trails
  // Maps playerId → Graphics object
  private trailGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

  // Track last known position of each player to detect when they're stationary
  // Maps playerId → last position
  private lastPlayerPositions: Map<string, { x: number; y: number }> = new Map();

  // Gravity obstacles (distortion fields)
  // Maps obstacleId → Graphics object
  private obstacleSprites: Map<string, Phaser.GameObjects.Graphics> = new Map();

  // Entropy swarms (virus enemies)
  // Maps swarmId → Container with circle + particle emitter
  private swarmSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Keyboard input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Current movement direction we're sending to server
  private currentDirection = { x: 0, y: 0 };

  // Connection status text (removed once connected)
  private connectionText?: Phaser.GameObjects.Text;

  // ========== godcell World Elements ==========

  // Flowing background particles (the "digital water")
  private dataParticles: DataParticle[] = [];

  // Grid graphics for subtle background pattern
  private gridGraphics!: Phaser.GameObjects.Graphics;

  // Nutrients (data packets) - collectible resources
  // Maps nutrientId → Phaser polygon sprite (hexagon)
  private nutrientSprites: Map<string, Phaser.GameObjects.Polygon> = new Map();

  // Health/Energy UI
  private healthBar?: Phaser.GameObjects.Graphics;
  private energyBar?: Phaser.GameObjects.Graphics;
  private healthText?: Phaser.GameObjects.Text;
  private energyText?: Phaser.GameObjects.Text;
  private countdownTimer?: Phaser.GameObjects.Text;

  // Death UI (DOM elements)
  private deathOverlay?: HTMLElement;
  private respawnButton?: HTMLButtonElement;

  // Detection system (chemical sensing for multi-cells)
  private detectedEntities: DetectedEntity[] = [];
  private detectionIndicators: Phaser.GameObjects.Graphics[] = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  // ============================================
  // Phaser Lifecycle: Create
  // Runs once when scene starts
  // ============================================

  create() {
    const config = GAME_CONFIG;

    // Set world bounds (the full playable area)
    this.physics.world.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);

    // Create particle texture for swarm effects
    this.createParticleTexture();

    // Create the digital primordial soup environment
    this.createDigitalOcean();

    // Set up keyboard input
    this.cursors = this.input.keyboard!.createCursorKeys();

    // Connect to game server
    this.connectToServer();

    // Add connection status text
    this.connectionText = this.add
      .text(10, 10, 'Connecting to server...', {
        fontSize: '14px',
        color: '#00ffff',
        fontFamily: 'monospace',
      })
      .setDepth(1000);

    // Create metabolism UI (health/energy bars)
    this.createMetabolismUI();

    // Set up death UI (DOM elements)
    this.setupDeathUI();
  }

  // ============================================
  // Metabolism UI
  // ============================================

  /**
   * Create health and energy bars
   */
  private createMetabolismUI() {
    // Health bar (red)
    this.healthBar = this.add.graphics();
    this.healthBar.setScrollFactor(0); // Fixed to camera
    this.healthBar.setDepth(1000);

    // Energy bar (cyan)
    this.energyBar = this.add.graphics();
    this.energyBar.setScrollFactor(0); // Fixed to camera
    this.energyBar.setDepth(1000);

    // Health text (inside health bar)
    this.healthText = this.add
      .text(110, 20, '', {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5) // Center the text
      .setScrollFactor(0)
      .setDepth(1001); // Above bars

    // Energy text (inside energy bar)
    this.energyText = this.add
      .text(110, 45, '', {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5) // Center the text
      .setScrollFactor(0)
      .setDepth(1001); // Above bars

    // Energy countdown timer (digital watch style, center-top)
    this.countdownTimer = this.add
      .text(GAME_CONFIG.VIEWPORT_WIDTH / 2, 20, '00:00', {
        fontSize: '32px',
        color: '#00ffff', // Cyan (safe)
        fontFamily: 'monospace',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0) // Center horizontally, top vertically
      .setScrollFactor(0)
      .setDepth(1000);
  }

  /**
   * Update energy countdown timer every frame (Evangelion-style intensity)
   * Updates at 60fps for smooth countdown feel
   */
  private updateCountdownTimer() {
    if (!this.countdownTimer) return;

    const energy = this.myPlayerStats.energy;
    const decayRate = this.getStageDecayRate(this.myPlayerStats.stage);
    const secondsRemaining = decayRate > 0 ? energy / decayRate : Infinity;

    // Format as SS:TT (seconds:hundredths - Eva battery style)
    let timeString: string;
    if (secondsRemaining === Infinity) {
      timeString = '∞∞:∞∞'; // Godcell - transcended entropy
    } else {
      const seconds = Math.floor(secondsRemaining);
      const hundredths = Math.floor((secondsRemaining - seconds) * 100);
      timeString = `${String(seconds).padStart(2, '0')}:${String(hundredths).padStart(2, '0')}`;
    }

    // Update timer text
    this.countdownTimer.setText(timeString);

    // Color based on time remaining
    let timerColor: string;
    if (secondsRemaining > 30) {
      timerColor = '#00ffff'; // Cyan (safe)
    } else if (secondsRemaining > 15) {
      timerColor = '#ffff00'; // Yellow (warning)
    } else {
      timerColor = '#ff0000'; // Red (critical)
    }
    this.countdownTimer.setColor(timerColor);

    // Add pulsing effect when critical (< 15 seconds)
    if (secondsRemaining < 15) {
      const pulseScale = 1 + Math.sin(Date.now() / 200) * 0.1; // Pulse between 0.9 and 1.1
      this.countdownTimer.setScale(pulseScale);
    } else {
      this.countdownTimer.setScale(1);
    }
  }

  /**
   * Update metabolism UI bars
   */
  private updateMetabolismUI(health: number, maxHealth: number, energy: number, maxEnergy: number) {
    if (!this.healthBar || !this.energyBar || !this.healthText || !this.energyText) return;

    const barWidth = 200;
    const barHeight = 20;
    const barX = 10;
    const healthBarY = 10;
    const energyBarY = 35;

    // Clear previous frames
    this.healthBar.clear();
    this.energyBar.clear();

    // Health bar background
    this.healthBar.fillStyle(0x330000, 0.8);
    this.healthBar.fillRect(barX, healthBarY, barWidth, barHeight);

    // Health bar fill
    const healthPercent = health / maxHealth;
    const healthColor = healthPercent < 0.3 ? 0xff0000 : 0xff4444;
    this.healthBar.fillStyle(healthColor, 1);
    this.healthBar.fillRect(barX, healthBarY, barWidth * healthPercent, barHeight);

    // Health bar border
    this.healthBar.lineStyle(2, 0xff0000, 1);
    this.healthBar.strokeRect(barX, healthBarY, barWidth, barHeight);

    // Energy bar background
    this.energyBar.fillStyle(0x003333, 0.8);
    this.energyBar.fillRect(barX, energyBarY, barWidth, barHeight);

    // Energy bar fill
    const energyPercent = energy / maxEnergy;
    const energyColor = energyPercent < 0.3 ? 0x00cccc : 0x00ffff;
    this.energyBar.fillStyle(energyColor, 1);
    this.energyBar.fillRect(barX, energyBarY, barWidth * energyPercent, barHeight);

    // Energy bar border
    this.energyBar.lineStyle(2, 0x00ffff, 1);
    this.energyBar.strokeRect(barX, energyBarY, barWidth, barHeight);

    // Update text display (centered inside bars)
    this.healthText.setText(`${Math.ceil(health)}/${maxHealth}`);
    this.energyText.setText(`${Math.ceil(energy)}/${maxEnergy}`);

    // Visual feedback for low energy - dim player glow
    if (this.myPlayerId) {
      const mySprite = this.playerSprites.get(this.myPlayerId);
      if (mySprite && energyPercent < 0.3) {
        mySprite.setAlpha(0.6 + energyPercent * 0.4); // Dim when low energy
      } else if (mySprite) {
        mySprite.setAlpha(1); // Full brightness
      }
    }
  }

  // ============================================
  // GODCELL Environment Creation
  // ============================================

  /**
   * Create a simple particle texture for swarm effects at runtime
   */
  private createParticleTexture() {
    // Create a 16x16 circle texture
    const graphics = this.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(8, 8, 8); // Center at 8,8 with radius 8
    graphics.generateTexture('particle', 16, 16);
    graphics.destroy();
  }

  /**
   * Create the digital primordial soup aesthetic
   * - Subtle grid pattern
   * - Flowing data particles
   */
  private createDigitalOcean() {
    const config = GAME_CONFIG;

    // ========== Subtle Grid Pattern ==========
    this.gridGraphics = this.add.graphics();
    this.gridGraphics.lineStyle(1, config.GRID_COLOR, 0.3);

    const gridSize = 50;

    // Vertical lines
    for (let x = 0; x <= config.WORLD_WIDTH; x += gridSize) {
      this.gridGraphics.lineBetween(x, 0, x, config.WORLD_HEIGHT);
    }

    // Horizontal lines
    for (let y = 0; y <= config.WORLD_HEIGHT; y += gridSize) {
      this.gridGraphics.lineBetween(0, y, config.WORLD_WIDTH, y);
    }

    this.gridGraphics.setDepth(-100);
    this.gridGraphics.setAlpha(0.15); // Very subtle

    // ========== Flowing Data Particles ==========
    for (let i = 0; i < config.MAX_PARTICLES; i++) {
      this.createDataParticle();
    }
  }

  /**
   * Create a single flowing data particle
   */
  private createDataParticle() {
    const config = GAME_CONFIG;

    // Random starting position
    const x = Math.random() * config.WORLD_WIDTH;
    const y = Math.random() * config.WORLD_HEIGHT;

    // Random size
    const size =
      config.PARTICLE_MIN_SIZE +
      Math.random() * (config.PARTICLE_MAX_SIZE - config.PARTICLE_MIN_SIZE);

    // Create glowing particle
    const sprite = this.add.circle(x, y, size, config.PARTICLE_COLOR, 0.6);
    sprite.setDepth(-50); // Behind players

    // Random velocity (mostly flowing in one direction with some variance)
    const baseAngle = Math.PI / 4; // Flow diagonally down-right
    const variance = (Math.random() - 0.5) * Math.PI / 2;
    const angle = baseAngle + variance;
    const speed =
      config.PARTICLE_SPEED_MIN +
      Math.random() * (config.PARTICLE_SPEED_MAX - config.PARTICLE_SPEED_MIN);

    const velocity = {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    };

    this.dataParticles.push({ sprite, velocity });
  }

  /**
   * Update flowing particles (called every frame)
   */
  private updateDataParticles(delta: number) {
    const config = GAME_CONFIG;
    const deltaSeconds = delta / 1000;

    for (const particle of this.dataParticles) {
      // Move particle
      particle.sprite.x += particle.velocity.x * deltaSeconds;
      particle.sprite.y += particle.velocity.y * deltaSeconds;

      // Wrap around screen (create endless flow)
      if (particle.sprite.x > config.WORLD_WIDTH + 10) {
        particle.sprite.x = -10;
      }
      if (particle.sprite.y > config.WORLD_HEIGHT + 10) {
        particle.sprite.y = -10;
      }
      if (particle.sprite.x < -10) {
        particle.sprite.x = config.WORLD_WIDTH + 10;
      }
      if (particle.sprite.y < -10) {
        particle.sprite.y = config.WORLD_HEIGHT + 10;
      }
    }
  }

  // ============================================
  // Nutrient System
  // ============================================

  /**
   * Create a nutrient sprite (hexagonal data crystal)
   * Color indicates risk/reward gradient based on proximity to distortion cores
   */
  private createNutrient(nutrient: Nutrient) {
    // Don't create duplicates
    if (this.nutrientSprites.has(nutrient.id)) return;

    const config = GAME_CONFIG;

    // Nutrient color based on value multiplier (gradient system)
    let color: number;
    switch (nutrient.valueMultiplier) {
      case 5:
        color = config.NUTRIENT_5X_COLOR; // Magenta - extreme risk/reward!
        break;
      case 3:
        color = config.NUTRIENT_3X_COLOR; // Gold - inner gravity well
        break;
      case 2:
        color = config.NUTRIENT_2X_COLOR; // Cyan - outer gravity well
        break;
      default:
        color = config.NUTRIENT_COLOR; // Green - safe zone
        break;
    }

    // Create hexagon points (6-sided polygon)
    const hexagon = new Phaser.Geom.Polygon([
      { x: 0, y: -config.NUTRIENT_SIZE },
      { x: config.NUTRIENT_SIZE * 0.866, y: -config.NUTRIENT_SIZE * 0.5 },
      { x: config.NUTRIENT_SIZE * 0.866, y: config.NUTRIENT_SIZE * 0.5 },
      { x: 0, y: config.NUTRIENT_SIZE },
      { x: -config.NUTRIENT_SIZE * 0.866, y: config.NUTRIENT_SIZE * 0.5 },
      { x: -config.NUTRIENT_SIZE * 0.866, y: -config.NUTRIENT_SIZE * 0.5 },
    ]);

    // Create polygon sprite
    const sprite = this.add.polygon(
      nutrient.position.x,
      nutrient.position.y,
      hexagon.points,
      color,
      0.8
    );

    // Add stroke that scales with value (thicker stroke for higher value)
    const strokeWidth = 1 + nutrient.valueMultiplier; // 2/3/4/6px stroke
    sprite.setStrokeStyle(strokeWidth, color, 1);

    // Pulsing animation (more intense for high-value)
    const pulseScale = 1.1 + (nutrient.valueMultiplier * 0.05); // 1.15/1.2/1.25/1.35
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

    // Set depth (above background, below players)
    sprite.setDepth(-25);

    this.nutrientSprites.set(nutrient.id, sprite);
  }

  /**
   * Create a gravity obstacle (distortion field) visualization
   */
  private createObstacle(obstacle: Obstacle) {
    // Don't create duplicates
    if (this.obstacleSprites.has(obstacle.id)) return;

    const graphics = this.add.graphics();
    const config = GAME_CONFIG;

    // Draw four concentric danger zones
    // Outer ring (gravity well edge - 600px escapable with effort)
    graphics.lineStyle(2, 0x00ffff, 0.3);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, obstacle.radius); // 600px

    // Middle ring (strong gravity - 360px)
    graphics.lineStyle(2, 0x00ffff, 0.5);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, obstacle.radius * 0.6); // 360px

    // EVENT HORIZON (inescapable magenta zone - 180px)
    graphics.lineStyle(3, 0xff0088, 0.8);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, obstacle.radius * 0.3); // 180px
    graphics.fillStyle(0xff0088, 0.1);
    graphics.fillCircle(obstacle.position.x, obstacle.position.y, obstacle.radius * 0.3); // 180px EVENT HORIZON

    // SINGULARITY CORE (instant death - 60px)
    graphics.lineStyle(4, 0xff0000, 1.0);
    graphics.strokeCircle(obstacle.position.x, obstacle.position.y, config.OBSTACLE_CORE_RADIUS); // 60px
    graphics.fillStyle(0xff0000, 0.3);
    graphics.fillCircle(obstacle.position.x, obstacle.position.y, config.OBSTACLE_CORE_RADIUS); // 60px

    // Set depth (above background, below players and nutrients)
    graphics.setDepth(-50);

    this.obstacleSprites.set(obstacle.id, graphics);
  }

  /**
   * Create an entropy swarm (virus enemy) visualization with glitchy particles
   */
  private createSwarm(swarm: EntropySwarm) {
    // Don't create duplicates
    if (this.swarmSprites.has(swarm.id)) return;

    // Container to hold all swarm visuals
    const container = this.add.container(swarm.position.x, swarm.position.y);

    // Core circle (pulsing corrupted data)
    const core = this.add.circle(0, 0, swarm.size, 0xff0088, 0.6);
    core.setStrokeStyle(3, 0xff00ff, 0.9);
    container.add(core);

    // Glitchy particle emitter (corrupted data fragments)
    // Emit from random positions within the swarm radius for a chaotic corrupted look
    // Create a custom zone source that matches Phaser's RandomZoneSource interface
    const circle = new Phaser.Geom.Circle(0, 0, swarm.size);
    const zoneSource = {
      getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => {
        // Generate random point within circle and modify point in-place
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * circle.radius;
        point.x = circle.x + Math.cos(angle) * radius;
        point.y = circle.y + Math.sin(angle) * radius;
      }
    };

    const particles = this.add.particles(0, 0, 'particle', {
      speed: { min: 30, max: 100 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0.5 }, // Bigger particles
      alpha: { start: 1, end: 0 },
      lifespan: 1200, // Particles last longer
      frequency: 40, // Emit more often (every 40ms)
      tint: [0xff0088, 0xff00ff, 0x8800ff], // Purple/magenta glitch colors
      blendMode: 'ADD',
      emitZone: new Phaser.GameObjects.Particles.Zones.RandomZone(zoneSource),
    });
    container.add(particles);

    // Set depth (above obstacles, below players)
    container.setDepth(-30);

    // Add pulsing animation to core
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
  }

  /**
   * Update swarm position and visual state
   */
  private updateSwarm(swarmId: string, position: { x: number; y: number }, state: 'patrol' | 'chase') {
    const container = this.swarmSprites.get(swarmId);
    if (!container) return;

    // Update position
    container.setPosition(position.x, position.y);

    // Visual feedback for state (chase = more intense)
    const core = container.list[0] as Phaser.GameObjects.Arc;
    if (state === 'chase') {
      core.setFillStyle(0xff0044, 0.8); // Brighter red when chasing
      core.setStrokeStyle(4, 0xff0000, 1.0);
    } else {
      core.setFillStyle(0xff0088, 0.6); // Normal purple when patrolling
      core.setStrokeStyle(3, 0xff00ff, 0.9);
    }
  }

  /**
   * Remove a nutrient sprite (with collection effect)
   */
  private removeNutrient(id: string, showEffect: boolean = false) {
    const sprite = this.nutrientSprites.get(id);
    if (!sprite) return;

    if (showEffect) {
      // Collection particle burst
      const particles = this.add.particles(sprite.x, sprite.y, 'particle', {
        speed: { min: 50, max: 150 },
        angle: { min: 0, max: 360 },
        scale: { start: 1, end: 0 },
        alpha: { start: 0.8, end: 0 },
        lifespan: 600,
        quantity: 12,
        tint: GAME_CONFIG.NUTRIENT_COLOR,
      });

      // Clean up particles after animation
      this.time.delayedCall(700, () => particles.destroy());
    }

    sprite.destroy();
    this.nutrientSprites.delete(id);
  }

  // ============================================
  // Death UI
  // ============================================

  /**
   * Set up DOM references for death overlay
   */
  private setupDeathUI() {
    this.deathOverlay = document.getElementById('death-overlay') as HTMLElement;
    this.respawnButton = document.getElementById('respawn-btn') as HTMLButtonElement;

    // Wire up respawn button
    if (this.respawnButton) {
      this.respawnButton.addEventListener('click', () => {
        // Send respawn request to server
        const respawnRequest: PlayerRespawnRequestMessage = {
          type: 'playerRespawnRequest',
        };
        this.socket.emit('playerRespawnRequest', respawnRequest);

        console.log('🔄 Respawn requested');
      });
    }
  }

  /**
   * Show death UI with stats
   */
  private showDeathUI(cause?: 'starvation' | 'singularity' | 'swarm' | 'obstacle') {
    if (!this.deathOverlay) return;

    // Calculate time survived
    const timeAlive = Date.now() - this.sessionStats.spawnTime;
    const minutes = Math.floor(timeAlive / 60000);
    const seconds = Math.floor((timeAlive % 60000) / 1000);
    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Convert stage enum to display string
    const stageNames: Record<EvolutionStage, string> = {
      [EvolutionStage.SINGLE_CELL]: 'Single-Cell',
      [EvolutionStage.MULTI_CELL]: 'Multi-Cell',
      [EvolutionStage.CYBER_ORGANISM]: 'Cyber-Organism',
      [EvolutionStage.HUMANOID]: 'Humanoid',
      [EvolutionStage.GODCELL]: 'Godcell',
    };

    // Convert death cause to display string
    const causeNames: Record<string, string> = {
      starvation: 'Starvation',
      singularity: 'Crushed by Singularity',
      swarm: 'Entropy Swarm',
      obstacle: 'Gravity Distortion',
    };

    // Update stats in UI
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

  /**
   * Hide death UI
   */
  private hideDeathUI() {
    if (!this.deathOverlay) return;
    this.deathOverlay.classList.remove('show');
  }

  /**
   * Reset session stats (called on spawn/respawn)
   */
  private resetSessionStats() {
    this.sessionStats.spawnTime = Date.now();
    this.sessionStats.nutrientsCollected = 0;
    this.sessionStats.highestStage = EvolutionStage.SINGLE_CELL;
  }

  // ============================================
  // Death Effects
  // ============================================

  /**
   * Create dilution effect when a cyber-cell dies
   * Particles scatter outward and fade over 2 seconds
   */
  private createDilutionEffect(position: { x: number; y: number }, color: string) {
    const particleCount = 25;
    const playerColor = Phaser.Display.Color.HexStringToColor(color);

    // Create individual particles that drift apart
    for (let i = 0; i < particleCount; i++) {
      // Random angle for scatter direction
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.2;

      // Random distance particles will travel
      const distance = 50 + Math.random() * 100;

      // Calculate end position
      const endX = position.x + Math.cos(angle) * distance;
      const endY = position.y + Math.sin(angle) * distance;

      // Random size for variety
      const size = 3 + Math.random() * 5;

      // Create particle circle
      const particle = this.add.circle(position.x, position.y, size, playerColor.color, 0.9);
      particle.setDepth(100); // Above everything else

      // Animate particle: drift outward and fade
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
  // Network Setup
  // ============================================

  private connectToServer() {
    // Connect to server (change this URL for deployment)
    const SERVER_URL = 'http://localhost:3000';
    this.socket = io(SERVER_URL);

    // ========== Server Messages ==========

    // Initial game state (sent when we first connect)
    this.socket.on('gameState', (message: GameStateMessage) => {
      // Remove "Connecting..." text now that we're connected
      if (this.connectionText) {
        this.connectionText.destroy();
        this.connectionText = undefined;
      }

      // Remember our player ID
      this.myPlayerId = this.socket.id;

      // Store our player's stats
      if (!this.myPlayerId) return;
      const myPlayer = message.players[this.myPlayerId];
      if (myPlayer) {
        this.myPlayerStats.health = myPlayer.health;
        this.myPlayerStats.maxHealth = myPlayer.maxHealth;
        this.myPlayerStats.energy = myPlayer.energy;
        this.myPlayerStats.maxEnergy = myPlayer.maxEnergy;
        this.myPlayerStats.stage = myPlayer.stage;

        // Update UI immediately with initial stats
        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );

        // Initialize session stats (start tracking survival time)
        this.resetSessionStats();
      }

      // Create sprites for all existing players
      for (const [playerId, player] of Object.entries(message.players)) {
        this.createCyberCell(playerId, player);
      }

      // Create sprites for all existing nutrients
      for (const nutrient of Object.values(message.nutrients)) {
        this.createNutrient(nutrient);
      }

      // Create gravity obstacles (distortion fields)
      for (const obstacle of Object.values(message.obstacles)) {
        this.createObstacle(obstacle);
      }

      // Create entropy swarms (virus enemies)
      for (const swarm of Object.values(message.swarms)) {
        this.createSwarm(swarm);
      }

      // Set up camera to follow our player
      const mySprite = this.playerSprites.get(this.myPlayerId);
      if (mySprite && myPlayer) {
        const config = GAME_CONFIG;

        // Camera follows our cyber-cell
        this.cameras.main.startFollow(mySprite, true, 0.1, 0.1);

        // Set camera bounds to the full world
        this.cameras.main.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);

        // Set camera zoom based on evolution stage
        const zoom = this.getStageZoom(myPlayer.stage);
        this.cameras.main.setZoom(zoom);
      }
    });

    // Another player joined
    this.socket.on('playerJoined', (message: PlayerJoinedMessage) => {
      this.createCyberCell(message.player.id, message.player);
    });

    // A player left
    this.socket.on('playerLeft', (message: PlayerLeftMessage) => {
      this.removeCyberCell(message.playerId);
    });

    // A player moved
    this.socket.on('playerMoved', (message: PlayerMovedMessage) => {
      this.updateCyberCellPosition(message.playerId, message.position);
    });

    // Nutrient spawned
    this.socket.on('nutrientSpawned', (message: NutrientSpawnedMessage) => {
      this.createNutrient(message.nutrient);
    });

    // Nutrient moved (attracted by obstacles)
    this.socket.on('nutrientMoved', (message: NutrientMovedMessage) => {
      const sprite = this.nutrientSprites.get(message.nutrientId);
      if (sprite) {
        sprite.setPosition(message.position.x, message.position.y);
      }
    });

    // Swarm spawned
    this.socket.on('swarmSpawned', (message: SwarmSpawnedMessage) => {
      this.createSwarm(message.swarm);
    });

    // Swarm moved
    this.socket.on('swarmMoved', (message: SwarmMovedMessage) => {
      this.updateSwarm(message.swarmId, message.position, message.state);
    });

    // Nutrient collected
    this.socket.on('nutrientCollected', (message: NutrientCollectedMessage) => {
      this.removeNutrient(message.nutrientId, true); // Show collection effect

      // Update our stats if we collected it
      if (message.playerId === this.myPlayerId) {
        this.myPlayerStats.energy = message.collectorEnergy;
        this.myPlayerStats.maxEnergy = message.collectorMaxEnergy;

        // Track nutrient collection for death stats
        this.sessionStats.nutrientsCollected++;

        // Immediately update UI with new energy/maxEnergy
        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }
    });

    // Energy/health update
    this.socket.on('energyUpdate', (message: EnergyUpdateMessage) => {
      // Update UI for our own player
      if (message.playerId === this.myPlayerId) {
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
    this.socket.on('playerDied', (message: PlayerDiedMessage) => {
      console.log(`💀 Player ${message.playerId} died (PERMANENT LOSS)`);

      // Create dilution effect (particles scatter and fade)
      this.createDilutionEffect(message.position, message.color);

      // Show death UI if it's our player
      if (message.playerId === this.myPlayerId) {
        // Small delay to let dilution effect play
        this.time.delayedCall(500, () => {
          this.showDeathUI(message.cause);
        });
      }

      // Remove the player sprite immediately
      this.removeCyberCell(message.playerId);
    });

    // Player respawned
    this.socket.on('playerRespawned', (message: PlayerRespawnedMessage) => {
      console.log(`🔄 Player ${message.player.id} respawned as single-cell`);

      // Update our stats if it's us
      if (message.player.id === this.myPlayerId) {
        this.myPlayerStats.health = message.player.health;
        this.myPlayerStats.maxHealth = message.player.maxHealth;
        this.myPlayerStats.energy = message.player.energy;
        this.myPlayerStats.maxEnergy = message.player.maxEnergy;
        this.myPlayerStats.stage = message.player.stage; // Back to single-cell

        // Reset session stats (new life begins)
        this.resetSessionStats();

        // Hide death UI
        this.hideDeathUI();

        // Update UI immediately with reset stats
        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }

      // Recreate sprite (it was removed on death)
      this.createCyberCell(message.player.id, message.player);

      // Re-attach camera if this is our player (fixes camera tracking bug)
      if (message.player.id === this.myPlayerId) {
        const mySprite = this.playerSprites.get(this.myPlayerId);
        if (mySprite) {
          const config = GAME_CONFIG;

          // Re-attach camera to the new sprite
          this.cameras.main.startFollow(mySprite, true, 0.1, 0.1);

          // Ensure camera bounds are still set
          this.cameras.main.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);

          // Reset camera zoom to single-cell level
          const resetZoom = this.getStageZoom(EvolutionStage.SINGLE_CELL);
          this.cameras.main.setZoom(resetZoom);

          console.log('📷 Camera re-attached after respawn');
        }
      }
    });

    // Player evolved
    this.socket.on('playerEvolved', (message: PlayerEvolvedMessage) => {
      console.log(`🧬 Player ${message.playerId} evolved to ${message.newStage}`);

      // Update our stats if it's us (evolution fully heals)
      if (message.playerId === this.myPlayerId) {
        this.myPlayerStats.health = message.newMaxHealth; // Evolution fully heals
        this.myPlayerStats.maxHealth = message.newMaxHealth;
        this.myPlayerStats.maxEnergy = message.newMaxEnergy;
        this.myPlayerStats.stage = message.newStage; // Update to new evolution stage

        // Track highest stage reached for death stats
        this.sessionStats.highestStage = message.newStage;

        // Update UI immediately with new max values
        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }

      // Visual evolution effect - swap to new stage visuals
      const container = this.playerSprites.get(message.playerId);
      if (container && container instanceof Phaser.GameObjects.Container) {
        const playerColor = this.playerColors.get(message.playerId);
        if (!playerColor) return;

        // Kill any existing tweens on this container (especially pulse animation)
        this.tweens.killTweensOf(container as any);

        // Remove old visuals
        container.removeAll(true); // true = destroy children

        // Build new stage visuals
        const newVisuals = this.buildStageVisuals(message.newStage, playerColor.color);
        container.add(newVisuals);

        // Re-apply white outline if this is our player
        if (message.playerId === this.myPlayerId) {
          container.list.forEach((child) => {
            (child as Phaser.GameObjects.Arc).setStrokeStyle(3, 0xffffff, 1);
          });
        }

        // Calculate new scale
        const newScale = this.getStageScale(message.newStage);

        // Animate size growth
        this.tweens.add({
          targets: container,
          scaleX: newScale,
          scaleY: newScale,
          duration: 500,
          ease: 'Back.easeOut',
          onComplete: () => {
            // Restart pulse animation for our own cell at new scale
            if (message.playerId === this.myPlayerId) {
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

        // Update camera zoom if this is our player (expanded vision at higher stages)
        if (message.playerId === this.myPlayerId) {
          const newZoom = this.getStageZoom(message.newStage);
          this.tweens.add({
            targets: this.cameras.main,
            zoom: newZoom,
            duration: 1000,
            ease: 'Sine.easeInOut',
          });
        }

        // Flash effect
        this.tweens.add({
          targets: container,
          alpha: 0.5,
          duration: 100,
          yoyo: true,
          repeat: 3,
        });
      }
    });

    // Detection updates (chemical sensing for multi-cells)
    this.socket.on('detectionUpdate', (message: DetectionUpdateMessage) => {
      this.detectedEntities = message.detected;
    });

    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ Connected to digital ocean');
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from digital ocean');
    });
  }

  // ============================================
  // Cyber-Cell (Player) Sprite Management
  // ============================================

  /**
   * Create a visual representation of a cyber-cell (player)
   */
  /**
   * Get scale multiplier based on evolution stage
   */
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

  /**
   * Get camera zoom level for evolution stage
   * Higher stages zoom out to see more of the world
   */
  private getStageZoom(stage: EvolutionStage): number {
    switch (stage) {
      case EvolutionStage.SINGLE_CELL:
        return 1.0; // Base zoom
      case EvolutionStage.MULTI_CELL:
        return 0.67; // 1.5x more visible area (1/1.5 = 0.67)
      case EvolutionStage.CYBER_ORGANISM:
        return 0.5; // 2x more visible area
      case EvolutionStage.HUMANOID:
        return 0.4; // 2.5x more visible area
      case EvolutionStage.GODCELL:
        return 0.33; // 3x more visible area
    }
  }

  /**
   * Get energy decay rate based on evolution stage
   */
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

  /**
   * Build stage-specific visual elements for a cyber-cell
   * Returns array of Phaser game objects to add to container
   */
  private buildStageVisuals(stage: EvolutionStage, color: number): Phaser.GameObjects.GameObject[] {
    const visuals: Phaser.GameObjects.GameObject[] = [];

    switch (stage) {
      case EvolutionStage.SINGLE_CELL: {
        // Simple single circle - clean, minimal
        const circle = this.add.circle(0, 0, GAME_CONFIG.PLAYER_SIZE, color, 1);
        circle.setStrokeStyle(3, color, 0.8);
        visuals.push(circle);
        break;
      }

      case EvolutionStage.MULTI_CELL:
      case EvolutionStage.CYBER_ORGANISM:
      case EvolutionStage.HUMANOID:
      case EvolutionStage.GODCELL: {
        // Star pattern: center + 5 points in pentagon arrangement
        const circleRadius = 8;
        const starRadius = 8;  // Tight overlapping cluster
        const numPoints = 5;

        // Add outer circles FIRST (they'll be behind)
        for (let i = 0; i < numPoints; i++) {
          const angle = (i * Math.PI * 2) / numPoints - Math.PI / 2;
          const x = Math.cos(angle) * starRadius;
          const y = Math.sin(angle) * starRadius;

          const pointCircle = this.add.circle(x, y, circleRadius, color, 1);
          pointCircle.setStrokeStyle(2, color, 0.8);
          visuals.push(pointCircle);
        }

        // Add center circle LAST (it'll be on top)
        const centerCircle = this.add.circle(0, 0, circleRadius, color, 1);
        centerCircle.setStrokeStyle(2, color, 0.8);
        visuals.push(centerCircle);

        break;
      }
    }

    return visuals;
  }

  private createCyberCell(playerId: string, player: Player) {
    // Don't create duplicate sprites
    if (this.playerSprites.has(playerId)) return;

    const color = Phaser.Display.Color.HexStringToColor(player.color).color;

    // Create container for stage-specific visuals
    const cellContainer = this.add.container(player.position.x, player.position.y);

    // Build and add stage-specific visual elements
    const visuals = this.buildStageVisuals(player.stage, color);
    cellContainer.add(visuals);

    // Set initial scale based on evolution stage
    const initialScale = this.getStageScale(player.stage);
    cellContainer.setScale(initialScale);

    // Highlight our own cell with extra glow
    if (playerId === this.myPlayerId) {
      // Add white outline to all circles in our cell
      cellContainer.list.forEach((child) => {
        (child as Phaser.GameObjects.Arc).setStrokeStyle(3, 0xffffff, 1);
      });

      // Pulsing animation for our cell
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

    // Store reference so we can update it later
    this.playerSprites.set(playerId, cellContainer);

    // Store player color for trail rendering (parse once, cache for performance)
    this.playerColors.set(playerId, Phaser.Display.Color.HexStringToColor(player.color));

    // Create trail graphics for this cyber-cell
    const trailGraphic = this.add.graphics();
    trailGraphic.setDepth(-10); // Behind cells, but above particles
    this.trailGraphics.set(playerId, trailGraphic);

    // Initialize empty trail array
    this.playerTrails.set(playerId, []);

    // Initialize last known position
    this.lastPlayerPositions.set(playerId, { x: player.position.x, y: player.position.y });
  }

  /**
   * Remove a cyber-cell when player disconnects
   */
  private removeCyberCell(playerId: string) {
    const sprite = this.playerSprites.get(playerId);
    if (sprite) {
      sprite.destroy();
      this.playerSprites.delete(playerId);
    }

    // Clean up player color
    this.playerColors.delete(playerId);

    // Clean up trail graphics
    const trailGraphic = this.trailGraphics.get(playerId);
    if (trailGraphic) {
      trailGraphic.destroy();
      this.trailGraphics.delete(playerId);
    }

    // Clean up trail data
    this.playerTrails.delete(playerId);

    // Clean up last position tracking
    this.lastPlayerPositions.delete(playerId);
  }

  /**
   * Update a cyber-cell's position smoothly
   */
  private updateCyberCellPosition(playerId: string, position: { x: number; y: number }) {
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    // Add current position to trail when player moves
    const trail = this.playerTrails.get(playerId);
    if (trail) {
      trail.push({ x: sprite.x, y: sprite.y });

      // Keep only last 90 positions (roughly 1.5 seconds at 60fps)
      const maxTrailLength = 90;
      if (trail.length > maxTrailLength) {
        trail.shift(); // Remove oldest position
      }
    }

    // Smooth movement - update position directly
    // The server sends updates frequently enough (60fps) that we don't need tweening
    sprite.x = position.x;
    sprite.y = position.y;
  }

  /**
   * Fade trails for stationary cyber-cells
   * Called every frame to gradually remove trail points when players aren't moving
   */
  private updateTrailFading() {
    // Check each player's current position vs last known position
    for (const [playerId, sprite] of this.playerSprites) {
      const lastPos = this.lastPlayerPositions.get(playerId);
      const trail = this.playerTrails.get(playerId);

      if (!lastPos || !trail) continue;

      const currentX = sprite.x;
      const currentY = sprite.y;

      // Check if player has moved significantly (more than 1 pixel)
      const hasMoved = Math.abs(currentX - lastPos.x) > 1 || Math.abs(currentY - lastPos.y) > 1;

      if (!hasMoved && trail.length > 0) {
        // Player is stationary - remove oldest trail point to create fade effect
        trail.shift();
      }

      // Update last known position
      lastPos.x = currentX;
      lastPos.y = currentY;
    }
  }

  /**
   * Render glowing trails for all cyber-cells
   */
  private renderTrails() {
    // Iterate through all players
    for (const [playerId, trail] of this.playerTrails) {
      const trailGraphic = this.trailGraphics.get(playerId);
      const sprite = this.playerSprites.get(playerId);
      const playerColor = this.playerColors.get(playerId);

      if (!trailGraphic || !sprite || !playerColor || trail.length === 0) continue;

      // Clear previous frame's trail
      trailGraphic.clear();

      // Draw each point in the trail
      for (let i = 0; i < trail.length; i++) {
        const pos = trail[i];

        // Calculate opacity - oldest (start) is most transparent, newest (end) is most opaque
        const alpha = (i / trail.length) * 0.7; // Max 0.7 opacity

        // Calculate size - trail points get larger toward the front
        const size = 8 + (i / trail.length) * 18; // 8px to 26px (wider trail)

        // Draw the trail point (use cached color object)
        trailGraphic.fillStyle(playerColor.color, alpha);
        trailGraphic.fillCircle(pos.x, pos.y, size);
      }
    }
  }

  /**
   * Render detection indicators (chemical sensing for multi-cells)
   * Shows arrows at screen edge pointing toward detected entities
   */
  private renderDetectionIndicators() {
    // Clear previous indicators
    this.detectionIndicators.forEach((indicator) => indicator.destroy());
    this.detectionIndicators = [];

    // Only show if player is Stage 2+ (multi-cell has chemical sensing)
    if (this.myPlayerStats.stage === EvolutionStage.SINGLE_CELL) return;

    // Get my player sprite for camera position
    const mySprite = this.myPlayerId ? this.playerSprites.get(this.myPlayerId) : null;
    if (!mySprite) return;

    const camera = this.cameras.main;
    const viewportCenterX = camera.scrollX + camera.width / 2;
    const viewportCenterY = camera.scrollY + camera.height / 2;

    const maxDetectionRange = GAME_CONFIG.MULTI_CELL_DETECTION_RADIUS;

    // Render indicator for each detected entity
    for (const entity of this.detectedEntities) {
      // Calculate angle from viewport center to entity
      const dx = entity.position.x - viewportCenterX;
      const dy = entity.position.y - viewportCenterY;
      const angle = Math.atan2(dy, dx);
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Calculate arrow scale based on proximity (closer = bigger)
      // Scale ranges from 0.5 (far) to 2.0 (very close)
      const normalizedDistance = Math.min(distance / maxDetectionRange, 1.0);
      const arrowScale = 0.5 + (1.0 - normalizedDistance) * 1.5;

      // Choose color based on entity type
      const color = entity.entityType === 'player' ? 0xff00ff : 0x00ff00; // Magenta for players, green for nutrients

      // Calculate indicator position at edge of screen
      const edgeX = viewportCenterX + Math.cos(angle) * (camera.width / 2 - 40);
      const edgeY = viewportCenterY + Math.sin(angle) * (camera.height / 2 - 40);

      // Create arrow indicator
      const indicator = this.add.graphics();
      indicator.setScrollFactor(0); // Fixed to camera
      indicator.setDepth(999); // Below UI bars but above game world

      // Convert world position to screen position for rendering
      const screenX = edgeX - camera.scrollX;
      const screenY = edgeY - camera.scrollY;

      // Draw arrow pointing toward entity (size scales with proximity)
      const tipLength = 15 * arrowScale;
      const baseLength = 8 * arrowScale;

      indicator.fillStyle(color, 0.8);
      indicator.beginPath();
      // Arrow tip
      indicator.moveTo(screenX + Math.cos(angle) * tipLength, screenY + Math.sin(angle) * tipLength);
      // Arrow base left
      indicator.lineTo(
        screenX + Math.cos(angle + 2.5) * baseLength,
        screenY + Math.sin(angle + 2.5) * baseLength
      );
      // Arrow base right
      indicator.lineTo(
        screenX + Math.cos(angle - 2.5) * baseLength,
        screenY + Math.sin(angle - 2.5) * baseLength
      );
      indicator.closePath();
      indicator.fillPath();

      this.detectionIndicators.push(indicator);
    }
  }

  // ============================================
  // Phaser Lifecycle: Update
  // Runs every frame (60 times per second)
  // ============================================

  update(_time: number, delta: number) {
    // Update energy countdown timer every frame (Eva-style intensity)
    this.updateCountdownTimer();

    // Update flowing particles (the digital water)
    this.updateDataParticles(delta);

    // Render glowing trails for all cyber-cells
    this.renderTrails();

    // Fade trails for stationary players
    this.updateTrailFading();

    // Render detection indicators (chemical sensing for multi-cells)
    this.renderDetectionIndicators();

    // Don't process input until we're connected
    if (!this.myPlayerId) return;

    // Read keyboard input
    const direction = { x: 0, y: 0 };

    if (this.cursors.left.isDown) {
      direction.x = -1;
    } else if (this.cursors.right.isDown) {
      direction.x = 1;
    }

    if (this.cursors.up.isDown) {
      direction.y = -1;
    } else if (this.cursors.down.isDown) {
      direction.y = 1;
    }

    // Only send to server if direction changed
    // (Reduces network traffic)
    if (direction.x !== this.currentDirection.x || direction.y !== this.currentDirection.y) {
      this.currentDirection = direction;

      const moveMessage: PlayerMoveMessage = {
        type: 'playerMove',
        direction,
      };

      this.socket.emit('playerMove', moveMessage);
    }
  }
}
