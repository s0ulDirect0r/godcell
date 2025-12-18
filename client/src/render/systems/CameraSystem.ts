// ============================================
// CameraSystem - Manages all camera state and behavior
// Owns orthographic (top-down) and perspective (first-person) cameras
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG, EvolutionStage } from '#shared';

export type CameraMode = 'topdown' | 'firstperson' | 'thirdperson' | 'observer';

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

  // Sphere camera height above surface
  private readonly SPHERE_CAMERA_HEIGHT = 800;

  // Observer mode state (free-fly camera for debugging multi-sphere world)
  private observerVelocity = new THREE.Vector3();
  private observerYaw = 0;
  private observerPitch = 0;
  private observerInput = { forward: 0, right: 0, up: 0 }; // -1, 0, or 1
  private observerFOV = 60; // Default FOV in degrees
  private readonly OBSERVER_MIN_FOV = 20; // Telephoto zoom
  private readonly OBSERVER_MAX_FOV = 120; // Wide-angle
  private readonly OBSERVER_SPEED = 8000; // Units per second (fast for large sphere world)

  // Stage-based FOV
  private readonly BASE_FOV = 60;
  private readonly GODCELL_FOV = 90; // 50% wider for Stage 5
  private targetFOV = 60;
  private isGodcell = false;
  private readonly OBSERVER_FRICTION = 0.85; // Slightly more friction for snappier control

  // Godcell flight mode (mouse look like observer, but follows player)
  private godcellFlightMode = false;
  private godcellYaw = 0;
  private godcellPitch = 0;

  constructor(viewportWidth: number, viewportHeight: number) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.aspect = viewportWidth / viewportHeight;

    // Create orthographic camera (used for flat world projection/coordinate conversion)
    const frustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    this.orthoCamera = new THREE.OrthographicCamera(
      (frustumSize * this.aspect) / -2,
      (frustumSize * this.aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      1,
      2000
    );
    this.orthoCamera.position.set(0, 1000, 0);
    this.orthoCamera.lookAt(0, 0, 0);
    this.orthoCamera.up.set(0, 0, -1);

    // Create perspective camera (main camera for sphere world)
    // Far plane set to 50000 to accommodate god sphere (radius 14688) viewing from distance
    this.perspCamera = new THREE.PerspectiveCamera(60, this.aspect, 1, 50000);

    // Start camera above the sphere at default position
    const startPos = new THREE.Vector3(GAME_CONFIG.SPHERE_RADIUS, 0, 0);
    const normal = startPos.clone().normalize();
    this.perspCamera.position.copy(startPos).addScaledVector(normal, this.SPHERE_CAMERA_HEIGHT);
    this.perspCamera.lookAt(startPos);
    this.perspCamera.up.set(0, 1, 0);
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
    // Sphere world always uses perspective camera for 3D surface rendering
    return this.perspCamera;
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
    // Zoom multiplier per stage - controls how much of the world is visible (FLAT MODE)
    // Higher = more zoomed out (see more world, player appears smaller)
    switch (stage) {
      case EvolutionStage.SINGLE_CELL:
        return 1.0; // Tight focus on small cell
      case EvolutionStage.MULTI_CELL:
        return 1.5; // Slightly wider for larger multi-cell
      case EvolutionStage.CYBER_ORGANISM:
        return 4.0; // Jungle scale
      case EvolutionStage.HUMANOID:
        return 4.0; // First-person mode uses perspective camera instead
      case EvolutionStage.GODCELL:
        return 5.0; // Third-person with wider view
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
  // Third-Person Controls (Stage 5 Godcell)
  // ============================================

  /**
   * Update third-person camera to follow player in 3D space (flat world)
   * Camera orbits behind and above the player
   *
   * @param x - Player X position (game coords)
   * @param y - Player Y position (game coords, maps to -Z in Three.js)
   * @param z - Player Z position (height, maps to Y in Three.js)
   */
  updateThirdPersonPosition(x: number, y: number, z: number): void {
    if (this.mode !== 'thirdperson') return;

    // Third-person camera offset (behind and above player)
    // These values create a comfortable chase-cam feel for a large sphere
    const distanceBehind = 600; // How far behind the player
    const heightAbove = 300; // How far above the player

    // Convert game coords to Three.js:
    // Game: X=right, Y=up (on screen), Z=height
    // Three.js: X=right, Y=up (height), Z=forward (into screen is -Z)
    const targetPos = new THREE.Vector3(x, z, -y);

    // Camera position: behind and above (for now, fixed angle looking "forward" in +Z direction)
    // In game terms, this means looking "down" the Y axis
    const cameraPos = new THREE.Vector3(
      x,
      z + heightAbove,
      -y + distanceBehind // Behind in Three.js space = more positive Z
    );

    // Smooth follow with lerp
    const lerpFactor = 0.1;
    this.perspCamera.position.lerp(cameraPos, lerpFactor);

    // Look at the player
    this.perspCamera.lookAt(targetPos);
  }

  /**
   * Update third-person camera for sphere world (Stage 5 Godcell flying in 3D)
   * Camera positioned radially outward from player (above them from sphere's perspective)
   *
   * @param x - Player X position (Three.js coords, direct from mesh)
   * @param y - Player Y position (Three.js coords, direct from mesh)
   * @param z - Player Z position (Three.js coords, direct from mesh)
   */
  updateThirdPersonSphere(x: number, y: number, z: number): void {
    if (this.mode !== 'thirdperson') return;

    const playerPos = new THREE.Vector3(x, y, z);

    // Camera distance from player
    const cameraDistance = 2400;

    let cameraPos: THREE.Vector3;

    if (this.godcellFlightMode) {
      // Flight mode: camera orbits player based on yaw/pitch (like observer but following player)
      // Calculate camera offset from yaw/pitch
      const yaw = this.godcellYaw;
      const pitch = this.godcellPitch;

      // Spherical to cartesian offset (camera behind and above player based on look direction)
      // Camera is BEHIND where we're looking, so we negate the direction
      const offsetX = Math.sin(yaw) * Math.cos(pitch) * cameraDistance;
      const offsetY = -Math.sin(pitch) * cameraDistance;
      const offsetZ = Math.cos(yaw) * Math.cos(pitch) * cameraDistance;

      cameraPos = new THREE.Vector3(
        playerPos.x + offsetX,
        playerPos.y + offsetY,
        playerPos.z + offsetZ
      );
    } else {
      // Default: camera radially outward from sphere center
      const radialDir = playerPos.clone().normalize();
      cameraPos = playerPos.clone().addScaledVector(radialDir, cameraDistance);
    }

    // Tight follow - high lerp factor to reduce lag/shake
    const lerpFactor = 0.5;
    this.perspCamera.position.lerp(cameraPos, lerpFactor);

    // Smooth the lookAt target too (stored between frames)
    if (!this._smoothLookTarget) {
      this._smoothLookTarget = playerPos.clone();
    }
    this._smoothLookTarget.lerp(playerPos, lerpFactor);
    this.perspCamera.lookAt(this._smoothLookTarget);
  }

  // Debug counter for throttled logging
  private _tpDebugCount?: number;
  // Smoothed look target for third-person camera
  private _smoothLookTarget?: THREE.Vector3;

  // ============================================
  // Sphere Mode Camera
  // ============================================

  /**
   * Update camera position for sphere world mode.
   * Camera hovers above player on sphere surface, looking down at them.
   * Uses pole-locked up vector (north pole = up).
   *
   * @param x - Player X position on sphere
   * @param y - Player Y position on sphere
   * @param z - Player Z position on sphere
   */
  updateSpherePosition(x: number, y: number, z: number): void {
    const playerPos = new THREE.Vector3(x, y, z);
    const surfaceNormal = playerPos.clone().normalize();

    // Position camera above player along surface normal
    const cameraPos = playerPos.clone().addScaledVector(surfaceNormal, this.SPHERE_CAMERA_HEIGHT);

    // Smooth follow
    const lerpFactor = 0.15;
    this.perspCamera.position.lerp(cameraPos, lerpFactor);

    // Look at player
    this.perspCamera.lookAt(playerPos);

    // Pole-locked up vector: orient "up" toward north pole (world Y+)
    // This gives consistent orientation across the sphere
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, surfaceNormal);

    if (right.lengthSq() > 0.0001) {
      // Not at pole - compute proper up
      right.normalize();
      const localUp = new THREE.Vector3().crossVectors(surfaceNormal, right).normalize();
      this.perspCamera.up.copy(localUp);
    } else {
      // At pole - use fallback
      this.perspCamera.up.set(0, 0, -1);
    }
  }

  // ============================================
  // Observer Mode (free-fly camera for debugging)
  // ============================================

  /**
   * Toggle observer mode on/off.
   * When entering, positions camera at current view.
   */
  toggleObserverMode(): boolean {
    if (this.mode === 'observer') {
      // Exit observer mode - return to normal sphere camera
      this.mode = 'topdown'; // Will be overridden by normal camera logic
      console.log('[CameraSystem] Observer mode OFF');
      return false;
    } else {
      // Enter observer mode - keep current camera position
      this.mode = 'observer';
      this.observerVelocity.set(0, 0, 0);
      // Extract current look direction
      const dir = new THREE.Vector3();
      this.perspCamera.getWorldDirection(dir);
      this.observerYaw = Math.atan2(-dir.x, -dir.z);
      this.observerPitch = Math.asin(dir.y);
      // Apply observer FOV
      this.perspCamera.fov = this.observerFOV;
      this.perspCamera.updateProjectionMatrix();
      console.log('[CameraSystem] Observer mode ON - WASD: fly, Space/Shift: up/down, Mouse: look, [/]: FOV zoom');
      return true;
    }
  }

  isObserverMode(): boolean {
    return this.mode === 'observer';
  }

  /**
   * Set observer movement input (called from input handler)
   * @param forward -1 (back) to 1 (forward)
   * @param right -1 (left) to 1 (right)
   * @param up -1 (down) to 1 (up)
   */
  setObserverInput(forward: number, right: number, up: number): void {
    this.observerInput.forward = forward;
    this.observerInput.right = right;
    this.observerInput.up = up;
  }

  /**
   * Update observer look direction from mouse input
   */
  updateObserverLook(deltaX: number, deltaY: number): void {
    if (this.mode !== 'observer') return;

    const sensitivity = 0.002;
    this.observerYaw -= deltaX * sensitivity;
    this.observerPitch -= deltaY * sensitivity;

    // Clamp pitch to prevent flipping
    const maxPitch = Math.PI / 2 - 0.01;
    this.observerPitch = Math.max(-maxPitch, Math.min(maxPitch, this.observerPitch));
  }

  /**
   * Update observer camera position (call each frame with delta time)
   */
  updateObserver(dt: number): void {
    if (this.mode !== 'observer') return;

    // Calculate forward and right vectors from yaw (fly-through style)
    const forward = new THREE.Vector3(
      -Math.sin(this.observerYaw) * Math.cos(this.observerPitch),
      Math.sin(this.observerPitch),
      -Math.cos(this.observerYaw) * Math.cos(this.observerPitch)
    );
    const right = new THREE.Vector3(
      Math.cos(this.observerYaw),
      0,
      -Math.sin(this.observerYaw)
    );
    const up = new THREE.Vector3(0, 1, 0); // World up for vertical movement

    // Calculate desired velocity from input
    const desiredVelocity = new THREE.Vector3();
    desiredVelocity.addScaledVector(forward, this.observerInput.forward * this.OBSERVER_SPEED);
    desiredVelocity.addScaledVector(right, this.observerInput.right * this.OBSERVER_SPEED);
    desiredVelocity.addScaledVector(up, this.observerInput.up * this.OBSERVER_SPEED);

    // Lerp current velocity toward desired (smooth acceleration/deceleration)
    // Frame-rate independent lerp factor
    const lerpFactor = 1 - Math.pow(this.OBSERVER_FRICTION, dt * 60);
    this.observerVelocity.lerp(desiredVelocity, lerpFactor);

    // Update position
    this.perspCamera.position.addScaledVector(this.observerVelocity, dt);

    // Update look direction
    const euler = new THREE.Euler(this.observerPitch, this.observerYaw, 0, 'YXZ');
    this.perspCamera.quaternion.setFromEuler(euler);
    this.perspCamera.up.set(0, 1, 0);
  }

  /**
   * Adjust observer FOV (zoom in/out)
   * @param delta - Positive to zoom out (wider FOV), negative to zoom in (narrower FOV)
   */
  adjustObserverFOV(delta: number): void {
    this.observerFOV = Math.max(
      this.OBSERVER_MIN_FOV,
      Math.min(this.OBSERVER_MAX_FOV, this.observerFOV + delta)
    );
    this.perspCamera.fov = this.observerFOV;
    this.perspCamera.updateProjectionMatrix();
    console.log(`[Observer] FOV: ${this.observerFOV.toFixed(0)}°`);
  }

  /**
   * Get current observer FOV
   */
  getObserverFOV(): number {
    return this.observerFOV;
  }

  /**
   * Set whether player is Godcell (Stage 5) for FOV adjustment
   * Godcell gets 50% wider FOV for better spatial awareness
   */
  setGodcellMode(isGodcell: boolean): void {
    if (this.isGodcell === isGodcell) return;
    this.isGodcell = isGodcell;
    this.targetFOV = isGodcell ? this.GODCELL_FOV : this.BASE_FOV;
  }

  /**
   * Enable/disable Godcell flight mode (mouse look like observer)
   */
  setGodcellFlightMode(enabled: boolean): void {
    if (this.godcellFlightMode === enabled) return;
    this.godcellFlightMode = enabled;
    if (enabled) {
      console.log('[CameraSystem] Godcell flight mode ON - mouse look enabled');
    }
  }

  isGodcellFlightMode(): boolean {
    return this.godcellFlightMode;
  }

  /**
   * Update Godcell look direction from mouse input
   */
  updateGodcellLook(deltaX: number, deltaY: number): void {
    if (!this.godcellFlightMode) return;

    const sensitivity = 0.002;
    this.godcellYaw -= deltaX * sensitivity;
    this.godcellPitch -= deltaY * sensitivity;

    // Clamp pitch to prevent flipping
    const maxPitch = Math.PI / 2 - 0.01;
    this.godcellPitch = Math.max(-maxPitch, Math.min(maxPitch, this.godcellPitch));
  }

  /**
   * Get Godcell camera yaw (for input transformation)
   */
  getGodcellYaw(): number {
    return this.godcellYaw;
  }

  /**
   * Get Godcell camera pitch (for input transformation)
   */
  getGodcellPitch(): number {
    return this.godcellPitch;
  }

  /**
   * Update FOV smoothly toward target (for stage transitions)
   */
  private updateFOVTransition(): void {
    if (this.mode === 'observer') return; // Observer mode manages its own FOV

    const currentFOV = this.perspCamera.fov;
    if (Math.abs(currentFOV - this.targetFOV) > 0.1) {
      // Lerp toward target FOV
      this.perspCamera.fov = currentFOV + (this.targetFOV - currentFOV) * 0.1;
      this.perspCamera.updateProjectionMatrix();
    }
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

    // Update FOV transition (for Godcell wider FOV)
    this.updateFOVTransition();

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
    let mode: 'topdown' | 'orbit' | 'tps' | 'fps';
    if (this.mode === 'firstperson') {
      mode = 'fps';
    } else if (this.mode === 'thirdperson') {
      mode = 'tps';
    } else {
      mode = 'topdown';
    }
    return {
      mode,
      supports3D: true,
    };
  }
}
