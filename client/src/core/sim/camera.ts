/**
 * Camera target calculation - derives camera descriptor from game state.
 * Renderer consumes this descriptor to position and animate the camera.
 */

import type { GameState } from '../state/GameState';
import { getLocalPlayer } from '../state/selectors';
import { CLIENT_CONFIG } from '../config/clientConfig';
import { EvolutionStage } from '@godcell/shared';

/**
 * Camera descriptor for renderer consumption
 */
export interface CameraDescriptor {
  target: { x: number; y: number; z?: number }; // World position to center on
  zoom: number;                                  // Zoom level (1.0 = default)
  shake?: {
    intensity: number; // Shake magnitude (pixels)
    duration: number;  // Shake duration (ms)
  };
  easing: number; // Lerp factor for smooth following (0-1)
}

/**
 * Get camera target descriptor from game state
 * Follows the local player, adjusts zoom based on evolution stage
 */
export function getCameraTarget(state: GameState): CameraDescriptor {
  const localPlayer = getLocalPlayer(state);

  // Default camera (centered on world if no local player)
  if (!localPlayer) {
    return {
      target: { x: 0, y: 0 },
      zoom: 1.0,
      easing: CLIENT_CONFIG.CAMERA_EASING_FACTOR,
    };
  }

  // Calculate zoom based on evolution stage
  const zoom = calculateZoom(localPlayer.stage);

  // Center camera on local player
  return {
    target: {
      x: localPlayer.position.x,
      y: localPlayer.position.y,
    },
    zoom,
    easing: CLIENT_CONFIG.CAMERA_EASING_FACTOR,
  };
}

/**
 * Calculate zoom level based on evolution stage
 * Higher stages = zoomed out more (to see their larger size + surroundings)
 */
export function calculateZoom(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return CLIENT_CONFIG.CAMERA_ZOOM_SINGLE_CELL;
    case EvolutionStage.MULTI_CELL:
      return CLIENT_CONFIG.CAMERA_ZOOM_MULTI_CELL;
    case EvolutionStage.CYBER_ORGANISM:
      return CLIENT_CONFIG.CAMERA_ZOOM_CYBER_ORGANISM;
    case EvolutionStage.HUMANOID:
      return CLIENT_CONFIG.CAMERA_ZOOM_HUMANOID;
    case EvolutionStage.GODCELL:
      return CLIENT_CONFIG.CAMERA_ZOOM_GODCELL;
    default:
      return 1.0;
  }
}

/**
 * Create a camera shake effect (e.g., on damage, evolution)
 */
export function createCameraShake(intensity: number, duration: number): CameraDescriptor['shake'] {
  return { intensity, duration };
}
