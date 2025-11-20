# Phase 4: Renderer Contract + Phaser Adapter

**Estimated Time:** 2 hours
**Dependencies:** Phase 3 (Input Manager Extraction) must be complete

## Overview

Define a renderer-agnostic contract and wrap existing Phaser rendering logic behind it. GameScene becomes a thin bootstrap layer that wires core systems together and delegates rendering to a `PhaserRenderer` adapter. This is the critical phase that decouples rendering from game logic.

## Goals

1. Define `Renderer` interface contract
2. Move all Phaser rendering code into `PhaserRenderer` class
3. GameScene becomes orchestration layer (bootstrap + update loop)
4. Test that game still works with rendering abstracted

## Files to Create

### `client/src/render/Renderer.ts`
Renderer contract interface.

```typescript
import type { GameState } from '../core/state/GameState';

export interface CameraCapabilities {
  mode: 'topdown' | 'orbit' | 'tps' | 'fps';
  supports3D: boolean;
}

export interface Renderer {
  /**
   * Initialize renderer
   * @param container DOM element to render into
   * @param width Canvas width
   * @param height Canvas height
   */
  init(container: HTMLElement, width: number, height: number): void;

  /**
   * Render one frame
   * @param state Current game state
   * @param dt Delta time (milliseconds)
   */
  render(state: GameState, dt: number): void;

  /**
   * Resize canvas
   */
  resize(width: number, height: number): void;

  /**
   * Get camera capabilities
   */
  getCameraCapabilities(): CameraCapabilities;

  /**
   * Get camera projection for input (screen ↔ world)
   */
  getCameraProjection(): {
    screenToWorld(screenX: number, screenY: number): { x: number; y: number };
    worldToScreen(worldX: number, worldY: number): { x: number; y: number };
  };

  /**
   * Clean up resources
   */
  dispose(): void;
}
```

### `client/src/render/phaser/PhaserRenderer.ts`
Phaser implementation of renderer contract.

```typescript
import Phaser from 'phaser';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG } from '@godcell/shared';

/**
 * Phaser-based renderer (temporary during migration)
 * Eventually this will be deleted in favor of ThreeRenderer
 */
export class PhaserRenderer implements Renderer {
  private game!: Phaser.Game;
  private scene!: PhaserRenderScene;

  init(container: HTMLElement, width: number, height: number): void {
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: container,
      width,
      height,
      backgroundColor: GAME_CONFIG.BACKGROUND_COLOR,
      scene: [PhaserRenderScene],
      physics: {
        default: 'arcade',
        arcade: {
          debug: false,
        },
      },
    };

    this.game = new Phaser.Game(config);
    this.scene = this.game.scene.getScene('PhaserRenderScene') as PhaserRenderScene;
  }

  render(state: GameState, dt: number): void {
    // Phaser handles rendering in its own update loop
    // We'll pass state to the scene for rendering
    this.scene.renderState(state, dt);
  }

  resize(width: number, height: number): void {
    this.game.scale.resize(width, height);
  }

  getCameraCapabilities(): CameraCapabilities {
    return {
      mode: 'topdown',
      supports3D: false,
    };
  }

  getCameraProjection() {
    const cam = this.scene.cameras.main;
    return {
      screenToWorld: (screenX: number, screenY: number) => ({
        x: cam.scrollX + screenX / cam.zoom,
        y: cam.scrollY + screenY / cam.zoom,
      }),
      worldToScreen: (worldX: number, worldY: number) => ({
        x: (worldX - cam.scrollX) * cam.zoom,
        y: (worldY - cam.scrollY) * cam.zoom,
      }),
    };
  }

  dispose(): void {
    this.game.destroy(true);
  }
}

/**
 * Internal Phaser scene for rendering
 */
class PhaserRenderScene extends Phaser.Scene {
  // Move ALL rendering logic from GameScene here
  // Players, nutrients, obstacles, swarms, trails, particles, etc.

  constructor() {
    super({ key: 'PhaserRenderScene' });
  }

  // ... (copy rendering logic from GameScene.ts)
  // This is ~1000 lines of sprite management, trails, interpolation

  renderState(state: GameState, dt: number): void {
    // Update player sprites from state
    // Update nutrient sprites from state
    // Update obstacle sprites from state
    // Update swarm sprites from state
    // Render trails
    // Update camera follow
    // ... all rendering logic
  }
}
```

**Note:** The full `PhaserRenderScene` implementation will be copied from `GameScene.ts` - it's a big chunk of code (~1000 lines) that's mostly mechanical copying.

## Files to Modify

### `client/src/main.ts`
Bootstrap using renderer contract.

```typescript
import { GameState } from './core/state/GameState';
import { SocketManager } from './core/net/SocketManager';
import { InputManager } from './core/input/InputManager';
import { PhaserRenderer } from './render/phaser/PhaserRenderer';
import { PerformanceMonitor } from './utils/performance';
import { getRendererFlags } from './config/renderer-flags';
import { DebugOverlay } from './ui/DebugOverlay';

const flags = getRendererFlags();
const perfMonitor = new PerformanceMonitor();
let debugOverlay: DebugOverlay | null = null;

if (flags.showDebugOverlay) {
  debugOverlay = new DebugOverlay();
}

// Initialize core systems
const gameState = new GameState();
const inputManager = new InputManager();

const serverUrl = import.meta.env.DEV
  ? 'http://localhost:3000'
  : window.location.origin;
const socketManager = new SocketManager(serverUrl, gameState);

// Initialize renderer
const renderer = new PhaserRenderer();
const container = document.getElementById('game-container')!;
renderer.init(container, 1200, 800);

// Wire input manager with renderer's camera projection
inputManager.setCameraProjection(renderer.getCameraProjection());

// Main update loop
function update(): void {
  const dt = 16; // Approx 60fps

  perfMonitor.tick();

  // Update systems
  inputManager.update(dt);

  // Render
  renderer.render(gameState, dt);

  // Debug overlay
  if (debugOverlay) {
    debugOverlay.update(perfMonitor.getMetrics(), flags.mode);
  }

  requestAnimationFrame(update);
}

// Start loop
update();

console.log(`[Init] Renderer mode: ${flags.mode}`);
```

### `client/src/scenes/GameScene.ts`
**This file can be deleted or gutted** - all logic moved to `PhaserRenderer` and `main.ts`.

## Test Cases

### Manual Testing

```bash
npm run dev
# Open: http://localhost:8080

# Verify:
# - Game loads and looks identical
# - All rendering works (players, nutrients, obstacles, swarms, trails)
# - Movement works
# - Camera follows player
# - Death/respawn works
# - No console errors
# - FPS unchanged (check debug overlay)
```

## Acceptance Criteria

- [ ] Renderer interface defined
- [ ] PhaserRenderer implements interface
- [ ] All Phaser rendering code moved to PhaserRenderer
- [ ] GameScene deleted or becomes minimal
- [ ] main.ts orchestrates core + renderer
- [ ] Game visually identical to Phase 3
- [ ] All gameplay works
- [ ] No FPS regressions

## Implementation Notes

**Gotchas:**
- This is the biggest code move of the migration (~1000 lines)
- Mechanical copying - easy to miss a sprite type or handler
- Test thoroughly after moving code
- Camera projection must be wired to InputManager

**Architecture benefits:**
- GameScene no longer exists (or is minimal)
- Phaser is now isolated in render/phaser/
- Can swap to Three.js without touching core logic
- Renderer contract makes testing easier (can mock renderer)

**Big refactor:**
This phase involves moving a lot of code. Take time to:
1. Copy rendering logic methodically
2. Test each entity type (players, nutrients, obstacles, swarms)
3. Verify trails, particles, camera follow all work

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Delete client/src/render/Renderer.ts
# 2. Delete client/src/render/phaser/PhaserRenderer.ts
# 3. Revert client/src/main.ts
# 4. Restore client/src/scenes/GameScene.ts from Phase 3
```

## Next Phase

Once this phase is approved, proceed to **Phase 5: Three.js Proof-of-Concept**.
