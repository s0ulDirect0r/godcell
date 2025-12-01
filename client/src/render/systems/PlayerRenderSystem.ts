// ============================================
// PlayerRenderSystem - Manages all player entity rendering
// Owns player meshes (all stages), outlines, evolution state, humanoid models
// Queries ECS World directly for player entities
// ============================================

import * as THREE from 'three';
import type { Player, EvolutionStage, DamageSource } from '@godcell/shared';
import { GAME_CONFIG, EvolutionStage as EvolutionStageEnum } from '@godcell/shared';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  getPlayer,
  getLocalPlayerId,
  type InterpolationTargetComponent,
  type ClientDamageInfoComponent,
} from '../../ecs';
import { createMultiCell, updateMultiCellEnergy } from '../meshes/MultiCellMesh';
import { createSingleCell, updateSingleCellEnergy } from '../meshes/SingleCellMesh';
import {
  createCyberOrganism,
  updateCyberOrganismAnimation,
  updateCyberOrganismEnergy,
} from '../meshes/CyberOrganismMesh';
import {
  createHumanoidModel,
  updateHumanoidAnimation,
  updateHumanoidEnergy,
  setHumanoidRotation,
  type HumanoidAnimationState,
} from '../meshes/HumanoidMesh';
import {
  createGodcell,
  updateGodcellEnergy,
  animateGodcell,
} from '../meshes/GodcellMesh';
import { updateCompassIndicators, disposeCompassIndicators } from '../three/CompassRenderer';
import {
  calculateEvolutionProgress,
  updateEvolutionCorona,
  updateEvolutionRing,
  removeEvolutionEffects,
  applyEvolutionEffects,
} from '../three/EvolutionVisuals';
import type { RenderMode } from './EnvironmentSystem';

/**
 * Interpolation target for smooth position updates
 */
export interface InterpolationTarget {
  x: number;
  y: number;
  timestamp: number;
}

/**
 * Damage info for visual feedback (auras, outline color)
 */
export interface PlayerDamageInfo {
  totalDamageRate: number;
  primarySource: DamageSource;
  proximityFactor?: number;
}

/**
 * Evolution animation state
 */
interface EvolutionState {
  startTime: number;
  duration: number;
  sourceStage: string;
  targetStage: string;
  sourceMesh?: THREE.Group;
  targetMesh?: THREE.Group;
}

/**
 * Detected entity for compass indicators
 */
interface DetectedEntity {
  id: string;
  position: { x: number; y: number };
  entityType: 'player' | 'nutrient' | 'swarm';
}

/**
 * PlayerRenderSystem - Manages all player entity rendering
 *
 * Owns:
 * - Player meshes (single-cell, multi-cell, cyber-organism, humanoid)
 * - Player outlines (white ring for local player)
 * - Evolution animation state (crossfade between stages)
 * - Humanoid models (async loaded GLTFs)
 * - Compass indicators (chemical sensing dots)
 */
export class PlayerRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Player meshes (Groups containing stage-appropriate geometry)
  private playerMeshes: Map<string, THREE.Group> = new Map();

  // White stroke outline for local player
  private playerOutlines: Map<string, THREE.Mesh> = new Map();

  // Evolution animation state (for crossfade during evolution)
  private playerEvolutionState: Map<string, EvolutionState> = new Map();

  // Humanoid models (async loaded GLTFs)
  private humanoidModels: Map<string, THREE.Group> = new Map();

  // Player IDs with pending humanoid loads
  private pendingHumanoidLoads: Set<string> = new Set();

  // Compass indicators (chemical sensing dots around player)
  private compassIndicators: THREE.Group | null = null;

  // Detected entities for compass (set externally)
  private detectedEntities: DetectedEntity[] = [];

  // Multi-cell visual style
  private multiCellStyle: 'colonial' | 'radial' = 'colonial';

  // Geometry cache (shared from ThreeRenderer)
  private geometryCache!: Map<string, THREE.BufferGeometry>;

  /**
   * Initialize player system with scene, world, and geometry cache
   */
  init(scene: THREE.Scene, world: World, geometryCache: Map<string, THREE.BufferGeometry>): void {
    this.scene = scene;
    this.world = world;
    this.geometryCache = geometryCache;
  }

  /**
   * Main sync method - called every frame
   * Creates new meshes, updates existing, removes stale
   * Queries ECS World directly for player entities
   */
  sync(renderMode: RenderMode, cameraYaw: number): void {
    const isJungleMode = renderMode === 'jungle';
    const myPlayerId = getLocalPlayerId(this.world);

    // Track which players exist in ECS
    const currentPlayerIds = new Set<string>();

    // Query ECS World for all players
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (!playerId) return;

      const player = getPlayer(this.world, playerId);
      if (!player) return;

      currentPlayerIds.add(playerId);

      // Get interpolation target and damage info from components
      const interp = this.world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
      const damageInfo = this.world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);

      const id = playerId;
      let cellGroup = this.playerMeshes.get(id);
      const isMyPlayer = id === myPlayerId;

      // Calculate size based on stage (needed for rendering and compass)
      const radius = this.getPlayerRadius(player.stage);

      // Check if stage changed (e.g., via dev panel) - need to recreate mesh
      if (cellGroup && cellGroup.userData.stage !== player.stage) {
        // Stage changed - remove old mesh and let it be recreated
        this.scene.remove(cellGroup);
        cellGroup.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
        this.playerMeshes.delete(id);
        cellGroup = undefined;

        // Also remove outline if it exists (will be recreated if needed)
        const outline = this.playerOutlines.get(id);
        if (outline) {
          this.scene.remove(outline);
          this.playerOutlines.delete(id);
        }

        // Clean up any evolution animation state and its meshes
        const evolState = this.playerEvolutionState.get(id);
        if (evolState) {
          if (evolState.sourceMesh) {
            this.scene.remove(evolState.sourceMesh);
          }
          if (evolState.targetMesh) {
            this.scene.remove(evolState.targetMesh);
          }
          this.playerEvolutionState.delete(id);
        }
      }

      if (!cellGroup) {
        // Parse hex color (#RRGGBB → 0xRRGGBB)
        const colorHex = parseInt(player.color.replace('#', ''), 16);

        // Create cell based on stage
        if (player.stage === 'humanoid') {
          // Stage 4: Humanoid (loaded async)
          const existingHumanoid = this.humanoidModels.get(id);
          if (existingHumanoid) {
            cellGroup = existingHumanoid;
          } else {
            // Start async load if not already loading
            if (!this.pendingHumanoidLoads.has(id)) {
              this.pendingHumanoidLoads.add(id);
              createHumanoidModel(colorHex).then(({ model }) => {
                this.pendingHumanoidLoads.delete(id);
                this.humanoidModels.set(id, model);

                // Replace placeholder with loaded model
                const placeholder = this.playerMeshes.get(id);
                if (placeholder) {
                  this.scene.remove(placeholder);
                }
                model.userData.stage = 'humanoid';
                model.userData.isHumanoid = true;
                this.scene.add(model);
                this.playerMeshes.set(id, model);
              }).catch(err => {
                console.error('Failed to load humanoid model:', err);
                this.pendingHumanoidLoads.delete(id);
              });
            }
            // Use cyber-organism as placeholder while humanoid loads
            cellGroup = createCyberOrganism(radius, colorHex);
            cellGroup.userData.isHumanoidPlaceholder = true;
          }
        } else if (player.stage === 'godcell') {
          // Stage 5: Godcell - glowing sphere for 3D flight
          cellGroup = createGodcell(radius, colorHex);
        } else if (player.stage === 'cyber_organism') {
          // Stage 3: Cyber-organism hexapod
          cellGroup = createCyberOrganism(radius, colorHex);
        } else if (player.stage === 'multi_cell') {
          // Multi-cell organism
          cellGroup = createMultiCell({
            radius,
            colorHex,
            style: this.multiCellStyle,
          });
        } else {
          // Single-cell organism
          cellGroup = createSingleCell(radius, colorHex);
        }

        // Position group at player location on XZ plane (Y=height)
        // Lift Stage 3+ creatures above the grid (legs extend downward)
        const heightOffset = (player.stage === 'cyber_organism' || player.stage === 'humanoid' || player.stage === 'godcell') ? 5 : 0;
        cellGroup.position.set(player.position.x, heightOffset, -player.position.y);

        // Store stage for change detection
        cellGroup.userData.stage = player.stage;

        this.scene.add(cellGroup);
        this.playerMeshes.set(id, cellGroup);

        // Add white stroke outline for client player
        if (isMyPlayer) {
          // Outline radius accounts for visual extent (legs extend beyond body for cyber-organism)
          const outlineRadius = this.getOutlineRadius(player.stage, radius);
          const outlineGeometry = this.getGeometry(`ring-outline-${outlineRadius}`, () =>
            new THREE.RingGeometry(outlineRadius, outlineRadius + 3, 32)
          );
          // Don't cache outline material - needs to change color and opacity dynamically
          const outlineMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 1.0,
            transparent: true,
            opacity: 1.0,
            depthWrite: false,
          });
          const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
          outline.position.y = 0.1;
          outline.rotation.x = -Math.PI / 2;
          this.scene.add(outline);
          this.playerOutlines.set(id, outline);
        }
      }

      // Update cell visuals based on stage and energy
      this.updatePlayerVisuals(cellGroup, player, isMyPlayer, cameraYaw);

      // Apply evolution effects if player is evolving
      const evolState = this.playerEvolutionState.get(id);
      if (evolState) {
        this.updateEvolutionAnimation(cellGroup, evolState);
      }

      // Update outline opacity and color for client player
      if (isMyPlayer) {
        // Convert component to PlayerDamageInfo if present
        const damageInfoForOutline = damageInfo ? {
          totalDamageRate: damageInfo.totalDamageRate,
          primarySource: damageInfo.primarySource,
          proximityFactor: damageInfo.proximityFactor,
        } : undefined;
        this.updatePlayerOutline(id, player, damageInfoForOutline);
      }

      // Update position with client-side interpolation
      if (interp) {
        const target: InterpolationTarget = {
          x: interp.targetX,
          y: interp.targetY,
          timestamp: interp.timestamp,
        };
        this.interpolatePosition(cellGroup, target, id, isMyPlayer, radius, player.stage);
      } else {
        // Fallback to direct position if no target
        const heightOffset = (player.stage === 'cyber_organism' || player.stage === 'humanoid' || player.stage === 'godcell') ? 5 : 0;
        cellGroup.position.set(player.position.x, heightOffset, -player.position.y);

        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.set(player.position.x, heightOffset + 0.1, -player.position.y);
        }

        // Update compass indicators (multi-cell only - chemical sensing ability)
        if (isMyPlayer) {
          const isMultiCell = player.stage === EvolutionStageEnum.MULTI_CELL;
          if (isMultiCell) {
            this.compassIndicators = updateCompassIndicators(
              this.scene,
              this.compassIndicators,
              this.detectedEntities,
              { x: player.position.x, y: player.position.y },
              radius,
              player.stage
            );
          } else if (this.compassIndicators) {
            // Clear compass for jungle stages
            disposeCompassIndicators(this.compassIndicators);
            this.scene.remove(this.compassIndicators);
            this.compassIndicators = null;
          }
        }
      }

      // Cross-stage visibility
      const playerIsJungleStage = (
        player.stage === EvolutionStageEnum.CYBER_ORGANISM ||
        player.stage === EvolutionStageEnum.HUMANOID ||
        player.stage === EvolutionStageEnum.GODCELL
      );
      const shouldBeVisible = isMyPlayer || (isJungleMode === playerIsJungleStage);
      cellGroup.visible = shouldBeVisible;

      const outline = this.playerOutlines.get(id);
      if (outline) {
        outline.visible = shouldBeVisible;
      }
    });

    // Remove players that no longer exist in ECS
    this.playerMeshes.forEach((_group, id) => {
      if (!currentPlayerIds.has(id)) {
        this.removePlayerInternal(id);
      }
    });
  }

  /**
   * Update detected entities for compass indicators
   */
  setDetectedEntities(entities: DetectedEntity[]): void {
    this.detectedEntities = entities;
  }

  /**
   * Start evolution animation
   */
  startEvolution(
    playerId: string,
    sourceStage: string,
    targetStage: string,
    duration: number,
    targetRadius: number,
    colorHex: number
  ): void {
    const sourceGroup = this.playerMeshes.get(playerId);
    if (!sourceGroup) return;

    // Create target mesh based on new stage
    let targetMesh: THREE.Group;
    if (targetStage === 'humanoid') {
      targetMesh = createCyberOrganism(targetRadius, colorHex);
      targetMesh.userData.isHumanoidPlaceholder = true;
    } else if (targetStage === 'godcell') {
      targetMesh = createGodcell(targetRadius, colorHex);
    } else if (targetStage === 'cyber_organism') {
      targetMesh = createCyberOrganism(targetRadius, colorHex);
    } else if (targetStage === 'multi_cell') {
      targetMesh = createMultiCell({
        radius: targetRadius,
        colorHex,
        style: this.multiCellStyle,
      });
    } else {
      targetMesh = createSingleCell(targetRadius, colorHex);
    }

    // Position target at same location
    targetMesh.position.copy(sourceGroup.position);
    targetMesh.userData.stage = targetStage;

    // Start hidden (will fade in during crossfade)
    this.setGroupOpacity(targetMesh, 0);
    this.scene.add(targetMesh);

    this.playerEvolutionState.set(playerId, {
      startTime: Date.now(),
      duration,
      sourceStage,
      targetStage,
      sourceMesh: sourceGroup,
      targetMesh,
    });
  }

  /**
   * Complete evolution animation - swap to target mesh
   */
  completeEvolution(playerId: string): void {
    const evolState = this.playerEvolutionState.get(playerId);
    if (!evolState) return;

    // Remove source mesh
    if (evolState.sourceMesh) {
      this.scene.remove(evolState.sourceMesh);
    }

    // Make target mesh fully visible and set as player mesh
    if (evolState.targetMesh) {
      this.setGroupOpacity(evolState.targetMesh, 1);
      evolState.targetMesh.scale.setScalar(1);
      this.playerMeshes.set(playerId, evolState.targetMesh);
    }

    this.playerEvolutionState.delete(playerId);
  }

  /**
   * Remove a player (called from playerDied handler)
   */
  removePlayer(playerId: string): void {
    this.removePlayerInternal(playerId);
  }

  /**
   * Get player mesh for external access
   */
  getPlayerMesh(playerId: string): THREE.Group | undefined {
    return this.playerMeshes.get(playerId);
  }

  /**
   * Get all player meshes (for TrailSystem, AuraSystem)
   */
  getPlayerMeshes(): Map<string, THREE.Group> {
    return this.playerMeshes;
  }

  /**
   * Get player position from mesh (game coordinates)
   */
  getPlayerPosition(playerId: string): { x: number; y: number } | undefined {
    const group = this.playerMeshes.get(playerId);
    if (!group) return undefined;
    return { x: group.position.x, y: -group.position.z };
  }

  /**
   * Get player color from mesh
   */
  getPlayerColor(playerId: string): number {
    const group = this.playerMeshes.get(playerId);
    if (!group) return 0x00ffff;

    const firstChild = group.children[0];
    if (firstChild instanceof THREE.Group && firstChild.children.length > 1) {
      const nucleus = firstChild.children[1] as THREE.Mesh;
      if (nucleus?.material) {
        return (nucleus.material as THREE.MeshStandardMaterial).color?.getHex() ?? 0x00ffff;
      }
    } else if (group.children[3]) {
      const nucleus = group.children[3] as THREE.Mesh;
      if (nucleus?.material) {
        return (nucleus.material as THREE.MeshStandardMaterial).color?.getHex() ?? 0x00ffff;
      }
    }
    return 0x00ffff;
  }

  /**
   * Calculate player visual size based on evolution stage
   */
  getPlayerRadius(stage: string): number {
    if (stage === 'godcell') {
      return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.GODCELL_SIZE_MULTIPLIER;
    }
    if (stage === 'humanoid') {
      return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.HUMANOID_SIZE_MULTIPLIER;
    }
    if (stage === 'cyber_organism') {
      return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.CYBER_ORGANISM_SIZE_MULTIPLIER;
    }
    if (stage === 'multi_cell') {
      return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER;
    }
    return GAME_CONFIG.PLAYER_SIZE;
  }

  /**
   * Get outline radius - accounts for visual extent of creature
   * Cyber-organism has legs + long tail extending beyond body
   */
  getOutlineRadius(stage: string, bodyRadius: number): number {
    if (stage === 'cyber_organism') {
      return bodyRadius * 2.8; // Legs + tail extend well beyond body
    }
    return bodyRadius;
  }

  /**
   * Update outline for new stage after evolution
   */
  updateOutlineForStage(playerId: string, stage: string): void {
    const oldOutline = this.playerOutlines.get(playerId);
    if (!oldOutline) return;

    // Remove old outline
    this.scene.remove(oldOutline);
    (oldOutline.material as THREE.Material).dispose();

    // Create new outline with correct size (accounting for visual extent)
    const bodyRadius = this.getPlayerRadius(stage);
    const outlineRadius = this.getOutlineRadius(stage, bodyRadius);
    const outlineGeometry = this.getGeometry(`ring-outline-${outlineRadius}`, () =>
      new THREE.RingGeometry(outlineRadius, outlineRadius + 3, 32)
    );
    const outlineMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });
    const newOutline = new THREE.Mesh(outlineGeometry, outlineMaterial);
    newOutline.position.y = 0.1;
    newOutline.rotation.x = -Math.PI / 2;
    this.scene.add(newOutline);
    this.playerOutlines.set(playerId, newOutline);
  }

  /**
   * Set trail visibility (delegates to external - called from sync)
   */
  setTrailVisibleCallback: ((playerId: string, visible: boolean) => void) | null = null;

  /**
   * Clear all player meshes
   */
  clearAll(): void {
    this.playerMeshes.forEach((_group, id) => {
      this.removePlayerInternal(id);
    });
  }

  /**
   * Get count of player meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.playerMeshes.size;
  }

  /**
   * Dispose all player resources
   */
  dispose(): void {
    this.clearAll();

    // Clean up humanoid models
    this.humanoidModels.forEach((model) => {
      this.scene.remove(model);
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    });
    this.humanoidModels.clear();
    this.pendingHumanoidLoads.clear();

    // Clean up compass
    if (this.compassIndicators) {
      disposeCompassIndicators(this.compassIndicators);
      this.scene.remove(this.compassIndicators);
      this.compassIndicators = null;
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  private removePlayerInternal(playerId: string): void {
    const group = this.playerMeshes.get(playerId);
    if (group) {
      this.scene.remove(group);
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          if ((child.material as THREE.Material).dispose) {
            (child.material as THREE.Material).dispose();
          }
        }
      });
      this.playerMeshes.delete(playerId);
    }

    const outline = this.playerOutlines.get(playerId);
    if (outline) {
      this.scene.remove(outline);
      this.playerOutlines.delete(playerId);
    }

    // Clean up evolution state
    const evolState = this.playerEvolutionState.get(playerId);
    if (evolState) {
      if (evolState.sourceMesh) this.scene.remove(evolState.sourceMesh);
      if (evolState.targetMesh) this.scene.remove(evolState.targetMesh);
      this.playerEvolutionState.delete(playerId);
    }
  }

  private updatePlayerVisuals(
    cellGroup: THREE.Group,
    player: Player,
    isMyPlayer: boolean,
    cameraYaw: number
  ): void {
    if (player.stage === 'humanoid' && cellGroup.userData.isHumanoid) {
      // Stage 4: Humanoid
      const energyRatio = player.energy / player.maxEnergy;
      updateHumanoidEnergy(cellGroup, energyRatio);

      // Check if player is moving
      const prevPos = cellGroup.userData.lastPosition as { x: number; y: number } | undefined;
      const currPos = player.position;
      const isMoving = prevPos
        ? Math.abs(currPos.x - prevPos.x) > 1 || Math.abs(currPos.y - prevPos.y) > 1
        : false;
      cellGroup.userData.lastPosition = { x: currPos.x, y: currPos.y };

      // Calculate speed for animation blending
      const speed = prevPos
        ? Math.sqrt(Math.pow(currPos.x - prevPos.x, 2) + Math.pow(currPos.y - prevPos.y, 2)) * 60
        : 0;

      // Update humanoid animation
      const animState = cellGroup.userData.animState as HumanoidAnimationState | undefined;
      if (animState) {
        updateHumanoidAnimation(animState, 1 / 60, isMoving, speed);
      }

      // Rotation
      if (isMyPlayer) {
        setHumanoidRotation(cellGroup, cameraYaw);
      } else if (prevPos && isMoving) {
        const dx = currPos.x - prevPos.x;
        const dy = currPos.y - prevPos.y;
        const targetHeading = Math.atan2(dy, dx);
        setHumanoidRotation(cellGroup, targetHeading);
      }

      cellGroup.position.set(player.position.x, 0, -player.position.y);

    } else if (player.stage === 'godcell') {
      // Stage 5: Godcell - 3D flying sphere
      const energyRatio = player.energy / player.maxEnergy;
      updateGodcellEnergy(cellGroup, energyRatio);
      animateGodcell(cellGroup, 1 / 60);

      // Godcell uses 3D position (z from player.position)
      const posZ = player.position.z ?? 0;
      // Convert game coordinates to Three.js: game Y → -Z, game Z → Y
      cellGroup.position.set(player.position.x, posZ, -player.position.y);

    } else if (player.stage === 'cyber_organism') {
      // Stage 3: Cyber-organism
      const energyRatio = player.energy / player.maxEnergy;
      updateCyberOrganismEnergy(cellGroup, energyRatio);

      const prevPos = cellGroup.userData.lastPosition as { x: number; y: number } | undefined;
      const currPos = player.position;
      const isMoving = prevPos
        ? Math.abs(currPos.x - prevPos.x) > 1 || Math.abs(currPos.y - prevPos.y) > 1
        : false;
      cellGroup.userData.lastPosition = { x: currPos.x, y: currPos.y };

      // Update heading
      if (prevPos && isMoving) {
        const dx = currPos.x - prevPos.x;
        const dy = currPos.y - prevPos.y;
        const targetHeading = Math.atan2(dy, dx) + Math.PI;

        if (cellGroup.userData.heading === undefined) {
          cellGroup.userData.heading = targetHeading;
        }

        let currentHeading = cellGroup.userData.heading as number;
        let delta = targetHeading - currentHeading;

        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        currentHeading += delta * 0.15;
        cellGroup.userData.heading = currentHeading;
        cellGroup.rotation.z = currentHeading;
      }

      updateCyberOrganismAnimation(cellGroup, isMoving, 1 / 60);

    } else if (player.stage === 'multi_cell') {
      updateMultiCellEnergy(cellGroup, this.multiCellStyle, player.energy, player.maxEnergy);
    } else {
      this.updateCellEnergy(cellGroup, player.energy, player.maxEnergy, player.stage);
    }
  }

  private updateCellEnergy(
    cellGroup: THREE.Group,
    energy: number,
    maxEnergy: number,
    stage: EvolutionStage
  ): void {
    updateSingleCellEnergy(cellGroup, energy, maxEnergy);

    const evolutionProgress = calculateEvolutionProgress(maxEnergy, stage);
    const isApproachingEvolution = evolutionProgress >= 0.3;

    if (isApproachingEvolution) {
      // Pulsing scale effect
      const time = Date.now() * 0.003;
      const pulseIntensity = 0.05 + evolutionProgress * 0.05;
      const cellPulse = 1.0 + Math.sin(time) * pulseIntensity;
      cellGroup.scale.set(cellPulse, cellPulse, cellPulse);

      // Particle corona
      updateEvolutionCorona(cellGroup, evolutionProgress);

      // Glow ring
      updateEvolutionRing(cellGroup, evolutionProgress, cellGroup.userData.radius || 10);
    } else {
      cellGroup.scale.set(1, 1, 1);
      removeEvolutionEffects(cellGroup);
    }
  }

  private updateEvolutionAnimation(cellGroup: THREE.Group, evolState: EvolutionState): void {
    const elapsed = Date.now() - evolState.startTime;
    const progress = Math.min(elapsed / evolState.duration, 1.0);

    if (evolState.sourceMesh) {
      applyEvolutionEffects(evolState.sourceMesh, evolState.sourceStage, progress);
    }
    if (evolState.targetMesh) {
      applyEvolutionEffects(evolState.targetMesh, evolState.targetStage, progress);

      // Crossfade
      const sourceOpacity = 1.0 - progress;
      const targetOpacity = progress;

      if (evolState.sourceMesh) {
        this.setGroupOpacity(evolState.sourceMesh, sourceOpacity);
        evolState.sourceMesh.scale.setScalar(1.0 - progress * 0.15);
      }
      this.setGroupOpacity(evolState.targetMesh, targetOpacity);
      evolState.targetMesh.scale.setScalar(0.7 + progress * 0.3);

      // Keep both at same position
      evolState.targetMesh.position.copy(cellGroup.position);
    }
  }

  private updatePlayerOutline(
    playerId: string,
    player: Player,
    damageInfo: PlayerDamageInfo | undefined
  ): void {
    const outline = this.playerOutlines.get(playerId);
    if (!outline) return;

    const energyRatio = player.energy / player.maxEnergy;
    const outlineMaterial = outline.material as THREE.MeshStandardMaterial;
    outlineMaterial.opacity = energyRatio;

    if (damageInfo && damageInfo.totalDamageRate > 0) {
      outlineMaterial.color.setRGB(1.0, 0.0, 0.0);
      outlineMaterial.emissive.setRGB(1.0, 0.0, 0.0);
      outlineMaterial.emissiveIntensity = 2.0;
    } else {
      outlineMaterial.color.setRGB(1.0, 1.0, 1.0);
      outlineMaterial.emissive.setRGB(1.0, 1.0, 1.0);
      outlineMaterial.emissiveIntensity = 1.0;
    }
  }

  private interpolatePosition(
    cellGroup: THREE.Group,
    target: InterpolationTarget,
    playerId: string,
    isMyPlayer: boolean,
    radius: number,
    stage: string
  ): void {
    const lerpFactor = 0.3;
    cellGroup.position.x += (target.x - cellGroup.position.x) * lerpFactor;
    const targetZ = -target.y;
    cellGroup.position.z += (targetZ - cellGroup.position.z) * lerpFactor;

    const outline = this.playerOutlines.get(playerId);
    if (outline) {
      outline.position.x = cellGroup.position.x;
      outline.position.z = cellGroup.position.z;
    }

    // Update compass indicators for client player (multi-cell only)
    // XZ plane: game Y maps to -Z
    if (isMyPlayer) {
      const isMultiCell = stage === 'multi_cell';
      if (isMultiCell) {
        this.compassIndicators = updateCompassIndicators(
          this.scene,
          this.compassIndicators,
          this.detectedEntities,
          { x: cellGroup.position.x, y: -cellGroup.position.z },
          radius,
          stage as EvolutionStage
        );
      } else if (this.compassIndicators) {
        // Clear compass for jungle stages
        disposeCompassIndicators(this.compassIndicators);
        this.scene.remove(this.compassIndicators);
        this.compassIndicators = null;
      }
    }
  }

  private setGroupOpacity(group: THREE.Group, opacity: number): void {
    group.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.Material;
        if ('opacity' in material) {
          (material as any).opacity = opacity;
        }
        if ('uniforms' in material && (material as any).uniforms.opacity) {
          (material as any).uniforms.opacity.value = opacity;
        }
      } else if (child instanceof THREE.Points) {
        const material = child.material as THREE.PointsMaterial;
        material.opacity = opacity;
      } else if (child instanceof THREE.Group) {
        this.setGroupOpacity(child, opacity);
      }
    });
  }

  private getGeometry(
    key: string,
    factory: () => THREE.BufferGeometry
  ): THREE.BufferGeometry {
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = factory();
      this.geometryCache.set(key, geometry);
    }
    return geometry;
  }
}
