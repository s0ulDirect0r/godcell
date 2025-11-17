// ============================================
// Shared Types & Constants
// Used by both client and server
// ============================================

// Player position in the game world
export interface Position {
  x: number;
  y: number;
}

// A player in the game
export interface Player {
  id: string;
  position: Position;
  color: string; // Hex color like "#FF5733"
}

// ============================================
// Network Messages (Client → Server)
// ============================================

export interface PlayerMoveMessage {
  type: 'playerMove';
  direction: {
    x: number; // -1, 0, or 1
    y: number; // -1, 0, or 1
  };
}

// ============================================
// Network Messages (Server → Client)
// ============================================

export interface GameStateMessage {
  type: 'gameState';
  players: Record<string, Player>; // Map of playerId → Player
}

export interface PlayerJoinedMessage {
  type: 'playerJoined';
  player: Player;
}

export interface PlayerLeftMessage {
  type: 'playerLeft';
  playerId: string;
}

export interface PlayerMovedMessage {
  type: 'playerMoved';
  playerId: string;
  position: Position;
}

// Union type of all possible server messages
export type ServerMessage =
  | GameStateMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerMovedMessage;

// ============================================
// Game Constants
// ============================================

export const GAME_CONFIG = {
  PLAYER_SPEED: 200, // Pixels per second
  PLAYER_SIZE: 50,   // Width/height of player square
  WORLD_WIDTH: 800,
  WORLD_HEIGHT: 600,
};
