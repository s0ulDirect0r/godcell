/**
 * Frame-rate independent lerp factor.
 *
 * Standard lerp (position += (target - position) * factor) is frame-rate dependent:
 * at 120fps it applies twice as often as 60fps, making movement snap faster.
 *
 * This formula ensures the same amount of "catch up" per second regardless of frame rate.
 *
 * @param baseLerp - Lerp factor tuned for 60fps (e.g., 0.3 means 30% toward target per frame at 60fps)
 * @param dt - Actual frame delta time in milliseconds
 * @param baseDt - Reference frame time (default 16.67ms = 60fps)
 * @returns Adjusted lerp factor for current frame rate
 *
 * @example
 * // At 60fps: returns ~0.3
 * // At 120fps: returns ~0.16 (less per frame, same per second)
 * // At 30fps: returns ~0.51 (more per frame, same per second)
 * const lerpFactor = frameLerp(0.3, dt);
 * position += (target - position) * lerpFactor;
 */
export function frameLerp(baseLerp: number, dt: number, baseDt: number = 16.67): number {
  return 1 - Math.pow(1 - baseLerp, dt / baseDt);
}
