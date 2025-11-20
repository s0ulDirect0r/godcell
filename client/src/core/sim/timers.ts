/**
 * Client-side timer utilities for countdowns and time-based calculations
 */

/**
 * Format seconds into a countdown string (MM:SS or SS)
 */
export function formatCountdown(seconds: number): string {
  if (seconds < 0) return '0:00';

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  return secs.toString();
}

/**
 * Format milliseconds into seconds with decimal places
 */
export function formatMilliseconds(ms: number, decimalPlaces = 1): string {
  return (ms / 1000).toFixed(decimalPlaces);
}

/**
 * Calculate time remaining for an event (e.g., respawn timer, evolution cooldown)
 */
export function getTimeRemaining(startTime: number, duration: number, currentTime: number): number {
  const elapsed = currentTime - startTime;
  const remaining = duration - elapsed;
  return Math.max(0, remaining);
}

/**
 * Check if a timer has expired
 */
export function hasTimerExpired(startTime: number, duration: number, currentTime: number): boolean {
  return currentTime - startTime >= duration;
}

/**
 * Calculate progress percentage for a timer (0-1)
 */
export function getTimerProgress(startTime: number, duration: number, currentTime: number): number {
  if (duration === 0) return 1;
  const elapsed = currentTime - startTime;
  return Math.min(1, Math.max(0, elapsed / duration));
}
