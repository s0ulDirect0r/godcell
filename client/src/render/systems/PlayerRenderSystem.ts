// ============================================
// PlayerRenderSystem - Manages all player entity rendering
// Owns player meshes (all stages), outlines, evolution state, humanoid models
// Queries ECS World directly for player entities
// ============================================

import * as THREE from 'three';
import type { Player, EvolutionStage, DamageSource } from '#shared';
import { GAME_CONFIG, EvolutionStage as EvolutionStageEnum, getSurfaceNormal, toVec3 } from '#shared';
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
import { createGodcell, updateGodcellEnergy, animateGodcell } from '../meshes/GodcellMesh';
import { updateCompassIndicators, disposeCompassIndicators } from '../three/CompassRenderer';
import {
  calculateEntityWarp,
  calculateEntityWarp3D,
  applyEntityWarp,
  applyEntityWarpSphere,
  resetEntityWarp,
} from '../utils/GravityDistortionUtils';
import { frameLerp } from '../../utils/math';
import {
  calculateEvolutionProgress,
  updateEvolutionCorona,
  updateEvolutionRing,
  removeEvolutionEffects,
  applyEvolutionEffects,
} from '../three/EvolutionVisuals';
import type { RenderMode } from './EnvironmentSystem';
import { orientFlatToSurface, orientHexapodToSurface } from '../utils/SphereRenderUtils';

/**
 * Interpolation target for smooth position updates
 * In sphere mode: x, y, z are 3D world coordinates
 * In flat mode: x, y are game coordinates (y maps to -Z in Three.js)
 */
export interface InterpolationTarget {
  x: number;
  y: number;
  z?: number;
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

  // Delta time for frame-rate independent interpolation (ms)
  private dt: number = 16.67;

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
   * @param renderMode Current render mode (soup/jungle)
   * @param cameraYaw Camera yaw for humanoid rotation
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  sync(renderMode: RenderMode, cameraYaw: number, dt: number = 16.67): void {
    this.dt = dt;
    const isJungleMode = renderMode === 'jungle';
    const myPlayerId = getLocalPlayerId(this.world);

    // Track which players exist in ECS
    const currentPlayerIds = new Set<string>();

    // Query ECS World for all players
    // DEBUG: Count how many times we process each player
    const playerProcessCount = new Map<string, number>();

    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (!playerId) return;

      const player = getPlayer(this.world, playerId);
      if (!player) return;

      // DEBUG: Track duplicate processing
      const count = (playerProcessCount.get(playerId) ?? 0) + 1;
      playerProcessCount.set(playerId, count);
      if (count > 1 && playerId === getLocalPlayerId(this.world)) {
        console.error('[DUPLICATE PLAYER PROCESSING]', { playerId, count, entity });
      }

      currentPlayerIds.add(playerId);

      // Get interpolation target and damage info from components
      const interp = this.world.getComponent<InterpolationTargetComponent>(
        entity,
        Components.InterpolationTarget
      );
      const damageInfo = this.world.getComponent<ClientDamageInfoComponent>(
        entity,
        Components.ClientDamageInfo
      );

      const id = playerId;
      let cellGroup = this.playerMeshes.get(id);
      const isMyPlayer = id === myPlayerId;

      // Use radius from ECS (flows from server)
      const radius = player.radius;

      // Check if stage changed (e.g., via dev panel) - need to recreate mesh
      if (cellGroup && cellGroup.userData.stage !== player.stage) {
        // Stage changed - remove old mesh and let it be recreated
        this.scene.remove(cellGroup);
        cellGroup.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
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

        // Clean up any evolution animation state and its meshes (dispose to prevent GPU memory leak)
        const evolState = this.playerEvolutionState.get(id);
        if (evolState) {
          if (evolState.sourceMesh) {
            this.scene.remove(evolState.sourceMesh);
            this.disposeGroup(evolState.sourceMesh);
          }
          if (evolState.targetMesh) {
            this.scene.remove(evolState.targetMesh);
            this.disposeGroup(evolState.targetMesh);
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
              createHumanoidModel(colorHex)
                .then(({ model }) => {
                  this.pendingHumanoidLoads.delete(id);
                  this.humanoidModels.set(id, model);

                  // Replace placeholder with loaded model - but only if player is still humanoid
                  // This prevents race condition where player evolves to godcell before model loads
                  const placeholder = this.playerMeshes.get(id);
                  if (placeholder && placeholder.userData.stage === 'humanoid') {
                    this.scene.remove(placeholder);
                    model.userData.stage = 'humanoid';
                    model.userData.isHumanoid = true;
                    this.scene.add(model);
                    this.playerMeshes.set(id, model);
                  }
                })
                .catch((err) => {
                  console.error('Failed to load humanoid model:', err);
                  this.pendingHumanoidLoads.delete(id);
                });
            }
            // Use cyber-organism as placeholder while humanoid loads
            cellGroup = createCyberOrganism(radius, colorHex);
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

        // Position group at player location (sphere surface coordinates)
        // ALWAYS use authoritative player.position from server, NOT InterpolationTarget
        // InterpolationTarget may be stale during evolution transitions
        const spawnPos = player.position;
        cellGroup.position.set(spawnPos.x, spawnPos.y, spawnPos.z ?? 0);

        // Reset InterpolationTarget to match spawn position to avoid initial gap
        if (interp) {
          interp.targetX = spawnPos.x;
          interp.targetY = spawnPos.y;
          interp.targetZ = spawnPos.z ?? 0;
        }

        // Orient flat organisms to lie on sphere surface
        if (player.stage === 'single_cell' || player.stage === 'multi_cell') {
          orientFlatToSurface(cellGroup, spawnPos);
        }
        cellGroup.userData.isSphere = true;

        // Store stage for change detection
        cellGroup.userData.stage = player.stage;

        this.scene.add(cellGroup);
        this.playerMeshes.set(id, cellGroup);

        // Add white stroke outline for client player
        if (isMyPlayer) {
          // Outline radius accounts for visual extent (legs extend beyond body for cyber-organism)
          const outlineRadius = this.getOutlineRadius(player.stage, radius);
          const outlineGeometry = this.getGeometry(
            `ring-outline-${outlineRadius}`,
            () => new THREE.RingGeometry(outlineRadius, outlineRadius + 3, 32)
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
        const damageInfoForOutline = damageInfo
          ? {
              totalDamageRate: damageInfo.totalDamageRate,
              primarySource: damageInfo.primarySource,
              proximityFactor: damageInfo.proximityFactor,
            }
          : undefined;
        this.updatePlayerOutline(id, player, damageInfoForOutline);
      }

      // Update position with client-side interpolation
      if (interp) {
        const target: InterpolationTarget = {
          x: interp.targetX,
          y: interp.targetY,
          z: interp.targetZ ?? player.position.z ?? 0,
          timestamp: interp.timestamp,
        };

        this.interpolatePosition(cellGroup, target, id, isMyPlayer, radius, player.stage);
      } else {
        // Fallback to direct position if no interpolation target
        if (cellGroup.userData.isSphere) {
          // Sphere mode: use 3D coordinates directly
          cellGroup.position.set(
            player.position.x,
            player.position.y,
            player.position.z ?? 0
          );
          // Orient flat organisms to lie on sphere surface
          if (player.stage === 'single_cell' || player.stage === 'multi_cell') {
            orientFlatToSurface(cellGroup, player.position);
          } else if (player.stage === 'cyber_organism') {
            // Orient hexapod on sphere surface
            const heading = this.getHexapodHeading(cellGroup);
            orientHexapodToSurface(cellGroup, player.position, heading);

            // Add height offset along surface normal (legs extend below body)
            const normal = getSurfaceNormal(toVec3(player.position));
            const heightOffset = 5;
            cellGroup.position.x += normal.x * heightOffset;
            cellGroup.position.y += normal.y * heightOffset;
            cellGroup.position.z += (normal.z ?? 0) * heightOffset;
          }

          const outline = this.playerOutlines.get(id);
          if (outline) {
            outline.position.copy(cellGroup.position);
          }
        } else {
          // Flat mode: XZ plane
          const heightOffset =
            player.stage === 'cyber_organism' ||
            player.stage === 'humanoid' ||
            player.stage === 'godcell'
              ? 5
              : 0;
          cellGroup.position.set(player.position.x, heightOffset, -player.position.y);

          const outline = this.playerOutlines.get(id);
          if (outline) {
            outline.position.set(player.position.x, heightOffset + 0.1, -player.position.y);
          }
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

      // Apply gravity well distortion to soup-stage players
      // This creates a visual "spaghettification" effect when near gravity wells
      const isSoupStage =
        player.stage === EvolutionStageEnum.SINGLE_CELL ||
        player.stage === EvolutionStageEnum.MULTI_CELL;
      const outline = this.playerOutlines.get(id);
      if (isSoupStage && !isJungleMode) {
        if (cellGroup.userData.isSphere) {
          // Sphere mode: use 3D warp calculation
          const pos3D = {
            x: cellGroup.position.x,
            y: cellGroup.position.y,
            z: cellGroup.position.z,
          };
          const warp = calculateEntityWarp3D(pos3D);

          // Compute fresh surface quaternion for combining with warp
          const surfaceQuat = new THREE.Quaternion();
          const normal = { x: pos3D.x, y: pos3D.y, z: pos3D.z };
          const mag = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
          if (mag > 0.001) {
            normal.x /= mag;
            normal.y /= mag;
            normal.z /= mag;
          }
          const surfaceNormal = new THREE.Vector3(normal.x, normal.y, normal.z);
          const negZ = new THREE.Vector3(0, 0, -1);
          surfaceQuat.setFromUnitVectors(negZ, surfaceNormal);

          applyEntityWarpSphere(cellGroup, warp, surfaceQuat);

          // Also warp outline
          if (outline) {
            applyEntityWarpSphere(outline, warp, surfaceQuat);
          }
        } else {
          // Flat mode: use 2D warp calculation
          const gameX = cellGroup.position.x;
          const gameY = -cellGroup.position.z; // Three.js Z = -game Y
          const warp = calculateEntityWarp(gameX, gameY);
          applyEntityWarp(cellGroup, warp);

          if (outline) {
            applyEntityWarp(outline, warp);
          }
        }
      } else {
        // Reset any warp when not in soup or in jungle stages
        resetEntityWarp(cellGroup);
        if (outline) {
          resetEntityWarp(outline);
        }
      }

      // Cross-stage visibility
      const playerIsJungleStage =
        player.stage === EvolutionStageEnum.CYBER_ORGANISM ||
        player.stage === EvolutionStageEnum.HUMANOID ||
        player.stage === EvolutionStageEnum.GODCELL;
      const shouldBeVisible = isMyPlayer || isJungleMode === playerIsJungleStage;
      cellGroup.visible = shouldBeVisible;

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
    // For humanoid: use a temporary mesh for crossfade animation, then let sync()
    // handle the actual humanoid model loading after evolution completes.
    // We use cyber_organism as the visual during crossfade (temporary only).
    let targetMesh: THREE.Group;
    if (targetStage === 'godcell') {
      targetMesh = createGodcell(targetRadius, colorHex);
    } else if (targetStage === 'cyber_organism') {
      targetMesh = createCyberOrganism(targetRadius, colorHex);
    } else if (targetStage === 'humanoid') {
      // Temporary mesh for crossfade - will be replaced by sync() after evolution
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
    // For humanoid, mark as temporary so sync() will recreate with proper model
    // For other stages, set actual stage
    targetMesh.userData.stage = targetStage === 'humanoid' ? 'humanoid_temp' : targetStage;

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

    // Remove and dispose source mesh (prevent GPU memory leak)
    if (evolState.sourceMesh) {
      this.scene.remove(evolState.sourceMesh);
      this.disposeGroup(evolState.sourceMesh);
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
   * Checks userData.colorHex first (used by cyber-organism, humanoid, godcell),
   * then falls back to extracting from mesh materials (soup-scale stages)
   */
  getPlayerColor(playerId: string): number {
    const group = this.playerMeshes.get(playerId);
    if (!group) return 0x00ffff;

    // First check userData.colorHex (set by stage 3+ mesh factories)
    if (typeof group.userData.colorHex === 'number') {
      return group.userData.colorHex;
    }

    // Check first child's userData (for nested structures)
    const firstChild = group.children[0];
    if (firstChild instanceof THREE.Group && typeof firstChild.userData.colorHex === 'number') {
      return firstChild.userData.colorHex;
    }

    // Fall back to extracting from mesh materials (soup-scale stages)
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
   * Flash a player mesh red briefly to indicate damage taken
   * Sets a flash timestamp on userData - actual flash is applied in updatePlayerVisuals
   */
  flashDamage(playerId: string): void {
    const group = this.playerMeshes.get(playerId);
    if (!group) return;

    // Set flash start time - will be processed in update loop
    group.userData.damageFlashTime = performance.now();
  }

  /**
   * Apply damage flash effect to a mesh group based on flash timing
   * Called from updatePlayerVisuals each frame
   */
  private applyDamageFlash(group: THREE.Group): void {
    const flashTime = group.userData.damageFlashTime;
    if (!flashTime) return;

    const elapsed = performance.now() - flashTime;
    const flashDuration = 300; // ms (longer for visibility)

    if (elapsed >= flashDuration) {
      // Flash complete - clear the flag and restore materials
      delete group.userData.damageFlashTime;
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.userData.originalEmissive !== undefined) {
            mat.emissive.setHex(mat.userData.originalEmissive);
            mat.emissiveIntensity = mat.userData.originalIntensity;
            delete mat.userData.originalEmissive;
            delete mat.userData.originalIntensity;
          }
        }
      });
      return;
    }

    // Calculate flash intensity with easing (stays bright longer, fades at end)
    const progress = elapsed / flashDuration;
    const flashIntensity = progress < 0.5 ? 1.0 : 1.0 - (progress - 0.5) * 2; // Hold at full for first half

    // Apply bright white/red flash to all emissive materials
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.userData.originalEmissive === undefined) {
          // Store original on first flash frame
          mat.userData.originalEmissive = mat.emissive.getHex();
          mat.userData.originalIntensity = mat.emissiveIntensity;
        }

        if (mat.emissive && mat.userData.originalEmissive !== undefined) {
          // Lerp between bright white flash and original color
          const original = new THREE.Color(mat.userData.originalEmissive);
          const flash = new THREE.Color(0xffffff); // Pure white for more visible flash
          mat.emissive.lerpColors(original, flash, flashIntensity);
          // Much higher intensity for visibility (up to 15)
          mat.emissiveIntensity =
            mat.userData.originalIntensity + (15 - mat.userData.originalIntensity) * flashIntensity;
        }
      }
    });
  }

  /**
   * Calculate player visual size based on evolution stage
   * @deprecated Use player.radius from ECS instead - radius flows from server.
   * This method is only kept for backwards compatibility with ThreeRenderer.startEvolution().
   */
  getPlayerRadius(stage: string): number {
    if (stage === 'godcell') {
      return GAME_CONFIG.GODCELL_RADIUS;
    }
    if (stage === 'humanoid') {
      return GAME_CONFIG.HUMANOID_RADIUS;
    }
    if (stage === 'cyber_organism') {
      return GAME_CONFIG.CYBER_ORGANISM_RADIUS;
    }
    if (stage === 'multi_cell') {
      return GAME_CONFIG.MULTI_CELL_RADIUS;
    }
    return GAME_CONFIG.SINGLE_CELL_RADIUS;
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

    // Remove old outline and dispose geometry/material (prevent GPU memory leak)
    this.scene.remove(oldOutline);
    oldOutline.geometry?.dispose();
    (oldOutline.material as THREE.Material)?.dispose();

    // Create new outline with correct size (accounting for visual extent)
    const bodyRadius = this.getPlayerRadius(stage);
    const outlineRadius = this.getOutlineRadius(stage, bodyRadius);
    const outlineGeometry = this.getGeometry(
      `ring-outline-${outlineRadius}`,
      () => new THREE.RingGeometry(outlineRadius, outlineRadius + 3, 32)
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

  /**
   * Dispose all geometry and materials in a group (recursive)
   * Prevents GPU memory leaks when removing entities
   */
  private disposeGroup(group: THREE.Group | THREE.Object3D): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          (child.material as THREE.Material)?.dispose();
        }
      }
    });
  }

  private removePlayerInternal(playerId: string): void {
    const group = this.playerMeshes.get(playerId);
    if (group) {
      this.scene.remove(group);
      this.disposeGroup(group);
      this.playerMeshes.delete(playerId);
    }

    const outline = this.playerOutlines.get(playerId);
    if (outline) {
      this.scene.remove(outline);
      outline.geometry?.dispose();
      (outline.material as THREE.Material)?.dispose();
      this.playerOutlines.delete(playerId);
    }

    // Clean up evolution state (dispose meshes to prevent GPU memory leak)
    const evolState = this.playerEvolutionState.get(playerId);
    if (evolState) {
      if (evolState.sourceMesh) {
        this.scene.remove(evolState.sourceMesh);
        this.disposeGroup(evolState.sourceMesh);
      }
      if (evolState.targetMesh) {
        this.scene.remove(evolState.targetMesh);
        this.disposeGroup(evolState.targetMesh);
      }
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

      // Calculate speed for animation blending (distance / dt = units per second)
      const speed = prevPos
        ? Math.sqrt(Math.pow(currPos.x - prevPos.x, 2) + Math.pow(currPos.y - prevPos.y, 2)) /
          (this.dt / 1000)
        : 0;

      // Update humanoid animation
      const animState = cellGroup.userData.animState as HumanoidAnimationState | undefined;
      if (animState) {
        updateHumanoidAnimation(animState, this.dt / 1000, isMoving, speed);
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

      // Godcell uses 3D position on sphere
      cellGroup.position.set(player.position.x, player.position.y, player.position.z ?? 0);
    } else if (player.stage === 'cyber_organism') {
      // Stage 3: Cyber-organism
      const energyRatio = player.energy / player.maxEnergy;
      updateCyberOrganismEnergy(cellGroup, energyRatio);

      // Track position for movement detection (3D for sphere mode)
      const prevPos = cellGroup.userData.lastPosition3D as
        | { x: number; y: number; z: number }
        | undefined;
      const currPos = {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z ?? 0,
      };

      // Calculate movement in 3D
      const dx = prevPos ? currPos.x - prevPos.x : 0;
      const dy = prevPos ? currPos.y - prevPos.y : 0;
      const dz = prevPos ? currPos.z - prevPos.z : 0;
      const distMoved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const isMoving = distMoved > 1;

      cellGroup.userData.lastPosition3D = currPos;

      // Calculate movement speed (units per second)
      const speed = prevPos && this.dt > 0 ? distMoved / (this.dt / 1000) : 0;

      // Update heading direction (3D vector for sphere orientation)
      if (prevPos && isMoving) {
        // Target heading is normalized velocity direction
        const targetHeading = new THREE.Vector3(dx, dy, dz).normalize();

        // Initialize or get current heading
        let currentHeading = cellGroup.userData.heading3D as THREE.Vector3 | undefined;
        if (!currentHeading) {
          currentHeading = targetHeading.clone();
          cellGroup.userData.heading3D = currentHeading;
        }

        // Smoothly interpolate toward target heading
        currentHeading.lerp(targetHeading, 0.15);
        currentHeading.normalize();
      }

      updateCyberOrganismAnimation(cellGroup, isMoving, speed, this.dt / 1000);
    } else if (player.stage === 'multi_cell') {
      updateMultiCellEnergy(cellGroup, this.multiCellStyle, player.energy, player.maxEnergy);
    } else {
      this.updateCellEnergy(cellGroup, player.energy, player.maxEnergy, player.stage);
    }

    // Apply damage flash effect if active (fades white -> original over 300ms)
    this.applyDamageFlash(cellGroup);
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
      const time = performance.now() * 0.003;
      const pulseIntensity = 0.05 + evolutionProgress * 0.05;
      const cellPulse = 1.0 + Math.sin(time) * pulseIntensity;
      cellGroup.scale.set(cellPulse, cellPulse, cellPulse);

      // Particle corona
      updateEvolutionCorona(cellGroup, evolutionProgress);

      // Glow ring
      updateEvolutionRing(cellGroup, evolutionProgress, cellGroup.userData.radius);
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
    // Use consistent lerp for all stages - the real fix is using authoritative sphere radius
    const baseLerp = 0.3;
    const lerpFactor = frameLerp(baseLerp, this.dt);

    if (cellGroup.userData.isSphere) {
      // Sphere mode: use SLERP (spherical linear interpolation) for correct arc movement
      // Cartesian lerp + projection fails for large angular separations
      const currentVec = new THREE.Vector3(
        cellGroup.position.x,
        cellGroup.position.y,
        cellGroup.position.z
      );
      const targetVec = new THREE.Vector3(target.x, target.y, target.z ?? 0);

      // Determine sphere radius
      const isJungleStage = stage === 'cyber_organism' || stage === 'humanoid' || stage === 'godcell';
      const sphereRadius = isJungleStage ? GAME_CONFIG.JUNGLE_SPHERE_RADIUS : GAME_CONFIG.SOUP_SPHERE_RADIUS;

      // Normalize both to unit sphere for slerp, then scale back
      const currentDir = currentVec.clone().normalize();
      const targetDir = targetVec.clone().normalize();

      // Slerp on unit sphere using quaternion rotation
      const fullRotation = new THREE.Quaternion();
      fullRotation.setFromUnitVectors(currentDir, targetDir);

      // Partial rotation: interpolate from identity toward full rotation
      const partialRotation = new THREE.Quaternion();
      partialRotation.slerpQuaternions(new THREE.Quaternion(), fullRotation, lerpFactor);

      // Apply partial rotation to current direction
      currentDir.applyQuaternion(partialRotation);

      // Scale back to sphere surface
      currentVec.copy(currentDir).multiplyScalar(sphereRadius);

      cellGroup.position.copy(currentVec);

      // Orient flat organisms to lie on sphere surface
      if (stage === 'single_cell' || stage === 'multi_cell') {
        const pos = { x: cellGroup.position.x, y: cellGroup.position.y, z: cellGroup.position.z };
        orientFlatToSurface(cellGroup, pos);
      } else if (stage === 'cyber_organism') {
        // Orient hexapod on sphere surface
        const pos = { x: cellGroup.position.x, y: cellGroup.position.y, z: cellGroup.position.z };
        const heading = this.getHexapodHeading(cellGroup);
        orientHexapodToSurface(cellGroup, pos, heading);
      }

      const outline = this.playerOutlines.get(playerId);
      if (outline) {
        outline.position.copy(cellGroup.position);
      }
    } else {
      // Flat mode: XZ plane (game Y maps to -Z)
      cellGroup.position.x += (target.x - cellGroup.position.x) * lerpFactor;
      const targetZ = -target.y;
      cellGroup.position.z += (targetZ - cellGroup.position.z) * lerpFactor;

      const outline = this.playerOutlines.get(playerId);
      if (outline) {
        outline.position.x = cellGroup.position.x;
        outline.position.z = cellGroup.position.z;
      }
    }

    // Update compass indicators for client player (multi-cell only)
    if (isMyPlayer) {
      const isMultiCell = stage === 'multi_cell';
      if (isMultiCell) {
        // Compass uses game coordinates
        const gamePos = cellGroup.userData.isSphere
          ? { x: cellGroup.position.x, y: cellGroup.position.y }
          : { x: cellGroup.position.x, y: -cellGroup.position.z };
        this.compassIndicators = updateCompassIndicators(
          this.scene,
          this.compassIndicators,
          this.detectedEntities,
          gamePos,
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
    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.Material;
        // THREE.js materials have complex type hierarchy; runtime check + cast is pragmatic
        if ('opacity' in material) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (material as any).opacity = opacity;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ('uniforms' in material && (material as any).uniforms?.opacity) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  private getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = factory();
      this.geometryCache.set(key, geometry);
    }
    return geometry;
  }

  /**
   * Get heading direction for hexapod orientation on sphere
   * Uses stored heading3D vector, with fallback to default forward direction
   */
  private getHexapodHeading(cellGroup: THREE.Group): THREE.Vector3 {
    const stored = cellGroup.userData.heading3D as THREE.Vector3 | undefined;
    if (stored) {
      return stored.clone();
    }
    // Default: positive X direction (will be projected to tangent plane by orientHexapodToSurface)
    return new THREE.Vector3(1, 0, 0);
  }
}
