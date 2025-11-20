/**
 * Current input state snapshot (keyboard + mouse)
 */

/**
 * Current keyboard and mouse state
 */
export class InputState {
  // Keyboard keys currently pressed
  keys = new Set<string>();

  // Mouse state
  mouse = {
    x: 0,
    y: 0,
    buttons: 0, // Bitmask of pressed buttons
    leftButton: false,
    rightButton: false,
    middleButton: false,
  };

  // Pointer lock state
  isPointerLocked = false;

  /**
   * Update key state (pressed)
   */
  keyDown(key: string): void {
    this.keys.add(key.toLowerCase());
  }

  /**
   * Update key state (released)
   */
  keyUp(key: string): void {
    this.keys.delete(key.toLowerCase());
  }

  /**
   * Check if a key is pressed
   */
  isKeyDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  /**
   * Update mouse position
   */
  updateMousePosition(x: number, y: number): void {
    this.mouse.x = x;
    this.mouse.y = y;
  }

  /**
   * Update mouse button state
   */
  updateMouseButtons(buttons: number): void {
    this.mouse.buttons = buttons;
    this.mouse.leftButton = (buttons & 1) !== 0;
    this.mouse.rightButton = (buttons & 2) !== 0;
    this.mouse.middleButton = (buttons & 4) !== 0;
  }

  /**
   * Clear all input state
   */
  reset(): void {
    this.keys.clear();
    this.mouse.x = 0;
    this.mouse.y = 0;
    this.mouse.buttons = 0;
    this.mouse.leftButton = false;
    this.mouse.rightButton = false;
    this.mouse.middleButton = false;
    this.isPointerLocked = false;
  }
}
