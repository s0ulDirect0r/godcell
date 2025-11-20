/**
 * Tests for InputManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InputManager } from './InputManager';
import { IntentSender } from '../net/IntentSender';

describe('InputManager', () => {
  let inputManager: InputManager;
  let mockIntentSender: IntentSender;

  beforeEach(() => {
    // Create mock intent sender
    mockIntentSender = {
      sendMove: vi.fn(),
      sendRespawnRequest: vi.fn(),
      sendPseudopodExtend: vi.fn(),
      setSocket: vi.fn(),
    } as any;

    inputManager = new InputManager(mockIntentSender);
  });

  describe('Movement intents', () => {
    it('should generate zero movement by default', () => {
      const intent = inputManager.getMoveIntent();
      expect(intent).toEqual({ x: 0, y: 0 });
    });

    it('should generate movement from WASD keys', () => {
      inputManager.handleKeyDown('w');
      expect(inputManager.getMoveIntent()).toEqual({ x: 0, y: -1 });

      inputManager.handleKeyUp('w');
      inputManager.handleKeyDown('s');
      expect(inputManager.getMoveIntent()).toEqual({ x: 0, y: 1 });

      inputManager.handleKeyUp('s');
      inputManager.handleKeyDown('a');
      expect(inputManager.getMoveIntent()).toEqual({ x: -1, y: 0 });

      inputManager.handleKeyUp('a');
      inputManager.handleKeyDown('d');
      expect(inputManager.getMoveIntent()).toEqual({ x: 1, y: 0 });
    });

    it('should generate movement from arrow keys', () => {
      inputManager.handleKeyDown('arrowup');
      expect(inputManager.getMoveIntent()).toEqual({ x: 0, y: -1 });

      inputManager.handleKeyUp('arrowup');
      inputManager.handleKeyDown('arrowdown');
      expect(inputManager.getMoveIntent()).toEqual({ x: 0, y: 1 });

      inputManager.handleKeyUp('arrowdown');
      inputManager.handleKeyDown('arrowleft');
      expect(inputManager.getMoveIntent()).toEqual({ x: -1, y: 0 });

      inputManager.handleKeyUp('arrowleft');
      inputManager.handleKeyDown('arrowright');
      expect(inputManager.getMoveIntent()).toEqual({ x: 1, y: 0 });
    });

    it('should handle diagonal movement', () => {
      inputManager.handleKeyDown('w');
      inputManager.handleKeyDown('d');
      expect(inputManager.getMoveIntent()).toEqual({ x: 1, y: -1 });

      inputManager.handleKeyUp('w');
      inputManager.handleKeyUp('d');
      inputManager.handleKeyDown('s');
      inputManager.handleKeyDown('a');
      expect(inputManager.getMoveIntent()).toEqual({ x: -1, y: 1 });
    });

    it('should only send movement when it changes', () => {
      // Initially lastSentMove = {0, 0}, so no send on first update with no input
      inputManager.update();
      expect(mockIntentSender.sendMove).toHaveBeenCalledTimes(0);

      // Press W - should send on next update
      inputManager.handleKeyDown('w');
      inputManager.update();
      expect(mockIntentSender.sendMove).toHaveBeenCalledTimes(1);
      expect(mockIntentSender.sendMove).toHaveBeenCalledWith({ x: 0, y: -1 });

      // Same movement should not send again
      inputManager.update();
      expect(mockIntentSender.sendMove).toHaveBeenCalledTimes(1);

      // Release W and press D - should send new movement
      inputManager.handleKeyUp('w');
      inputManager.handleKeyDown('d');
      inputManager.update();
      expect(mockIntentSender.sendMove).toHaveBeenCalledTimes(2);
      expect(mockIntentSender.sendMove).toHaveBeenCalledWith({ x: 1, y: 0 });
    });
  });

  describe('Respawn key transition detection', () => {
    it('should return true only on key-down transition', () => {
      // Initially false
      expect(inputManager.isRespawnKeyDownTransition()).toBe(false);

      // Press R key - should return true once
      inputManager.handleKeyDown('r');
      expect(inputManager.isRespawnKeyDownTransition()).toBe(true);

      // While held - should return false
      expect(inputManager.isRespawnKeyDownTransition()).toBe(false);
      expect(inputManager.isRespawnKeyDownTransition()).toBe(false);

      // Release R key - must call transition check to reset flag
      inputManager.handleKeyUp('r');
      expect(inputManager.isRespawnKeyDownTransition()).toBe(false);

      // Press again - should return true again
      inputManager.handleKeyDown('r');
      expect(inputManager.isRespawnKeyDownTransition()).toBe(true);

      // While held again - should return false
      expect(inputManager.isRespawnKeyDownTransition()).toBe(false);
    });

    it('should only send respawn request once per key press', () => {
      // Simulate tick loop with R key held
      inputManager.handleKeyDown('r');

      // First tick - should send
      if (inputManager.isRespawnKeyDownTransition()) {
        inputManager.requestRespawn();
      }
      expect(mockIntentSender.sendRespawnRequest).toHaveBeenCalledTimes(1);

      // Next 60 ticks (1 second at 60Hz) - should NOT send
      for (let i = 0; i < 60; i++) {
        if (inputManager.isRespawnKeyDownTransition()) {
          inputManager.requestRespawn();
        }
      }
      expect(mockIntentSender.sendRespawnRequest).toHaveBeenCalledTimes(1);

      // Release key (must check transition to reset flag)
      inputManager.handleKeyUp('r');
      inputManager.isRespawnKeyDownTransition(); // Reset flag

      // Press again - should send once more
      inputManager.handleKeyDown('r');
      if (inputManager.isRespawnKeyDownTransition()) {
        inputManager.requestRespawn();
      }
      expect(mockIntentSender.sendRespawnRequest).toHaveBeenCalledTimes(2);
    });

    it('should reset respawn flag on reset()', () => {
      inputManager.handleKeyDown('r');
      expect(inputManager.isRespawnKeyDownTransition()).toBe(true);

      // Reset should clear the flag
      inputManager.reset();

      // Even though R is still "down" in state, reset cleared the flag
      // so next check should return true (treats as new press)
      inputManager.handleKeyDown('r');
      expect(inputManager.isRespawnKeyDownTransition()).toBe(true);
    });
  });

  describe('isRespawnRequested (legacy)', () => {
    it('should return true while R key is held', () => {
      expect(inputManager.isRespawnRequested()).toBe(false);

      inputManager.handleKeyDown('r');
      expect(inputManager.isRespawnRequested()).toBe(true);
      expect(inputManager.isRespawnRequested()).toBe(true);

      inputManager.handleKeyUp('r');
      expect(inputManager.isRespawnRequested()).toBe(false);
    });
  });

  describe('Mouse input', () => {
    it('should track mouse position', () => {
      inputManager.handleMouseMove(100, 200);
      const state = inputManager.getInputState();
      expect(state.mouse.x).toBe(100);
      expect(state.mouse.y).toBe(200);
    });

    it('should track mouse buttons', () => {
      inputManager.handleMouseButtons(1); // Left button
      const state = inputManager.getInputState();
      expect(state.mouse.buttons).toBe(1);
      expect(state.mouse.leftButton).toBe(true);
    });

    it('should send pseudopod extend intent on click', () => {
      inputManager.handleMouseClick(500, 300);
      expect(mockIntentSender.sendPseudopodExtend).toHaveBeenCalledWith(500, 300);
    });
  });
});
