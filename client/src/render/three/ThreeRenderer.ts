// ============================================
// Three.js Renderer
// ============================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { LightningStrike } from 'three-stdlib';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import { createComposer } from './postprocessing/composer';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { createMultiCell, updateMultiCellEnergy } from '../meshes/MultiCellMesh';
import { createSingleCell, disposeSingleCellCache, updateSingleCellEnergy } from '../meshes/SingleCellMesh';
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
import { updateCompassIndicators, disposeCompassIndicators } from './CompassRenderer';
import { updateTrails, disposeAllTrails } from '../effects/TrailEffect';
import {
  calculateEvolutionProgress,
  updateEvolutionCorona,
  updateEvolutionRing,
  removeEvolutionEffects,
  applyEvolutionEffects,
} from './EvolutionVisuals';
import {
  spawnDeathParticles,
  spawnHitSparks,
  spawnEvolutionParticles,
  spawnEMPPulse,
  spawnSwarmDeathExplosion,
  spawnMaterializeParticles,
  spawnEnergyTransferParticles,
  type DeathAnimation,
  type EvolutionAnimation,
  type EMPEffect,
  type SwarmDeathAnimation,
  type SpawnAnimation,
  type EnergyTransferAnimation,
} from '../effects/ParticleEffects';
import {
  updateDeathAnimations,
  updateEvolutionAnimations,
  updateEMPEffects,
  updateSwarmDeathAnimations,
  updateSpawnAnimations,
  updateEnergyTransferAnimations,
} from './AnimationUpdater';
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
import {
  createObstacle,
  updateObstacleAnimation,
  disposeObstacle,
  type AccretionParticle,
} from './ObstacleRenderer';
import {
  createSwarm,
  updateSwarmState,
  updateSwarmAnimation,
  disposeSwarm,
  type SwarmInternalParticle,
  type SwarmOrbitingParticle,
} from './SwarmRenderer';
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

  // Humanoid model loading (async)
  private pendingHumanoidLoads: Set<string> = new Set(); // Player IDs with pending humanoid loads
  private humanoidModels: Map<string, THREE.Group> = new Map(); // Loaded humanoid models

  // Multi-cell style
  private multiCellStyle: 'colonial' | 'radial' = 'colonial';

  // Resource caching for performance
  private geometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private materialCache: Map<string, THREE.Material> = new Map();

  // Entity meshes
  private nutrientMeshes: Map<string, THREE.Group> = new Map(); // Changed to Group for 3D icosahedron + inner glow
  private playerMeshes: Map<string, THREE.Group> = new Map(); // Changed to Group for 3D cells (membrane + nucleus)
  private playerOutlines: Map<string, THREE.Mesh> = new Map(); // White stroke for client player
  private drainAuraMeshes: Map<string, THREE.Mesh | THREE.Group> = new Map(); // Red aura for players/swarms being drained (Mesh for players, Group for swarms)
  private obstacleMeshes: Map<string, THREE.Group> = new Map();
  private obstacleParticles: Map<string, AccretionParticle[]> = new Map(); // Accretion disk particles
  private obstaclePulsePhase: Map<string, number> = new Map(); // Phase offset for core pulsing animation
  private swarmMeshes: Map<string, THREE.Group> = new Map(); // Changed to Group to include 3D sphere + particles
  private swarmParticleData: Map<string, SwarmOrbitingParticle[]> = new Map(); // Animation data for orbiting particles
  private swarmInternalParticles: Map<string, SwarmInternalParticle[]> = new Map(); // Internal storm particles
  private swarmPulsePhase: Map<string, number> = new Map(); // Phase offset for pulsing animation
  private pseudopodMeshes: Map<string, THREE.Mesh> = new Map(); // Lightning beam projectiles

  // Trails (using tube geometry for thick ribbons)
  private playerTrailPoints: Map<string, Array<{ x: number; y: number }>> = new Map();
  private playerTrailLines: Map<string, THREE.Mesh> = new Map();

  // Interpolation targets
  private swarmTargets: Map<string, { x: number; y: number }> = new Map();

  // Death animations (particle bursts)
  private deathAnimations: DeathAnimation[] = [];

  // Evolution animations (orbital particles)
  private evolutionAnimations: EvolutionAnimation[] = [];

  // Evolution state tracking
  private playerEvolutionState: Map<string, {
    startTime: number;
    duration: number;
    sourceStage: string;
    targetStage: string;
    sourceMesh?: THREE.Group;
    targetMesh?: THREE.Group;
  }> = new Map();

  // Detection system (chemical sensing)
  private detectedEntities: Array<{ id: string; position: { x: number; y: number }; entityType: 'player' | 'nutrient' | 'swarm' }> = [];
  private compassIndicators: THREE.Group | null = null; // Group holding all compass dots

  // EMP pulse effects (expanding electromagnetic ring)
  private empEffects: EMPEffect[] = [];

  // Swarm death animations (exploding particles)
  private swarmDeathAnimations: SwarmDeathAnimation[] = [];

  // Spawn materialization animations (converging particles + scale up)
  private spawnAnimations: SpawnAnimation[] = [];

  // Track entities that are currently spawning (for scale/opacity animation)
  private spawningEntities: Set<string> = new Set();

  // Energy gain visual feedback (cyan glow when collecting nutrients)
  private gainAuraMeshes: Map<string, THREE.Group> = new Map(); // Player ID → gain aura
  private energyTransferAnimations: EnergyTransferAnimation[] = []; // Particles flying to collector

  // Track nutrient positions for energy transfer effect (cached when nutrient exists)
  private nutrientPositionCache: Map<string, { x: number; y: number }> = new Map();

  // Track previous energy values for continuous gain detection
  private previousEnergy: Map<string, number> = new Map();

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
        // Get the player's last known position and color before they're removed
        const playerGroup = this.playerMeshes.get(event.playerId);
        if (playerGroup) {
          // XZ plane: game Y = -Three.js Z
          const position = { x: playerGroup.position.x, y: -playerGroup.position.z };

          // Get color from nucleus mesh (structure varies by stage)
          let color = 0x00ffff; // Default cyan
          const firstChild = playerGroup.children[0];
          if (firstChild instanceof THREE.Group && firstChild.children.length > 1) {
            // Multi-cell: get nucleus from first cell group
            const nucleus = firstChild.children[1] as THREE.Mesh;
            if (nucleus && nucleus.material) {
              const material = nucleus.material as THREE.MeshStandardMaterial;
              color = material.emissive.getHex();
            }
          } else if (playerGroup.children[3]) {
            // Single-cell: get nucleus directly (fourth child: membrane, cytoplasm, organelles, nucleus)
            const nucleus = playerGroup.children[3] as THREE.Mesh;
            if (nucleus && nucleus.material) {
              const material = nucleus.material as THREE.MeshStandardMaterial;
              color = material.emissive.getHex();
            }
          }

          this.deathAnimations.push(spawnDeathParticles(this.scene, position.x, position.y, color));

          // Immediately remove player group, outline, and trail
          this.scene.remove(playerGroup);

          // Dispose geometries and materials
          playerGroup.children.forEach(child => {
            if (child instanceof THREE.Mesh) {
              // Don't dispose cached geometries
              if ((child.material as THREE.Material).dispose) {
                (child.material as THREE.Material).dispose();
              }
            }
          });

          this.playerMeshes.delete(event.playerId);

          const outline = this.playerOutlines.get(event.playerId);
          if (outline) {
            this.scene.remove(outline);
            this.playerOutlines.delete(event.playerId);
          }

          const trail = this.playerTrailLines.get(event.playerId);
          if (trail) {
            this.scene.remove(trail);
            this.playerTrailLines.delete(event.playerId);
          }
        }
      });

      // Evolution started - track animation state, create target mesh, and spawn particles
      eventBus.on('playerEvolutionStarted', (event) => {
        const sourceGroup = this.playerMeshes.get(event.playerId);
        if (!sourceGroup) return;

        // Calculate target radius
        const targetRadius = this.getPlayerRadius(event.targetStage as any);

        // Get color from source mesh nucleus
        let colorHex = 0x00ffff; // Default
        const firstChild = sourceGroup.children[0];
        if (firstChild instanceof THREE.Group && firstChild.children.length > 1) {
          // Multi-cell
          const nucleus = firstChild.children[1] as THREE.Mesh;
          if (nucleus && nucleus.material) {
            const material = nucleus.material as THREE.MeshStandardMaterial;
            colorHex = material.emissive.getHex();
          }
        } else if (sourceGroup.children[3]) {
          // Single-cell
          const nucleus = sourceGroup.children[3] as THREE.Mesh;
          if (nucleus && nucleus.material) {
            const material = nucleus.material as THREE.MeshStandardMaterial;
            colorHex = material.emissive.getHex();
          }
        }

        // Create target mesh for new stage
        let targetGroup: THREE.Group;
        if (event.targetStage === 'cyber_organism' || event.targetStage === 'humanoid' || event.targetStage === 'godcell') {
          // Stage 3+: Cyber-organism hexapod
          targetGroup = createCyberOrganism(targetRadius, colorHex);
        } else if (event.targetStage === 'multi_cell') {
          targetGroup = createMultiCell({
            radius: targetRadius,
            colorHex,
            style: this.multiCellStyle,
          });
        } else {
          // Create single-cell
          targetGroup = createSingleCell(targetRadius, colorHex);
        }

        // Position target at same location as source
        targetGroup.position.copy(sourceGroup.position);
        targetGroup.userData.stage = event.targetStage;

        // Start target completely transparent
        this.setGroupOpacity(targetGroup, 0);

        // Add to scene
        this.scene.add(targetGroup);

        // Store evolution state
        this.playerEvolutionState.set(event.playerId, {
          startTime: Date.now(),
          duration: event.duration,
          sourceStage: event.currentStage,
          targetStage: event.targetStage,
          sourceMesh: sourceGroup,
          targetMesh: targetGroup,
        });

        // Spawn evolution particles
        const playerGroup = this.playerMeshes.get(event.playerId);
        if (playerGroup) {
          // Get color from nucleus
          let color = 0x00ffff; // Default cyan
          const firstChild = playerGroup.children[0];
          if (firstChild instanceof THREE.Group && firstChild.children.length > 1) {
            // Multi-cell: get nucleus from first cell group
            const nucleus = firstChild.children[1] as THREE.Mesh;
            if (nucleus && nucleus.material) {
              const material = nucleus.material as THREE.MeshStandardMaterial;
              color = material.emissive.getHex();
            }
          } else if (playerGroup.children[3]) {
            // Single-cell: get nucleus directly
            const nucleus = playerGroup.children[3] as THREE.Mesh;
            if (nucleus && nucleus.material) {
              const material = nucleus.material as THREE.MeshStandardMaterial;
              color = material.emissive.getHex();
            }
          }

          // XZ plane: game Y = -Three.js Z
          this.evolutionAnimations.push(spawnEvolutionParticles(
            this.scene,
            playerGroup.position.x,
            -playerGroup.position.z,
            color,
            event.duration
          ));
        }
      });

      // Evolution completed - finalize mesh swap
      eventBus.on('playerEvolved', (event) => {
        const evolState = this.playerEvolutionState.get(event.playerId);
        if (evolState && evolState.targetMesh && evolState.sourceMesh) {
          // Remove source mesh from scene
          this.scene.remove(evolState.sourceMesh);

          // Dispose source mesh materials
          evolState.sourceMesh.children.forEach(child => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
              if ((child.material as THREE.Material).dispose) {
                (child.material as THREE.Material).dispose();
              }
            } else if (child instanceof THREE.Group) {
              child.children.forEach(subChild => {
                if (subChild instanceof THREE.Mesh && (subChild.material as THREE.Material).dispose) {
                  (subChild.material as THREE.Material).dispose();
                }
              });
            }
          });

          // Replace playerMeshes entry with target mesh
          this.playerMeshes.set(event.playerId, evolState.targetMesh);

          // Reset target mesh opacity and scale to normal
          this.setGroupOpacity(evolState.targetMesh, 1.0);
          evolState.targetMesh.scale.setScalar(1.0);
        }

        // Clean up evolution state
        setTimeout(() => {
          this.playerEvolutionState.delete(event.playerId);
        }, 100);

        // Update camera zoom if this is the local player
        if (this.myPlayerId && event.playerId === this.myPlayerId) {
          // Set target zoom for smooth transition
          this.cameraSystem.setTargetZoom(CameraSystem.getStageZoom(event.newStage));

          // Update white outline for new size
          const oldOutline = this.playerOutlines.get(event.playerId);
          if (oldOutline) {
            // Remove old outline
            this.scene.remove(oldOutline);
            oldOutline.geometry.dispose();
            (oldOutline.material as THREE.Material).dispose();

            // Create new outline with evolved radius
            const newRadius = this.getPlayerRadius(event.newStage);
            const outlineGeometry = this.getGeometry(`ring-outline-${newRadius}`, () =>
              new THREE.RingGeometry(newRadius + 16, newRadius + 19, 32)
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
            newOutline.position.y = 0.1; // Slightly above player (Y=height)
            // Rotate so ring lies flat on XZ plane (camera looks down Y axis)
            newOutline.rotation.x = -Math.PI / 2;
            this.scene.add(newOutline);
            this.playerOutlines.set(event.playerId, newOutline);
          }
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
        this.detectedEntities = event.detected;
      });

      // EMP activation - spawn visual pulse effect
      eventBus.on('empActivated', (event) => {
        this.empEffects.push(spawnEMPPulse(this.scene, event.position.x, event.position.y));
      });

      // Swarm consumed - spawn death explosion + energy transfer to consumer
      eventBus.on('swarmConsumed', (event) => {
        const swarmGroup = this.swarmMeshes.get(event.swarmId);
        const consumerMesh = this.playerMeshes.get(event.consumerId);

        if (swarmGroup) {
          // Capture position before removal (XZ plane: game Y = -Three.js Z)
          const position = { x: swarmGroup.position.x, y: -swarmGroup.position.z };
          this.swarmDeathAnimations.push(spawnSwarmDeathExplosion(this.scene, position.x, position.y));

          // Energy transfer particles from swarm to consumer (orange/red for swarm energy)
          if (consumerMesh) {
            // XZ plane: target game Y = -Three.js Z
            this.energyTransferAnimations.push(
              spawnEnergyTransferParticles(
                this.scene,
                position.x,
                position.y,
                consumerMesh.position.x,
                -consumerMesh.position.z,
                event.consumerId,
                0xff6600, // Orange for swarm energy
                30 // More particles for swarm consumption
              )
            );
          }
        }
      });

      eventBus.on('pseudopodHit', (event) => {
        // Spawn red spark explosion at hit location
        this.deathAnimations.push(spawnHitSparks(this.scene, event.hitPosition.x, event.hitPosition.y));

        // Flash the drain aura on the target (shows they're taking damage)
        this.flashDrainAura(event.targetId);

        // Note: No energy transfer particles here - pseudopod hits only damage the target,
        // they don't grant energy to the attacker. Beam KILLS grant energy (handled via
        // continuous energy detection in updateGainAuras).
      });

      // === Spawn animations for entity materialization ===

      // Player joined - trigger spawn animation
      eventBus.on('playerJoined', (event) => {
        const colorHex = parseInt(event.player.color.replace('#', ''), 16);
        this.triggerSpawnAnimation(event.player.id, 'player', event.player.position.x, event.player.position.y, colorHex);
      });

      // Player respawned - trigger spawn animation
      eventBus.on('playerRespawned', (event) => {
        const colorHex = parseInt(event.player.color.replace('#', ''), 16);
        this.triggerSpawnAnimation(event.player.id, 'player', event.player.position.x, event.player.position.y, colorHex);
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
        this.triggerSpawnAnimation(event.nutrient.id, 'nutrient', event.nutrient.position.x, event.nutrient.position.y, colorHex, 25);
      });

      // Swarm spawned - trigger spawn animation
      eventBus.on('swarmSpawned', (event) => {
        this.triggerSpawnAnimation(event.swarm.id, 'swarm', event.swarm.position.x, event.swarm.position.y, 0xff6600, 50);
      });

      // === Energy gain visual feedback ===

      // Nutrient collected - trigger energy transfer particles and gain aura
      eventBus.on('nutrientCollected', (event) => {
        // Get nutrient position from cache (before it's removed)
        const nutrientPos = this.nutrientPositionCache.get(event.nutrientId);
        const collectorMesh = this.playerMeshes.get(event.playerId);

        if (nutrientPos && collectorMesh) {
          // Spawn particles flying from nutrient to collector
          // XZ plane: target game Y = -Three.js Z
          this.energyTransferAnimations.push(
            spawnEnergyTransferParticles(
              this.scene,
              nutrientPos.x,
              nutrientPos.y,
              collectorMesh.position.x,
              -collectorMesh.position.z,
              event.playerId,
              0x00ffff // Cyan energy particles
            )
          );
        }

        // Clean up cached position
        this.nutrientPositionCache.delete(event.nutrientId);
      });

      // Player engulfed another player - energy transfer from prey to predator
      eventBus.on('playerEngulfed', (event) => {
        const predatorMesh = this.playerMeshes.get(event.predatorId);

        if (predatorMesh) {
          // Spawn particles from prey position to predator (larger burst for player kill)
          // XZ plane: target game Y = -Three.js Z
          this.energyTransferAnimations.push(
            spawnEnergyTransferParticles(
              this.scene,
              event.position.x,
              event.position.y,
              predatorMesh.position.x,
              -predatorMesh.position.z,
              event.predatorId,
              0x00ff88, // Green-cyan for player energy
              40 // Lots of particles for player kill
            )
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
   * Trigger a spawn materialization animation for an entity
   */
  private triggerSpawnAnimation(
    entityId: string,
    entityType: 'player' | 'nutrient' | 'swarm',
    x: number,
    y: number,
    colorHex: number,
    radius: number = 40
  ): void {
    // Mark entity as spawning (for scale/opacity animation)
    this.spawningEntities.add(entityId);

    // Create converging particle effect
    const spawnAnim = spawnMaterializeParticles(this.scene, entityId, entityType, x, y, colorHex, radius);
    this.spawnAnimations.push(spawnAnim);
  }

  /**
   * Apply spawn animation scale/opacity to entities based on progress
   * Progress 0 = just spawned (small, transparent)
   * Progress 1 = fully materialized (normal scale, full opacity)
   */
  private applySpawnAnimations(spawnProgress: Map<string, number>): void {
    spawnProgress.forEach((progress, entityId) => {
      // Ease-out curve for smoother scale-up (fast at start, slow at end)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const scale = 0.1 + easeOut * 0.9; // Scale from 0.1 to 1.0
      const opacity = 0.3 + easeOut * 0.7; // Opacity from 0.3 to 1.0

      // Try to find and update the entity mesh
      // Check players
      const playerGroup = this.playerMeshes.get(entityId);
      if (playerGroup) {
        playerGroup.scale.setScalar(scale);
        this.setGroupOpacity(playerGroup, opacity);
        return;
      }

      // Check nutrients
      const nutrientGroup = this.nutrientMeshes.get(entityId);
      if (nutrientGroup) {
        nutrientGroup.scale.setScalar(scale);
        this.setGroupOpacity(nutrientGroup, opacity);
        return;
      }

      // Check swarms
      const swarmGroup = this.swarmMeshes.get(entityId);
      if (swarmGroup) {
        swarmGroup.scale.setScalar(scale);
        this.setGroupOpacity(swarmGroup, opacity);
        return;
      }
    });
  }

  // ============================================
  // Resource Caching (Performance)
  // ============================================

  private getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
    if (!this.geometryCache.has(key)) {
      this.geometryCache.set(key, factory());
    }
    return this.geometryCache.get(key)!;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Calculate player visual size based on evolution stage
   */
  private getPlayerRadius(stage: string): number {
    if (stage === 'multi_cell' || stage === 'cyber_organism' || stage === 'humanoid' || stage === 'godcell') {
      return GAME_CONFIG.PLAYER_SIZE * GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER;
    }
    return GAME_CONFIG.PLAYER_SIZE;
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

    // Update death animations
    updateDeathAnimations(this.scene, this.deathAnimations, dt);

    // Update evolution animations
    updateEvolutionAnimations(this.scene, this.evolutionAnimations, dt);

    // Update EMP pulse animations
    updateEMPEffects(this.scene, this.empEffects);

    // Update swarm death explosions
    updateSwarmDeathAnimations(this.scene, this.swarmDeathAnimations, dt);

    // Update spawn materialization animations and get progress map
    const spawnProgress = updateSpawnAnimations(this.scene, this.spawnAnimations, dt);

    // Clean up finished spawn animations from tracking set
    this.spawningEntities.forEach(entityId => {
      if (!spawnProgress.has(entityId)) {
        this.spawningEntities.delete(entityId);
      }
    });

    // Sync all entities
    this.syncPlayers(state);
    this.syncNutrients(state);
    this.syncObstacles(state);
    this.syncSwarms(state);
    this.syncPseudopods(state);

    // Apply spawn animations (scale/opacity) to entities
    this.applySpawnAnimations(spawnProgress);

    // Animate nutrients (rotation, bobbing)
    this.updateNutrientAnimations(dt);

    // Interpolate swarm positions
    this.interpolateSwarms();

    // Animate swarm particles
    this.updateSwarmParticles(state, dt);

    // Update drain visual feedback (red auras)
    this.updateDrainAuras(state, dt);

    // Update energy transfer animations (particles flying to collector)
    // Returns set of player IDs receiving energy this frame
    const receivingEnergy = updateEnergyTransferAnimations(this.scene, this.energyTransferAnimations, dt);

    // Update gain auras (cyan glow when receiving energy)
    this.updateGainAuras(state, receivingEnergy, dt);

    // Animate obstacle particles
    this.updateObstacleParticles(state, dt);

    // Update trails
    updateTrails(
      this.scene,
      this.playerTrailPoints,
      this.playerTrailLines,
      this.playerMeshes,
      state.players
    );

    // Update camera system (follows player, applies shake, transitions zoom)
    // Pass player's interpolated mesh position (game coords: mesh.x = game X, -mesh.z = game Y)
    if (myPlayer) {
      const mesh = this.playerMeshes.get(myPlayer.id);
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
        players: this.playerMeshes.size,
        nutrients: this.nutrientMeshes.size,
        swarms: this.swarmMeshes.size,
        obstacles: this.obstacleMeshes.size,
      });
      if (this.playerMeshes.size > 0) {
        const firstPlayer = this.playerMeshes.values().next().value;
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
    // Clear nutrients
    this.nutrientMeshes.forEach((group) => {
      this.scene.remove(group);
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material) {
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.nutrientMeshes.clear();
    this.nutrientPositionCache.clear();

    // Clear swarms
    this.swarmMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeSwarm(group);
    });
    this.swarmMeshes.clear();
    this.swarmTargets.clear();
    this.swarmParticleData.clear();
    this.swarmInternalParticles.clear();
    this.swarmPulsePhase.clear();

    // Clear obstacles
    this.obstacleMeshes.forEach((group) => {
      disposeObstacle(group);
      this.scene.remove(group);
    });
    this.obstacleMeshes.clear();
    this.obstacleParticles.clear();
    this.obstaclePulsePhase.clear();

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

  private syncObstacles(state: GameState): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (this.environmentSystem.getMode() === 'jungle') return;

    // Remove obstacles that no longer exist
    this.obstacleMeshes.forEach((group, id) => {
      if (!state.obstacles.has(id)) {
        disposeObstacle(group);
        this.scene.remove(group);
        this.obstacleMeshes.delete(id);
        this.obstacleParticles.delete(id);
        this.obstaclePulsePhase.delete(id);
      }
    });

    // Add obstacles (they don't move, so only create once)
    state.obstacles.forEach((obstacle, id) => {
      if (!this.obstacleMeshes.has(id)) {
        const { group, particles, vortexSpeed: _vortexSpeed } = createObstacle(obstacle.position, obstacle.radius);

        // Store particle data for animation
        this.obstacleParticles.set(id, particles);

        // Random phase offset for pulsing animation
        this.obstaclePulsePhase.set(id, Math.random() * Math.PI * 2);

        this.scene.add(group);
        this.obstacleMeshes.set(id, group);
      }
    });
  }

  private syncSwarms(state: GameState): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (this.environmentSystem.getMode() === 'jungle') return;

    // Remove swarms that no longer exist
    this.swarmMeshes.forEach((group, id) => {
      if (!state.swarms.has(id)) {
        this.scene.remove(group);
        disposeSwarm(group);
        this.swarmMeshes.delete(id);
        this.swarmTargets.delete(id);
        this.swarmParticleData.delete(id);
        this.swarmInternalParticles.delete(id);
        this.swarmPulsePhase.delete(id);
      }
    });

    // Add or update swarms
    state.swarms.forEach((swarm, id) => {
      let group = this.swarmMeshes.get(id);

      if (!group) {
        // Create swarm visual using extracted renderer
        const result = createSwarm(swarm.position, swarm.size);
        group = result.group;

        // Store particle animation data
        this.swarmInternalParticles.set(id, result.internalParticles);
        this.swarmParticleData.set(id, result.orbitingParticles);

        // Random phase offset for pulsing (so swarms don't pulse in sync)
        this.swarmPulsePhase.set(id, Math.random() * Math.PI * 2);

        this.scene.add(group);
        this.swarmMeshes.set(id, group);
        this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });
      }

      // Update target position for interpolation
      this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });

      // Update colors and intensity based on state
      const now = Date.now();
      const isDisabled = !!(swarm.disabledUntil && now < swarm.disabledUntil);
      updateSwarmState(group, swarm.state, isDisabled);
    });
  }

  private syncPseudopods(state: GameState): void {
    // Remove pseudopods that no longer exist
    this.pseudopodMeshes.forEach((mesh, id) => {
      if (!state.pseudopods.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.pseudopodMeshes.delete(id);
      }
    });

    // Add or update pseudopods
    state.pseudopods.forEach((beam, id) => {
      let mesh = this.pseudopodMeshes.get(id);

      if (!mesh) {
        // Determine if hitscan or projectile mode based on velocity magnitude
        // Hitscan: velocity holds end position (low magnitude from position)
        // Projectile: velocity holds actual velocity vector (high magnitude)
        const vx = beam.velocity.x - beam.position.x;
        const vy = beam.velocity.y - beam.position.y;
        const velocityMag = Math.sqrt(vx * vx + vy * vy);
        const isHitscan = velocityMag < 100; // Hitscan if "velocity" is actually end position

        let startPos: THREE.Vector3;
        let endPos: THREE.Vector3;

        if (isHitscan) {
          // Hitscan mode: beam.velocity is the end position (XZ plane, Y=height)
          startPos = new THREE.Vector3(beam.position.x, 1, -beam.position.y);
          endPos = new THREE.Vector3(beam.velocity.x, 1, -beam.velocity.y);
        } else {
          // Projectile mode: create short lightning bolt in direction of travel
          const boltLength = 80; // Fixed visual length
          const dirX = beam.velocity.x / Math.sqrt(beam.velocity.x ** 2 + beam.velocity.y ** 2);
          const dirY = beam.velocity.y / Math.sqrt(beam.velocity.x ** 2 + beam.velocity.y ** 2);

          // XZ plane: game Y maps to -Z
          startPos = new THREE.Vector3(beam.position.x, 1, -beam.position.y);
          endPos = new THREE.Vector3(
            beam.position.x + dirX * boltLength,
            1,
            -(beam.position.y + dirY * boltLength)
          );
        }

        // Calculate beam direction and length
        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const length = direction.length();

        // Create lightning bolt geometry
        const rayParams = {
          sourceOffset: new THREE.Vector3(0, 0, 0),
          destOffset: new THREE.Vector3(0, length, 0),
          radius0: beam.width / 2,
          radius1: beam.width / 3,
          minRadius: 2.5,
          maxIterations: 7,
          isEternal: true,
          timeScale: 0.7,
          propagationTimeFactor: 0.05,
          vanishingTimeFactor: 0.95,
          subrayPeriod: 3.5,
          subrayDutyCycle: 0.6,
          maxSubrayRecursion: 1,
          ramification: 3,
          recursionProbability: 0.4,
        };

        const lightningGeometry = new LightningStrike(rayParams);

        // Create mesh with lightning geometry
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(beam.color),
          transparent: true,
          opacity: 0.9,
        });

        mesh = new THREE.Mesh(lightningGeometry, material);

        // Position at beam start
        mesh.position.copy(startPos);

        // Rotate to point from start to end
        // Lightning geometry points in +Y direction by default
        // Use quaternion to rotate from +Y to the actual direction
        const defaultDir = new THREE.Vector3(0, 1, 0);
        const targetDir = direction.clone().normalize();
        mesh.quaternion.setFromUnitVectors(defaultDir, targetDir);

        this.scene.add(mesh);
        this.pseudopodMeshes.set(id, mesh);
      } else {
        // Update projectile position (projectile mode only - hitscan beams are static)
        // Check if this is a projectile beam
        const vx = beam.velocity.x - beam.position.x;
        const vy = beam.velocity.y - beam.position.y;
        const velocityMag = Math.sqrt(vx * vx + vy * vy);
        const isProjectile = velocityMag >= 100;

        if (isProjectile) {
          // Update position for moving projectile (XZ plane)
          mesh.position.x = beam.position.x;
          mesh.position.z = -beam.position.y;
        }
      }
    });
  }

  private interpolateSwarms(): void {
    const lerpFactor = 0.3;

    this.swarmMeshes.forEach((group, id) => {
      const target = this.swarmTargets.get(id);
      if (target) {
        // XZ plane: interpolate X and Z (game Y maps to -Z)
        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;
      }
    });
  }

  private updateSwarmParticles(state: GameState, dt: number): void {
    this.swarmMeshes.forEach((group, id) => {
      const swarm = state.swarms.get(id);
      const swarmState = swarm?.state || 'patrol';
      const pulsePhase = this.swarmPulsePhase.get(id) || 0;
      const internalParticles = this.swarmInternalParticles.get(id);
      const orbitingParticles = this.swarmParticleData.get(id);

      if (internalParticles && orbitingParticles) {
        updateSwarmAnimation(group, internalParticles, orbitingParticles, swarmState, pulsePhase, dt);
      }
    });
  }

  /**
   * Update drain visual feedback (variable-intensity aura around damaged players)
   */
  private updateDrainAuras(state: GameState, _dt: number): void {
    const time = Date.now() * 0.001;

    // For each player, check if they should have a drain aura
    state.players.forEach((player, playerId) => {
      const playerMesh = this.playerMeshes.get(playerId);
      if (!playerMesh) return;

      const damageInfo = state.playerDamageInfo.get(playerId);

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
        const auraMesh = this.drainAuraMeshes.get(playerId);
        if (auraMesh) {
          this.scene.remove(auraMesh);
          // Dispose group meshes (auras are groups with two spheres)
          if (auraMesh instanceof THREE.Group) {
            auraMesh.children.forEach(child => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                (child.material as THREE.Material).dispose();
              }
            });
          } else if (auraMesh instanceof THREE.Mesh) {
            auraMesh.geometry.dispose();
            (auraMesh.material as THREE.Material).dispose();
          }
          this.drainAuraMeshes.delete(playerId);
        }
      }
    });

    // For each swarm, check if they should have a drain aura
    state.swarms.forEach((swarm, swarmId) => {
      const swarmMesh = this.swarmMeshes.get(swarmId);
      if (!swarmMesh) return;

      const damageInfo = state.swarmDamageInfo.get(swarmId);
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
        const auraMesh = this.drainAuraMeshes.get(auraId);
        if (auraMesh) {
          this.scene.remove(auraMesh);
          // Dispose group meshes (swarm auras are groups with two spheres)
          if (auraMesh instanceof THREE.Group) {
            auraMesh.children.forEach(child => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                (child.material as THREE.Material).dispose();
              }
            });
          } else if (auraMesh instanceof THREE.Mesh) {
            auraMesh.geometry.dispose();
            (auraMesh.material as THREE.Material).dispose();
          }
          this.drainAuraMeshes.delete(auraId);
        }
      }
    });

    // Clean up auras for players/swarms that no longer exist
    this.drainAuraMeshes.forEach((auraMesh, id) => {
      let shouldCleanup = false;

      // Check if it's a player aura (no prefix) or swarm aura (has prefix)
      if (id.startsWith('swarm-')) {
        const swarmId = id.substring(6); // Remove "swarm-" prefix
        if (!state.swarms.has(swarmId)) {
          shouldCleanup = true;
        }
      } else {
        // Player aura
        if (!state.players.has(id)) {
          shouldCleanup = true;
        }
      }

      if (shouldCleanup) {
        this.scene.remove(auraMesh);
        // Dispose group meshes (swarm auras) or single mesh (player auras)
        if (auraMesh instanceof THREE.Group) {
          auraMesh.children.forEach(child => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              (child.material as THREE.Material).dispose();
            }
          });
        } else if (auraMesh instanceof THREE.Mesh) {
          auraMesh.geometry.dispose();
          (auraMesh.material as THREE.Material).dispose();
        }
        this.drainAuraMeshes.delete(id);
      }
    });
  }

  /**
   * Update energy gain visual feedback (cyan aura when collecting nutrients)
   * Detects continuous energy gain by comparing current vs previous energy
   * Triggers flash when energy increases, regardless of source
   */
  private updateGainAuras(state: GameState, receivingEnergy: Set<string>, _dt: number): void {
    // Calculate energy gains BEFORE updating previousEnergy (so we can use gains for intensity)
    const energyGains = new Map<string, number>();

    // Detect continuous energy gain by comparing to previous frame
    // This catches ALL energy sources: nutrients, draining, contact damage, etc.
    state.players.forEach((player, playerId) => {
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
      if (!state.players.has(playerId)) {
        this.previousEnergy.delete(playerId);
      }
    });

    // For each player receiving energy, create or trigger gain aura
    receivingEnergy.forEach(playerId => {
      const playerMesh = this.playerMeshes.get(playerId);
      if (!playerMesh) return;

      const player = state.players.get(playerId);
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
      const playerMesh = this.playerMeshes.get(playerId);
      if (!playerMesh) {
        // Player no longer exists - clean up
        this.scene.remove(gainAura);
        gainAura.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
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

  private updateObstacleParticles(state: GameState, dt: number): void {
    this.obstacleMeshes.forEach((group, id) => {
      const obstacle = state.obstacles.get(id);
      if (!obstacle) return;

      const particleData = this.obstacleParticles.get(id);
      const pulsePhase = this.obstaclePulsePhase.get(id) || 0;

      if (particleData) {
        updateObstacleAnimation(group, particleData, obstacle.radius, pulsePhase, dt);
      }
    });
  }

  private syncNutrients(state: GameState): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (this.environmentSystem.getMode() === 'jungle') return;

    // Remove nutrients that no longer exist
    this.nutrientMeshes.forEach((group, id) => {
      if (!state.nutrients.has(id)) {
        this.scene.remove(group);
        // Dispose non-cached materials from group children
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh && child.material) {
            (child.material as THREE.Material).dispose();
          }
        });
        this.nutrientMeshes.delete(id);
      }
    });

    // Add or update nutrients
    state.nutrients.forEach((nutrient, id) => {
      let group = this.nutrientMeshes.get(id);

      if (!group) {
        group = this.createNutrient3D(nutrient);
        this.scene.add(group);
        this.nutrientMeshes.set(id, group);
      }

      // Update base position (bobbing animation added in updateNutrientAnimations)
      // XZ plane: X=game X, Y=height, Z=-game Y
      group.userData.baseX = nutrient.position.x;
      group.userData.baseZ = -nutrient.position.y;
      group.position.set(nutrient.position.x, 0, -nutrient.position.y);

      // Cache position for energy transfer effect (used when nutrient is collected)
      this.nutrientPositionCache.set(id, { x: nutrient.position.x, y: nutrient.position.y });
    });

    // Clean up position cache for nutrients that no longer exist
    this.nutrientPositionCache.forEach((_, id) => {
      if (!state.nutrients.has(id)) {
        // Don't delete immediately - let nutrientCollected event use it first
        // The event handler will clean it up
      }
    });
  }

  /**
   * Create a 3D nutrient with icosahedron crystal + inner glow core
   */
  private createNutrient3D(nutrient: { valueMultiplier: number; id: string }): THREE.Group {
    const group = new THREE.Group();

    // Determine color based on value multiplier
    let color: number;
    if (nutrient.valueMultiplier >= 5) {
      color = GAME_CONFIG.NUTRIENT_5X_COLOR; // Magenta (5x)
    } else if (nutrient.valueMultiplier >= 3) {
      color = GAME_CONFIG.NUTRIENT_3X_COLOR; // Gold (3x)
    } else if (nutrient.valueMultiplier >= 2) {
      color = GAME_CONFIG.NUTRIENT_2X_COLOR; // Cyan (2x)
    } else {
      color = GAME_CONFIG.NUTRIENT_COLOR; // Green (1x)
    }

    // Outer icosahedron crystal (main shape)
    // Size scales slightly with value: 1x=12, 2x=13, 3x=14, 5x=16
    const sizeMultiplier = 1 + (nutrient.valueMultiplier - 1) * 0.1;
    const crystalSize = GAME_CONFIG.NUTRIENT_SIZE * sizeMultiplier;
    const outerGeometry = new THREE.IcosahedronGeometry(crystalSize, 0);
    const outerMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.85,
      flatShading: true, // Sharp faceted look
    });
    const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
    group.add(outerMesh);

    // Inner glow core (bright point at center)
    const coreGeometry = new THREE.SphereGeometry(crystalSize * 0.35, 8, 8);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.name = 'core';
    group.add(coreMesh);

    // Store animation data
    group.userData = {
      color,
      crystalSize,
      spawnTime: Date.now(),
      rotationSpeed: 0.0008 + Math.random() * 0.0004, // Slight variation per nutrient
      bobPhase: Math.random() * Math.PI * 2, // Random starting phase for bobbing
    };

    return group;
  }

  /**
   * Animate nutrients: rotation + gentle bobbing
   */
  private updateNutrientAnimations(dt: number): void {
    const now = Date.now();

    this.nutrientMeshes.forEach((group) => {
      const { rotationSpeed, bobPhase, baseX, baseZ } = group.userData;

      // Rotate around Y axis (tumbling effect)
      group.rotation.y += rotationSpeed * dt;
      // Slight wobble on X axis
      group.rotation.x = Math.sin(now * 0.0005 + bobPhase) * 0.3;

      // Gentle bobbing on Y axis (height - floating in digital ocean)
      const bobAmount = Math.sin(now * 0.002 + bobPhase) * 2;
      if (baseX !== undefined && baseZ !== undefined) {
        group.position.set(baseX, bobAmount, baseZ);
      }

      // Pulse the inner core brightness
      const core = group.children.find(c => c.name === 'core') as THREE.Mesh | undefined;
      if (core && core.material instanceof THREE.MeshBasicMaterial) {
        const pulse = 0.7 + Math.sin(now * 0.004 + bobPhase) * 0.3;
        core.material.opacity = pulse;
      }
    });
  }

  private syncPlayers(state: GameState): void {
    // Use renderMode for cross-stage visibility (set by updateRenderModeForStage)
    const isJungleMode = this.environmentSystem.getMode() === 'jungle';

    // Remove players that left
    this.playerMeshes.forEach((group, id) => {
      if (!state.players.has(id)) {
        this.scene.remove(group);

        // Dispose non-cached materials
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            if ((child.material as THREE.Material).dispose) {
              (child.material as THREE.Material).dispose();
            }
          }
        });

        this.playerMeshes.delete(id);

        // Also remove outline if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          this.scene.remove(outline);
          this.playerOutlines.delete(id);
        }
      }
    });

    // Add or update players
    state.players.forEach((player, id) => {
      let cellGroup = this.playerMeshes.get(id);
      const isMyPlayer = id === state.myPlayerId;

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
          // Check if we already have a loaded humanoid model for this player
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
        } else if (player.stage === 'cyber_organism' || player.stage === 'godcell') {
          // Stage 3 and Stage 5: Cyber-organism hexapod (placeholder for godcell for now)
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
          const outlineGeometry = this.getGeometry(`ring-outline-${radius}`, () =>
            new THREE.RingGeometry(radius, radius + 3, 32)
          );
          // Don't cache outline material - needs to change color and opacity dynamically
          const outlineMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 1.0,
            transparent: true,
            opacity: 1.0, // Will fade with health
            depthWrite: false, // Prevent z-fighting with transparent materials
          });
          const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
          outline.position.y = 0.1; // Slightly above player (Y=height)
          // Rotate so ring lies flat on XZ plane (camera looks down Y axis)
          outline.rotation.x = -Math.PI / 2;
          this.scene.add(outline);
          this.playerOutlines.set(id, outline);
        }
      }

      // Update cell visuals based on stage and energy (diegetic UI - energy is sole life resource)
      if (player.stage === 'humanoid' && cellGroup.userData.isHumanoid) {
        // Stage 4: Humanoid - update animation and energy visualization
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
          ? Math.sqrt(Math.pow(currPos.x - prevPos.x, 2) + Math.pow(currPos.y - prevPos.y, 2)) * 60 // per second
          : 0;

        // Update humanoid animation (idle/walk/run blending)
        const animState = cellGroup.userData.animState as HumanoidAnimationState | undefined;
        if (animState) {
          updateHumanoidAnimation(animState, 1 / 60, isMoving, speed);
        }

        // For first-person (local player), rotate humanoid to match camera yaw
        // For other players, rotate to face movement direction
        if (isMyPlayer) {
          setHumanoidRotation(cellGroup, this.cameraSystem.getYaw());
        } else if (prevPos && isMoving) {
          const dx = currPos.x - prevPos.x;
          const dy = currPos.y - prevPos.y;
          const targetHeading = Math.atan2(dy, dx);
          setHumanoidRotation(cellGroup, targetHeading);
        }

        // Position humanoid in world (different coordinate system - Y is up in 3D)
        // Game coords: X = X, Y = Z (forward into world), height = Y
        cellGroup.position.set(player.position.x, 0, -player.position.y);

      } else if (player.stage === 'cyber_organism' || player.stage === 'godcell') {
        // Stage 3 and 5: Cyber-organism (hexapod)
        const energyRatio = player.energy / player.maxEnergy;
        updateCyberOrganismEnergy(cellGroup, energyRatio);

        // Check if player is moving by comparing current to previous position
        const prevPos = cellGroup.userData.lastPosition as { x: number; y: number } | undefined;
        const currPos = player.position;
        const isMoving = prevPos
          ? Math.abs(currPos.x - prevPos.x) > 1 || Math.abs(currPos.y - prevPos.y) > 1
          : false;
        cellGroup.userData.lastPosition = { x: currPos.x, y: currPos.y };

        // Update heading (face direction of movement)
        if (prevPos && isMoving) {
          const dx = currPos.x - prevPos.x;
          const dy = currPos.y - prevPos.y;
          // Calculate target heading - offset by PI because head points in -X direction
          const targetHeading = Math.atan2(dy, dx) + Math.PI;

          // Initialize heading if not set
          if (cellGroup.userData.heading === undefined) {
            cellGroup.userData.heading = targetHeading;
          }

          // Smooth rotation toward target heading (lerp with angle wrapping)
          let currentHeading = cellGroup.userData.heading as number;
          let delta = targetHeading - currentHeading;

          // Wrap delta to [-PI, PI] for shortest rotation path
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;

          currentHeading += delta * 0.15; // Lerp factor for smooth turning
          cellGroup.userData.heading = currentHeading;
          cellGroup.rotation.z = currentHeading;
        }

        updateCyberOrganismAnimation(cellGroup, isMoving, 1 / 60); // ~60fps
      } else if (player.stage === 'multi_cell') {
        updateMultiCellEnergy(
          cellGroup,
          this.multiCellStyle,
          player.energy,
          player.maxEnergy
        );
      } else {
        this.updateCellEnergy(cellGroup, player.energy, player.maxEnergy, player.stage);
      }

      // Apply evolution effects if player is evolving
      const evolState = this.playerEvolutionState.get(id);
      if (evolState) {
        const elapsed = Date.now() - evolState.startTime;
        const progress = Math.min(elapsed / evolState.duration, 1.0);

        // Apply glow and pulse to whichever mesh is visible
        if (evolState.sourceMesh) {
          applyEvolutionEffects(evolState.sourceMesh, evolState.sourceStage, progress);
        }
        if (evolState.targetMesh) {
          applyEvolutionEffects(evolState.targetMesh, evolState.targetStage, progress);

          // Crossfade: source fades out, target fades in
          const sourceOpacity = 1.0 - progress;
          const targetOpacity = progress;

          this.setGroupOpacity(evolState.sourceMesh!, sourceOpacity);
          this.setGroupOpacity(evolState.targetMesh, targetOpacity);

          // Scale effects: source shrinks slightly, target grows from smaller
          evolState.sourceMesh!.scale.setScalar(1.0 - progress * 0.15); // Shrink to 0.85
          evolState.targetMesh.scale.setScalar(0.7 + progress * 0.3); // Grow from 0.7 to 1.0

          // Keep both meshes at same position
          evolState.targetMesh.position.copy(cellGroup.position);
        }
      }

      // Update outline opacity and color for client player based on energy and damage
      if (isMyPlayer) {
        const outline = this.playerOutlines.get(id);
        if (outline) {
          const energyRatio = player.energy / player.maxEnergy;
          const outlineMaterial = outline.material as THREE.MeshStandardMaterial;
          outlineMaterial.opacity = energyRatio; // Direct proportion: 1.0 at full energy, 0.0 at death

          // Turn outline red when taking damage
          const damageInfo = state.playerDamageInfo.get(id);
          if (damageInfo && damageInfo.totalDamageRate > 0) {
            // Taking damage - turn red
            outlineMaterial.color.setRGB(1.0, 0.0, 0.0); // Pure red
            outlineMaterial.emissive.setRGB(1.0, 0.0, 0.0); // Pure red glow
            outlineMaterial.emissiveIntensity = 2.0; // Bright
          } else {
            // No damage - keep white
            outlineMaterial.color.setRGB(1.0, 1.0, 1.0);
            outlineMaterial.emissive.setRGB(1.0, 1.0, 1.0);
            outlineMaterial.emissiveIntensity = 1.0;
          }
        }
      }

      // Update position with client-side interpolation
      const target = state.playerTargets.get(id);
      if (target) {
        // Lerp toward server position (XZ plane: game Y maps to -Z)
        const lerpFactor = 0.3;
        cellGroup.position.x += (target.x - cellGroup.position.x) * lerpFactor;
        const targetZ = -target.y;
        cellGroup.position.z += (targetZ - cellGroup.position.z) * lerpFactor;

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.x = cellGroup.position.x;
          outline.position.z = cellGroup.position.z;
        }

        // Update compass indicators for client player (chemical sensing)
        if (isMyPlayer) {
          this.compassIndicators = updateCompassIndicators(
            this.scene,
            this.compassIndicators,
            this.detectedEntities,
            { x: cellGroup.position.x, y: cellGroup.position.y },
            radius,
            player.stage
          );
        }
      } else {
        // Fallback to direct position if no target
        // Maintain height offset for Stage 3+ creatures
        const heightOffset = (player.stage === 'cyber_organism' || player.stage === 'humanoid' || player.stage === 'godcell') ? 5 : 0;
        cellGroup.position.set(player.position.x, heightOffset, -player.position.y);

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.set(player.position.x, heightOffset + 0.1, -player.position.y);
        }

        // Update compass indicators for client player (chemical sensing)
        if (isMyPlayer) {
          this.compassIndicators = updateCompassIndicators(
            this.scene,
            this.compassIndicators,
            this.detectedEntities,
            { x: player.position.x, y: player.position.y },
            radius,
            player.stage
          );
        }
      }

      // Cross-stage visibility: Only render players in the same world as local player
      // Soup mode: only Stage 1-2 players visible
      // Jungle mode: only Stage 3+ players visible
      const playerIsJungleStage = (
        player.stage === EvolutionStage.CYBER_ORGANISM ||
        player.stage === EvolutionStage.HUMANOID ||
        player.stage === EvolutionStage.GODCELL
      );
      const shouldBeVisible = isMyPlayer || (isJungleMode === playerIsJungleStage);
      cellGroup.visible = shouldBeVisible;

      // Also hide outline if it exists and player should be hidden
      const outline = this.playerOutlines.get(id);
      if (outline) {
        outline.visible = shouldBeVisible;
      }

      // Hide trail for hidden players
      const trail = this.playerTrailLines.get(id);
      if (trail) {
        trail.visible = shouldBeVisible;
      }
    });
  }

  /**
   * Update cell visual state based on energy (diegetic UI)
   * Energy is the sole life resource in the energy-only system
   * Energy affects all visual feedback: brightness, opacity, and urgency effects
   * Evolution progress (30-100%) triggers visual indicators
   */
  private updateCellEnergy(cellGroup: THREE.Group, energy: number, maxEnergy: number, stage: EvolutionStage): void {
    // Update energy-based visuals (brightness, opacity, flickering)
    updateSingleCellEnergy(cellGroup, energy, maxEnergy);

    // Calculate evolution progress (0.0 = start, 1.0 = ready to evolve)
    // Progress starts counting at 30% of next evolution threshold
    const evolutionProgress = calculateEvolutionProgress(maxEnergy, stage);
    const isApproachingEvolution = evolutionProgress >= 0.3; // 30% threshold

    // ============================================
    // Evolution Progress Indicators (30-100%)
    // ============================================
    if (isApproachingEvolution) {
      // 1. Pulsing Scale Effect - whole cell breathes
      const time = Date.now() * 0.003; // Slower pulse for evolution (vs starvation)
      const pulseIntensity = 0.05 + evolutionProgress * 0.05; // 5-10% size variance
      const cellPulse = 1.0 + Math.sin(time) * pulseIntensity;
      cellGroup.scale.set(cellPulse, cellPulse, cellPulse);

      // 2. Particle Corona - orbiting glow particles
      updateEvolutionCorona(cellGroup, evolutionProgress);

      // 3. Glow Ring - shrinking torus around cell
      updateEvolutionRing(cellGroup, evolutionProgress, cellGroup.userData.radius || 10);
    } else {
      // No evolution effects - reset scale and remove corona/ring
      cellGroup.scale.set(1, 1, 1);
      removeEvolutionEffects(cellGroup);
    }
  }

  /**
   * Set opacity for all materials in a group recursively
   */
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
        // Recursively set opacity for nested groups (multi-cell)
        this.setGroupOpacity(child, opacity);
      }
    });
  }

  /**
   * Flash the drain aura on a target when hit by pseudopod beam
   * Temporarily increases brightness/scale for impact feedback
   */
  private flashDrainAura(targetId: string): void {
    const auraMesh = this.drainAuraMeshes.get(targetId);
    if (!auraMesh) return; // No aura to flash (target may not be currently drained)

    // Boost emissive intensity for a brief flash (handled by existing animation)
    // We'll store a flash timestamp and check it in updateDrainAuras
    if (!auraMesh.userData.flashTime) {
      auraMesh.userData.flashTime = Date.now();
    } else {
      // Refresh flash
      auraMesh.userData.flashTime = Date.now();
    }
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
    // Clean up humanoid models (Stage 4 GLTF instances)
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

    // Clean up meshes (geometries are cached, so don't dispose them here)
    this.nutrientMeshes.clear();
    this.playerMeshes.clear();
    this.playerOutlines.clear();

    // Clean up player trails
    disposeAllTrails(this.scene, this.playerTrailPoints, this.playerTrailLines);

    // Clean up drain auras (both Mesh for players and Group for swarms)
    this.drainAuraMeshes.forEach(auraMesh => {
      this.scene.remove(auraMesh);
      if (auraMesh instanceof THREE.Group) {
        auraMesh.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
      } else if (auraMesh instanceof THREE.Mesh) {
        auraMesh.geometry.dispose();
        (auraMesh.material as THREE.Material).dispose();
      }
    });
    this.drainAuraMeshes.clear();

    // Clean up gain auras (cyan glow for energy gain)
    this.gainAuraMeshes.forEach(aura => {
      this.scene.remove(aura);
      aura.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.gainAuraMeshes.clear();

    // Clean up energy transfer animations
    this.energyTransferAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.energyTransferAnimations = [];
    this.nutrientPositionCache.clear();

    this.obstacleMeshes.forEach(group => {
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.obstacleMeshes.clear();

    this.swarmMeshes.forEach(group => {
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.swarmMeshes.clear();
    this.swarmParticleData.clear();
    this.swarmInternalParticles.clear();
    this.swarmPulsePhase.clear();

    // Clean up death animations
    this.deathAnimations.forEach(anim => {
      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();
    });
    this.deathAnimations = [];

    // Dispose cached geometries
    this.geometryCache.forEach(geo => geo.dispose());
    this.geometryCache.clear();

    // Dispose cached materials
    this.materialCache.forEach(mat => mat.dispose());
    this.materialCache.clear();

    // Clean up compass indicators
    if (this.compassIndicators) {
      disposeCompassIndicators(this.compassIndicators);
      this.scene.remove(this.compassIndicators);
      this.compassIndicators = null;
    }

    // Dispose extracted module caches
    disposeSingleCellCache();

    // Dispose composer
    this.composer.dispose();

    // Dispose renderer
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
