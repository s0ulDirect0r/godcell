/**
 * Input validation utilities for socket message handling.
 * All validators fail silently (return false/clamped values) so invalid
 * messages are dropped without crashing the server.
 */

import { GAME_CONFIG } from '#shared';

/** Returns true if v is a finite number (not NaN, not Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates and clamps direction components to [-1, 1]. Returns null if inputs are invalid. */
export function clampDirection(
  x: unknown,
  y: unknown,
  z?: unknown
): { x: number; y: number; z: number } | null {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  const zVal = z !== undefined ? z : 0;
  if (!isFiniteNumber(zVal)) return null;
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
    z: Math.max(-1, Math.min(1, zVal)),
  };
}

/** Returns true if (x, y) are finite numbers within jungle world bounds. */
export function isValidTarget(x: unknown, y: unknown): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  // Targets must be within the full jungle (largest play area)
  return (
    x >= 0 && x <= GAME_CONFIG.JUNGLE_WIDTH && y >= 0 && y <= GAME_CONFIG.JUNGLE_HEIGHT
  );
}

/** Returns true if the value is one of the allowed melee attack types. */
export function isValidMeleeAttackType(v: unknown): v is 'swipe' | 'thrust' {
  return v === 'swipe' || v === 'thrust';
}
