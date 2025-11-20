/**
 * Math and utility helpers for simulation
 */

import type { Position } from '@godcell/shared';

/**
 * Linear interpolation between two values
 */
export function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

/**
 * Linear interpolation between two positions
 */
export function lerpPosition(start: Position, end: Position, alpha: number): Position {
  return {
    x: lerp(start.x, end.x, alpha),
    y: lerp(start.y, end.y, alpha),
  };
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate distance between two positions
 */
export function distance(a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate squared distance (faster, avoids sqrt)
 */
export function distanceSquared(a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/**
 * Normalize a vector (make it length 1)
 */
export function normalize(x: number, y: number): { x: number; y: number } {
  const length = Math.sqrt(x * x + y * y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

/**
 * Calculate angle between two positions (in radians)
 */
export function angleBetween(a: Position, b: Position): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Convert degrees to radians
 */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Smooth step function (easing curve)
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
