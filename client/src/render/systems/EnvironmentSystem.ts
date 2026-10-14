// ============================================
// EnvironmentSystem - Manages background environments
// Owns soup/jungle backgrounds, particles, ground plane
// ============================================

import * as THREE from 'three';
import type { ComputeNode } from 'three/webgpu';
import { PointCloud } from '../three/PointCloud';
import { SoupCurrents } from '../effects/SoupCurrents';
import { GAME_CONFIG } from '#shared';
import {
  createJungleBackground,
  updateJungleParticles,
  updateSoupActivity,
  updateUndergrowth,
  updateFireflies,
  updateGroundTexture,
  getJungleBackgroundColor,
  getSoupBackgroundColor,
  getFirstPersonSkyColor,
  createFirstPersonGround,
} from '../three/JungleBackground';
import {
  createSubdividedLine,
  updateGridLineDistortion,
  updateGravityWellCache,
  clearGravityWellCache,
  getGravityWellCache,
} from '../utils/GravityDistortionUtils';
import { World } from '../../ecs';

export type RenderMode = 'soup' | 'jungle';

/**
 * EnvironmentSystem - Manages all background environments
 *
 * Owns:
 * - Soup background (grid + flowing particles) for Stages 1-2
 * - Jungle background (procedural) for Stage 3+
 * - First-person ground plane for Stage 4+
 * - All background particle animations
 */
export class EnvironmentSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Render mode
  private mode: RenderMode = 'soup';

  // Soup background (Stage 1-2)
  private soupBackgroundGroup!: THREE.Group;
  private soupCurrents!: SoupCurrents; // GPU compute background particles

  // Grid distortion data
  // Each entry: { geometry, originalPositions } for a grid line
  private gridLines: Array<{ geometry: THREE.BufferGeometry; originalPositions: Float32Array }> =
    [];
  private gravityWellCacheUpdated = false;

  // Jungle background (Stage 3+)
  private jungleBackgroundGroup!: THREE.Group;
  private jungleParticles!: PointCloud;
  private jungleParticleData: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
  }> = [];

  // Soup activity visualization (inside soup pool in jungle view)
  private soupActivityPoints!: PointCloud;
  private soupActivityData: Array<{ x: number; y: number; vx: number; vy: number; color: number }> =
    [];

  // Undergrowth particles (ground-level glow)
  private undergrowthPoints!: PointCloud;
  private undergrowthData: Array<{ x: number; y: number; phase: number; baseOpacity: number }> = [];

  // Firefly particles (floating ambient life)
  private fireflyPoints!: PointCloud;
  private fireflyData: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    phase: number;
    color: number;
  }> = [];

  // First-person ground plane (Stage 4+)
  private firstPersonGround!: THREE.Group;

  /**
   * Initialize environment system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;

    // Create soup background group (grid + particles)
    this.soupBackgroundGroup = new THREE.Group();
    this.soupBackgroundGroup.name = 'soupBackground';
    scene.add(this.soupBackgroundGroup);

    // Create soup grid and particles
    this.createGrid();
    this.soupCurrents = new SoupCurrents();
    this.soupBackgroundGroup.add(this.soupCurrents.object);

    // Create jungle background (uses JungleBackground helper)
    const jungleResult = createJungleBackground(scene);
    this.jungleBackgroundGroup = jungleResult.group;
    this.jungleParticles = jungleResult.particles;
    this.jungleParticleData = jungleResult.particleData;
    this.soupActivityPoints = jungleResult.soupActivityPoints;
    this.soupActivityData = jungleResult.soupActivityData;
    this.undergrowthPoints = jungleResult.undergrowthPoints;
    this.undergrowthData = jungleResult.undergrowthData;
    this.fireflyPoints = jungleResult.fireflyPoints;
    this.fireflyData = jungleResult.fireflyData;

    // Create first-person ground plane (Stage 4+)
    this.firstPersonGround = createFirstPersonGround();
    this.firstPersonGround.visible = false;
    scene.add(this.firstPersonGround);

    // Set initial background color (soup mode)
    scene.background = new THREE.Color(getSoupBackgroundColor());
  }

  // ============================================
  // Mode Switching
  // ============================================

  /**
   * Get current render mode
   */
  getMode(): RenderMode {
    return this.mode;
  }

  getSoupCurrents(): SoupCurrents {
    return this.soupCurrents;
  }

  /** Compute pass to dispatch this frame (soup currents only run in soup mode) */
  getActiveCompute(): ComputeNode | null {
    return this.mode === 'soup' ? this.soupCurrents.computeNode : null;
  }

  /**
   * Set render mode (soup vs jungle)
   * Returns true if mode changed (caller should clear entities when switching to jungle)
   */
  setMode(mode: RenderMode): boolean {
    if (this.mode === mode) return false;

    console.log(`[RenderMode] Switching from ${this.mode} to ${mode}`);

    if (mode === 'jungle') {
      // Transitioning to jungle (Stage 3+)
      // Remove soup background from scene entirely
      if (this.soupBackgroundGroup.parent === this.scene) {
        this.scene.remove(this.soupBackgroundGroup);
      }

      // Show jungle background
      if (this.jungleBackgroundGroup.parent !== this.scene) {
        this.scene.add(this.jungleBackgroundGroup);
      }
      this.jungleBackgroundGroup.visible = true;
      this.scene.background = new THREE.Color(getJungleBackgroundColor());

      // Clear gravity well cache (no obstacles in jungle)
      clearGravityWellCache();
    } else {
      // Transitioning to soup (Stage 1-2, e.g., death respawn)
      // Re-add soup background
      if (this.soupBackgroundGroup.parent !== this.scene) {
        this.scene.add(this.soupBackgroundGroup);
      }
      this.soupBackgroundGroup.visible = true;

      // Hide jungle background
      this.jungleBackgroundGroup.visible = false;
      this.scene.background = new THREE.Color(getSoupBackgroundColor());

      // Reset gravity well cache flag so it gets rebuilt
      this.gravityWellCacheUpdated = false;
    }

    this.mode = mode;
    return true; // Mode changed
  }

  // ============================================
  // First-Person Ground
  // ============================================

  /**
   * Set first-person ground visibility
   * Called when entering/exiting first-person mode
   */
  setFirstPersonGroundVisible(visible: boolean): void {
    this.firstPersonGround.visible = visible;

    // Update background color based on visibility
    if (visible) {
      this.scene.background = new THREE.Color(getFirstPersonSkyColor());
    } else {
      // Restore based on current mode
      if (this.mode === 'jungle') {
        this.scene.background = new THREE.Color(getJungleBackgroundColor());
      } else {
        this.scene.background = new THREE.Color(getSoupBackgroundColor());
      }
    }
  }

  // ============================================
  // Update (called each frame)
  // ============================================

  /**
   * Update background particles and grid distortion based on current mode
   * @param dt - Delta time in milliseconds
   */
  update(dt: number): void {
    if (this.mode === 'soup') {
      this.soupCurrents.update(dt / 1000, getGravityWellCache());
      this.updateGridDistortion();
    } else {
      // Jungle mode: update all jungle particles and ambient effects
      const dtSeconds = dt / 1000;
      updateJungleParticles(this.jungleParticles, this.jungleParticleData, dtSeconds);
      updateSoupActivity(this.soupActivityPoints, this.soupActivityData, dtSeconds);
      updateUndergrowth(this.undergrowthPoints, this.undergrowthData, dtSeconds);
      updateFireflies(this.fireflyPoints, this.fireflyData, dtSeconds);
      updateGroundTexture(this.jungleBackgroundGroup, dtSeconds);
    }
  }

  /**
   * Update grid line distortion toward gravity wells
   * Called each frame in soup mode
   */
  private updateGridDistortion(): void {
    // Update gravity well cache on first frame (obstacles are static, so only need once)
    // We check each frame until we have obstacles, in case they load after init
    if (!this.gravityWellCacheUpdated && this.world) {
      updateGravityWellCache(this.world);
      // Only mark as updated if we actually found obstacles in the cache
      // (they may not be loaded yet on first frames)
      if (getGravityWellCache().length > 0) {
        this.gravityWellCacheUpdated = true;
      }
    }

    // Apply distortion to each grid line
    for (const { geometry, originalPositions } of this.gridLines) {
      updateGridLineDistortion(geometry, originalPositions);
    }
  }

  /**
   * Force refresh of gravity well cache
   * Call this after obstacles are synced from server
   */
  refreshGravityWellCache(): void {
    if (this.world) {
      updateGravityWellCache(this.world);
      this.gravityWellCacheUpdated = true;
    }
  }

  // ============================================
  // Soup Background Creation
  // ============================================

  private createGrid(): void {
    const gridSize = 100; // Grid cell size
    const gridColor = GAME_CONFIG.GRID_COLOR;
    const gridHeight = -1; // Height (below entities)

    // Number of segments per grid line for smooth distortion curves
    // Higher = smoother curves but more vertices. 20-30 is a good balance.
    const segmentsPerLine = 25;

    // Soup grid spans the soup region within the jungle coordinate space
    const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X;
    const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH;
    const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y;
    const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT;

    const material = new THREE.LineBasicMaterial({ color: gridColor });

    // Create lines parallel to Z axis (along game Y direction)
    // XZ plane: X=game X, Y=height, Z=-game Y
    for (let x = soupMinX; x <= soupMaxX; x += gridSize) {
      const { geometry, originalPositions } = createSubdividedLine(
        x,
        -soupMinY, // Start: Three.js coords (X, Z)
        x,
        -soupMaxY, // End: Three.js coords
        segmentsPerLine,
        gridHeight
      );
      const line = new THREE.Line(geometry, material);
      this.soupBackgroundGroup.add(line);
      this.gridLines.push({ geometry, originalPositions });
    }

    // Create lines parallel to X axis (along game X direction)
    for (let gameY = soupMinY; gameY <= soupMaxY; gameY += gridSize) {
      const { geometry, originalPositions } = createSubdividedLine(
        soupMinX,
        -gameY, // Start: Three.js coords
        soupMaxX,
        -gameY, // End: Three.js coords
        segmentsPerLine,
        gridHeight
      );
      const line = new THREE.Line(geometry, material);
      this.soupBackgroundGroup.add(line);
      this.gridLines.push({ geometry, originalPositions });
    }
  }
}
