/**
 * Main render loop with fixed-step accumulator.
 * Matches server tick rate for deterministic simulation.
 */

import { CLIENT_CONFIG } from '../../core/config/clientConfig';

export type TickCallback = (deltaTime: number) => void;
export type RenderCallback = (interpolationAlpha: number) => void;

/**
 * Fixed-step render loop
 */
export class RenderLoop {
  private isRunning = false;
  private rafId: number | null = null;

  private lastTime = 0;
  private accumulator = 0;

  // Fixed timestep (should match server tick rate)
  private readonly FIXED_STEP_MS = 1000 / CLIENT_CONFIG.SIMULATION_TICK_RATE;

  // Callbacks
  private tickCallbacks: TickCallback[] = [];
  private renderCallbacks: RenderCallback[] = [];

  /**
   * Register a callback for fixed-step simulation ticks
   */
  onTick(callback: TickCallback): void {
    this.tickCallbacks.push(callback);
  }

  /**
   * Register a callback for rendering (called every frame)
   */
  onRender(callback: RenderCallback): void {
    this.renderCallbacks.push(callback);
  }

  /**
   * Start the render loop
   */
  start(): void {
    if (this.isRunning) {
      console.warn('RenderLoop already running');
      return;
    }

    this.isRunning = true;
    this.lastTime = performance.now();
    this.accumulator = 0;

    this.tick(this.lastTime);
  }

  /**
   * Stop the render loop
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Main loop tick (called by requestAnimationFrame)
   */
  private tick = (currentTime: number): void => {
    if (!this.isRunning) return;

    // Calculate frame delta time
    const frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Cap frame time to prevent spiral of death
    const cappedFrameTime = Math.min(frameTime, CLIENT_CONFIG.MAX_FRAME_TIME_MS);

    // Add to accumulator
    this.accumulator += cappedFrameTime;

    // Fixed-step simulation (run multiple times if we're behind)
    let tickCount = 0;
    while (this.accumulator >= this.FIXED_STEP_MS) {
      // Run simulation tick
      this.tickCallbacks.forEach((callback) => callback(this.FIXED_STEP_MS / 1000));

      this.accumulator -= this.FIXED_STEP_MS;
      tickCount++;

      // Safeguard: don't run more than 10 ticks per frame
      if (tickCount >= 10) {
        console.warn('Too many ticks in one frame, resetting accumulator');
        this.accumulator = 0;
        break;
      }
    }

    // Render with interpolation alpha (how far between ticks we are)
    const interpolationAlpha = this.accumulator / this.FIXED_STEP_MS;
    this.renderCallbacks.forEach((callback) => callback(interpolationAlpha));

    // Schedule next frame
    this.rafId = requestAnimationFrame(this.tick);
  };

  /**
   * Check if loop is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}
