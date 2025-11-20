/**
 * Minimap view model - derives minimap data from GameState.
 * Shows player positions relative to world bounds.
 */

import type { GameState } from '../state/GameState';
import { getAllPlayers, getLocalPlayer } from '../state/selectors';
import { GAME_CONFIG } from '../config/gameConfig';

/**
 * Minimap data for a single player
 */
export interface MinimapPlayer {
  id: string;
  x: number; // Normalized position (0-1)
  y: number; // Normalized position (0-1)
  color: string;
  isLocal: boolean;
}

/**
 * Minimap viewport rect (normalized 0-1)
 */
export interface MinimapViewport {
  x: number; // Normalized position (0-1)
  y: number; // Normalized position (0-1)
  w: number; // Normalized width (0-1)
  h: number; // Normalized height (0-1)
}

/**
 * Minimap data ready for rendering
 */
export interface MinimapData {
  players: MinimapPlayer[];
  viewport: MinimapViewport;
  worldWidth: number;
  worldHeight: number;
}

/**
 * Derive minimap data from game state
 */
export function deriveMinimapData(state: GameState): MinimapData {
  const localPlayer = getLocalPlayer(state);
  const allPlayers = getAllPlayers(state);

  // Map players to minimap positions (normalized 0-1)
  const players: MinimapPlayer[] = allPlayers.map((player) => ({
    id: player.id,
    x: player.position.x / GAME_CONFIG.WORLD_WIDTH,
    y: player.position.y / GAME_CONFIG.WORLD_HEIGHT,
    color: player.color,
    isLocal: player.id === localPlayer?.id,
  }));

  // Calculate viewport rect (normalized)
  let viewport: MinimapViewport;
  if (localPlayer) {
    const viewportW = GAME_CONFIG.VIEWPORT_WIDTH / GAME_CONFIG.WORLD_WIDTH;
    const viewportH = GAME_CONFIG.VIEWPORT_HEIGHT / GAME_CONFIG.WORLD_HEIGHT;
    const viewportX = Math.max(
      0,
      Math.min(
        1 - viewportW,
        localPlayer.position.x / GAME_CONFIG.WORLD_WIDTH - viewportW / 2
      )
    );
    const viewportY = Math.max(
      0,
      Math.min(
        1 - viewportH,
        localPlayer.position.y / GAME_CONFIG.WORLD_HEIGHT - viewportH / 2
      )
    );

    viewport = {
      x: viewportX,
      y: viewportY,
      w: viewportW,
      h: viewportH,
    };
  } else {
    // Default viewport (centered)
    viewport = {
      x: 0,
      y: 0,
      w: GAME_CONFIG.VIEWPORT_WIDTH / GAME_CONFIG.WORLD_WIDTH,
      h: GAME_CONFIG.VIEWPORT_HEIGHT / GAME_CONFIG.WORLD_HEIGHT,
    };
  }

  return {
    players,
    viewport,
    worldWidth: GAME_CONFIG.WORLD_WIDTH,
    worldHeight: GAME_CONFIG.WORLD_HEIGHT,
  };
}
