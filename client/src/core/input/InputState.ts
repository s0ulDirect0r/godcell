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

  // Pointer lock state (for first-person mouse look)
  pointerLock = {
    isLocked: false,
    deltaX: 0, // Mouse movement since last frame
    deltaY: 0,
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

    // Mouse movement - accumulate deltas when pointer locked
    window.addEventListener('mousemove', (e) => {
      this.pointer.screenX = e.clientX;
      this.pointer.screenY = e.clientY;

      // Accumulate deltas when pointer is locked (for FPS look)
      if (this.pointerLock.isLocked) {
        this.pointerLock.deltaX += e.movementX;
        this.pointerLock.deltaY += e.movementY;
      }
    });

    window.addEventListener('mousedown', (e) => {
      this.pointer.isDown = true;
      this.pointer.button = e.button;
    });

    window.addEventListener('mouseup', () => {
      this.pointer.isDown = false;
      this.pointer.button = -1;
    });

    // Pointer lock change event
    document.addEventListener('pointerlockchange', () => {
      this.pointerLock.isLocked = document.pointerLockElement !== null;
      // Reset deltas when lock state changes
      this.pointerLock.deltaX = 0;
      this.pointerLock.deltaY = 0;
    });

    // Prevent default on space (prevents page scroll)
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
      }
    });

    // Prevent context menu on right-click (needed for RMB game actions)
    window.addEventListener('contextmenu', (e) => {
      // Only prevent on game canvas, allow on UI elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'CANVAS' || target.closest('canvas')) {
        e.preventDefault();
      }
    });
  }

  /**
   * Consume accumulated mouse deltas (call once per frame after reading)
   * Returns the deltas and resets them to 0
   */
  consumeMouseDelta(): { deltaX: number; deltaY: number } {
    const result = {
      deltaX: this.pointerLock.deltaX,
      deltaY: this.pointerLock.deltaY,
    };
    this.pointerLock.deltaX = 0;
    this.pointerLock.deltaY = 0;
    return result;
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
