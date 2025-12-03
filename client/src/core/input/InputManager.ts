// ============================================
// Input Manager - High-Level Intent Generation
// ============================================

import { InputState } from './InputState';
import { eventBus } from '../events/EventBus';
import type { CombatSpecialization, EvolutionStage } from '@godcell/shared';

export interface CameraProjection {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
}

// Provider for querying local player state (avoids circular dependency)
export interface PlayerStateProvider {
  getStage(): EvolutionStage | null;
  getSpecialization(): CombatSpecialization;
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
  private pseudopodClientCooldown = 300; // Local anti-spam cooldown for Stage 1-2 beams

  private lastProjectileTime = 0;
  private projectileClientCooldown = 333; // Local anti-spam cooldown for Stage 3+ projectiles

  // Track previous movement direction to avoid redundant network updates
  private lastMoveDirection = { x: 0, y: 0, z: 0 };

  // Track previous mouse state (LMB and RMB)
  private wasLMBDown = false;
  private wasRMBDown = false;

  // Cooldowns for combat abilities (Stage 3+)
  private lastMeleeTime = 0;
  private meleeClientCooldown = 200; // Local anti-spam cooldown (matches server 200ms)

  private lastTrapTime = 0;
  private trapClientCooldown = 1000; // Local anti-spam cooldown (matches server 1000ms)

  // Track sprint state (Shift key)
  private wasSprinting = false;

  // Provider for querying local player state
  private playerStateProvider?: PlayerStateProvider;

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
   * Set player state provider (for querying stage/specialization)
   */
  setPlayerStateProvider(provider: PlayerStateProvider): void {
    this.playerStateProvider = provider;
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
    this.updateCombatInput();
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
    let vz = 0;

    // WASD movement
    // In first-person mode: W = forward (camera direction), S = back, A/D = strafe
    // In top-down mode: W = up (+Y), S = down (-Y), A = left (-X), D = right (+X)
    if (this.inputState.isKeyDown('w') || this.inputState.isKeyDown('arrowup')) {
      vy = 1;  // Forward
    }
    if (this.inputState.isKeyDown('s') || this.inputState.isKeyDown('arrowdown')) {
      vy = -1;  // Back
    }
    if (this.inputState.isKeyDown('a') || this.inputState.isKeyDown('arrowleft')) {
      vx = -1;  // Strafe left
    }
    if (this.inputState.isKeyDown('d') || this.inputState.isKeyDown('arrowright')) {
      vx = 1;  // Strafe right
    }

    // Q/E for vertical movement (Stage 5 / Godcell 3D flight)
    // Q = ascend (positive Z), E = descend (negative Z)
    if (this.inputState.isKeyDown('q')) {
      vz = 1;  // Ascend
    }
    if (this.inputState.isKeyDown('e')) {
      vz = -1;  // Descend
    }

    // Normalize diagonal movement (XY plane only for now)
    if (vx !== 0 && vy !== 0) {
      const mag = Math.sqrt(vx * vx + vy * vy);
      vx /= mag;
      vy /= mag;
    }

    // In first-person mode, rotate movement by camera yaw
    // This makes W move in the direction the camera is facing
    if (this.firstPersonMode && (vx !== 0 || vy !== 0)) {
      const yaw = this._firstPersonYaw;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);

      // Rotate (vx, vy) by yaw
      // Input: vx = strafe (A=-1, D=+1), vy = forward/back (W=+1, S=-1)
      // Output: world X and Y based on camera facing direction
      // Standard 2D rotation matrix, but adjusted for our coordinate system
      const worldX = vx * cos - vy * sin;
      const worldY = vx * sin + vy * cos;

      vx = worldX;
      vy = worldY;
    }

    // Only emit if direction changed (reduces network traffic)
    const dirChanged =
      vx !== this.lastMoveDirection.x ||
      vy !== this.lastMoveDirection.y ||
      vz !== this.lastMoveDirection.z;

    if (dirChanged) {
      // Include z in direction (server will ignore for non-Stage-5 players)
      const direction: { x: number; y: number; z?: number } = { x: vx, y: vy };
      if (vz !== 0) {
        direction.z = vz;
      }
      eventBus.emit({ type: 'client:inputMove', direction });
      this.lastMoveDirection = { x: vx, y: vy, z: vz };
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

  /**
   * Handle combat input: LMB and RMB for attacks based on stage and specialization.
   *
   * Stage 1-2: LMB = pseudopod beam
   * Stage 3+ Melee: LMB = swipe, RMB = thrust
   * Stage 3+ Ranged: LMB = projectile
   * Stage 3+ Traps: LMB = projectile, RMB = place trap
   */
  private updateCombatInput(): void {
    const now = Date.now();

    // Get current mouse button states
    const isLMBDown = this.inputState.pointer.isDown && this.inputState.pointer.button === 0;
    const isRMBDown = this.inputState.pointer.isDown && this.inputState.pointer.button === 2;

    // Get player stage and specialization
    const stage = this.playerStateProvider?.getStage() ?? null;
    const specialization = this.playerStateProvider?.getSpecialization() ?? null;

    // Determine if we're Stage 3+ (jungle scale - can use specializations)
    const isJungleStage = stage === 'cyber_organism' || stage === 'humanoid' || stage === 'godcell';

    // Handle LMB (rising edge)
    if (isLMBDown && !this.wasLMBDown) {
      this.handleLMB(now, isJungleStage, specialization);
    }

    // Handle RMB (rising edge)
    if (isRMBDown && !this.wasRMBDown) {
      this.handleRMB(now, isJungleStage, specialization);
    }

    // Update previous state
    this.wasLMBDown = isLMBDown;
    this.wasRMBDown = isRMBDown;
  }

  /**
   * Handle left mouse button click
   */
  private handleLMB(now: number, isJungleStage: boolean, specialization: CombatSpecialization): void {
    if (!this.cameraProjection) return;

    const worldPos = this.cameraProjection.screenToWorld(
      this.inputState.pointer.screenX,
      this.inputState.pointer.screenY
    );

    if (isJungleStage && specialization === 'melee') {
      // Melee: LMB = Swipe (180° arc attack)
      if (now - this.lastMeleeTime < this.meleeClientCooldown) return;

      eventBus.emit({
        type: 'client:meleeAttack',
        attackType: 'swipe',
        targetX: worldPos.x,
        targetY: worldPos.y,
      });
      this.lastMeleeTime = now;

    } else if (isJungleStage) {
      // Stage 3+ (ranged or traps): LMB = projectile
      if (now - this.lastProjectileTime < this.projectileClientCooldown) return;

      eventBus.emit({
        type: 'client:projectileFire',
        targetX: worldPos.x,
        targetY: worldPos.y,
      });
      this.lastProjectileTime = now;

    } else {
      // Stage 1-2: LMB = pseudopod beam
      if (now - this.lastPseudopodTime < this.pseudopodClientCooldown) return;

      eventBus.emit({
        type: 'client:pseudopodFire',
        targetX: worldPos.x,
        targetY: worldPos.y,
      });
      this.lastPseudopodTime = now;
    }
  }

  /**
   * Handle right mouse button click
   */
  private handleRMB(now: number, isJungleStage: boolean, specialization: CombatSpecialization): void {
    if (!this.cameraProjection) return;
    if (!isJungleStage) return; // RMB only used in Stage 3+

    const worldPos = this.cameraProjection.screenToWorld(
      this.inputState.pointer.screenX,
      this.inputState.pointer.screenY
    );

    if (specialization === 'melee') {
      // Melee: RMB = Thrust (30° cone attack)
      if (now - this.lastMeleeTime < this.meleeClientCooldown) return;

      eventBus.emit({
        type: 'client:meleeAttack',
        attackType: 'thrust',
        targetX: worldPos.x,
        targetY: worldPos.y,
      });
      this.lastMeleeTime = now;

    } else if (specialization === 'traps') {
      // Traps: RMB = place trap at player position
      if (now - this.lastTrapTime < this.trapClientCooldown) return;

      eventBus.emit({ type: 'client:placeTrap' });
      this.lastTrapTime = now;
    }
    // Ranged: No RMB action
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.inputState.dispose();
  }
}
