import Phaser from 'phaser';
import { io, Socket } from 'socket.io-client';
import type {
  Player,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  PlayerMoveMessage,
  GAME_CONFIG,
} from '@lofi-mmo/shared';

// ============================================
// Game Scene
// This is where all the gameplay happens
// ============================================

export class GameScene extends Phaser.Scene {
  // Network connection to server
  private socket!: Socket;

  // Our player's ID (assigned by server)
  private myPlayerId?: string;

  // Visual representations of all players
  // Maps playerId → Phaser rectangle sprite
  private playerSprites: Map<string, Phaser.GameObjects.Rectangle> = new Map();

  // Keyboard input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Current movement direction we're sending to server
  private currentDirection = { x: 0, y: 0 };

  // Connection status text (removed once connected)
  private connectionText?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  // ============================================
  // Phaser Lifecycle: Create
  // Runs once when scene starts
  // ============================================

  create() {
    // Set up keyboard input
    this.cursors = this.input.keyboard!.createCursorKeys();

    // Connect to game server
    this.connectToServer();

    // Add connection status text
    this.connectionText = this.add
      .text(10, 10, 'Connecting to server...', {
        fontSize: '14px',
        color: '#ffffff',
      })
      .setDepth(1000);
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
        this.createPlayerSprite(playerId, player);
      }
    });

    // Another player joined
    this.socket.on('playerJoined', (message: PlayerJoinedMessage) => {
      console.log('👋 Player joined:', message.player.id);
      this.createPlayerSprite(message.player.id, message.player);
    });

    // A player left
    this.socket.on('playerLeft', (message: PlayerLeftMessage) => {
      console.log('👋 Player left:', message.playerId);
      this.removePlayerSprite(message.playerId);
    });

    // A player moved
    this.socket.on('playerMoved', (message: PlayerMovedMessage) => {
      this.updatePlayerPosition(message.playerId, message.position);
    });

    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ Connected to server');
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
    });
  }

  // ============================================
  // Player Sprite Management
  // ============================================

  /**
   * Create a visual representation of a player
   */
  private createPlayerSprite(playerId: string, player: Player) {
    // Don't create duplicate sprites
    if (this.playerSprites.has(playerId)) return;

    // Create a colored rectangle to represent the player
    const sprite = this.add.rectangle(
      player.position.x,
      player.position.y,
      50, // PLAYER_SIZE
      50, // PLAYER_SIZE
      Phaser.Display.Color.HexStringToColor(player.color).color
    );

    // Highlight our own player with a white border
    if (playerId === this.myPlayerId) {
      sprite.setStrokeStyle(3, 0xffffff);
    }

    // Store reference so we can update it later
    this.playerSprites.set(playerId, sprite);
  }

  /**
   * Remove a player's sprite when they disconnect
   */
  private removePlayerSprite(playerId: string) {
    const sprite = this.playerSprites.get(playerId);
    if (sprite) {
      sprite.destroy();
      this.playerSprites.delete(playerId);
    }
  }

  /**
   * Update a player's position smoothly
   */
  private updatePlayerPosition(playerId: string, position: { x: number; y: number }) {
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

  update() {
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
