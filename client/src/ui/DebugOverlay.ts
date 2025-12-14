// ============================================
// Debug Overlay - Performance Metrics Display
// ============================================

import type { PerformanceMetrics } from '../utils/performance';

// Valid renderer modes - extend this list as new modes are added
type RendererMode = 'three-only' | 'phaser-only' | 'hybrid';
const VALID_RENDERER_MODES: ReadonlySet<string> = new Set<RendererMode>([
  'three-only',
  'phaser-only',
  'hybrid',
]);

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
   * Uses safe DOM APIs to prevent XSS - never uses innerHTML with user-controlled data
   */
  update(metrics: PerformanceMetrics, rendererMode: string): void {
    // Validate renderer mode against known values to prevent XSS
    const safeRendererMode = VALID_RENDERER_MODES.has(rendererMode) ? rendererMode : 'unknown';
    const memMB = metrics.memoryUsage ? (metrics.memoryUsage / 1024 / 1024).toFixed(1) : 'N/A';

    // Clear previous content
    this.container.textContent = '';

    // Build overlay using safe DOM APIs
    const rendererDiv = document.createElement('div');
    rendererDiv.textContent = `Renderer: ${safeRendererMode}`;

    const fpsDiv = document.createElement('div');
    fpsDiv.textContent = `FPS: ${metrics.fps}`;

    const frameDiv = document.createElement('div');
    frameDiv.textContent = `Frame: ${metrics.avgFrameTime}ms`;

    const memDiv = document.createElement('div');
    memDiv.textContent = `Memory: ${memMB}MB`;

    // Append all elements
    this.container.appendChild(rendererDiv);
    this.container.appendChild(fpsDiv);
    this.container.appendChild(frameDiv);
    this.container.appendChild(memDiv);
  }

  /**
   * Remove overlay from DOM
   */
  dispose(): void {
    this.container.remove();
  }
}
