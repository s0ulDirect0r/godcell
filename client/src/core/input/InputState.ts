// ============================================
// Input State - Raw Keyboard + Mouse State
// ============================================

export class InputState {
  // Keyboard state
  readonly keys: Set<string> = new Set();

  // Mouse state
  pointer = {
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    isDown: false,
    button: -1,
  };

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    // Mouse
    window.addEventListener('mousemove', (e) => {
      this.pointer.screenX = e.clientX;
      this.pointer.screenY = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      this.pointer.isDown = true;
      this.pointer.button = e.button;
    });

    window.addEventListener('mouseup', () => {
      this.pointer.isDown = false;
      this.pointer.button = -1;
    });

    // Prevent default on space (prevents page scroll)
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
      }
    });
  }

  /**
   * Check if key is pressed
   */
  isKeyDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  /**
   * Clean up listeners
   */
  dispose(): void {
    // Note: Remove all listeners if needed
    // For now, leaving as-is since GameScene persists
  }
}
