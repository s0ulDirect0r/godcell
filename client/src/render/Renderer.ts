// ============================================
// Renderer Contract - Interface for Three.js Renderer
// ============================================

import type { World } from '../ecs';

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
   * @param world ECS World reference for render systems to query
   */
  init(container: HTMLElement, width: number, height: number, world: World): void;

  /**
   * Render one frame (renderer queries World directly for state)
   * @param dt Delta time (milliseconds)
   */
  render(dt: number): void;

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
