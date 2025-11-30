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
    // Shake on XZ plane (camera looks down Y-axis)
    const offsetX = (Math.random() - 0.5) * shakeAmount;
    const offsetZ = (Math.random() - 0.5) * shakeAmount;
    camera.position.x += offsetX;
    camera.position.z += offsetZ;
    return shakeAmount * decayRate;
  }
  return 0;
}

/**
 * Smoothly follow a target position with camera
 * Camera is above world looking down Y-axis, so we move on XZ plane
 *
 * @param camera - Orthographic camera
 * @param targetX - Target X position (game X)
 * @param targetY - Target Y position (game Y, maps to -Z in 3D)
 * @param lerpFactor - Interpolation factor (0-1, default 0.2)
 */
export function followTarget(
  camera: THREE.OrthographicCamera,
  targetX: number,
  targetY: number,
  lerpFactor: number = 0.2
): void {
  // Game Y maps to -Z in Three.js (game +Y = screen up = -Z direction)
  const targetZ = -targetY;
  camera.position.x += (targetX - camera.position.x) * lerpFactor;
  camera.position.z += (targetZ - camera.position.z) * lerpFactor;
}

/**
 * Update camera zoom with smooth lerp transition
 * Uses VERY slow lerp for Stage 3 evolution (1.5 -> 3.5+) for dramatic cinematic effect
 * The creature is evolving by an order of magnitude - the camera pull should feel epic
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
    // Dramatically slower lerp for Stage 3 evolution (1.5 -> 3.5 = 2.0 diff)
    // This creates a slow, epic zoom-out that emphasizes the order of magnitude change
    // >1.5 diff = ultra slow cinematic pull (Stage 2 -> Stage 3 evolution)
    // >1.0 diff = slow dramatic transition
    // >0.5 diff = moderate transition
    // <0.5 diff = normal speed
    let lerpFactor: number;
    if (zoomDiff > 1.5) {
      // Ultra slow for Stage 3 evolution - takes ~5-6 seconds
      lerpFactor = 0.008;
    } else if (zoomDiff > 1.0) {
      lerpFactor = 0.015;
    } else if (zoomDiff > 0.5) {
      lerpFactor = 0.04;
    } else {
      lerpFactor = baseLerpFactor;
    }

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
