// ============================================
// Input Manager - High-Level Intent Generation
// ============================================

import { InputState } from './InputState';
import { eventBus } from '../events/EventBus';

export interface CameraProjection {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
}

export class InputManager {
  private inputState: InputState;

  // Cooldowns
  private lastRespawnKeyTime = 0;
  private respawnKeyCooldown = 300; // Prevent key spam

  // Track previous movement direction to avoid redundant network updates
  private lastMoveDirection = { x: 0, y: 0 };

  constructor() {
    this.inputState = new InputState();
  }

  /**
   * Set camera projection adapter (for screen ↔ world conversion)
   * Currently unused but will be needed for pseudopod aiming in future phases
   */
  setCameraProjection(_projection: CameraProjection): void {
    // Will be used for pseudopod targeting (screen → world conversion)
  }

  /**
   * Update input state and emit intents
   * Call this every frame
   */
  update(_dt: number): void {
    this.updateMovement();
    this.updateRespawn();
    // Pseudopods/other mechanics can be added later
  }

  private updateMovement(): void {
    let vx = 0;
    let vy = 0;

    // WASD movement
    if (this.inputState.isKeyDown('w') || this.inputState.isKeyDown('arrowup')) {
      vy = -1;
    }
    if (this.inputState.isKeyDown('s') || this.inputState.isKeyDown('arrowdown')) {
      vy = 1;
    }
    if (this.inputState.isKeyDown('a') || this.inputState.isKeyDown('arrowleft')) {
      vx = -1;
    }
    if (this.inputState.isKeyDown('d') || this.inputState.isKeyDown('arrowright')) {
      vx = 1;
    }

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const mag = Math.sqrt(vx * vx + vy * vy);
      vx /= mag;
      vy /= mag;
    }

    // Only emit if direction changed (reduces network traffic)
    if (vx !== this.lastMoveDirection.x || vy !== this.lastMoveDirection.y) {
      eventBus.emit({ type: 'client:inputMove', direction: { x: vx, y: vy } });
      this.lastMoveDirection = { x: vx, y: vy };
    }
  }

  private updateRespawn(): void {
    const now = Date.now();

    if (this.inputState.isKeyDown('r')) {
      // Check cooldown (prevent key-down spam)
      if (now - this.lastRespawnKeyTime < this.respawnKeyCooldown) {
        return;
      }

      // Emit respawn intent
      eventBus.emit({ type: 'client:inputRespawn' });

      this.lastRespawnKeyTime = now;
    }
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.inputState.dispose();
  }
}
