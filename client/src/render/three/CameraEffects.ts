// ============================================
// Camera Effects
// Helpers for camera zoom, shake, and frustum updates
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';

/**
 * Get camera zoom multiplier for evolution stage
 * Higher stages zoom out to show more of the world
 *
 * Stage 1-2 (Soup): Small world (4800×3200), tighter zoom
 * Stage 3+ (Jungle): 4x larger world (19200×12800), dramatic zoom-out
 *
 * @param stage - Current evolution stage
 * @returns Zoom multiplier (1.0 = base, higher = zoomed out more)
 */
export function getStageZoom(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return 1.0; // Base scale - tight view of soup
    case EvolutionStage.MULTI_CELL:
      return 1.5; // 1.5x - slightly wider for larger multi-cell body
    case EvolutionStage.CYBER_ORGANISM:
      return 3.5; // 3.5x - dramatic zoom-out to reveal jungle (4x world size)
    case EvolutionStage.HUMANOID:
      return 4.0; // 4x - even wider for humanoid scale
    case EvolutionStage.GODCELL:
      return 5.0; // 5x - godlike overview of the world
    default:
      return 1.0; // Sensible fallback for unknown stages
  }
}

/**
 * Calculate camera shake intensity from damage taken
 *
 * @param damageAmount - Amount of damage taken
 * @returns Shake intensity (0-40 range)
 */
export function calculateDamageShake(damageAmount: number): number {
  // Camera shake intensity scales with damage (1 damage = 1.6 shake intensity)
  return Math.min(damageAmount * 1.6, 40); // Cap at 40
}

/**
 * Apply camera shake effect and decay
 *
 * @param camera - Orthographic camera to shake
 * @param shakeAmount - Current shake intensity
 * @param decayRate - Shake decay multiplier (default 0.88)
 * @returns New shake amount after decay
 */
export function applyCameraShake(
  camera: THREE.OrthographicCamera,
  shakeAmount: number,
  decayRate: number = 0.88
): number {
  if (shakeAmount > 0) {
    const offsetX = (Math.random() - 0.5) * shakeAmount;
    const offsetY = (Math.random() - 0.5) * shakeAmount;
    camera.position.x += offsetX;
    camera.position.y += offsetY;
    return shakeAmount * decayRate;
  }
  return 0;
}

/**
 * Smoothly follow a target position with camera
 *
 * @param camera - Orthographic camera
 * @param targetX - Target X position
 * @param targetY - Target Y position
 * @param lerpFactor - Interpolation factor (0-1, default 0.2)
 */
export function followTarget(
  camera: THREE.OrthographicCamera,
  targetX: number,
  targetY: number,
  lerpFactor: number = 0.2
): void {
  camera.position.x += (targetX - camera.position.x) * lerpFactor;
  camera.position.y += (targetY - camera.position.y) * lerpFactor;
}

/**
 * Update camera zoom with smooth lerp transition
 * Uses slower lerp for large zoom changes (evolution moments) for dramatic effect
 *
 * @param camera - Orthographic camera
 * @param currentZoom - Current zoom level
 * @param targetZoom - Target zoom level
 * @param aspect - Viewport aspect ratio
 * @param baseLerpFactor - Base interpolation factor (default 0.1)
 * @returns New current zoom level
 */
export function updateZoomTransition(
  camera: THREE.OrthographicCamera,
  currentZoom: number,
  targetZoom: number,
  aspect: number,
  baseLerpFactor: number = 0.1
): number {
  const zoomDiff = Math.abs(currentZoom - targetZoom);

  if (zoomDiff > 0.01) {
    // Use slower lerp for dramatic zoom changes (evolution to jungle = 1.5 -> 3.5 = 2.0 diff)
    // Large zoom diff (>1.0) = slower, cinematic transition
    // Small zoom diff (<0.5) = normal speed
    const lerpFactor = zoomDiff > 1.0 ? 0.03 : zoomDiff > 0.5 ? 0.06 : baseLerpFactor;

    // Lerp toward target
    let newZoom = currentZoom + (targetZoom - currentZoom) * lerpFactor;

    // Snap to target when very close
    if (Math.abs(newZoom - targetZoom) < 0.01) {
      newZoom = targetZoom;
    }

    // Apply zoom to camera frustum
    applyCameraZoom(camera, newZoom, aspect);

    return newZoom;
  }

  return currentZoom;
}

/**
 * Apply zoom level to camera frustum
 *
 * @param camera - Orthographic camera
 * @param zoom - Zoom multiplier
 * @param aspect - Viewport aspect ratio
 */
export function applyCameraZoom(
  camera: THREE.OrthographicCamera,
  zoom: number,
  aspect: number
): void {
  const baseFrustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
  const scaledFrustumSize = baseFrustumSize * zoom;

  camera.left = (scaledFrustumSize * aspect) / -2;
  camera.right = (scaledFrustumSize * aspect) / 2;
  camera.top = scaledFrustumSize / 2;
  camera.bottom = scaledFrustumSize / -2;
  camera.updateProjectionMatrix();
}
