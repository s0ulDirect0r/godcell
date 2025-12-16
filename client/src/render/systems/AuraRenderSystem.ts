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
  getEntityScale,
  isSphereMode,
  type EntityScale,
  type EntityId,
  type StageComponent,
  type SwarmComponent,
  EvolutionStage,
} from '#shared';
import { ClientComponents } from '../../ecs/types';
import type { DrainAuraComponent, GainAuraComponent } from '../../ecs/components';
import { getStringIdByEntity } from '../../ecs/factories';
import { createCellAura, getAuraColor, applyAuraIntensity } from '../effects/AuraEffect';
import { createGainAura, triggerGainFlash, updateGainAura } from '../effects/GainAuraEffect';

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

  // Note: Player radius is now stored in StageComponent.radius and read directly from ECS
  // The getPlayerRadius() method has been removed - radius flows from server via ECS

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

    const time = performance.now() * 0.001;

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
        this.updateDrainAura(entity, entityId, drainAura, stage, playerMeshes, time);
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
        this.updateSwarmDrainAura(
          entity,
          auraId,
          drainAura,
          swarmComp.size,
          swarmMeshes.get(entityId),
          time
        );
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
        this.updateGainAura(entity, entityId, gainAura, stage, playerMeshes);
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
    stageComp: StageComponent,
    playerMeshes: Map<string, THREE.Object3D>,
    time: number
  ): void {
    const stage = stageComp.stage;
    this.activeDrainIds.add(entityId);

    const playerMesh = playerMeshes.get(entityId);
    if (!playerMesh) return;

    let auraMesh = this.drainAuraMeshes.get(entityId);

    // Recreate aura if player evolved to a new stage
    if (auraMesh && auraMesh.userData.stage !== stage) {
      this.scene.remove(auraMesh);
      this.disposeMesh(auraMesh);
      auraMesh = undefined;
      this.drainAuraMeshes.delete(entityId);
    }

    if (!auraMesh) {
      auraMesh = this.createPlayerDrainAura(stageComp);
      auraMesh.userData.stage = stage;
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
  private createPlayerDrainAura(stageComp: StageComponent): THREE.Group {
    const auraMesh = new THREE.Group();

    if (stageComp.stage === EvolutionStage.MULTI_CELL) {
      // Multi-cell: aura around each cell in the organism
      const baseRadius = stageComp.radius;
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
      const playerRadius = stageComp.radius;
      const singleAura = createCellAura(playerRadius);
      auraMesh.add(singleAura);
    }

    // In flat mode, offset below player (Y=height)
    // In sphere mode, don't offset - position is set when syncing
    if (!isSphereMode()) {
      auraMesh.position.y = -1;
    }
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

    // Recreate aura if swarm size changed significantly (>20% difference)
    if (auraMesh && auraMesh.userData.swarmSize) {
      const sizeDiff =
        Math.abs(auraMesh.userData.swarmSize - swarmSize) / auraMesh.userData.swarmSize;
      if (sizeDiff > 0.2) {
        this.scene.remove(auraMesh);
        this.disposeMesh(auraMesh);
        auraMesh = undefined;
        this.drainAuraMeshes.delete(auraId);
      }
    }

    if (!auraMesh) {
      auraMesh = new THREE.Group();
      const swarmAura = createCellAura(swarmSize);
      auraMesh.add(swarmAura);
      // In flat mode, offset below swarm
      if (!isSphereMode()) {
        auraMesh.position.y = -1;
      }
      auraMesh.userData.swarmSize = swarmSize;

      this.drainAuraMeshes.set(auraId, auraMesh);
      this.scene.add(auraMesh);
    }

    // Position at swarm (full 3D for sphere mode)
    auraMesh.position.copy(swarmMesh.position);

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
    stageComp: StageComponent,
    playerMeshes: Map<string, THREE.Object3D>
  ): void {
    this.activeGainIds.add(entityId);

    const playerMesh = playerMeshes.get(entityId);
    if (!playerMesh) return;

    let auraMesh = this.gainAuraMeshes.get(entityId);

    if (!auraMesh) {
      auraMesh = createGainAura(stageComp.radius, gainAura.color);
      // In flat mode, slight height offset
      if (!isSphereMode()) {
        auraMesh.position.y = 0.05;
      }
      this.gainAuraMeshes.set(entityId, auraMesh);
      this.scene.add(auraMesh);
    }

    // Position at player (full 3D for sphere mode)
    auraMesh.position.copy(playerMesh.position);

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

    auraMesh.userData.flashTime = performance.now();
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
   * Dispose a mesh group recursively
   * Handles nested groups (e.g., createPlayerDrainAura creates Groups with cell auras)
   */
  private disposeMesh(mesh: THREE.Object3D): void {
    mesh.children.forEach((child) => {
      // Recursively dispose nested groups
      if (child instanceof THREE.Group) {
        this.disposeMesh(child);
      } else if (child instanceof THREE.Mesh) {
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
