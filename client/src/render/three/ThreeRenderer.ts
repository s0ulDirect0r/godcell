// ============================================
// Three.js Renderer
// ============================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Renderer, CameraCapabilities } from '../Renderer';
import { GAME_CONFIG, EvolutionStage, getEntityScale } from '@godcell/shared';
import { createComposer } from './postprocessing/composer';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { disposeSingleCellCache } from '../meshes/SingleCellMesh';
import { PlayerRenderSystem } from '../systems/PlayerRenderSystem';
import { TrailSystem } from '../systems/TrailSystem';
import { NutrientRenderSystem } from '../systems/NutrientRenderSystem';
import { ObstacleRenderSystem } from '../systems/ObstacleRenderSystem';
import { TreeRenderSystem } from '../systems/TreeRenderSystem';
import { SwarmRenderSystem } from '../systems/SwarmRenderSystem';
import { PseudopodRenderSystem } from '../systems/PseudopodRenderSystem';
import { EffectsSystem } from '../systems/EffectsSystem';
import { AuraRenderSystem } from '../systems/AuraRenderSystem';
import { AuraStateSystem } from '../../ecs/systems/AuraStateSystem';
import { CameraSystem } from '../systems/CameraSystem';
import { EnvironmentSystem, type RenderMode } from '../systems/EnvironmentSystem';
// Stage 3+ render systems
import { DataFruitRenderSystem } from '../systems/DataFruitRenderSystem';
import { CyberBugRenderSystem } from '../systems/CyberBugRenderSystem';
import { JungleCreatureRenderSystem } from '../systems/JungleCreatureRenderSystem';
import { ProjectileRenderSystem } from '../systems/ProjectileRenderSystem';
import { TrapRenderSystem } from '../systems/TrapRenderSystem';
import {
  World,
  Tags,
  getStringIdByEntity,
  getLocalPlayerId,
  getLocalPlayer,
  getPlayer,
} from '../../ecs';

/**
 * Three.js-based renderer with postprocessing effects
 */
export class ThreeRenderer implements Renderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private container!: HTMLElement;
  private composer!: EffectComposer;
  private renderPass!: RenderPass; // Stored to update camera on mode switch
  private bloomPass!: import('three/addons/postprocessing/UnrealBloomPass.js').UnrealBloomPass;

  // Perf debug toggles
  private _bloomEnabled = true;

  // ECS World reference (for render systems to query directly)
  private world!: World;

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

  // Tree render system (owns jungle tree meshes, Stage 3+ only)
  private treeRenderSystem!: TreeRenderSystem;

  // Swarm render system (owns swarm meshes, particles, interpolation)
  private swarmRenderSystem!: SwarmRenderSystem;

  // Pseudopod render system (owns lightning beam meshes)
  private pseudopodRenderSystem!: PseudopodRenderSystem;

  // Trail system (owns trail points and meshes)
  private trailSystem!: TrailSystem;

  // Effects system (particle effects, animations)
  private effectsSystem!: EffectsSystem;

  // Aura systems (ECS-driven visual feedback)
  private auraStateSystem!: AuraStateSystem;
  private auraRenderSystem!: AuraRenderSystem;

  // Stage 3+ render systems (jungle fauna, projectiles, and traps)
  private dataFruitRenderSystem!: DataFruitRenderSystem;
  private cyberBugRenderSystem!: CyberBugRenderSystem;
  private jungleCreatureRenderSystem!: JungleCreatureRenderSystem;
  private projectileRenderSystem!: ProjectileRenderSystem;
  private trapRenderSystem!: TrapRenderSystem;

  init(container: HTMLElement, width: number, height: number, world: World): void {
    this.container = container;
    this.world = world;

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Disable autoReset so renderer.info accumulates stats across all EffectComposer passes
    // We manually reset at the start of each frame in render()
    this.renderer.info.autoReset = false;
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

    // Create aura systems (ECS-driven visual feedback)
    this.auraStateSystem = new AuraStateSystem();
    this.auraRenderSystem = new AuraRenderSystem();
    this.auraRenderSystem.init(this.scene);

    // Create trail system (owns player trail points and meshes)
    this.trailSystem = new TrailSystem();
    this.trailSystem.init(this.scene);

    // Create player render system (owns player meshes, outlines, evolution state)
    this.playerRenderSystem = new PlayerRenderSystem();
    this.playerRenderSystem.init(this.scene, this.world, this.geometryCache);

    // Create nutrient render system (owns nutrient meshes)
    this.nutrientRenderSystem = new NutrientRenderSystem();
    this.nutrientRenderSystem.init(this.scene, this.world);

    // Create obstacle render system (owns gravity well meshes)
    this.obstacleRenderSystem = new ObstacleRenderSystem();
    this.obstacleRenderSystem.init(this.scene, this.world);

    // Create tree render system (owns jungle tree meshes, Stage 3+ only)
    this.treeRenderSystem = new TreeRenderSystem();
    this.treeRenderSystem.init(this.scene, this.world);

    // Create swarm render system (owns entropy swarm meshes)
    this.swarmRenderSystem = new SwarmRenderSystem();
    this.swarmRenderSystem.init(this.scene, this.world);

    // Create pseudopod render system (owns lightning beam meshes)
    this.pseudopodRenderSystem = new PseudopodRenderSystem();
    this.pseudopodRenderSystem.init(this.scene, this.world);

    // Create Stage 3+ render systems (jungle fauna and projectiles)
    this.dataFruitRenderSystem = new DataFruitRenderSystem();
    this.dataFruitRenderSystem.init(this.scene, this.world);

    this.cyberBugRenderSystem = new CyberBugRenderSystem();
    this.cyberBugRenderSystem.init(this.scene, this.world);

    this.jungleCreatureRenderSystem = new JungleCreatureRenderSystem();
    this.jungleCreatureRenderSystem.init(this.scene, this.world);

    this.projectileRenderSystem = new ProjectileRenderSystem();
    this.projectileRenderSystem.init(this.scene, this.world);

    this.trapRenderSystem = new TrapRenderSystem();
    this.trapRenderSystem.init(this.scene, this.world);

    // Basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(5, 10, 7.5);
    this.scene.add(keyLight);

    // Create postprocessing composer (store passes for camera switching and debug toggles)
    const composerResult = createComposer(this.renderer, this.scene, this.cameraSystem.getOrthoCamera(), width, height);
    this.composer = composerResult.composer;
    this.renderPass = composerResult.renderPass;
    this.bloomPass = composerResult.bloomPass;

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

        // Only spawn death effects in soup mode (soup-scale visual)
        if (position && this.environmentSystem.getMode() === 'soup') {
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

      // EMP activation - spawn visual pulse effect (soup-scale ability)
      eventBus.on('empActivated', (event) => {
        if (this.environmentSystem.getMode() === 'soup') {
          this.effectsSystem.spawnEMP(event.position.x, event.position.y);
        }
      });

      // Swarm consumed - spawn death explosion + energy transfer to consumer (soup-scale)
      eventBus.on('swarmConsumed', (event) => {
        // Only spawn effects in soup mode
        if (this.environmentSystem.getMode() !== 'soup') return;

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
        // Only spawn hit effects in soup mode (soup-scale combat)
        if (this.environmentSystem.getMode() !== 'soup') return;

        // Spawn red spark explosion at hit location
        this.effectsSystem.spawnHitBurst(event.hitPosition.x, event.hitPosition.y);

        // Flash the drain aura on the target (shows they're taking damage)
        this.auraRenderSystem.flashDrainAura(event.targetId);

        // Note: No energy transfer particles here - pseudopod hits only damage the target,
        // they don't grant energy to the attacker. Beam KILLS grant energy (handled via
        // continuous energy detection in updateGainAuras).
      });

      // === Spawn animations for entity materialization (soup-scale only) ===

      // Player joined - trigger spawn animation (soup mode only)
      eventBus.on('playerJoined', (event) => {
        if (this.environmentSystem.getMode() !== 'soup') return;
        const colorHex = parseInt(event.player.color.replace('#', ''), 16);
        this.effectsSystem.spawnMaterialize(event.player.id, 'player', event.player.position.x, event.player.position.y, colorHex);
      });

      // Player respawned - trigger spawn animation (soup mode only)
      eventBus.on('playerRespawned', (event) => {
        if (this.environmentSystem.getMode() !== 'soup') return;
        const colorHex = parseInt(event.player.color.replace('#', ''), 16);
        this.effectsSystem.spawnMaterialize(event.player.id, 'player', event.player.position.x, event.player.position.y, colorHex);
      });

      // Nutrient spawned - trigger spawn animation (soup mode only)
      eventBus.on('nutrientSpawned', (event) => {
        if (this.environmentSystem.getMode() !== 'soup') return;
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

      // Swarm spawned - trigger spawn animation (soup mode only)
      eventBus.on('swarmSpawned', (event) => {
        if (this.environmentSystem.getMode() !== 'soup') return;
        this.effectsSystem.spawnMaterialize(event.swarm.id, 'swarm', event.swarm.position.x, event.swarm.position.y, 0xff6600, 50);
      });

      // === Energy gain visual feedback (soup-scale only) ===

      // Nutrient collected - trigger energy transfer particles (soup mode only)
      eventBus.on('nutrientCollected', (event) => {
        if (this.environmentSystem.getMode() !== 'soup') return;
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

      // === DataFruit collected - trigger gold gain aura (jungle-scale) ===
      eventBus.on('dataFruitCollected', (event) => {
        // Only trigger aura for local player
        if (event.playerId === this.myPlayerId) {
          this.auraStateSystem.triggerFruitCollectionAura(this.world, event.playerId);
        }
      });

      // Player engulfed another player - energy transfer (soup mode only)
      eventBus.on('playerEngulfed', (event) => {
        if (this.environmentSystem.getMode() !== 'soup') return;
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

      // === Melee attack visual feedback (jungle-scale) ===
      eventBus.on('meleeAttackExecuted', (event) => {
        // Only show effects in jungle mode (Stage 3+ melee attacks)
        if (this.environmentSystem.getMode() !== 'jungle') return;

        // Calculate direction from position to target
        const dx = event.direction.x;
        const dy = event.direction.y;

        // Spawn melee arc effect at attacker position
        // Use player color if available, otherwise default red-orange
        const attackerPos = this.playerRenderSystem.getPlayerPosition(event.playerId);
        if (attackerPos) {
          const colorHex = this.playerRenderSystem.getPlayerColor(event.playerId) || 0xff6666;
          this.effectsSystem.spawnMeleeAttack(
            attackerPos.x,
            attackerPos.y,
            event.attackType,
            dx,
            dy,
            colorHex
          );
        }

        // Spawn hit effects on each player that was hit
        for (const hitPlayerId of event.hitPlayerIds) {
          const hitPos = this.playerRenderSystem.getPlayerPosition(hitPlayerId);
          if (hitPos) {
            // Spawn hit sparks at victim position
            this.effectsSystem.spawnHitBurst(hitPos.x, hitPos.y);
            // Flash the victim's mesh to indicate damage
            this.playerRenderSystem.flashDamage(hitPlayerId);
          }
        }
      });

      // === Projectile hit visual feedback (jungle-scale ranged attacks) ===
      eventBus.on('projectileHit', (event) => {
        if (this.environmentSystem.getMode() !== 'jungle') return;

        // Spawn hit sparks at impact location
        this.effectsSystem.spawnHitBurst(event.hitPosition.x, event.hitPosition.y);

        // Flash the victim if it's a player
        if (event.targetType === 'player') {
          this.playerRenderSystem.flashDamage(event.targetId);
        }
      });

      // === Trap triggered visual feedback (jungle-scale traps) ===
      eventBus.on('trapTriggered', (event) => {
        if (this.environmentSystem.getMode() !== 'jungle') return;

        // Spawn hit sparks at trap position
        this.effectsSystem.spawnHitBurst(event.position.x, event.position.y);

        // Flash the victim's mesh
        this.playerRenderSystem.flashDamage(event.victimId);
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

  render(dt: number): void {
    // Get local player info from World
    const myPlayerId = getLocalPlayerId(this.world);
    this.myPlayerId = myPlayerId ?? null;

    // Detect damage for camera shake
    const myPlayer = getLocalPlayer(this.world);
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

    // Update camera mode based on player stage
    // - Stages 1-3: top-down (orthographic)
    // - Stage 4 (humanoid): first-person (perspective)
    // - Stage 5 (godcell): third-person (perspective, following sphere)
    const currentMode = this.cameraSystem.getMode();
    if (myPlayer?.stage === EvolutionStage.GODCELL) {
      if (currentMode !== 'thirdperson') {
        this.setCameraMode('thirdperson');
      }
    } else if (myPlayer?.stage === EvolutionStage.HUMANOID) {
      if (currentMode !== 'firstperson') {
        this.setCameraMode('firstperson');
      }
    } else {
      if (currentMode !== 'topdown') {
        this.setCameraMode('topdown');
      }
    }

    // Update camera position based on mode (re-read mode after potential switch)
    const activeMode = this.cameraSystem.getMode();
    if (myPlayer) {
      if (activeMode === 'firstperson') {
        this.cameraSystem.updateFirstPersonPosition(
          myPlayer.position.x,
          myPlayer.position.y,
          GAME_CONFIG.HUMANOID_CAMERA_HEIGHT
        );
      } else if (activeMode === 'thirdperson') {
        // Third-person camera for godcell - uses 3D position
        const posZ = myPlayer.position.z ?? 0;
        this.cameraSystem.updateThirdPersonPosition(
          myPlayer.position.x,
          myPlayer.position.y,
          posZ
        );
      }
    }

    // Update environment particles (soup or jungle based on mode)
    this.environmentSystem.update(dt);

    // Update all particle effects (death, evolution, EMP, spawn, energy transfer)
    const { spawnProgress } = this.effectsSystem.update(dt);

    // Sync all entities (systems query World directly)
    this.playerRenderSystem.sync(this.environmentSystem.getMode(), this.cameraSystem.getYaw());
    this.nutrientRenderSystem.sync(this.environmentSystem.getMode());
    this.obstacleRenderSystem.sync(this.environmentSystem.getMode());
    this.treeRenderSystem.sync(this.environmentSystem.getMode());
    this.swarmRenderSystem.sync(this.environmentSystem.getMode());
    this.pseudopodRenderSystem.sync();

    // Stage 3+ render systems (jungle fauna, projectiles, and traps)
    this.dataFruitRenderSystem.sync(this.environmentSystem.getMode());
    this.cyberBugRenderSystem.sync(this.environmentSystem.getMode());
    this.jungleCreatureRenderSystem.sync(this.environmentSystem.getMode());
    this.projectileRenderSystem.sync(this.environmentSystem.getMode());
    this.trapRenderSystem.sync(this.environmentSystem.getMode());

    // Apply spawn animations (scale/opacity) to entities
    this.applySpawnAnimations(spawnProgress);

    // Animate nutrients (rotation, bobbing)
    this.nutrientRenderSystem.updateAnimations(dt);

    // Interpolate swarm positions
    this.swarmRenderSystem.interpolate();

    // Animate swarm particles
    this.swarmRenderSystem.updateAnimations(dt);

    // Stage 3+ interpolation and animations
    this.dataFruitRenderSystem.interpolate();
    this.dataFruitRenderSystem.updateAnimations(dt);
    this.cyberBugRenderSystem.interpolate();
    this.cyberBugRenderSystem.updateAnimations(dt);
    this.jungleCreatureRenderSystem.interpolate();
    this.jungleCreatureRenderSystem.updateAnimations(dt);
    this.projectileRenderSystem.interpolate();
    this.projectileRenderSystem.updateAnimations(dt);
    this.trapRenderSystem.updateAnimations(dt);

    // Build data maps for TrailSystem by querying World
    const playersForTrail = this.buildPlayersForTrail();

    // Update aura ECS components (state-driven: damage info, energy gains, evolution)
    this.auraStateSystem.update(this.world, dt);

    // Determine viewer scale for aura filtering
    const viewerScale = myPlayer
      ? getEntityScale(myPlayer.stage)
      : getEntityScale(EvolutionStage.SINGLE_CELL);

    // Render auras for entities at viewer's scale
    this.auraRenderSystem.sync(
      this.world,
      viewerScale,
      this.playerRenderSystem.getPlayerMeshes(),
      this.swarmRenderSystem.getSwarmMeshes()
    );

    // Animate obstacle particles
    this.obstacleRenderSystem.updateAnimations(dt);

    // Animate tree glow pulse and sway
    this.treeRenderSystem.updateAnimations(dt);

    // Update trails (soup mode only - trails are single-cell effects)
    this.trailSystem.update(this.playerRenderSystem.getPlayerMeshes(), playersForTrail, this.environmentSystem.getMode());

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

    // Reset renderer info before render to get accurate per-frame stats
    this.renderer.info.reset();

    // Track render time
    const renderStart = performance.now();

    // Render scene with postprocessing
    this.composer.render();

    const renderTime = performance.now() - renderStart;

    // Performance stats logging (every 60 frames)
    this._perfFrameCount = (this._perfFrameCount || 0) + 1;
    this._perfRenderTimeSum = (this._perfRenderTimeSum || 0) + renderTime;
    const now = performance.now();
    if (this._perfFrameCount >= 60) {
      const info = this.renderer.info;
      const renderMode = this.environmentSystem.getMode();
      // Calculate FPS from time elapsed over 60 frames
      const elapsed = now - (this._perfLastTime || now);
      const fps = elapsed > 0 ? Math.round(60000 / elapsed) : 0;
      const avgRenderMs = (this._perfRenderTimeSum / 60).toFixed(1);

      // Count scene objects
      let lightCount = 0;
      let meshCount = 0;
      let visibleMeshes = 0;
      let totalVerts = 0;
      this.scene.traverse((obj) => {
        if (obj.type.includes('Light')) lightCount++;
        if (obj.type === 'Mesh') {
          meshCount++;
          if (obj.visible) {
            visibleMeshes++;
            const mesh = obj as THREE.Mesh;
            if (mesh.geometry) {
              const pos = mesh.geometry.getAttribute('position');
              if (pos) totalVerts += pos.count;
            }
          }
        }
      });

      // Viewport size for fill rate context
      const vp = this.renderer.getSize(new THREE.Vector2());
      const pixels = vp.x * vp.y;

      console.log(`[PERF] mode=${renderMode} fps=${fps} renderMs=${avgRenderMs} | calls=${info.render.calls} tris=${info.render.triangles} | meshes=${meshCount} visible=${visibleMeshes} verts=${totalVerts} | lights=${lightCount} | geo=${info.memory.geometries} tex=${info.memory.textures} | px=${pixels}`);
      this._perfFrameCount = 0;
      this._perfRenderTimeSum = 0;
      this._perfLastTime = now;
    }
    if (!this._perfLastTime) this._perfLastTime = now;
  }

  private _perfFrameCount?: number;
  private _perfLastTime?: number;
  private _perfRenderTimeSum?: number;

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
   * and soup-specific effects (trails, particles)
   * Called when transitioning to jungle mode
   */
  private clearSoupEntities(): void {
    // Clear nutrients (delegated to NutrientRenderSystem)
    this.nutrientRenderSystem.clearAll();

    // Clear swarms (delegated to SwarmRenderSystem)
    this.swarmRenderSystem.clearAll();

    // Clear obstacles (delegated to ObstacleRenderSystem)
    this.obstacleRenderSystem.clearAll();

    // Clear soup-specific particle effects (death bursts, spawns, energy transfers)
    this.effectsSystem.clearSoupEffects();

    // Trails are handled by TrailSystem.update() checking render mode

    console.log('[RenderMode] Cleared all soup entities and effects');
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

  // === PERF DEBUG TOGGLES ===

  toggleBloom(): boolean {
    this._bloomEnabled = !this._bloomEnabled;
    this.bloomPass.enabled = this._bloomEnabled;
    console.log(`[PERF TOGGLE] Bloom: ${this._bloomEnabled ? 'ON' : 'OFF'}`);
    return this._bloomEnabled;
  }

  isBloomEnabled(): boolean {
    return this._bloomEnabled;
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
   * Switch camera mode between top-down, first-person, and third-person
   * - topdown: Stages 1-3 (orthographic, looking down)
   * - firstperson: Stage 4 humanoid (perspective, player's eyes)
   * - thirdperson: Stage 5 godcell (perspective, following behind)
   */
  setCameraMode(mode: 'topdown' | 'firstperson' | 'thirdperson'): void {
    const changed = this.cameraSystem.setMode(mode);
    if (!changed) return;

    // EnvironmentSystem handles ground plane visibility and background color
    // Both first-person and third-person need the ground plane visible
    this.environmentSystem.setFirstPersonGroundVisible(mode === 'firstperson' || mode === 'thirdperson');
  }

  /**
   * Get current camera mode
   */
  getCameraMode(): 'topdown' | 'firstperson' | 'thirdperson' {
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

  // ============================================
  // Private helpers for building data maps from World
  // ============================================

  /**
   * Build player data map for TrailSystem (needs stage, color, energy, maxEnergy)
   */
  private buildPlayersForTrail(): Map<string, {
    stage: string;
    color: string;
    energy: number;
    maxEnergy: number;
  }> {
    const result = new Map<string, {
      stage: string;
      color: string;
      energy: number;
      maxEnergy: number;
    }>();
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      if (!playerId) return;
      const player = getPlayer(this.world, playerId);
      if (player) {
        result.set(playerId, {
          stage: player.stage,
          color: player.color,
          energy: player.energy,
          maxEnergy: player.maxEnergy,
        });
      }
    });
    return result;
  }

  dispose(): void {
    // Clean up player meshes (humanoids, outlines, compass, etc.)
    this.playerRenderSystem.dispose();

    // Clean up nutrient meshes
    this.nutrientRenderSystem.dispose();

    // Clean up player trails
    this.trailSystem.dispose();

    // Clean up auras (drain and gain)
    this.auraRenderSystem.dispose();

    // Clean up all particle effects (death, evolution, EMP, spawn, energy transfer)
    this.effectsSystem.dispose();

    // Clean up obstacles
    this.obstacleRenderSystem.dispose();

    // Clean up trees
    this.treeRenderSystem.dispose();

    // Clean up swarms
    this.swarmRenderSystem.dispose();

    // Clean up pseudopods
    this.pseudopodRenderSystem.dispose();

    // Clean up Stage 3+ render systems
    this.dataFruitRenderSystem.dispose();
    this.cyberBugRenderSystem.dispose();
    this.jungleCreatureRenderSystem.dispose();
    this.projectileRenderSystem.dispose();
    this.trapRenderSystem.dispose();

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
