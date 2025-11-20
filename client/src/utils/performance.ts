// ============================================
// Performance Monitoring
// ============================================

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
    const memMB = metrics.memoryUsage ? (metrics.memoryUsage / 1024 / 1024).toFixed(1) : 'N/A';
    console.log(`[Perf] FPS: ${metrics.fps} | Frame: ${metrics.avgFrameTime}ms | Mem: ${memMB}MB`);
  }
}
