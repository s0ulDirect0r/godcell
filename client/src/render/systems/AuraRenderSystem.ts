// ============================================
// AuraRenderSystem - Renders aura visual feedback from ECS components
// Queries DrainAura, GainAura, EvolutionAura components
// Filters by entity scale to match viewer
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  GAME_CONFIG,
  getEntityScale,
  type EntityScale,
  type EntityId,
  type StageComponent,
  type SwarmComponent,
  EvolutionStage,
} from '@godcell/shared';
import { ClientComponents } from '../../ecs/types';
import type { DrainAuraComponent, GainAuraComponent } from '../../ecs/components';
import { getStringIdByEntity } from '../../ecs/factories';
import {
  createCellAura,
  getAuraColor,
  applyAuraIntensity,
} from '../effects/AuraEffect';
import {
  createGainAura,
  triggerGainFlash,
  updateGainAura,
} from '../effects/GainAuraEffect';

/**
 * AuraRenderSystem - Renders visual feedback auras from ECS components
 *
 * Queries the ECS World for entities with aura components:
 * - DrainAuraComponent → red glow (damage feedback)
 * - GainAuraComponent → cyan/gold glow (energy gain feedback)
 * - EvolutionAuraComponent → molting visual (future)
 *
 * Scale filtering: Only renders auras for entities at the viewer's scale.
 * A soup-scale viewer sees soup entity auras, jungle-scale sees jungle auras.
 */
export class AuraRenderSystem {
  private scene!: THREE.Scene;

  // Drain auras (red glow for entities taking damage)
  private drainAuraMeshes: Map<string, THREE.Group> = new Map();

  // Gain auras (cyan/gold glow for entities receiving energy)
  private gainAuraMeshes: Map<string, THREE.Group> = new Map();

  // Track which meshes were active this frame (for cleanup)
  private activeDrainIds = new Set<string>();
  private activeGainIds = new Set<string>();

  /**
   * Initialize with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Get player radius based on evolution stage
   */
  private getPlayerRadius(stage: EvolutionStage): number {
    switch (stage) {
      case EvolutionStage.MULTI_CELL:
        return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER;
      case EvolutionStage.CYBER_ORGANISM:
        return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.CYBER_ORGANISM_SIZE_MULTIPLIER;
      case EvolutionStage.HUMANOID:
        return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.HUMANOID_SIZE_MULTIPLIER;
      case EvolutionStage.GODCELL:
        return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.GODCELL_SIZE_MULTIPLIER;
      default:
        return GAME_CONFIG.PLAYER_SIZE;
    }
  }

  /**
   * Sync aura meshes with ECS state
   * Queries ECS for entities with aura components, creates/updates/removes meshes
   *
   * @param world - ECS World to query
   * @param viewerScale - Current viewer's scale (for filtering)
   * @param playerMeshes - Map of player IDs to their mesh objects (for positioning)
   * @param swarmMeshes - Map of swarm IDs to their mesh objects (for positioning)
   */
  sync(
    world: World,
    viewerScale: EntityScale,
    playerMeshes: Map<string, THREE.Object3D>,
    swarmMeshes: Map<string, THREE.Object3D>
  ): void {
    this.activeDrainIds.clear();
    this.activeGainIds.clear();

    const time = Date.now() * 0.001;

    // Process player drain auras
    world.forEachWithTag(Tags.Player, (entity) => {
      const drainAura = world.getComponent<DrainAuraComponent>(entity, ClientComponents.DrainAura);
      const stage = world.getComponent<StageComponent>(entity, Components.Stage);
      const entityId = getStringIdByEntity(entity);

      if (!entityId || !stage) return;

      // Scale filtering: only render if entity is at viewer's scale
      const entityScale = getEntityScale(stage.stage);
      if (entityScale !== viewerScale) return;

      if (drainAura) {
        this.updateDrainAura(entity, entityId, drainAura, stage.stage, playerMeshes, time);
      }
    });

    // Process swarm drain auras
    world.forEachWithTag(Tags.Swarm, (entity) => {
      const drainAura = world.getComponent<DrainAuraComponent>(entity, ClientComponents.DrainAura);
      const swarmComp = world.getComponent<SwarmComponent>(entity, Components.Swarm);
      const entityId = getStringIdByEntity(entity);

      if (!entityId || !swarmComp) return;

      // Swarms are always soup-scale
      if (viewerScale !== 'soup') return;

      if (drainAura) {
        const auraId = `swarm-${entityId}`;
        this.updateSwarmDrainAura(entity, auraId, drainAura, swarmComp.size, swarmMeshes.get(entityId), time);
      }
    });

    // Process player gain auras
    world.forEachWithTag(Tags.Player, (entity) => {
      const gainAura = world.getComponent<GainAuraComponent>(entity, ClientComponents.GainAura);
      const stage = world.getComponent<StageComponent>(entity, Components.Stage);
      const entityId = getStringIdByEntity(entity);

      if (!entityId || !stage) return;

      // Scale filtering
      const entityScale = getEntityScale(stage.stage);
      if (entityScale !== viewerScale) return;

      if (gainAura) {
        this.updateGainAura(entity, entityId, gainAura, stage.stage, playerMeshes);
      }
    });

    // Cleanup meshes for entities that no longer have auras
    this.cleanupInactiveMeshes();
  }

  /**
   * Update or create drain aura for a player
   */
  private updateDrainAura(
    _entity: EntityId,
    entityId: string,
    drainAura: DrainAuraComponent,
    stage: EvolutionStage,
    playerMeshes: Map<string, THREE.Object3D>,
    time: number
  ): void {
    this.activeDrainIds.add(entityId);

    const playerMesh = playerMeshes.get(entityId);
    if (!playerMesh) return;

    let auraMesh = this.drainAuraMeshes.get(entityId);

    if (!auraMesh) {
      auraMesh = this.createPlayerDrainAura(stage);
      this.drainAuraMeshes.set(entityId, auraMesh);
      this.scene.add(auraMesh);
    }

    // Position aura at player
    auraMesh.position.copy(playerMesh.position);
    auraMesh.rotation.copy(playerMesh.rotation);

    // Get color based on damage source
    const color = getAuraColor(drainAura.source);

    // Apply intensity-based visuals
    applyAuraIntensity(auraMesh, drainAura.intensity, color, time, drainAura.proximityFactor);
  }

  /**
   * Create drain aura mesh group for a player
   */
  private createPlayerDrainAura(stage: EvolutionStage): THREE.Group {
    const auraMesh = new THREE.Group();

    if (stage === EvolutionStage.MULTI_CELL) {
      // Multi-cell: aura around each cell in the organism
      const baseRadius = this.getPlayerRadius(stage);
      const cellRadius = baseRadius * 0.35;

      // Center cell
      const centerAura = createCellAura(cellRadius);
      auraMesh.add(centerAura);

      // Ring cells (6 in hexagonal pattern)
      const ringRadius = cellRadius * 2.2;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const x = Math.cos(angle) * ringRadius;
        const y = Math.sin(angle) * ringRadius;

        const ringAura = createCellAura(cellRadius);
        ringAura.position.set(x, y, 0);
        auraMesh.add(ringAura);
      }
    } else {
      // Single aura for other stages
      const playerRadius = this.getPlayerRadius(stage);
      const singleAura = createCellAura(playerRadius);
      auraMesh.add(singleAura);
    }

    auraMesh.position.y = -1; // Below player (Y=height)
    return auraMesh;
  }

  /**
   * Update or create drain aura for a swarm
   */
  private updateSwarmDrainAura(
    _entity: EntityId,
    auraId: string,
    drainAura: DrainAuraComponent,
    swarmSize: number,
    swarmMesh: THREE.Object3D | undefined,
    time: number
  ): void {
    this.activeDrainIds.add(auraId);

    if (!swarmMesh) return;

    let auraMesh = this.drainAuraMeshes.get(auraId);

    if (!auraMesh) {
      auraMesh = new THREE.Group();
      const swarmAura = createCellAura(swarmSize);
      auraMesh.add(swarmAura);
      auraMesh.position.y = -1;

      this.drainAuraMeshes.set(auraId, auraMesh);
      this.scene.add(auraMesh);
    }

    // Position at swarm
    auraMesh.position.x = swarmMesh.position.x;
    auraMesh.position.z = swarmMesh.position.z;

    const color = getAuraColor(drainAura.source);
    applyAuraIntensity(auraMesh, drainAura.intensity, color, time);
  }

  /**
   * Update or create gain aura for a player
   */
  private updateGainAura(
    _entity: EntityId,
    entityId: string,
    gainAura: GainAuraComponent,
    stage: EvolutionStage,
    playerMeshes: Map<string, THREE.Object3D>
  ): void {
    this.activeGainIds.add(entityId);

    const playerMesh = playerMeshes.get(entityId);
    if (!playerMesh) return;

    let auraMesh = this.gainAuraMeshes.get(entityId);

    if (!auraMesh) {
      const radius = this.getPlayerRadius(stage);
      auraMesh = createGainAura(radius, gainAura.color);
      auraMesh.position.y = 0.05;
      this.gainAuraMeshes.set(entityId, auraMesh);
      this.scene.add(auraMesh);
    }

    // Position at player
    auraMesh.position.x = playerMesh.position.x;
    auraMesh.position.z = playerMesh.position.z;

    // Trigger flash if not already active or if retriggered
    if (!auraMesh.userData.active || auraMesh.userData.triggerTime !== gainAura.triggerTime) {
      triggerGainFlash(auraMesh, gainAura.intensity, gainAura.color);
      auraMesh.userData.triggerTime = gainAura.triggerTime;
    }

    // Update animation
    updateGainAura(auraMesh);
  }

  /**
   * Flash the drain aura on a target when hit by pseudopod beam
   */
  flashDrainAura(targetId: string): void {
    const auraMesh = this.drainAuraMeshes.get(targetId);
    if (!auraMesh) return;

    auraMesh.userData.flashTime = Date.now();
  }

  /**
   * Remove meshes for entities that no longer have aura components
   */
  private cleanupInactiveMeshes(): void {
    // Cleanup drain auras
    this.drainAuraMeshes.forEach((mesh, id) => {
      if (!this.activeDrainIds.has(id)) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        this.drainAuraMeshes.delete(id);
      }
    });

    // Cleanup gain auras
    this.gainAuraMeshes.forEach((mesh, id) => {
      if (!this.activeGainIds.has(id)) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        this.gainAuraMeshes.delete(id);
      }
    });
  }

  /**
   * Dispose a mesh group
   */
  private disposeMesh(mesh: THREE.Group): void {
    mesh.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mat = child.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    });
  }

  /**
   * Clear all auras
   */
  clearAll(): void {
    this.drainAuraMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      this.disposeMesh(mesh);
    });
    this.drainAuraMeshes.clear();

    this.gainAuraMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      this.disposeMesh(mesh);
    });
    this.gainAuraMeshes.clear();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
