import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared'
import type {
  Player,
  Nutrient,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  PlayerMoveMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PlayerEvolvedMessage,
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
  };

  // Visual representations of all cyber-cells (players)
  // Maps playerId → Phaser circle sprite
  private playerSprites: Map<string, Phaser.GameObjects.Arc> = new Map();

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
  private uiText?: Phaser.GameObjects.Text;

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

    // UI text (stats display)
    this.uiText = this.add
      .text(10, 50, '', {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'monospace',
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  /**
   * Update metabolism UI bars
   */
  private updateMetabolismUI(health: number, maxHealth: number, energy: number, maxEnergy: number) {
    if (!this.healthBar || !this.energyBar || !this.uiText) return;

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

    // Update text display
    this.uiText.setText([
      `Health: ${Math.ceil(health)}/${maxHealth}`,
      `Energy: ${Math.ceil(energy)}/${maxEnergy}`,
    ]);

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
   */
  private createNutrient(nutrient: Nutrient) {
    // Don't create duplicates
    if (this.nutrientSprites.has(nutrient.id)) return;

    const config = GAME_CONFIG;

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
      config.NUTRIENT_COLOR,
      0.8
    );

    // Add glow effect
    sprite.setStrokeStyle(2, config.NUTRIENT_COLOR, 1);

    // Pulsing animation
    this.tweens.add({
      targets: sprite,
      scaleX: 1.2,
      scaleY: 1.2,
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
      const myPlayer = message.players[this.myPlayerId];
      if (myPlayer) {
        this.myPlayerStats.health = myPlayer.health;
        this.myPlayerStats.maxHealth = myPlayer.maxHealth;
        this.myPlayerStats.energy = myPlayer.energy;
        this.myPlayerStats.maxEnergy = myPlayer.maxEnergy;

        // Update UI immediately with initial stats
        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }

      // Create sprites for all existing players
      for (const [playerId, player] of Object.entries(message.players)) {
        this.createCyberCell(playerId, player);
      }

      // Create sprites for all existing nutrients
      for (const [nutrientId, nutrient] of Object.entries(message.nutrients)) {
        this.createNutrient(nutrient);
      }

      // Set up camera to follow our player
      const mySprite = this.playerSprites.get(this.myPlayerId);
      if (mySprite) {
        const config = GAME_CONFIG;

        // Camera follows our cyber-cell
        this.cameras.main.startFollow(mySprite, true, 0.1, 0.1);

        // Set camera bounds to the full world
        this.cameras.main.setBounds(0, 0, config.WORLD_WIDTH, config.WORLD_HEIGHT);
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

    // Nutrient collected
    this.socket.on('nutrientCollected', (message: NutrientCollectedMessage) => {
      this.removeNutrient(message.nutrientId, true); // Show collection effect

      // Update our stats if we collected it
      if (message.playerId === this.myPlayerId) {
        this.myPlayerStats.energy = message.collectorEnergy;
        this.myPlayerStats.maxEnergy = message.collectorMaxEnergy;

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
    });

    // Player evolved
    this.socket.on('playerEvolved', (message: PlayerEvolvedMessage) => {
      console.log(`🧬 Player ${message.playerId} evolved to ${message.newStage}`);

      // Update our stats if it's us (evolution fully heals)
      if (message.playerId === this.myPlayerId) {
        this.myPlayerStats.health = message.newMaxHealth; // Evolution fully heals
        this.myPlayerStats.maxHealth = message.newMaxHealth;
        this.myPlayerStats.maxEnergy = message.newMaxEnergy;

        // Update UI immediately with new max values
        this.updateMetabolismUI(
          this.myPlayerStats.health,
          this.myPlayerStats.maxHealth,
          this.myPlayerStats.energy,
          this.myPlayerStats.maxEnergy
        );
      }

      // TODO: Visual evolution effect (size increase, flash, particles)
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
  private createCyberCell(playerId: string, player: Player) {
    // Don't create duplicate sprites
    if (this.playerSprites.has(playerId)) return;

    const config = GAME_CONFIG;

    // Create a glowing circular cyber-cell
    const cell = this.add.circle(
      player.position.x,
      player.position.y,
      config.PLAYER_SIZE,
      Phaser.Display.Color.HexStringToColor(player.color).color,
      1
    );

    // Add glow effect
    cell.setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(player.color).color, 0.8);

    // Highlight our own cell with extra glow
    if (playerId === this.myPlayerId) {
      cell.setStrokeStyle(5, 0xffffff, 1);

      // Pulsing animation for our cell
      this.tweens.add({
        targets: cell,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Store reference so we can update it later
    this.playerSprites.set(playerId, cell);

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

  // ============================================
  // Phaser Lifecycle: Update
  // Runs every frame (60 times per second)
  // ============================================

  update(_time: number, delta: number) {
    // Update flowing particles (the digital water)
    this.updateDataParticles(delta);

    // Render glowing trails for all cyber-cells
    this.renderTrails();

    // Fade trails for stationary players
    this.updateTrailFading();

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
