import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG } from '@lofi-mmo/shared'
import type {
  Player,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  PlayerMoveMessage,
} from '@lofi-mmo/shared';

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

  // Visual representations of all cyber-cells (players)
  // Maps playerId → Phaser circle sprite
  private playerSprites: Map<string, Phaser.GameObjects.Arc> = new Map();

  // Keyboard input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Current movement direction we're sending to server
  private currentDirection = { x: 0, y: 0 };

  // Connection status text (removed once connected)
  private connectionText?: Phaser.GameObjects.Text;

  // ========== GODCELL World Elements ==========

  // Flowing background particles (the "digital water")
  private dataParticles: DataParticle[] = [];

  // Grid graphics for subtle background pattern
  private gridGraphics!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'GameScene' });
  }

  // ============================================
  // Phaser Lifecycle: Create
  // Runs once when scene starts
  // ============================================

  create() {
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
    const config = GAME_CONFIG as unknown as typeof import('@lofi-mmo/shared').GAME_CONFIG;

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
    const config = GAME_CONFIG as unknown as typeof import('@lofi-mmo/shared').GAME_CONFIG;

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
    const config = GAME_CONFIG as unknown as typeof import('@lofi-mmo/shared').GAME_CONFIG;
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
  // Network Setup
  // ============================================

  private connectToServer() {
    // Connect to server (change this URL for deployment)
    const SERVER_URL = 'http://localhost:3000';
    this.socket = io(SERVER_URL);

    // ========== Server Messages ==========

    // Initial game state (sent when we first connect)
    this.socket.on('gameState', (message: GameStateMessage) => {
      console.log('📦 Received game state:', message);

      // Remove "Connecting..." text now that we're connected
      if (this.connectionText) {
        this.connectionText.destroy();
        this.connectionText = undefined;
      }

      // Remember our player ID
      this.myPlayerId = this.socket.id;

      // Create sprites for all existing players
      for (const [playerId, player] of Object.entries(message.players)) {
        this.createCyberCell(playerId, player);
      }
    });

    // Another player joined
    this.socket.on('playerJoined', (message: PlayerJoinedMessage) => {
      console.log('👋 Cyber-cell joined:', message.player.id);
      this.createCyberCell(message.player.id, message.player);
    });

    // A player left
    this.socket.on('playerLeft', (message: PlayerLeftMessage) => {
      console.log('👋 Cyber-cell left:', message.playerId);
      this.removeCyberCell(message.playerId);
    });

    // A player moved
    this.socket.on('playerMoved', (message: PlayerMovedMessage) => {
      this.updateCyberCellPosition(message.playerId, message.position);
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

    const config = GAME_CONFIG as unknown as typeof import('@lofi-mmo/shared').GAME_CONFIG;

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
  }

  /**
   * Update a cyber-cell's position smoothly
   */
  private updateCyberCellPosition(playerId: string, position: { x: number; y: number }) {
    const sprite = this.playerSprites.get(playerId);
    if (!sprite) return;

    // Smooth movement using Phaser tweens
    // Instead of instantly teleporting, animate to new position
    this.tweens.add({
      targets: sprite,
      x: position.x,
      y: position.y,
      duration: 50, // 50ms - fast enough to feel responsive
      ease: 'Linear',
    });
  }

  // ============================================
  // Phaser Lifecycle: Update
  // Runs every frame (60 times per second)
  // ============================================

  update(_time: number, delta: number) {
    // Update flowing particles (the digital water)
    this.updateDataParticles(delta);

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
