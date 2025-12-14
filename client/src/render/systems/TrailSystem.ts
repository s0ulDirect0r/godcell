// ============================================
// TrailSystem - Manages player trail rendering
// Owns trail point history and trail meshes
// Stage-filtered: only renders in soup mode (Stage 1-2)
// ============================================

import * as THREE from 'three';
import { updateTrails, disposeAllTrails } from '../effects/TrailEffect';
import type { RenderMode } from './EnvironmentSystem';

/**
 * Player data needed for trail rendering
 */
interface TrailPlayerData {
  stage: string;
  color: string;
  energy: number;
  maxEnergy: number;
  radius: number;
}

/**
 * TrailSystem - Manages glowing ribbon trails behind players
 *
 * Owns:
 * - Trail point history for each player
 * - Trail mesh for each player
 */
export class TrailSystem {
  private scene!: THREE.Scene;

  // Trail point history (positions over time)
  private trailPoints: Map<string, Array<{ x: number; y: number }>> = new Map();

  // Trail meshes (tapered ribbons)
  private trailMeshes: Map<string, THREE.Mesh> = new Map();

  /**
   * Initialize trail system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Update all player trails
   * @param playerMeshes - Map of player ID to player mesh/group
   * @param players - Map of player ID to player data (stage, color, energy)
   * @param renderMode - Current render mode (soup vs jungle)
   */
  update(
    playerMeshes: Map<string, THREE.Object3D>,
    players: Map<string, TrailPlayerData>,
    renderMode: RenderMode
  ): void {
    // Trails are soup-world effects - hide/clear in jungle mode
    if (renderMode === 'jungle') {
      // Clear all trails when entering jungle mode
      if (this.trailMeshes.size > 0) {
        this.clearAll();
      }
      return;
    }

    updateTrails(
      this.scene,
      this.trailPoints,
      this.trailMeshes,
      playerMeshes as Map<string, THREE.Group>,
      players as Map<
        string,
        { stage: any; color: string; energy: number; maxEnergy: number; radius: number }
      >
    );
  }

  /**
   * Clear all trail meshes and point history
   * Called when transitioning to jungle mode
   */
  clearAll(): void {
    this.trailMeshes.forEach((trail) => {
      this.scene.remove(trail);
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
    });
    this.trailMeshes.clear();
    this.trailPoints.clear();
  }

  /**
   * Remove trail for a specific player (e.g., on death)
   */
  removeTrail(playerId: string): void {
    const trail = this.trailMeshes.get(playerId);
    if (trail) {
      this.scene.remove(trail);
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
      this.trailMeshes.delete(playerId);
    }
    this.trailPoints.delete(playerId);
  }

  /**
   * Set trail visibility for a specific player
   */
  setTrailVisible(playerId: string, visible: boolean): void {
    const trail = this.trailMeshes.get(playerId);
    if (trail) {
      trail.visible = visible;
    }
  }

  /**
   * Dispose all trails
   */
  dispose(): void {
    disposeAllTrails(this.scene, this.trailPoints, this.trailMeshes);
  }
}
