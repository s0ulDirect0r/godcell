# Phase 3: Input Manager Extraction

**Estimated Time:** 1 hour
**Dependencies:** Phase 2 (Socket Manager Extraction) must be complete

## Overview

Extract keyboard/mouse input handling from GameScene into a dedicated `InputManager` class. This class owns all input state, handles camera projection (world ↔ screen coordinates), and emits high-level intents. Focus is on the architecture - gameplay mechanics (like pseudopods) can be refined later.

## Goals

1. Move input handling out of GameScene
2. Generate high-level intents (move, respawn) instead of raw input
3. Support camera projection adapters for world ↔ screen mapping
4. Add cooldown gating for rate-limited actions
5. Prepare for 3D camera modes (raycast hooks)

## Files to Create

### `client/src/core/input/InputState.ts`

Raw input state (keyboard + mouse).

```typescript
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
```

### `client/src/core/input/InputManager.ts`

High-level input intent generation with camera projection.

```typescript
import { InputState } from './InputState';
import { eventBus } from '../events/EventBus';

export interface CameraProjection {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
}

export interface MoveIntent {
  vx: number;
  vy: number;
}

export class InputManager {
  private inputState: InputState;
  private cameraProjection: CameraProjection | null = null;

  // Cooldowns
  private lastRespawnKeyTime = 0;
  private respawnKeyCooldown = 300; // Prevent key spam

  constructor() {
    this.inputState = new InputState();
  }

  /**
   * Set camera projection adapter (for screen ↔ world conversion)
   */
  setCameraProjection(projection: CameraProjection): void {
    this.cameraProjection = projection;
  }

  /**
   * Update input state and emit intents
   * Call this every frame
   */
  update(dt: number): void {
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

    // Emit move intent (even if vx=0, vy=0 to stop movement)
    eventBus.emit<MoveIntent>('input:move', { vx, vy });
  }

  private updateRespawn(): void {
    const now = Date.now();

    if (this.inputState.isKeyDown('r')) {
      // Check cooldown (prevent key-down spam)
      if (now - this.lastRespawnKeyTime < this.respawnKeyCooldown) {
        return;
      }

      // Emit respawn intent
      eventBus.emit('input:respawn');

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
```

## Files to Modify

### `client/src/scenes/GameScene.ts`

Remove input handling, consume intents via EventBus.

**Remove:**

- Keyboard cursors setup
- Mouse/pointer event listeners
- Input handling in `update()`

**Add at top of class:**

```typescript
import { InputManager, CameraProjection } from '../core/input/InputManager';
import type { MoveIntent } from '../core/input/InputManager';

private inputManager!: InputManager;
```

**In `create()` method:**

```typescript
// Initialize input manager
this.inputManager = new InputManager();

// Set camera projection adapter
const cameraProjection: CameraProjection = {
  screenToWorld: (screenX: number, screenY: number) => {
    const cam = this.cameras.main;
    return {
      x: cam.scrollX + screenX / cam.zoom,
      y: cam.scrollY + screenY / cam.zoom,
    };
  },
  worldToScreen: (worldX: number, worldY: number) => {
    const cam = this.cameras.main;
    return {
      x: (worldX - cam.scrollX) * cam.zoom,
      y: (worldY - cam.scrollY) * cam.zoom,
    };
  },
};
this.inputManager.setCameraProjection(cameraProjection);

// Subscribe to input intents
eventBus.on<MoveIntent>('input:move', this.onMoveIntent.bind(this));
eventBus.on('input:respawn', this.onRespawnIntent.bind(this));
```

**Add intent handlers:**

```typescript
private onMoveIntent(intent: MoveIntent): void {
  this.socketManager.sendMove(intent.vx, intent.vy);
}

private onRespawnIntent(): void {
  this.socketManager.sendRespawn();
}
```

**In `update()` method:**

```typescript
// Remove all input handling code

// Add:
this.inputManager.update(delta);
```

**In `shutdown()` method:**

```typescript
this.inputManager.dispose();
```

## Test Cases

### Manual Testing

```bash
npm run dev
# Open: http://localhost:8080

# Test movement:
# - WASD keys move player
# - Arrow keys move player
# - Diagonal movement normalized (not faster)
# - Releasing keys stops movement

# Test respawn:
# - Die (let energy reach 0)
# - Press R key
# - Should respawn
# - Holding R doesn't spam respawn
```

### Edge Cases

```bash
# Test multiple keys:
# - Hold W+D (diagonal)
# - Should move at same speed as W or D alone

# Test cooldowns:
# - Spam R key - only one respawn per keypress
```

## Acceptance Criteria

- [ ] InputManager class created
- [ ] InputState tracks keyboard/mouse
- [ ] Camera projection adapter works for screen ↔ world conversion
- [ ] Movement intents emitted every frame
- [ ] Respawn intent respects key-down transition detection
- [ ] GameScene no longer handles raw input
- [ ] Game feels identical to Phase 2
- [ ] No double-handling of input

## Implementation Notes

**Gotchas:**

- Respawn key must detect key-down transitions, not continuous holds
- Camera projection adapter is specific to Phaser - will be replaced in Phase 5 for Three.js
- Diagonal movement normalization prevents speed exploits
- Pseudopod/click mechanics can be added later - focus on architecture now

**Architecture benefits:**

- Input handling is now testable (can mock InputState)
- Camera projection is abstracted (supports 2D ortho and future 3D raycast)
- High-level intents make GameScene simpler
- Easy to add new input actions (just emit new intent types)

**Future 3D support:**
For 3D cameras (orbit/TPS/FPS), the CameraProjection adapter will use raycasts:

```typescript
screenToWorld: (screenX, screenY) => {
  const raycaster = new THREE.Raycaster();
  // ... raycast to ground plane z=0
  return { x: intersection.x, y: intersection.y };
};
```

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Delete client/src/core/input/InputState.ts
# 2. Delete client/src/core/input/InputManager.ts
# 3. Revert client/src/scenes/GameScene.ts to Phase 2 version
# 4. Restore input handling in GameScene
```

## Next Phase

Once this phase is approved, proceed to **Phase 4: Renderer Contract + Phaser Adapter**.
