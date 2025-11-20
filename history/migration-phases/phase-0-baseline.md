# Phase 0: Baseline + Guardrails

**Estimated Time:** 0.5 hours
**Dependencies:** None (first phase)

## Overview

Establish baseline performance metrics and runtime toggles before making any architectural changes. This gives us reference points to detect regressions and allows safe experimentation during dual-render phases.

## Goals

1. Capture baseline FPS and memory usage
2. Create runtime flags to toggle between renderers
3. Document current visual state as reference
4. Set up infrastructure for A/B comparison

## Files to Create

### `client/src/utils/performance.ts`
Performance monitoring utilities.

```typescript
export interface PerformanceMetrics {
  fps: number;
  avgFrameTime: number;
  memoryUsage?: number;
  timestamp: number;
}

export class PerformanceMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private frameTimes: number[] = [];
  private readonly maxSamples = 60;

  /**
   * Call once per frame to track FPS
   */
  tick(): void {
    const now = performance.now();
    const delta = now - this.lastTime;

    this.frameTimes.push(delta);
    if (this.frameTimes.length > this.maxSamples) {
      this.frameTimes.shift();
    }

    this.frameCount++;
    this.lastTime = now;
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): PerformanceMetrics {
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = 1000 / avgFrameTime;

    // @ts-ignore - performance.memory is non-standard but available in Chrome
    const memoryUsage = performance.memory?.usedJSHeapSize;

    return {
      fps: Math.round(fps),
      avgFrameTime: Math.round(avgFrameTime * 100) / 100,
      memoryUsage,
      timestamp: Date.now(),
    };
  }

  /**
   * Log metrics to console
   */
  log(): void {
    const metrics = this.getMetrics();
    console.log(`[Perf] FPS: ${metrics.fps} | Frame: ${metrics.avgFrameTime}ms | Mem: ${(metrics.memoryUsage || 0) / 1024 / 1024}MB`);
  }
}
```

### `client/src/config/renderer-flags.ts`
Runtime flags for renderer selection.

```typescript
export type RendererMode = 'phaser-only' | 'hybrid' | 'three-only';

export interface RendererFlags {
  mode: RendererMode;
  showDebugOverlay: boolean;
  captureBaseline: boolean;
}

/**
 * Get renderer mode from URL params or localStorage
 * Priority: URL params > localStorage > default
 */
export function getRendererFlags(): RendererFlags {
  const params = new URLSearchParams(window.location.search);
  const stored = localStorage.getItem('renderer-mode');

  const mode = (params.get('renderer') || stored || 'phaser-only') as RendererMode;
  const showDebugOverlay = params.has('debug') || localStorage.getItem('debug-overlay') === 'true';
  const captureBaseline = params.has('baseline');

  // Persist to localStorage
  localStorage.setItem('renderer-mode', mode);
  if (showDebugOverlay) {
    localStorage.setItem('debug-overlay', 'true');
  }

  return { mode, showDebugOverlay, captureBaseline };
}

/**
 * Set renderer mode and reload
 */
export function setRendererMode(mode: RendererMode): void {
  localStorage.setItem('renderer-mode', mode);
  window.location.reload();
}
```

### `client/src/ui/DebugOverlay.ts`
DOM-based debug overlay for performance metrics.

```typescript
import type { PerformanceMetrics } from '../utils/performance';

export class DebugOverlay {
  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border: 1px solid #0f0;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
  }

  /**
   * Update overlay with current metrics
   */
  update(metrics: PerformanceMetrics, rendererMode: string): void {
    const memMB = metrics.memoryUsage ? (metrics.memoryUsage / 1024 / 1024).toFixed(1) : 'N/A';

    this.container.innerHTML = `
      <div>Renderer: ${rendererMode}</div>
      <div>FPS: ${metrics.fps}</div>
      <div>Frame: ${metrics.avgFrameTime}ms</div>
      <div>Memory: ${memMB}MB</div>
    `;
  }

  /**
   * Remove overlay from DOM
   */
  dispose(): void {
    this.container.remove();
  }
}
```

## Files to Modify

### `client/src/main.ts`
Add performance monitoring and renderer flags.

```typescript
import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { GAME_CONFIG } from '@godcell/shared';
import { PerformanceMonitor } from './utils/performance';
import { getRendererFlags } from './config/renderer-flags';
import { DebugOverlay } from './ui/DebugOverlay';

const flags = getRendererFlags();
const perfMonitor = new PerformanceMonitor();
let debugOverlay: DebugOverlay | null = null;

if (flags.showDebugOverlay) {
  debugOverlay = new DebugOverlay();
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_CONFIG.VIEWPORT_WIDTH,
  height: GAME_CONFIG.VIEWPORT_HEIGHT,
  backgroundColor: GAME_CONFIG.BACKGROUND_COLOR,
  scene: [GameScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  callbacks: {
    postRender: () => {
      perfMonitor.tick();

      if (debugOverlay) {
        debugOverlay.update(perfMonitor.getMetrics(), flags.mode);
      }

      // Capture baseline metrics after 10 seconds
      if (flags.captureBaseline && performance.now() > 10000) {
        perfMonitor.log();
        console.log('[Baseline] Metrics captured after 10s');
        flags.captureBaseline = false; // Only log once
      }
    },
  },
};

console.log(`[Init] Renderer mode: ${flags.mode}`);
new Phaser.Game(config);
```

### `client/src/scenes/GameScene.ts`
No logic changes, just expose renderer mode for future phases.

Add near the top of the class:
```typescript
// Renderer mode (for future dual-render support)
private rendererMode: RendererMode = 'phaser-only';

constructor() {
  super({ key: 'GameScene' });
  const flags = getRendererFlags();
  this.rendererMode = flags.mode;
}
```

## Test Cases

### Manual Testing

**Baseline capture:**
```bash
npm run dev
# Open: http://localhost:8080?baseline
# Play for 10+ seconds
# Check console for baseline metrics logged
```

**Debug overlay:**
```bash
npm run dev
# Open: http://localhost:8080?debug
# Verify overlay appears in top-right
# Check FPS/memory update each frame
```

**Renderer mode toggle:**
```bash
# Test all three modes (should all work with Phaser for now)
http://localhost:8080?renderer=phaser-only
http://localhost:8080?renderer=hybrid
http://localhost:8080?renderer=three-only

# Verify localStorage persists mode across reloads
```

### Expected Baseline Metrics

Approximate targets on modern hardware:
- **FPS:** 55-60 (vsync limited)
- **Frame time:** 16-18ms
- **Memory:** 30-50MB initially, stabilizing under 100MB

Document your actual baseline in a `BASELINE.md` file for reference.

## Acceptance Criteria

- [ ] Performance monitor tracks FPS and memory accurately
- [ ] Debug overlay renders and updates every frame
- [ ] URL param `?baseline` logs metrics after 10 seconds
- [ ] URL param `?debug` shows debug overlay
- [ ] URL param `?renderer=X` sets mode (verified via console log)
- [ ] Game behavior is **completely unchanged**
- [ ] No visual differences
- [ ] Baseline metrics documented

## Implementation Notes

**Gotchas:**
- `performance.memory` is non-standard (Chrome/Edge only) - gracefully handle undefined
- Debug overlay must have high z-index to render over game canvas
- Phaser's `postRender` callback fires after every frame render
- Don't call `perfMonitor.log()` every frame - too much console spam

**Performance considerations:**
- Performance monitoring overhead should be negligible (<0.1ms per frame)
- Debug overlay updates are cheap (just innerHTML assignments)

**Browser compatibility:**
- Use `performance.now()` (universally supported)
- Fallback for memory metrics when unavailable

## Rollback Instructions

```bash
# If this phase causes issues:
git revert HEAD

# Or manually:
# 1. Delete client/src/utils/performance.ts
# 2. Delete client/src/config/renderer-flags.ts
# 3. Delete client/src/ui/DebugOverlay.ts
# 4. Revert changes to client/src/main.ts
# 5. Revert changes to client/src/scenes/GameScene.ts
```

## Next Phase

Once this phase is approved, proceed to **Phase 1: Core State + Message Contract**.
