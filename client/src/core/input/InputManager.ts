/**
 * Input manager - maps raw input to high-level intents.
 * Maintains current input state and provides intent queries.
 */

import { InputState } from './InputState';
import type { IntentSender } from '../net/IntentSender';

/**
 * Movement intent (normalized direction vector)
 */
export interface MoveIntent {
  x: number; // -1, 0, or 1
  y: number; // -1, 0, or 1
}

/**
 * Action intent (e.g., extend pseudopod, evolve)
 */
export interface ActionIntent {
  type: 'pseudopod' | 'respawn';
  data?: any;
}

/**
 * Manages input state and intent generation
 */
export class InputManager {
  private inputState = new InputState();
  private intentSender: IntentSender | null = null;

  // Track last sent movement to avoid spamming server
  private lastSentMove = { x: 0, y: 0 };

  // Track respawn key state to avoid spamming server (only send on key-down transition)
  private respawnSent = false;

  constructor(intentSender?: IntentSender) {
    if (intentSender) {
      this.intentSender = intentSender;
    }
  }

  /**
   * Set the intent sender (for sending intents to server)
   */
  setIntentSender(intentSender: IntentSender): void {
    this.intentSender = intentSender;
  }

  /**
   * Get current input state (read-only)
   */
  getInputState(): InputState {
    return this.inputState;
  }

  /**
   * Handle keydown event
   */
  handleKeyDown(key: string): void {
    this.inputState.keyDown(key);
  }

  /**
   * Handle keyup event
   */
  handleKeyUp(key: string): void {
    this.inputState.keyUp(key);
  }

  /**
   * Handle mouse move event
   */
  handleMouseMove(x: number, y: number): void {
    this.inputState.updateMousePosition(x, y);
  }

  /**
   * Handle mouse button event
   */
  handleMouseButtons(buttons: number): void {
    this.inputState.updateMouseButtons(buttons);
  }

  /**
   * Handle mouse click event (for actions like pseudopod extension)
   */
  handleMouseClick(worldX: number, worldY: number): void {
    // Send pseudopod extend intent
    if (this.intentSender) {
      this.intentSender.sendPseudopodExtend(worldX, worldY);
    }
  }

  /**
   * Update input manager (called every frame)
   * Sends movement intents to server
   */
  update(): void {
    const moveIntent = this.getMoveIntent();

    // Only send if movement changed
    if (
      moveIntent.x !== this.lastSentMove.x ||
      moveIntent.y !== this.lastSentMove.y
    ) {
      if (this.intentSender) {
        this.intentSender.sendMove(moveIntent);
      }
      this.lastSentMove = { ...moveIntent };
    }
  }

  /**
   * Get current movement intent from keyboard state
   */
  getMoveIntent(): MoveIntent {
    let x = 0;
    let y = 0;

    // WASD or Arrow keys
    if (
      this.inputState.isKeyDown('w') ||
      this.inputState.isKeyDown('arrowup')
    ) {
      y = -1;
    }
    if (
      this.inputState.isKeyDown('s') ||
      this.inputState.isKeyDown('arrowdown')
    ) {
      y = 1;
    }
    if (
      this.inputState.isKeyDown('a') ||
      this.inputState.isKeyDown('arrowleft')
    ) {
      x = -1;
    }
    if (
      this.inputState.isKeyDown('d') ||
      this.inputState.isKeyDown('arrowright')
    ) {
      x = 1;
    }

    return { x, y };
  }

  /**
   * Check if respawn key is pressed (R key)
   */
  isRespawnRequested(): boolean {
    return this.inputState.isKeyDown('r');
  }

  /**
   * Check if respawn key was just pressed (key-down transition only)
   * Returns true only once per key press, not while held
   */
  isRespawnKeyDownTransition(): boolean {
    const isKeyDown = this.inputState.isKeyDown('r');

    // Key-down transition: key is down AND we haven't sent yet
    if (isKeyDown && !this.respawnSent) {
      this.respawnSent = true;
      return true;
    }

    // Key released: reset flag for next press
    if (!isKeyDown && this.respawnSent) {
      this.respawnSent = false;
    }

    return false;
  }

  /**
   * Send respawn request
   */
  requestRespawn(): void {
    if (this.intentSender) {
      this.intentSender.sendRespawnRequest();
    }
  }

  /**
   * Reset input state
   */
  reset(): void {
    this.inputState.reset();
    this.lastSentMove = { x: 0, y: 0 };
    this.respawnSent = false;
  }
}
