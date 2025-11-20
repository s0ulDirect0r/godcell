// ============================================
// Debug Overlay - Performance Metrics Display
// ============================================

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
