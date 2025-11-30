// ============================================
// CameraSystem - Manages all camera state and behavior
// Owns orthographic (top-down) and perspective (first-person) cameras
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';

export type CameraMode = 'topdown' | 'firstperson';

export interface CameraCapabilities {
  mode: 'topdown' | 'orbit' | 'tps' | 'fps';
  supports3D: boolean;
}

export interface CameraProjection {
  screenToWorld(screenX: number, screenY: number): { x: number; y: number };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
}

/**
 * CameraSystem - Single source of truth for all camera logic
 *
 * Manages:
 * - Orthographic camera (Stages 1-3 top-down view)
 * - Perspective camera (Stage 4+ first-person view)
 * - Camera following, shake, and zoom transitions
 * - Mode switching between top-down and first-person
 */
export class CameraSystem {
  // Cameras
  private orthoCamera: THREE.OrthographicCamera;
  private perspCamera: THREE.PerspectiveCamera;

  // State
  private mode: CameraMode = 'topdown';
  private shake = 0;
  private currentZoom = 1.0;
  private targetZoom = 1.0;

  // First-person rotation
  private fpYaw = 0;
  private fpPitch = 0;

  // Viewport
  private aspect: number;
  private viewportWidth: number;
  private viewportHeight: number;

  constructor(viewportWidth: number, viewportHeight: number) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.aspect = viewportWidth / viewportHeight;

    // Create orthographic camera (top-down for Stages 1-3)
    // Camera looks down Y-axis at XZ plane
    const frustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    this.orthoCamera = new THREE.OrthographicCamera(
      (frustumSize * this.aspect) / -2,
      (frustumSize * this.aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      1,
      2000
    );

    // Position at soup center, looking down
    const soupCenterX = GAME_CONFIG.SOUP_WIDTH / 2;
    const soupCenterY = GAME_CONFIG.SOUP_HEIGHT / 2;
    this.orthoCamera.position.set(soupCenterX, 1000, -soupCenterY);
    this.orthoCamera.lookAt(soupCenterX, 0, -soupCenterY);
    this.orthoCamera.up.set(0, 0, -1);

    // Create perspective camera (first-person for Stage 4+)
    this.perspCamera = new THREE.PerspectiveCamera(75, this.aspect, 1, 10000);
    this.perspCamera.position.set(0, 0, 0);
  }

  // ============================================
  // Camera Getters
  // ============================================

  getOrthoCamera(): THREE.OrthographicCamera {
    return this.orthoCamera;
  }

  getPerspCamera(): THREE.PerspectiveCamera {
    return this.perspCamera;
  }

  getActiveCamera(): THREE.Camera {
    return this.mode === 'firstperson' ? this.perspCamera : this.orthoCamera;
  }

  getMode(): CameraMode {
    return this.mode;
  }

  getYaw(): number {
    return this.fpYaw;
  }

  // ============================================
  // Mode Switching
  // ============================================

  /**
   * Switch camera mode. Returns true if mode changed.
   * Caller is responsible for environment changes (backgrounds, ground plane).
   */
  setMode(mode: CameraMode): boolean {
    if (this.mode === mode) return false;
    this.mode = mode;

    if (mode === 'firstperson') {
      // Reset first-person rotation
      this.fpYaw = 0;
      this.fpPitch = 0;
    }

    return true;
  }

  // ============================================
  // Zoom Control
  // ============================================

  /**
   * Get zoom multiplier for evolution stage
   */
  static getStageZoom(stage: EvolutionStage): number {
    switch (stage) {
      case EvolutionStage.SINGLE_CELL:
        return 1.0;
      case EvolutionStage.MULTI_CELL:
        return 1.5;
      case EvolutionStage.CYBER_ORGANISM:
        return 3.5;
      case EvolutionStage.HUMANOID:
        return 4.0;
      case EvolutionStage.GODCELL:
        return 5.0;
      default:
        return 1.0;
    }
  }

  setTargetZoom(zoom: number): void {
    this.targetZoom = zoom;
  }

  /**
   * Instantly set zoom (no transition). Use for respawns.
   */
  setZoomInstant(zoom: number): void {
    this.currentZoom = zoom;
    this.targetZoom = zoom;
    this.applyZoom();
  }

  getCurrentZoom(): number {
    return this.currentZoom;
  }

  // ============================================
  // Camera Shake
  // ============================================

  /**
   * Add shake intensity (uses max to avoid overriding larger shake)
   */
  addShake(intensity: number): void {
    this.shake = Math.max(this.shake, Math.min(intensity, 40));
  }

  /**
   * Calculate shake intensity from damage amount
   */
  static calculateDamageShake(damageAmount: number): number {
    return Math.min(damageAmount * 1.6, 40);
  }

  // ============================================
  // First-Person Controls
  // ============================================

  /**
   * Update first-person look from mouse input
   */
  updateFirstPersonLook(deltaX: number, deltaY: number): void {
    if (this.mode !== 'firstperson') return;

    const sensitivity = 0.002;

    // Yaw (horizontal) - no clamp
    this.fpYaw -= deltaX * sensitivity;

    // Pitch (vertical) - clamp to prevent flipping
    const maxPitch = Math.PI / 2 - 0.01;
    this.fpPitch -= deltaY * sensitivity;
    this.fpPitch = Math.max(-maxPitch, Math.min(maxPitch, this.fpPitch));
  }

  /**
   * Position first-person camera at player location
   */
  updateFirstPersonPosition(x: number, y: number, height: number): void {
    if (this.mode !== 'firstperson') return;

    // Game Y maps to -Z in Three.js
    this.perspCamera.position.set(x, height, -y);

    // Apply look rotation
    const euler = new THREE.Euler(this.fpPitch, this.fpYaw, 0, 'YXZ');
    this.perspCamera.quaternion.setFromEuler(euler);
  }

  // ============================================
  // Update (called each frame)
  // ============================================

  /**
   * Update camera state. Call this each frame.
   * @param targetX - Target X position to follow (or undefined if no target)
   * @param targetY - Target Y position to follow (game coords, maps to -Z)
   */
  update(targetX?: number, targetY?: number): void {
    // Update zoom transition
    this.updateZoomTransition();

    // Apply shake and decay
    this.updateShake();

    // Follow target (top-down mode only)
    if (this.mode === 'topdown' && targetX !== undefined && targetY !== undefined) {
      this.followTarget(targetX, targetY);
    }
  }

  private updateZoomTransition(): void {
    const zoomDiff = Math.abs(this.currentZoom - this.targetZoom);
    if (zoomDiff <= 0.01) return;

    // Variable lerp speed based on zoom difference
    // Larger differences = slower, more cinematic transitions
    let lerpFactor: number;
    if (zoomDiff > 1.5) {
      lerpFactor = 0.008; // Ultra slow for Stage 3 evolution
    } else if (zoomDiff > 1.0) {
      lerpFactor = 0.015;
    } else if (zoomDiff > 0.5) {
      lerpFactor = 0.04;
    } else {
      lerpFactor = 0.1;
    }

    this.currentZoom += (this.targetZoom - this.currentZoom) * lerpFactor;

    // Snap when very close
    if (Math.abs(this.currentZoom - this.targetZoom) < 0.01) {
      this.currentZoom = this.targetZoom;
    }

    // Apply to frustum
    this.applyZoom();
  }

  private applyZoom(): void {
    const baseFrustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    const scaledFrustumSize = baseFrustumSize * this.currentZoom;

    this.orthoCamera.left = (scaledFrustumSize * this.aspect) / -2;
    this.orthoCamera.right = (scaledFrustumSize * this.aspect) / 2;
    this.orthoCamera.top = scaledFrustumSize / 2;
    this.orthoCamera.bottom = scaledFrustumSize / -2;
    this.orthoCamera.updateProjectionMatrix();
  }

  private updateShake(): void {
    if (this.shake > 0) {
      // Shake on XZ plane (camera looks down Y-axis)
      const offsetX = (Math.random() - 0.5) * this.shake;
      const offsetZ = (Math.random() - 0.5) * this.shake;
      this.orthoCamera.position.x += offsetX;
      this.orthoCamera.position.z += offsetZ;
      this.shake *= 0.88; // Decay
    }
  }

  private followTarget(targetX: number, targetY: number): void {
    const lerpFactor = 0.2;
    const targetZ = -targetY; // Game Y maps to -Z
    this.orthoCamera.position.x += (targetX - this.orthoCamera.position.x) * lerpFactor;
    this.orthoCamera.position.z += (targetZ - this.orthoCamera.position.z) * lerpFactor;
  }

  // ============================================
  // Resize
  // ============================================

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.aspect = width / height;

    // Update ortho frustum
    this.applyZoom();

    // Update perspective aspect
    this.perspCamera.aspect = this.aspect;
    this.perspCamera.updateProjectionMatrix();
  }

  // ============================================
  // Projection (screen <-> world)
  // ============================================

  getProjection(): CameraProjection {
    const camera = this.orthoCamera;

    return {
      screenToWorld: (screenX: number, screenY: number) => {
        // Normalize to [-1, 1]
        const ndcX = (screenX / this.viewportWidth) * 2 - 1;
        const ndcY = -(screenY / this.viewportHeight) * 2 + 1;

        const vector = new THREE.Vector3(ndcX, ndcY, 0);
        vector.unproject(camera);

        // Return game coords (3D X -> game X, 3D Z -> game -Y)
        return { x: vector.x, y: -vector.z };
      },

      worldToScreen: (worldX: number, worldY: number) => {
        // Game coords to 3D (game Y -> -Z)
        const vector = new THREE.Vector3(worldX, 0, -worldY);
        vector.project(camera);

        return {
          x: ((vector.x + 1) / 2) * this.viewportWidth,
          y: ((-vector.y + 1) / 2) * this.viewportHeight,
        };
      },
    };
  }

  getCapabilities(): CameraCapabilities {
    return {
      mode: this.mode === 'firstperson' ? 'fps' : 'topdown',
      supports3D: true,
    };
  }
}
