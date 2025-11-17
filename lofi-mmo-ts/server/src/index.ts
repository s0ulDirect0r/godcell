import { Server } from 'socket.io';
import type {
  Player,
  Position,
  PlayerMoveMessage,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  GAME_CONFIG,
} from '@lofi-mmo/shared';

// ============================================
// Server Configuration
// ============================================

const PORT = 3000;
const TICK_RATE = 60; // Server updates 60 times per second
const TICK_INTERVAL = 1000 / TICK_RATE;

// ============================================
// Game State
// ============================================

// All players currently in the game
// Maps socket ID → Player data
const players: Map<string, Player> = new Map();

// Player velocities (for server-side movement simulation)
// Maps socket ID → {x, y} velocity
const playerVelocities: Map<string, { x: number; y: number }> = new Map();

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a random color for a new player
 */
function randomColor(): string {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE'];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Generate a random spawn position
 */
function randomSpawnPosition(): Position {
  return {
    x: Math.random() * 700 + 50, // Random x between 50 and 750
    y: Math.random() * 500 + 50, // Random y between 50 and 550
  };
}

// ============================================
// Socket.io Server Setup
// ============================================

const io = new Server(PORT, {
  cors: {
    origin: '*', // Allow all origins for development
  },
});

console.log(`🎮 Game server running on port ${PORT}`);

// ============================================
// Connection Handling
// ============================================

io.on('connection', (socket) => {
  console.log(`✅ Player connected: ${socket.id}`);

  // Create a new player
  const newPlayer: Player = {
    id: socket.id,
    position: randomSpawnPosition(),
    color: randomColor(),
  };

  // Add to game state
  players.set(socket.id, newPlayer);
  playerVelocities.set(socket.id, { x: 0, y: 0 });

  // Send current game state to the new player
  const gameState: GameStateMessage = {
    type: 'gameState',
    players: Object.fromEntries(players),
  };
  socket.emit('gameState', gameState);

  // Notify all OTHER players that someone joined
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: newPlayer,
  };
  socket.broadcast.emit('playerJoined', joinMessage);

  // ============================================
  // Player Movement Input
  // ============================================

  socket.on('playerMove', (message: PlayerMoveMessage) => {
    const velocity = playerVelocities.get(socket.id);
    if (!velocity) return;

    // Update player's velocity based on input
    // Direction values are -1, 0, or 1
    velocity.x = message.direction.x;
    velocity.y = message.direction.y;
  });

  // ============================================
  // Disconnection Handling
  // ============================================

  socket.on('disconnect', () => {
    console.log(`❌ Player disconnected: ${socket.id}`);

    // Remove from game state
    players.delete(socket.id);
    playerVelocities.delete(socket.id);

    // Notify other players
    const leftMessage: PlayerLeftMessage = {
      type: 'playerLeft',
      playerId: socket.id,
    };
    socket.broadcast.emit('playerLeft', leftMessage);
  });
});

// ============================================
// Game Loop (Server Tick)
// ============================================

/**
 * Main game loop - runs 60 times per second
 * Updates player positions based on their velocities
 */
setInterval(() => {
  const deltaTime = TICK_INTERVAL / 1000; // Convert to seconds

  // Update each player's position
  for (const [playerId, player] of players) {
    const velocity = playerVelocities.get(playerId);
    if (!velocity) continue;

    // Skip if player isn't moving
    if (velocity.x === 0 && velocity.y === 0) continue;

    // Normalize diagonal movement (same as Bevy version)
    const length = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    const normalizedX = length > 0 ? velocity.x / length : 0;
    const normalizedY = length > 0 ? velocity.y / length : 0;

    // Update position (frame-rate independent)
    player.position.x += normalizedX * 200 * deltaTime; // 200 = PLAYER_SPEED
    player.position.y += normalizedY * 200 * deltaTime;

    // Keep player within world bounds
    player.position.x = Math.max(0, Math.min(800, player.position.x)); // WORLD_WIDTH
    player.position.y = Math.max(0, Math.min(600, player.position.y)); // WORLD_HEIGHT

    // Broadcast position update to all clients
    const moveMessage: PlayerMovedMessage = {
      type: 'playerMoved',
      playerId,
      position: player.position,
    };
    io.emit('playerMoved', moveMessage);
  }
}, TICK_INTERVAL);
