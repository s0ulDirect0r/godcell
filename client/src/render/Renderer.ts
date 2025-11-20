// ============================================
// Renderer Contract - Interface for Three.js Renderer
// ============================================

import type { GameState } from '../core/state/GameState';

export interface CameraCapabilities {
  mode: 'topdown' | 'orbit' | 'tps' | 'fps';
  supports3D: boolean;
}

export interface Renderer {
  /**
   * Initialize renderer
   * @param container DOM element to render into
   * @param width Canvas width
   * @param height Canvas height
   */
  init(container: HTMLElement, width: number, height: number): void;

  /**
   * Render one frame
   * @param state Current game state
   * @param dt Delta time (milliseconds)
   */
  render(state: GameState, dt: number): void;

  /**
   * Resize canvas
   */
  resize(width: number, height: number): void;

  /**
   * Get camera capabilities
   */
  getCameraCapabilities(): CameraCapabilities;

  /**
   * Get camera projection for input (screen ↔ world)
   */
  getCameraProjection(): {
    screenToWorld(screenX: number, screenY: number): { x: number; y: number };
    worldToScreen(worldX: number, worldY: number): { x: number; y: number };
  };

  /**
   * Clean up resources
   */
  dispose(): void;
}
