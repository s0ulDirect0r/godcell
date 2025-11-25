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
import { createMultiCell, updateMultiCellEnergy } from './MultiCellRenderer';
import { createSingleCell, disposeSingleCellCache, updateSingleCellEnergy } from './SingleCellRenderer';
import { updateCompassIndicators, disposeCompassIndicators } from './CompassRenderer';
import { updateTrails, disposeAllTrails } from './TrailRenderer';
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
} from './ParticleEffects';
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
} from './DrainAuraRenderer';
import {
  createGainAura,
  triggerGainFlash,
  updateGainAura,
} from './GainAuraRenderer';
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
import {
  getStageZoom,
  calculateDamageShake,
  applyCameraShake,
  followTarget,
  updateZoomTransition,
  applyCameraZoom,
} from './CameraEffects';

/**
 * Three.js-based renderer with postprocessing effects
 */
export class ThreeRenderer implements Renderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private container!: HTMLElement;
  private composer!: EffectComposer;

  // Camera effects
  private cameraShake = 0;
  private lastPlayerEnergy: number | null = null;

  // Camera zoom for evolution stages
  private currentZoom = 1.0; // Current zoom level (1.0 = Stage 1)
  private targetZoom = 1.0; // Target zoom level (for smooth transitions)
  private myPlayerId: string | null = null; // Local player ID for event filtering
  private initialZoomSet = false; // Track if we've set initial zoom based on spawn stage

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

  // Background particles (using efficient Points system)
  private dataParticles!: THREE.Points;
  private particleData: Array<{ x: number; y: number; vx: number; vy: number; size: number }> = [];

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
    this.scene.background = new THREE.Color(GAME_CONFIG.BACKGROUND_COLOR);

    // Add grid
    this.createGrid();

    // Create background particles
    this.createDataParticles();

    // Create orthographic camera (top-down 2D)
    const aspect = width / height;
    const frustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,  // Near plane (must be non-negative for Three.js)
      200   // Far plane
    );
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    // Basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(5, 10, 7.5);
    this.scene.add(keyLight);

    // Create postprocessing composer
    this.composer = createComposer(this.renderer, this.scene, this.camera, width, height);

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
          const position = { x: playerGroup.position.x, y: playerGroup.position.y };

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
        if (event.targetStage === 'multi_cell') {
          targetGroup = createMultiCell({
            radius: targetRadius,
            colorHex,
            style: this.multiCellStyle,
          });
        } else {
          // Create single-cell (or other future stages)
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

          this.evolutionAnimations.push(spawnEvolutionParticles(
            this.scene,
            playerGroup.position.x,
            playerGroup.position.y,
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
          this.targetZoom = getStageZoom(event.newStage);

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
            newOutline.position.z = 0.1;
            this.scene.add(newOutline);
            this.playerOutlines.set(event.playerId, newOutline);
          }
        }
      });

      // Player respawned - reset camera zoom
      eventBus.on('playerRespawned', (event) => {
        // Update camera zoom if this is the local player
        if (this.myPlayerId && event.player.id === this.myPlayerId) {
          // Set zoom based on respawn stage
          this.targetZoom = getStageZoom(event.player.stage);
          this.currentZoom = this.targetZoom; // Instant reset (no transition)
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
          // Capture position before removal
          const position = { x: swarmGroup.position.x, y: swarmGroup.position.y };
          this.swarmDeathAnimations.push(spawnSwarmDeathExplosion(this.scene, position.x, position.y));

          // Energy transfer particles from swarm to consumer (orange/red for swarm energy)
          if (consumerMesh) {
            this.energyTransferAnimations.push(
              spawnEnergyTransferParticles(
                this.scene,
                position.x,
                position.y,
                consumerMesh.position.x,
                consumerMesh.position.y,
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
          this.energyTransferAnimations.push(
            spawnEnergyTransferParticles(
              this.scene,
              nutrientPos.x,
              nutrientPos.y,
              collectorMesh.position.x,
              collectorMesh.position.y,
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
          this.energyTransferAnimations.push(
            spawnEnergyTransferParticles(
              this.scene,
              event.position.x,
              event.position.y,
              predatorMesh.position.x,
              predatorMesh.position.y,
              event.predatorId,
              0x00ff88, // Green-cyan for player energy
              40 // Lots of particles for player kill
            )
          );
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
        const initialZoom = getStageZoom(myPlayer.stage);
        this.currentZoom = initialZoom;
        this.targetZoom = initialZoom;
        this.initialZoomSet = true;

        // Apply immediately if not Stage 1
        if (initialZoom !== 1.0) {
          const aspect = this.renderer.domElement.width / this.renderer.domElement.height;
          applyCameraZoom(this.camera, this.currentZoom, aspect);
        }
      }

      // Detect energy decrease (damage taken) - energy is sole life resource
      if (this.lastPlayerEnergy !== null && myPlayer.energy < this.lastPlayerEnergy) {
        const damageAmount = this.lastPlayerEnergy - myPlayer.energy;
        const shakeIntensity = calculateDamageShake(damageAmount);
        this.cameraShake = Math.max(this.cameraShake, shakeIntensity); // Use max so multiple hits don't override
      }

      // Update last energy
      this.lastPlayerEnergy = myPlayer.energy;
    }

    // Update background particles
    this.updateDataParticles(dt);

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

    // Update camera to follow player's interpolated mesh position
    if (myPlayer) {
      const mesh = this.playerMeshes.get(myPlayer.id);
      if (mesh) {
        followTarget(this.camera, mesh.position.x, mesh.position.y);
      }
    }

    // Apply camera shake effect
    this.cameraShake = applyCameraShake(this.camera, this.cameraShake);

    // Update camera zoom (smooth transition to target zoom)
    const aspect = this.renderer.domElement.width / this.renderer.domElement.height;
    this.currentZoom = updateZoomTransition(
      this.camera,
      this.currentZoom,
      this.targetZoom,
      aspect
    );

    // Render scene with postprocessing
    this.composer.render();
  }

  private createGrid(): void {
    const gridSize = 100; // Grid cell size
    const gridColor = GAME_CONFIG.GRID_COLOR;

    // Create vertical lines
    for (let x = 0; x <= GAME_CONFIG.WORLD_WIDTH; x += gridSize) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, -1),
        new THREE.Vector3(x, GAME_CONFIG.WORLD_HEIGHT, -1),
      ]);
      const material = new THREE.LineBasicMaterial({ color: gridColor });
      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
    }

    // Create horizontal lines
    for (let y = 0; y <= GAME_CONFIG.WORLD_HEIGHT; y += gridSize) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, y, -1),
        new THREE.Vector3(GAME_CONFIG.WORLD_WIDTH, y, -1),
      ]);
      const material = new THREE.LineBasicMaterial({ color: gridColor });
      const line = new THREE.Line(geometry, material);
      this.scene.add(line);
    }
  }

  private createDataParticles(): void {
    const particleCount = GAME_CONFIG.MAX_PARTICLES;

    // Create positions and sizes arrays
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * GAME_CONFIG.WORLD_WIDTH;
      const y = Math.random() * GAME_CONFIG.WORLD_HEIGHT;
      const size = GAME_CONFIG.PARTICLE_MIN_SIZE + Math.random() * (GAME_CONFIG.PARTICLE_MAX_SIZE - GAME_CONFIG.PARTICLE_MIN_SIZE);

      // Position
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = -0.8;

      // Size
      sizes[i] = size;

      // Calculate velocity (diagonal flow)
      const baseAngle = Math.PI / 4; // 45 degrees
      const variance = (Math.random() - 0.5) * Math.PI / 2;
      const angle = baseAngle + variance;
      const speed = GAME_CONFIG.PARTICLE_SPEED_MIN + Math.random() * (GAME_CONFIG.PARTICLE_SPEED_MAX - GAME_CONFIG.PARTICLE_SPEED_MIN);

      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      // Store particle data for updates
      this.particleData.push({ x, y, vx, vy, size });
    }

    // Create BufferGeometry with position and size attributes
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Create PointsMaterial with transparent circles
    const material = new THREE.PointsMaterial({
      color: GAME_CONFIG.PARTICLE_COLOR,
      size: 5, // Base size (will be multiplied by size attribute)
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: false, // Keep consistent size regardless of camera distance
      map: this.createCircleTexture(),
      alphaTest: 0.5,
    });

    // Create Points mesh
    this.dataParticles = new THREE.Points(geometry, material);
    this.scene.add(this.dataParticles);
  }

  private createCircleTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;

    // Draw circle
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private updateDataParticles(dt: number): void {
    const deltaSeconds = dt / 1000;
    const positions = this.dataParticles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < this.particleData.length; i++) {
      const particle = this.particleData[i];

      // Update particle position
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;

      // Wrap around world bounds
      if (particle.x > GAME_CONFIG.WORLD_WIDTH + 10) particle.x = -10;
      if (particle.y > GAME_CONFIG.WORLD_HEIGHT + 10) particle.y = -10;
      if (particle.x < -10) particle.x = GAME_CONFIG.WORLD_WIDTH + 10;
      if (particle.y < -10) particle.y = GAME_CONFIG.WORLD_HEIGHT + 10;

      // Update BufferGeometry positions
      positions[i * 3] = particle.x;
      positions[i * 3 + 1] = particle.y;
      // Z position stays at -0.8
    }

    // Mark positions as needing update
    this.dataParticles.geometry.attributes.position.needsUpdate = true;
  }

  private syncObstacles(state: GameState): void {
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
          // Hitscan mode: beam.velocity is the end position
          startPos = new THREE.Vector3(beam.position.x, beam.position.y, 1);
          endPos = new THREE.Vector3(beam.velocity.x, beam.velocity.y, 1);
        } else {
          // Projectile mode: create short lightning bolt in direction of travel
          const boltLength = 80; // Fixed visual length
          const dirX = beam.velocity.x / Math.sqrt(beam.velocity.x ** 2 + beam.velocity.y ** 2);
          const dirY = beam.velocity.y / Math.sqrt(beam.velocity.x ** 2 + beam.velocity.y ** 2);

          startPos = new THREE.Vector3(beam.position.x, beam.position.y, 1);
          endPos = new THREE.Vector3(
            beam.position.x + dirX * boltLength,
            beam.position.y + dirY * boltLength,
            1
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
        const angle = Math.atan2(direction.y, direction.x);
        mesh.rotation.z = angle - Math.PI / 2;

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
          // Update position for moving projectile
          mesh.position.x = beam.position.x;
          mesh.position.y = beam.position.y;
        }
      }
    });
  }

  private interpolateSwarms(): void {
    const lerpFactor = 0.3;

    this.swarmMeshes.forEach((group, id) => {
      const target = this.swarmTargets.get(id);
      if (target) {
        group.position.x += (target.x - group.position.x) * lerpFactor;
        group.position.y += (target.y - group.position.y) * lerpFactor;
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

          newAuraMesh.position.z = -1; // Behind player
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
          newAuraMesh.position.z = -1; // Behind swarm

          this.drainAuraMeshes.set(auraId, newAuraMesh);
          this.scene.add(newAuraMesh);
          auraMesh = newAuraMesh;
        }

        // Type guard: ensure auraMesh exists after creation
        if (!auraMesh) return;

        // Position aura at swarm position
        auraMesh.position.x = swarmMesh.position.x;
        auraMesh.position.y = swarmMesh.position.y;

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
        gainAura.position.z = 0.05; // Slightly in front of player
        this.scene.add(gainAura);
        this.gainAuraMeshes.set(playerId, gainAura);
      }

      // Position aura at player position
      gainAura.position.x = playerMesh.position.x;
      gainAura.position.y = playerMesh.position.y;

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

      // Keep aura positioned at player
      gainAura.position.x = playerMesh.position.x;
      gainAura.position.y = playerMesh.position.y;

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
      group.userData.baseX = nutrient.position.x;
      group.userData.baseY = nutrient.position.y;
      group.position.set(nutrient.position.x, nutrient.position.y, 0);

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
      const { rotationSpeed, bobPhase, baseX, baseY } = group.userData;

      // Rotate around Y axis (tumbling effect)
      group.rotation.y += rotationSpeed * dt;
      // Slight wobble on X axis
      group.rotation.x = Math.sin(now * 0.0005 + bobPhase) * 0.3;

      // Gentle bobbing on Z axis (floating in digital ocean)
      const bobAmount = Math.sin(now * 0.002 + bobPhase) * 2;
      if (baseX !== undefined && baseY !== undefined) {
        group.position.set(baseX, baseY, bobAmount);
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
        if (player.stage === 'multi_cell') {
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

        // Position group at player location
        cellGroup.position.set(player.position.x, player.position.y, 0);

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
          outline.position.z = 0.1; // Slightly above player
          this.scene.add(outline);
          this.playerOutlines.set(id, outline);
        }
      }

      // Update cell visuals based on stage and energy (diegetic UI - energy is sole life resource)
      if (player.stage === 'multi_cell') {
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
        // Lerp toward server position
        const lerpFactor = 0.3;
        cellGroup.position.x += (target.x - cellGroup.position.x) * lerpFactor;
        cellGroup.position.y += (target.y - cellGroup.position.y) * lerpFactor;

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.x = cellGroup.position.x;
          outline.position.y = cellGroup.position.y;
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
        cellGroup.position.set(player.position.x, player.position.y, 0);

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.set(player.position.x, player.position.y, 0.1);
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
    const aspect = width / height;
    applyCameraZoom(this.camera, this.currentZoom, aspect);
  }

  getCameraCapabilities(): CameraCapabilities {
    return {
      mode: 'topdown',
      supports3D: true, // Will support 3D later
    };
  }

  getCameraProjection() {
    // Simple screen ↔ world for orthographic camera
    return {
      screenToWorld: (screenX: number, screenY: number) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((screenX - rect.left) / rect.width) * 2 - 1;
        const y = -((screenY - rect.top) / rect.height) * 2 + 1;

        const vector = new THREE.Vector3(x, y, 0);
        vector.unproject(this.camera);

        return { x: vector.x, y: vector.y };
      },
      worldToScreen: (worldX: number, worldY: number) => {
        const vector = new THREE.Vector3(worldX, worldY, 0);
        vector.project(this.camera);

        const rect = this.renderer.domElement.getBoundingClientRect();
        return {
          x: ((vector.x + 1) / 2) * rect.width + rect.left,
          y: ((-vector.y + 1) / 2) * rect.height + rect.top,
        };
      },
    };
  }

  dispose(): void {
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

    // Clean up particle system
    if (this.dataParticles) {
      this.dataParticles.geometry.dispose();
      (this.dataParticles.material as THREE.Material).dispose();
      const material = this.dataParticles.material as THREE.PointsMaterial;
      if (material.map) {
        material.map.dispose();
      }
    }

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
