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

  // Handler references for cleanup (prevents memory leaks)
  private keydownHandler: (e: KeyboardEvent) => void;
  private keyupHandler: (e: KeyboardEvent) => void;
  private mousemoveHandler: (e: MouseEvent) => void;
  private mousedownHandler: (e: MouseEvent) => void;
  private mouseupHandler: () => void;
  private pointerlockHandler: () => void;
  private spacePreventHandler: (e: KeyboardEvent) => void;
  private contextmenuHandler: (e: MouseEvent) => void;

  constructor() {
    // Store handler references so they can be removed in dispose()
    this.keydownHandler = (e: KeyboardEvent) => {
      this.keys.add(e.key.toLowerCase());
    };

    this.keyupHandler = (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase());
    };

    this.mousemoveHandler = (e: MouseEvent) => {
      this.pointer.screenX = e.clientX;
      this.pointer.screenY = e.clientY;

      // Accumulate deltas when pointer is locked (for FPS look)
      if (this.pointerLock.isLocked) {
        this.pointerLock.deltaX += e.movementX;
        this.pointerLock.deltaY += e.movementY;
      }
    };

    this.mousedownHandler = (e: MouseEvent) => {
      this.pointer.isDown = true;
      this.pointer.button = e.button;
    };

    this.mouseupHandler = () => {
      this.pointer.isDown = false;
      this.pointer.button = -1;
    };

    this.pointerlockHandler = () => {
      this.pointerLock.isLocked = document.pointerLockElement !== null;
      // Reset deltas when lock state changes
      this.pointerLock.deltaX = 0;
      this.pointerLock.deltaY = 0;
    };

    this.spacePreventHandler = (e: KeyboardEvent) => {
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
      }
    };

    this.contextmenuHandler = (e: MouseEvent) => {
      // Only prevent on game canvas, allow on UI elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'CANVAS' || target.closest('canvas')) {
        e.preventDefault();
      }
    };

    this.setupListeners();
  }

  private setupListeners(): void {
    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
    window.addEventListener('mousemove', this.mousemoveHandler);
    window.addEventListener('mousedown', this.mousedownHandler);
    window.addEventListener('mouseup', this.mouseupHandler);
    document.addEventListener('pointerlockchange', this.pointerlockHandler);
    window.addEventListener('keydown', this.spacePreventHandler);
    window.addEventListener('contextmenu', this.contextmenuHandler);
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
   * Clean up listeners (prevents memory leaks on game restart)
   */
  dispose(): void {
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
    window.removeEventListener('mousemove', this.mousemoveHandler);
    window.removeEventListener('mousedown', this.mousedownHandler);
    window.removeEventListener('mouseup', this.mouseupHandler);
    document.removeEventListener('pointerlockchange', this.pointerlockHandler);
    window.removeEventListener('keydown', this.spacePreventHandler);
    window.removeEventListener('contextmenu', this.contextmenuHandler);
  }
}
