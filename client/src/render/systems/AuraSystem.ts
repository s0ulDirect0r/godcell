// ============================================
// AuraSystem - Manages drain and gain visual feedback auras
// Owns drain auras (red damage indicator) and gain auras (cyan energy collection)
// ============================================

import * as THREE from 'three';
import { EvolutionStage, DamageSource, GAME_CONFIG } from '@godcell/shared';
import {
  createCellAura,
  calculateAuraIntensity,
  getAuraColor,
  applyAuraIntensity,
} from '../effects/AuraEffect';
import {
  createGainAura,
  triggerGainFlash,
  updateGainAura,
} from '../effects/GainAuraEffect';

/**
 * Damage info for an entity (player or swarm)
 */
export interface EntityDamageInfo {
  totalDamageRate: number;
  primarySource: DamageSource;
  proximityFactor?: number;
}

/**
 * AuraSystem - Manages visual feedback auras for damage and energy gain
 *
 * Owns:
 * - Drain auras (red glow when taking damage)
 * - Gain auras (cyan glow when receiving energy)
 * - Previous energy tracking for gain detection
 */
export class AuraSystem {
  private scene!: THREE.Scene;

  // Drain auras (red glow for entities taking damage)
  private drainAuraMeshes: Map<string, THREE.Mesh | THREE.Group> = new Map();

  // Gain auras (cyan glow for players receiving energy)
  private gainAuraMeshes: Map<string, THREE.Group> = new Map();

  // Previous energy tracking for gain detection
  private previousEnergy: Map<string, number> = new Map();

  /**
   * Initialize aura system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  // ============================================
  // Utility
  // ============================================

  /**
   * Get player radius based on evolution stage
   */
  private getPlayerRadius(stage: string): number {
    if (stage === 'multi_cell' || stage === 'cyber_organism' || stage === 'humanoid' || stage === 'godcell') {
      return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER;
    }
    return GAME_CONFIG.PLAYER_SIZE;
  }

  // ============================================
  // Drain Aura Management
  // ============================================

  /**
   * Flash the drain aura on a target when hit by pseudopod beam
   * Temporarily increases brightness/scale for impact feedback
   */
  flashDrainAura(targetId: string): void {
    const auraMesh = this.drainAuraMeshes.get(targetId);
    if (!auraMesh) return; // No aura to flash (target may not be currently drained)

    // Boost emissive intensity for a brief flash (handled by applyAuraIntensity)
    // Use performance.now() for consistency with animation timing
    auraMesh.userData.flashTime = performance.now();
  }

  /**
   * Update drain visual feedback (variable-intensity aura around damaged entities)
   */
  updateDrainAuras(
    players: Map<string, { stage: string }>,
    swarms: Map<string, { size: number }>,
    playerMeshes: Map<string, THREE.Object3D>,
    swarmMeshes: Map<string, THREE.Object3D>,
    playerDamageInfo: Map<string, EntityDamageInfo>,
    swarmDamageInfo: Map<string, EntityDamageInfo>,
  ): void {
    const time = performance.now() * 0.001;

    // For each player, check if they should have a drain aura
    players.forEach((player, playerId) => {
      const playerMesh = playerMeshes.get(playerId);
      if (!playerMesh) return;

      const damageInfo = playerDamageInfo.get(playerId);

      if (damageInfo && damageInfo.totalDamageRate > 0) {
        // Create or update drain aura
        let auraMesh = this.drainAuraMeshes.get(playerId);

        if (!auraMesh) {
          const newAuraMesh = new THREE.Group();

          // For multi-cell: create auras around each individual cell sphere
          // For single-cell: create one aura around the whole organism
          if (player.stage === EvolutionStage.MULTI_CELL) {
            // Multi-cell: aura around each cell in the organism
            // Match the exact proportions from MultiCellRenderer.ts
            const baseRadius = this.getPlayerRadius(player.stage);
            const cellRadius = baseRadius * 0.35; // Individual cell size (same as multi-cell rendering)

            // Create aura for center cell (at origin)
            const centerAura = createCellAura(cellRadius);
            newAuraMesh.add(centerAura);

            // Create auras for ring cells (6 cells in hexagonal pattern)
            const ringRadius = cellRadius * 2.2; // Distance from center (same as multi-cell rendering)
            const cellCount = 6;
            for (let i = 0; i < cellCount; i++) {
              const angle = (i / cellCount) * Math.PI * 2;
              const x = Math.cos(angle) * ringRadius;
              const y = Math.sin(angle) * ringRadius;

              const ringAura = createCellAura(cellRadius);
              ringAura.position.set(x, y, 0);
              newAuraMesh.add(ringAura);
            }
          } else {
            // Single-cell: one aura around the whole organism
            const playerRadius = this.getPlayerRadius(player.stage);
            const singleAura = createCellAura(playerRadius);
            newAuraMesh.add(singleAura);
          }

          newAuraMesh.position.y = -1; // Below player (Y=height)
          this.drainAuraMeshes.set(playerId, newAuraMesh);
          this.scene.add(newAuraMesh);
          auraMesh = newAuraMesh;
        }

        // Type guard: ensure auraMesh exists after creation
        if (!auraMesh) return;

        // Position aura at player position (copy position and rotation to stay aligned)
        auraMesh.position.copy(playerMesh.position);
        auraMesh.rotation.copy(playerMesh.rotation);

        // Calculate intensity from damage rate
        const intensity = calculateAuraIntensity(damageInfo.totalDamageRate);

        // Get color based on primary damage source
        const color = getAuraColor(damageInfo.primarySource);

        // Apply intensity-based visuals
        applyAuraIntensity(auraMesh as THREE.Group, intensity, color, time, damageInfo.proximityFactor);

      } else {
        // Remove aura if player is no longer drained
        this.removeDrainAura(playerId);
      }
    });

    // For each swarm, check if they should have a drain aura
    swarms.forEach((swarm, swarmId) => {
      const swarmMesh = swarmMeshes.get(swarmId);
      if (!swarmMesh) return;

      const damageInfo = swarmDamageInfo.get(swarmId);
      const auraId = `swarm-${swarmId}`; // Prefix to distinguish from player auras

      if (damageInfo) {
        // Create or update drain aura for swarm
        let auraMesh = this.drainAuraMeshes.get(auraId);

        if (!auraMesh) {
          // Create aura using helper (consistent with player auras)
          const newAuraMesh = new THREE.Group();
          const swarmAura = createCellAura(swarm.size);
          newAuraMesh.add(swarmAura);
          newAuraMesh.position.y = -1; // Below swarm (Y=height)

          this.drainAuraMeshes.set(auraId, newAuraMesh);
          this.scene.add(newAuraMesh);
          auraMesh = newAuraMesh;
        }

        // Type guard: ensure auraMesh exists after creation
        if (!auraMesh) return;

        // Position aura at swarm position (XZ plane)
        auraMesh.position.x = swarmMesh.position.x;
        auraMesh.position.z = swarmMesh.position.z;

        // Calculate intensity from damage rate
        const intensity = calculateAuraIntensity(damageInfo.totalDamageRate);

        // Get color based on primary damage source
        const color = getAuraColor(damageInfo.primarySource);

        // Apply intensity-based visuals
        applyAuraIntensity(auraMesh as THREE.Group, intensity, color, time);

      } else {
        // Remove aura if swarm is no longer drained
        this.removeDrainAura(auraId);
      }
    });

    // Clean up auras for players/swarms that no longer exist
    this.drainAuraMeshes.forEach((auraMesh, id) => {
      let shouldCleanup = false;

      // Check if it's a player aura (no prefix) or swarm aura (has prefix)
      if (id.startsWith('swarm-')) {
        const swarmId = id.substring(6); // Remove "swarm-" prefix
        if (!swarms.has(swarmId)) {
          shouldCleanup = true;
        }
      } else {
        // Player aura
        if (!players.has(id)) {
          shouldCleanup = true;
        }
      }

      if (shouldCleanup) {
        this.scene.remove(auraMesh);
        this.disposeAuraMesh(auraMesh);
        this.drainAuraMeshes.delete(id);
      }
    });
  }

  /**
   * Helper to remove a drain aura by ID
   */
  private removeDrainAura(id: string): void {
    const auraMesh = this.drainAuraMeshes.get(id);
    if (auraMesh) {
      this.scene.remove(auraMesh);
      this.disposeAuraMesh(auraMesh);
      this.drainAuraMeshes.delete(id);
    }
  }

  // ============================================
  // Gain Aura Management
  // ============================================

  /**
   * Update energy gain visual feedback (cyan aura when collecting nutrients)
   * Detects continuous energy gain by comparing current vs previous energy
   * Triggers flash when energy increases, regardless of source
   *
   * @param players - Map of player IDs to their stage and energy
   * @param playerMeshes - Map of player IDs to their mesh objects
   * @param receivingEnergy - Mutated: players with detected energy gains are added to this set
   */
  updateGainAuras(
    players: Map<string, { stage: string; energy: number }>,
    playerMeshes: Map<string, THREE.Object3D>,
    receivingEnergy: Set<string>,
  ): void {
    // Calculate energy gains BEFORE updating previousEnergy (so we can use gains for intensity)
    const energyGains = new Map<string, number>();

    // Detect continuous energy gain by comparing to previous frame
    // This catches ALL energy sources: nutrients, draining, contact damage, etc.
    players.forEach((player, playerId) => {
      const prevEnergy = this.previousEnergy.get(playerId) ?? player.energy;
      const energyGain = player.energy - prevEnergy;

      // Trigger gain aura if energy increased (threshold prevents noise from float precision)
      if (energyGain > 0.1) {
        receivingEnergy.add(playerId);
        energyGains.set(playerId, energyGain); // Store for intensity calculation
      }

      // Store current energy for next frame comparison
      this.previousEnergy.set(playerId, player.energy);
    });

    // Clean up previous energy for players that no longer exist
    this.previousEnergy.forEach((_, playerId) => {
      if (!players.has(playerId)) {
        this.previousEnergy.delete(playerId);
      }
    });

    // For each player receiving energy, create or trigger gain aura
    receivingEnergy.forEach(playerId => {
      const playerMesh = playerMeshes.get(playerId);
      if (!playerMesh) return;

      const player = players.get(playerId);
      if (!player) return;

      let gainAura = this.gainAuraMeshes.get(playerId);

      if (!gainAura) {
        // Create new gain aura for this player
        const radius = this.getPlayerRadius(player.stage);
        gainAura = createGainAura(radius);
        gainAura.position.y = 0.05; // Slightly above player (Y=height)
        this.scene.add(gainAura);
        this.gainAuraMeshes.set(playerId, gainAura);
      }

      // Position aura at player position (XZ plane)
      gainAura.position.x = playerMesh.position.x;
      gainAura.position.z = playerMesh.position.z;

      // Trigger flash animation - intensity scales with energy gain rate
      const energyGain = energyGains.get(playerId) ?? 0;
      const intensity = Math.min(1.0, 0.3 + energyGain / 50); // Base 0.3 + scales with gain
      triggerGainFlash(gainAura, intensity);
    });

    // Update all active gain auras (animation)
    this.gainAuraMeshes.forEach((gainAura, playerId) => {
      const playerMesh = playerMeshes.get(playerId);
      if (!playerMesh) {
        // Player no longer exists - clean up
        this.scene.remove(gainAura);
        this.disposeGainAura(gainAura);
        this.gainAuraMeshes.delete(playerId);
        return;
      }

      // Keep aura positioned at player (XZ plane)
      gainAura.position.x = playerMesh.position.x;
      gainAura.position.z = playerMesh.position.z;

      // Update animation (returns false when finished)
      updateGainAura(gainAura);
    });
  }

  // ============================================
  // Cleanup Helpers
  // ============================================

  /**
   * Dispose an aura mesh (handles both Mesh and Group types)
   */
  private disposeAuraMesh(auraMesh: THREE.Mesh | THREE.Group): void {
    if (auraMesh instanceof THREE.Group) {
      auraMesh.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach(m => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });
    } else if (auraMesh instanceof THREE.Mesh) {
      auraMesh.geometry.dispose();
      const mat = auraMesh.material;
      if (Array.isArray(mat)) {
        mat.forEach(m => m.dispose());
      } else {
        mat.dispose();
      }
    }
  }

  /**
   * Dispose a gain aura group
   */
  private disposeGainAura(aura: THREE.Group): void {
    aura.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
  }

  /**
   * Clear all auras (for mode transitions)
   * Called when switching from soup to jungle mode
   */
  clearAll(): void {
    // Clean up drain auras
    this.drainAuraMeshes.forEach(auraMesh => {
      this.scene.remove(auraMesh);
      this.disposeAuraMesh(auraMesh);
    });
    this.drainAuraMeshes.clear();

    // Clean up gain auras
    this.gainAuraMeshes.forEach(aura => {
      this.scene.remove(aura);
      this.disposeGainAura(aura);
    });
    this.gainAuraMeshes.clear();

    // Clear energy tracking
    this.previousEnergy.clear();
  }

  /**
   * Dispose all aura resources
   */
  dispose(): void {
    this.clearAll();
  }
}
