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
 * @param stage - Current evolution stage
 * @returns Zoom multiplier (1.0 = base, higher = zoomed out more)
 */
export function getStageZoom(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return 1.0; // Base scale
    case EvolutionStage.MULTI_CELL:
      return 1.5; // 1.5x more visible area
    case EvolutionStage.CYBER_ORGANISM:
      return 2.0; // 2x more visible area
    case EvolutionStage.HUMANOID:
      return 2.5; // 2.5x more visible area
    case EvolutionStage.GODCELL:
      return 3.0; // 3x more visible area
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
 *
 * @param camera - Orthographic camera
 * @param currentZoom - Current zoom level
 * @param targetZoom - Target zoom level
 * @param aspect - Viewport aspect ratio
 * @param lerpFactor - Interpolation factor (default 0.1)
 * @returns New current zoom level
 */
export function updateZoomTransition(
  camera: THREE.OrthographicCamera,
  currentZoom: number,
  targetZoom: number,
  aspect: number,
  lerpFactor: number = 0.1
): number {
  if (Math.abs(currentZoom - targetZoom) > 0.01) {
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
