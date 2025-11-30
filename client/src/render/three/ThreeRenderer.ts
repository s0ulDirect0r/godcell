// ============================================
// Three.js Renderer
// ============================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import { createComposer } from './postprocessing/composer';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { disposeSingleCellCache } from '../meshes/SingleCellMesh';
import { PlayerRenderSystem, type InterpolationTarget, type PlayerDamageInfo } from '../systems/PlayerRenderSystem';
import { TrailSystem } from '../systems/TrailSystem';
import { NutrientRenderSystem, type NutrientData } from '../systems/NutrientRenderSystem';
import { ObstacleRenderSystem, type ObstacleData } from '../systems/ObstacleRenderSystem';
import { SwarmRenderSystem, type SwarmData } from '../systems/SwarmRenderSystem';
import { PseudopodRenderSystem, type PseudopodData } from '../systems/PseudopodRenderSystem';
import { EffectsSystem } from '../systems/EffectsSystem';
import { AuraSystem } from '../systems/AuraSystem';
import { CameraSystem } from '../systems/CameraSystem';
import { EnvironmentSystem, type RenderMode } from '../systems/EnvironmentSystem';

/**
 * Three.js-based renderer with postprocessing effects
 */
export class ThreeRenderer implements Renderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private container!: HTMLElement;
  private composer!: EffectComposer;
  private renderPass!: RenderPass; // Stored to update camera on mode switch

  // Camera system (owns all camera state and behavior)
  private cameraSystem!: CameraSystem;

  // Environment system (owns backgrounds, particles, ground plane)
  private environmentSystem!: EnvironmentSystem;

  // Legacy references for compatibility during refactor
  private lastPlayerEnergy: number | null = null;
  private myPlayerId: string | null = null; // Local player ID for event filtering
  private initialZoomSet = false; // Track if we've set initial zoom based on spawn stage

  // Resource caching for performance
  private geometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private materialCache: Map<string, THREE.Material> = new Map();

  // Player render system (owns player meshes, outlines, evolution state)
  private playerRenderSystem!: PlayerRenderSystem;

  // Nutrient render system (owns nutrient meshes)
  private nutrientRenderSystem!: NutrientRenderSystem;

  // Obstacle render system (owns obstacle meshes)
  private obstacleRenderSystem!: ObstacleRenderSystem;

  // Swarm render system (owns swarm meshes, particles, interpolation)
  private swarmRenderSystem!: SwarmRenderSystem;

  // Pseudopod render system (owns lightning beam meshes)
  private pseudopodRenderSystem!: PseudopodRenderSystem;

  // Trail system (owns trail points and meshes)
  private trailSystem!: TrailSystem;

  // Effects system (particle effects, animations)
  private effectsSystem!: EffectsSystem;

  // Aura system (owns drain and gain auras)
  private auraSystem!: AuraSystem;

  init(container: HTMLElement, width: number, height: number): void {
    this.container = container;

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Create scene
    this.scene = new THREE.Scene();

    // Create camera system (owns both cameras and all camera logic)
    this.cameraSystem = new CameraSystem(width, height);

    // Create environment system (owns backgrounds, particles, ground plane)
    this.environmentSystem = new EnvironmentSystem();
    this.environmentSystem.init(this.scene);

    // Create effects system (owns all particle effects and animations)
    this.effectsSystem = new EffectsSystem();
    this.effectsSystem.init(this.scene);

    // Create aura system (owns drain and gain auras)
    this.auraSystem = new AuraSystem();
    this.auraSystem.init(this.scene);

    // Create trail system (owns player trail points and meshes)
    this.trailSystem = new TrailSystem();
    this.trailSystem.init(this.scene);

    // Create player render system (owns player meshes, outlines, evolution state)
    this.playerRenderSystem = new PlayerRenderSystem();
    this.playerRenderSystem.init(this.scene, this.geometryCache);

    // Create nutrient render system (owns nutrient meshes)
    this.nutrientRenderSystem = new NutrientRenderSystem();
    this.nutrientRenderSystem.init(this.scene);

    // Create obstacle render system (owns gravity well meshes)
    this.obstacleRenderSystem = new ObstacleRenderSystem();
    this.obstacleRenderSystem.init(this.scene);

    // Create swarm render system (owns entropy swarm meshes)
    this.swarmRenderSystem = new SwarmRenderSystem();
    this.swarmRenderSystem.init(this.scene);

    // Create pseudopod render system (owns lightning beam meshes)
    this.pseudopodRenderSystem = new PseudopodRenderSystem();
    this.pseudopodRenderSystem.init(this.scene);

    // Basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(5, 10, 7.5);
    this.scene.add(keyLight);

    // Create postprocessing composer (store renderPass for camera switching)
    const composerResult = createComposer(this.renderer, this.scene, this.cameraSystem.getOrthoCamera(), width, height);
    this.composer = composerResult.composer;
    this.renderPass = composerResult.renderPass;

    // Setup event listeners for camera effects
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Import eventBus for death animations
    import('../../core/events/EventBus').then(({ eventBus }) => {
      eventBus.on('playerDied', (event) => {
        // Get position and color before removal
        const position = this.playerRenderSystem.getPlayerPosition(event.playerId);
        const color = this.playerRenderSystem.getPlayerColor(event.playerId);

        if (position) {
          this.effectsSystem.spawnDeathBurst(position.x, position.y, color);
        }

        // Remove player mesh, outline, and evolution state
        this.playerRenderSystem.removePlayer(event.playerId);

        // Remove trail
        this.trailSystem.removeTrail(event.playerId);
      });

      // Evolution started - delegate to player render system
      eventBus.on('playerEvolutionStarted', (event) => {
        const colorHex = this.playerRenderSystem.getPlayerColor(event.playerId);
        const targetRadius = this.playerRenderSystem.getPlayerRadius(event.targetStage);

        // Start evolution animation in player render system
        this.playerRenderSystem.startEvolution(
          event.playerId,
          event.currentStage,
          event.targetStage,
          event.duration,
          targetRadius,
          colorHex
        );

        // Spawn evolution particles
        const position = this.playerRenderSystem.getPlayerPosition(event.playerId);
        if (position) {
          this.effectsSystem.spawnEvolution(position.x, position.y, colorHex, event.duration);
        }
      });

      // Evolution completed - finalize mesh swap
      eventBus.on('playerEvolved', (event) => {
        // Complete evolution in player render system
        this.playerRenderSystem.completeEvolution(event.playerId);

        // Update camera zoom if this is the local player
        if (this.myPlayerId && event.playerId === this.myPlayerId) {
          this.cameraSystem.setTargetZoom(CameraSystem.getStageZoom(event.newStage));

          // Update outline for new stage
          this.playerRenderSystem.updateOutlineForStage(event.playerId, event.newStage);
        }
      });

      // Player respawned - reset camera zoom
      eventBus.on('playerRespawned', (event) => {
        // Update camera zoom if this is the local player
        if (this.myPlayerId && event.player.id === this.myPlayerId) {
          // Set zoom based on respawn stage (instant, no transition)
          this.cameraSystem.setZoomInstant(CameraSystem.getStageZoom(event.player.stage));
          this.initialZoomSet = false; // Allow re-initialization
        }
      });

      // Detection update - chemical sensing for Stage 2+
      eventBus.on('detectionUpdate', (event) => {
        this.playerRenderSystem.setDetectedEntities(event.detected);
      });

      // EMP activation - spawn visual pulse effect
      eventBus.on('empActivated', (event) => {
        this.effectsSystem.spawnEMP(event.position.x, event.position.y);
      });

      // Swarm consumed - spawn death explosion + energy transfer to consumer
      eventBus.on('swarmConsumed', (event) => {
        // Get swarm position before removal (system returns game coordinates)
        const position = this.swarmRenderSystem.getSwarmPosition(event.swarmId);
        const consumerPos = this.playerRenderSystem.getPlayerPosition(event.consumerId);

        if (position) {
          this.effectsSystem.spawnSwarmDeath(position.x, position.y);

          // Energy transfer particles from swarm to consumer (orange/red for swarm energy)
          if (consumerPos) {
            this.effectsSystem.spawnEnergyTransfer(
              position.x,
              position.y,
              consumerPos.x,
              consumerPos.y,
              event.consumerId,
              0xff6600, // Orange for swarm energy
              30 // More particles for swarm consumption
            );
          }
        }
      });

      eventBus.on('pseudopodHit', (event) => {
        // Spawn red spark explosion at hit location
        this.effectsSystem.spawnHitBurst(event.hitPosition.x, event.hitPosition.y);

        // Flash the drain aura on the target (shows they're taking damage)
        this.auraSystem.flashDrainAura(event.targetId);

        // Note: No energy transfer particles here - pseudopod hits only damage the target,
        // they don't grant energy to the attacker. Beam KILLS grant energy (handled via
        // continuous energy detection in updateGainAuras).
      });

      // === Spawn animations for entity materialization ===

      // Player joined - trigger spawn animation
      eventBus.on('playerJoined', (event) => {
        const colorHex = parseInt(event.player.color.replace('#', ''), 16);
        this.effectsSystem.spawnMaterialize(event.player.id, 'player', event.player.position.x, event.player.position.y, colorHex);
      });

      // Player respawned - trigger spawn animation
      eventBus.on('playerRespawned', (event) => {
        const colorHex = parseInt(event.player.color.replace('#', ''), 16);
        this.effectsSystem.spawnMaterialize(event.player.id, 'player', event.player.position.x, event.player.position.y, colorHex);
      });

      // Nutrient spawned - trigger spawn animation
      eventBus.on('nutrientSpawned', (event) => {
        // Get color based on value multiplier
        let colorHex = GAME_CONFIG.NUTRIENT_COLOR;
        if (event.nutrient.valueMultiplier >= 5) {
          colorHex = GAME_CONFIG.NUTRIENT_5X_COLOR;
        } else if (event.nutrient.valueMultiplier >= 3) {
          colorHex = GAME_CONFIG.NUTRIENT_3X_COLOR;
        } else if (event.nutrient.valueMultiplier >= 2) {
          colorHex = GAME_CONFIG.NUTRIENT_2X_COLOR;
        }
        this.effectsSystem.spawnMaterialize(event.nutrient.id, 'nutrient', event.nutrient.position.x, event.nutrient.position.y, colorHex, 25);
      });

      // Swarm spawned - trigger spawn animation
      eventBus.on('swarmSpawned', (event) => {
        this.effectsSystem.spawnMaterialize(event.swarm.id, 'swarm', event.swarm.position.x, event.swarm.position.y, 0xff6600, 50);
      });

      // === Energy gain visual feedback ===

      // Nutrient collected - trigger energy transfer particles and gain aura
      eventBus.on('nutrientCollected', (event) => {
        // Get nutrient position from cache (before it's removed)
        const nutrientPos = this.nutrientRenderSystem.getNutrientPosition(event.nutrientId);
        const collectorPos = this.playerRenderSystem.getPlayerPosition(event.playerId);

        if (nutrientPos && collectorPos) {
          // Spawn particles flying from nutrient to collector
          this.effectsSystem.spawnEnergyTransfer(
            nutrientPos.x,
            nutrientPos.y,
            collectorPos.x,
            collectorPos.y,
            event.playerId,
            0x00ffff // Cyan energy particles
          );
        }

        // Clean up cached position
        this.nutrientRenderSystem.clearNutrientPosition(event.nutrientId);
      });

      // Player engulfed another player - energy transfer from prey to predator
      eventBus.on('playerEngulfed', (event) => {
        const predatorPos = this.playerRenderSystem.getPlayerPosition(event.predatorId);

        if (predatorPos) {
          // Spawn particles from prey position to predator (larger burst for player kill)
          this.effectsSystem.spawnEnergyTransfer(
            event.position.x,
            event.position.y,
            predatorPos.x,
            predatorPos.y,
            event.predatorId,
            0x00ff88, // Green-cyan for player energy
            40 // Lots of particles for player kill
          );
        }
      });

      // Mouse look event - update first-person camera rotation
      eventBus.on('client:mouseLook', (event) => {
        if (this.cameraSystem.getMode() === 'firstperson') {
          this.cameraSystem.updateFirstPersonLook(event.deltaX, event.deltaY);
        }
      });
    });
  }

  /**
   * Apply spawn animation scale/opacity to entities based on progress
   * Progress 0 = just spawned (small, transparent)
   * Progress 1 = fully materialized (normal scale, full opacity)
   */
  private applySpawnAnimations(spawnProgress: Map<string, number>): void {
    // Apply to nutrients (delegated to NutrientRenderSystem)
    this.nutrientRenderSystem.applySpawnAnimations(spawnProgress);

    // Apply to swarms (delegated to SwarmRenderSystem)
    this.swarmRenderSystem.applySpawnAnimations(spawnProgress);

    // Players don't need spawn animations (handled by materialize effect)
  }

  render(state: GameState, dt: number): void {
    // Update local player ID reference (for event filtering)
    this.myPlayerId = state.myPlayerId;

    // Detect damage for camera shake
    const myPlayer = state.getMyPlayer();
    if (myPlayer) {
      // Set initial zoom based on spawn stage (first frame only)
      if (!this.initialZoomSet) {
        const initialZoom = CameraSystem.getStageZoom(myPlayer.stage);
        this.cameraSystem.setZoomInstant(initialZoom);
        this.initialZoomSet = true;
      }

      // Detect energy decrease (damage taken) - energy is sole life resource
      if (this.lastPlayerEnergy !== null && myPlayer.energy < this.lastPlayerEnergy) {
        const damageAmount = this.lastPlayerEnergy - myPlayer.energy;
        const shakeIntensity = CameraSystem.calculateDamageShake(damageAmount);
        this.cameraSystem.addShake(shakeIntensity);
      }

      // Update last energy
      this.lastPlayerEnergy = myPlayer.energy;
    }

    // Update render mode based on local player stage (soup vs jungle world)
    this.updateRenderModeForStage(myPlayer?.stage ?? EvolutionStage.SINGLE_CELL);

    // Update camera mode based on player stage (top-down for Stages 1-3, first-person for Stage 4+)
    const isFirstPersonStage = myPlayer?.stage === EvolutionStage.HUMANOID;
    if (isFirstPersonStage && this.cameraSystem.getMode() !== 'firstperson') {
      this.setCameraMode('firstperson');
    } else if (!isFirstPersonStage && this.cameraSystem.getMode() === 'firstperson') {
      this.setCameraMode('topdown');
    }

    // Update first-person camera position if in first-person mode
    if (this.cameraSystem.getMode() === 'firstperson' && myPlayer) {
      this.cameraSystem.updateFirstPersonPosition(
        myPlayer.position.x,
        myPlayer.position.y,
        GAME_CONFIG.HUMANOID_CAMERA_HEIGHT
      );
    }

    // Update environment particles (soup or jungle based on mode)
    this.environmentSystem.update(dt);

    // Update all particle effects (death, evolution, EMP, spawn, energy transfer)
    const { spawnProgress, receivingEnergy } = this.effectsSystem.update(dt);

    // Sync all entities
    this.playerRenderSystem.sync(
      state.players,
      state.playerTargets as Map<string, InterpolationTarget>,
      state.playerDamageInfo as Map<string, PlayerDamageInfo>,
      state.myPlayerId,
      this.environmentSystem.getMode(),
      this.cameraSystem.getYaw()
    );
    this.nutrientRenderSystem.sync(
      state.nutrients as Map<string, NutrientData>,
      this.environmentSystem.getMode()
    );
    this.obstacleRenderSystem.sync(
      state.obstacles as Map<string, ObstacleData>,
      this.environmentSystem.getMode()
    );
    this.swarmRenderSystem.sync(
      state.swarms as Map<string, SwarmData>,
      this.environmentSystem.getMode()
    );
    this.pseudopodRenderSystem.sync(state.pseudopods as Map<string, PseudopodData>);

    // Apply spawn animations (scale/opacity) to entities
    this.applySpawnAnimations(spawnProgress);

    // Animate nutrients (rotation, bobbing)
    this.nutrientRenderSystem.updateAnimations(dt);

    // Interpolate swarm positions
    this.swarmRenderSystem.interpolate();

    // Animate swarm particles
    this.swarmRenderSystem.updateAnimations(state.swarms as Map<string, SwarmData>, dt);

    // Update drain visual feedback (red auras)
    this.auraSystem.updateDrainAuras(
      state.players,
      state.swarms,
      this.playerRenderSystem.getPlayerMeshes(),
      this.swarmRenderSystem.getSwarmMeshes(),
      state.playerDamageInfo,
      state.swarmDamageInfo
    );

    // Update gain auras (cyan glow when receiving energy)
    this.auraSystem.updateGainAuras(
      state.players,
      this.playerRenderSystem.getPlayerMeshes(),
      receivingEnergy
    );

    // Animate obstacle particles
    this.obstacleRenderSystem.updateAnimations(
      state.obstacles as Map<string, ObstacleData>,
      dt
    );

    // Update trails
    this.trailSystem.update(this.playerRenderSystem.getPlayerMeshes(), state.players);

    // Update camera system (follows player, applies shake, transitions zoom)
    // Pass player's interpolated mesh position (game coords: mesh.x = game X, -mesh.z = game Y)
    if (myPlayer) {
      const mesh = this.playerRenderSystem.getPlayerMesh(myPlayer.id);
      if (mesh) {
        this.cameraSystem.update(mesh.position.x, -mesh.position.z);
      } else {
        this.cameraSystem.update();
      }
    } else {
      this.cameraSystem.update();
    }

    // Update renderPass camera based on current mode before rendering
    this.renderPass.camera = this.cameraSystem.getActiveCamera();

    // DEBUG: Log camera and entity state every 60 frames
    if (!this._debugFrameCount) this._debugFrameCount = 0;
    this._debugFrameCount++;
    if (this._debugFrameCount % 60 === 0) {
      const orthoCamera = this.cameraSystem.getOrthoCamera();
      console.log('[DEBUG] Camera:', {
        pos: { x: orthoCamera.position.x.toFixed(0), y: orthoCamera.position.y.toFixed(0), z: orthoCamera.position.z.toFixed(0) },
        frustum: { left: orthoCamera.left.toFixed(0), right: orthoCamera.right.toFixed(0), top: orthoCamera.top.toFixed(0), bottom: orthoCamera.bottom.toFixed(0) },
        near: orthoCamera.near,
        far: orthoCamera.far,
      });
      console.log('[DEBUG] Entities:', {
        players: this.playerRenderSystem.getMeshCount(),
        nutrients: this.nutrientRenderSystem.getMeshCount(),
        swarms: this.swarmRenderSystem.getMeshCount(),
        obstacles: this.obstacleRenderSystem.getMeshCount(),
      });
      const playerMeshes = this.playerRenderSystem.getPlayerMeshes();
      if (playerMeshes.size > 0) {
        const firstPlayer = playerMeshes.values().next().value;
        if (firstPlayer) {
          console.log('[DEBUG] First player mesh pos:', {
            x: firstPlayer.position.x.toFixed(0),
            y: firstPlayer.position.y.toFixed(0),
            z: firstPlayer.position.z.toFixed(0),
          });
        }
      }
    }

    // Render scene with postprocessing
    this.composer.render();
  }

  private _debugFrameCount?: number;

  /**
   * Set the render mode (soup vs jungle world)
   * Delegates to EnvironmentSystem and handles entity clearing on mode change.
   */
  private setRenderMode(mode: RenderMode): void {
    const modeChanged = this.environmentSystem.setMode(mode);

    // Clear soup entities when transitioning to jungle
    if (modeChanged && mode === 'jungle') {
      this.clearSoupEntities();
    }
  }

  /**
   * Clear all soup-world entity meshes (nutrients, swarms, obstacles)
   * Called when transitioning to jungle mode
   */
  private clearSoupEntities(): void {
    // Clear nutrients (delegated to NutrientRenderSystem)
    this.nutrientRenderSystem.clearAll();

    // Clear swarms (delegated to SwarmRenderSystem)
    this.swarmRenderSystem.clearAll();

    // Clear obstacles (delegated to ObstacleRenderSystem)
    this.obstacleRenderSystem.clearAll();

    console.log('[RenderMode] Cleared all soup entities');
  }

  /**
   * Update render mode based on player evolution stage
   * Stage 1-2 (soup stages): Soup mode
   * Stage 3+ (jungle stages): Jungle mode
   */
  private updateRenderModeForStage(stage: EvolutionStage): void {
    const isSoupStage = stage === EvolutionStage.SINGLE_CELL || stage === EvolutionStage.MULTI_CELL;
    this.setRenderMode(isSoupStage ? 'soup' : 'jungle');
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.cameraSystem.resize(width, height);
  }

  getCameraCapabilities(): CameraCapabilities {
    return this.cameraSystem.getCapabilities();
  }

  getCameraProjection() {
    // Screen ↔ world for orthographic camera on XZ plane (Y=height)
    // Camera looks down Y-axis, game Y maps to -Z
    const camera = this.cameraSystem.getOrthoCamera();
    return {
      screenToWorld: (screenX: number, screenY: number) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        // Convert screen coords to NDC (-1 to +1)
        const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

        // Unproject from NDC to world coordinates
        const vector = new THREE.Vector3(ndcX, ndcY, 0);
        vector.unproject(camera);

        // XZ plane: game X = Three.js X, game Y = -Three.js Z
        return { x: vector.x, y: -vector.z };
      },
      worldToScreen: (worldX: number, worldY: number) => {
        // XZ plane: Three.js (worldX, 0, -worldY)
        const vector = new THREE.Vector3(worldX, 0, -worldY);
        vector.project(camera);

        const rect = this.renderer.domElement.getBoundingClientRect();
        return {
          x: ((vector.x + 1) / 2) * rect.width + rect.left,
          y: ((-vector.y + 1) / 2) * rect.height + rect.top,
        };
      },
    };
  }

  // ============================================
  // First-Person Camera Controls (Stage 4+)
  // ============================================

  /**
   * Switch camera mode between top-down (ortho) and first-person (perspective)
   * Called when player evolves to/from Stage 4
   */
  setCameraMode(mode: 'topdown' | 'firstperson'): void {
    const changed = this.cameraSystem.setMode(mode);
    if (!changed) return;

    // EnvironmentSystem handles ground plane visibility and background color
    this.environmentSystem.setFirstPersonGroundVisible(mode === 'firstperson');
  }

  /**
   * Get current camera mode
   */
  getCameraMode(): 'topdown' | 'firstperson' {
    return this.cameraSystem.getMode();
  }

  /**
   * Update first-person camera rotation from mouse input
   * @param deltaX - Mouse movement in X (affects yaw/horizontal rotation)
   * @param deltaY - Mouse movement in Y (affects pitch/vertical look)
   */
  updateFirstPersonLook(deltaX: number, deltaY: number): void {
    this.cameraSystem.updateFirstPersonLook(deltaX, deltaY);
  }

  /**
   * Get current first-person yaw (for rotating movement input)
   */
  getFirstPersonYaw(): number {
    return this.cameraSystem.getYaw();
  }

  /**
   * Position first-person camera at player location with current look rotation
   * Called each frame in first-person mode
   * @param x - Player world X position
   * @param y - Player world Y position (maps to world Z in 3D)
   * @param height - Camera height above ground (humanoid eye level)
   */
  updateFirstPersonCamera(x: number, y: number, height: number): void {
    this.cameraSystem.updateFirstPersonPosition(x, y, height);
  }

  /**
   * Get the active camera (ortho for top-down, perspective for first-person)
   */
  getActiveCamera(): THREE.Camera {
    return this.cameraSystem.getActiveCamera();
  }

  dispose(): void {
    // Clean up player meshes (humanoids, outlines, compass, etc.)
    this.playerRenderSystem.dispose();

    // Clean up nutrient meshes
    this.nutrientRenderSystem.dispose();

    // Clean up player trails
    this.trailSystem.dispose();

    // Clean up auras (drain and gain)
    this.auraSystem.dispose();

    // Clean up all particle effects (death, evolution, EMP, spawn, energy transfer)
    this.effectsSystem.dispose();

    // Clean up obstacles
    this.obstacleRenderSystem.dispose();

    // Clean up swarms
    this.swarmRenderSystem.dispose();

    // Clean up pseudopods
    this.pseudopodRenderSystem.dispose();

    // Dispose cached geometries
    this.geometryCache.forEach(geo => geo.dispose());
    this.geometryCache.clear();

    // Dispose cached materials
    this.materialCache.forEach(mat => mat.dispose());
    this.materialCache.clear();

    // Dispose extracted module caches
    disposeSingleCellCache();

    // Dispose composer
    this.composer.dispose();

    // Dispose renderer
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
