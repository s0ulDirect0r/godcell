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
  private cameraProjection?: CameraProjection;

  // Cooldowns
  private lastRespawnKeyTime = 0;
  private respawnKeyCooldown = 300; // Prevent key spam

  private lastEMPTime = 0;
  private empClientCooldown = 300; // Local anti-spam cooldown

  private lastPseudopodTime = 0;
  private pseudopodClientCooldown = 300; // Local anti-spam cooldown

  // Track previous movement direction to avoid redundant network updates
  private lastMoveDirection = { x: 0, y: 0 };

  // Track previous mouse state
  private wasMouseDown = false;

  // Track sprint state (Shift key)
  private wasSprinting = false;

  // First-person mode (Stage 4+) - enables pointer lock and mouse look
  private firstPersonMode = false;
  private _firstPersonYaw = 0; // Camera yaw for rotating movement input (used in Step 4)

  constructor() {
    this.inputState = new InputState();
    this.setupPointerLockClickHandler();
  }

  /**
   * Set camera projection adapter (for screen ↔ world conversion)
   */
  setCameraProjection(projection: CameraProjection): void {
    this.cameraProjection = projection;
  }

  /**
   * Enable/disable first-person mode (affects pointer lock and movement rotation)
   */
  setFirstPersonMode(enabled: boolean): void {
    this.firstPersonMode = enabled;

    // Exit pointer lock when leaving first-person mode
    if (!enabled && this.inputState.pointerLock.isLocked) {
      document.exitPointerLock();
    }
  }

  /**
   * Update first-person yaw (for rotating movement input)
   * Called from renderer when camera rotates
   */
  setFirstPersonYaw(yaw: number): void {
    this._firstPersonYaw = yaw;
  }

  /**
   * Get current first-person yaw (for movement rotation in Step 4)
   */
  getFirstPersonYaw(): number {
    return this._firstPersonYaw;
  }

  /**
   * Check if pointer is locked
   */
  isPointerLocked(): boolean {
    return this.inputState.pointerLock.isLocked;
  }

  /**
   * Setup click handler to request pointer lock in first-person mode
   */
  private setupPointerLockClickHandler(): void {
    document.addEventListener('click', () => {
      if (this.firstPersonMode && !this.inputState.pointerLock.isLocked) {
        document.body.requestPointerLock();
      }
    });
  }

  /**
   * Update input state and emit intents
   * Call this every frame
   */
  update(_dt: number): void {
    this.updateMovement();
    this.updateSprint();
    this.updateRespawn();
    this.updateEMP();
    this.updatePseudopod();
    this.updateMouseLook();
  }

  /**
   * Update mouse look (first-person mode only)
   * Emits look deltas for camera rotation
   */
  private updateMouseLook(): void {
    if (!this.firstPersonMode || !this.inputState.pointerLock.isLocked) {
      return;
    }

    // Consume accumulated mouse deltas
    const { deltaX, deltaY } = this.inputState.consumeMouseDelta();

    // Only emit if there was movement
    if (deltaX !== 0 || deltaY !== 0) {
      eventBus.emit({
        type: 'client:mouseLook',
        deltaX,
        deltaY,
      });
    }
  }

  private updateMovement(): void {
    let vx = 0;
    let vy = 0;

    // WASD movement (Y+ is up in world coordinates)
    if (this.inputState.isKeyDown('w') || this.inputState.isKeyDown('arrowup')) {
      vy = 1;  // Up is positive Y
    }
    if (this.inputState.isKeyDown('s') || this.inputState.isKeyDown('arrowdown')) {
      vy = -1;  // Down is negative Y
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

  private updateSprint(): void {
    // Shift key for sprint (Stage 3+ ability)
    const isSprinting = this.inputState.isKeyDown('shift') || this.inputState.isKeyDown('shiftleft') || this.inputState.isKeyDown('shiftright');

    // Only emit on state change (reduces network traffic)
    if (isSprinting !== this.wasSprinting) {
      eventBus.emit({ type: 'client:sprint', sprinting: isSprinting });
      this.wasSprinting = isSprinting;
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

  private updateEMP(): void {
    const now = Date.now();

    // Spacebar for EMP (multi-cell ability)
    if (this.inputState.isKeyDown(' ') || this.inputState.isKeyDown('space')) {
      // Check cooldown (prevent key-down spam)
      if (now - this.lastEMPTime < this.empClientCooldown) {
        return;
      }

      // Emit EMP intent
      eventBus.emit({ type: 'client:empActivate' });

      this.lastEMPTime = now;
    }
  }

  private updatePseudopod(): void {
    const now = Date.now();
    const isMouseDown = this.inputState.pointer.isDown && this.inputState.pointer.button === 0;

    // Detect left-click (rising edge)
    if (isMouseDown && !this.wasMouseDown) {
      // Check cooldown
      if (now - this.lastPseudopodTime < this.pseudopodClientCooldown) {
        this.wasMouseDown = isMouseDown;
        return;
      }

      // Convert screen to world coordinates
      if (this.cameraProjection) {
        const worldPos = this.cameraProjection.screenToWorld(
          this.inputState.pointer.screenX,
          this.inputState.pointer.screenY
        );

        // Emit pseudopod fire intent with target position
        eventBus.emit({
          type: 'client:pseudopodFire',
          targetX: worldPos.x,
          targetY: worldPos.y,
        });

        this.lastPseudopodTime = now;
      }
    }

    this.wasMouseDown = isMouseDown;
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.inputState.dispose();
  }
}
