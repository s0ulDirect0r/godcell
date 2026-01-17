// ============================================
// TrailSystem - Manages player trail rendering
// Owns trail point history and trail meshes
// Soup mode (Stage 1-2): trails for single-cells and multi-cells
// Jungle/God mode (Stage 3-5): trails only for godcells
// ============================================

import * as THREE from 'three';
import { updateTrails, disposeAllTrails } from '../effects/TrailEffect';
import type { RenderMode } from './EnvironmentSystem';
import { EvolutionStage } from '#shared';

/**
 * Player data needed for trail rendering
 */
interface TrailPlayerData {
  stage: EvolutionStage;
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
    // In jungle mode, only render trails for godcells (3D flight trails)
    if (renderMode === 'jungle') {
      // Filter to only godcell players
      const godcellPlayers = new Map<string, TrailPlayerData>();
      const godcellMeshes = new Map<string, THREE.Object3D>();

      players.forEach((player, id) => {
        if (player.stage === EvolutionStage.GODCELL) {
          godcellPlayers.set(id, player);
          const mesh = playerMeshes.get(id);
          if (mesh) godcellMeshes.set(id, mesh);
        }
      });

      // Clear non-godcell trails (e.g., when transitioning from soup to jungle)
      this.clearNonGodcellTrails();

      // Only update if there are godcells
      if (godcellPlayers.size > 0) {
        updateTrails(
          this.scene,
          this.trailPoints,
          this.trailMeshes,
          godcellMeshes as Map<string, THREE.Group>,
          godcellPlayers
        );
      }
      return;
    }

    // Soup mode: render trails for single-cells and multi-cells (not godcells)
    updateTrails(
      this.scene,
      this.trailPoints,
      this.trailMeshes,
      playerMeshes as Map<string, THREE.Group>,
      players
    );
  }

  /**
   * Clear trails that don't belong to godcells
   * Called when transitioning to jungle mode to clean up soup trails
   */
  private clearNonGodcellTrails(): void {
    const keysToRemove: string[] = [];

    this.trailMeshes.forEach((trail, key) => {
      // Keep trails with "_wingtip_" in the key (godcell trails)
      if (!key.includes('_wingtip_')) {
        this.scene.remove(trail);
        trail.geometry.dispose();
        (trail.material as THREE.Material).dispose();
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach((key) => {
      this.trailMeshes.delete(key);
      this.trailPoints.delete(key);
    });
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
