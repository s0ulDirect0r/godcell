// ============================================
// Three.js Renderer
// ============================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG } from '@godcell/shared';
import { createComposer } from './postprocessing/composer';

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
  private lastPlayerHealth: number | null = null;

  // Resource caching for performance
  private geometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private materialCache: Map<string, THREE.Material> = new Map();

  // Entity meshes
  private nutrientMeshes: Map<string, THREE.Mesh> = new Map();
  private playerMeshes: Map<string, THREE.Group> = new Map(); // Changed to Group for 3D cells (membrane + nucleus)
  private playerOutlines: Map<string, THREE.Mesh> = new Map(); // White stroke for client player
  private obstacleMeshes: Map<string, THREE.Group> = new Map();
  private swarmMeshes: Map<string, THREE.Group> = new Map(); // Changed to Group to include particles
  private swarmParticleData: Map<string, Array<{ angle: number; radius: number; speed: number }>> = new Map(); // Animation data for swarm particles

  // Trails (using tube geometry for thick ribbons)
  private playerTrailPoints: Map<string, Array<{ x: number; y: number }>> = new Map();
  private playerTrailLines: Map<string, THREE.Mesh> = new Map();

  // Interpolation targets
  private swarmTargets: Map<string, { x: number; y: number }> = new Map();

  // Background particles (using efficient Points system)
  private dataParticles!: THREE.Points;
  private particleData: Array<{ x: number; y: number; vx: number; vy: number; size: number }> = [];

  // Death animations (particle bursts)
  private deathAnimations: Array<{
    particles: THREE.Points;
    particleData: Array<{ x: number; y: number; vx: number; vy: number; life: number }>;
    startTime: number;
    duration: number;
  }> = [];

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

          // Get color from nucleus mesh (fourth child: membrane, cytoplasm, organelles, nucleus)
          const nucleus = playerGroup.children[3] as THREE.Mesh;
          const material = nucleus.material as THREE.MeshStandardMaterial;
          const color = material.emissive.getHex();

          this.spawnDeathParticles(position.x, position.y, color);

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

  private getMaterial(key: string, factory: () => THREE.Material): THREE.Material {
    if (!this.materialCache.has(key)) {
      this.materialCache.set(key, factory());
    }
    return this.materialCache.get(key)!;
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
    // Detect damage for camera shake
    const myPlayer = state.getMyPlayer();
    if (myPlayer) {
      // Detect health decrease (damage taken)
      if (this.lastPlayerHealth !== null && myPlayer.health < this.lastPlayerHealth) {
        const damageAmount = this.lastPlayerHealth - myPlayer.health;
        // Camera shake intensity scales with damage (1 damage = 1.6 shake intensity)
        const shakeIntensity = Math.min(damageAmount * 1.6, 40); // Cap at 40
        this.cameraShake = Math.max(this.cameraShake, shakeIntensity); // Use max so multiple hits don't override
      }

      // Update last health
      this.lastPlayerHealth = myPlayer.health;
    }

    // Update background particles
    this.updateDataParticles(dt);

    // Update death animations
    this.updateDeathAnimations(dt);

    // Sync all entities
    this.syncPlayers(state);
    this.syncNutrients(state);
    this.syncObstacles(state);
    this.syncSwarms(state);

    // Interpolate swarm positions
    this.interpolateSwarms();

    // Animate swarm particles
    this.updateSwarmParticles(dt);

    // Update trails
    this.updateTrails(state);

    // Update camera to follow player's interpolated mesh position
    if (myPlayer) {
      const mesh = this.playerMeshes.get(myPlayer.id);
      if (mesh) {
        // Lerp camera toward mesh position (which is already interpolated)
        const lerpFactor = 0.2;
        this.camera.position.x += (mesh.position.x - this.camera.position.x) * lerpFactor;
        this.camera.position.y += (mesh.position.y - this.camera.position.y) * lerpFactor;
      }
    }

    // Apply camera shake effect
    if (this.cameraShake > 0) {
      const offsetX = (Math.random() - 0.5) * this.cameraShake;
      const offsetY = (Math.random() - 0.5) * this.cameraShake;
      this.camera.position.x += offsetX;
      this.camera.position.y += offsetY;
      this.cameraShake *= 0.88; // Moderate decay
    }

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
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        this.scene.remove(group);
        this.obstacleMeshes.delete(id);
      }
    });

    // Add obstacles (they don't move, so only create once)
    state.obstacles.forEach((obstacle, id) => {
      if (!this.obstacleMeshes.has(id)) {
        const group = new THREE.Group();
        group.position.set(obstacle.position.x, obstacle.position.y, -1);

        // Outer ring (cyan, low opacity)
        const outerRing = new THREE.Mesh(
          new THREE.RingGeometry(obstacle.radius - 2, obstacle.radius, 64),
          new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 })
        );
        group.add(outerRing);

        // Middle ring (cyan, medium opacity)
        const middleRing = new THREE.Mesh(
          new THREE.RingGeometry(obstacle.radius * 0.6 - 2, obstacle.radius * 0.6, 64),
          new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 })
        );
        group.add(middleRing);

        // Inner ring (magenta)
        const innerRing = new THREE.Mesh(
          new THREE.RingGeometry(obstacle.radius * 0.3 - 3, obstacle.radius * 0.3, 64),
          new THREE.MeshBasicMaterial({ color: 0xff0088, transparent: true, opacity: 0.8 })
        );
        group.add(innerRing);

        // Core fill (magenta, low opacity)
        const coreFill = new THREE.Mesh(
          new THREE.CircleGeometry(obstacle.radius * 0.3, 64),
          new THREE.MeshBasicMaterial({ color: 0xff0088, transparent: true, opacity: 0.1 })
        );
        group.add(coreFill);

        // Death core (red, solid)
        const deathCore = new THREE.Mesh(
          new THREE.CircleGeometry(GAME_CONFIG.OBSTACLE_CORE_RADIUS, 32),
          new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3 })
        );
        group.add(deathCore);

        // Death core outline (red)
        const deathCoreOutline = new THREE.Mesh(
          new THREE.RingGeometry(GAME_CONFIG.OBSTACLE_CORE_RADIUS - 4, GAME_CONFIG.OBSTACLE_CORE_RADIUS, 32),
          new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 1.0 })
        );
        group.add(deathCoreOutline);

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
        // Dispose all children
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        this.swarmMeshes.delete(id);
        this.swarmTargets.delete(id);
        this.swarmParticleData.delete(id); // Clean up particle animation data
      }
    });

    // Add or update swarms
    state.swarms.forEach((swarm, id) => {
      let group = this.swarmMeshes.get(id);

      if (!group) {
        // Create swarm group (circle + particles for glitch/viral effect)
        group = new THREE.Group();

        // Main circle body
        const geometry = new THREE.CircleGeometry(swarm.size, 32);
        const material = new THREE.MeshBasicMaterial({
          color: 0xff0088,
          transparent: true,
          opacity: 0.6
        });
        const mesh = new THREE.Mesh(geometry, material);
        group.add(mesh);

        // Particle system for glitch/static effect
        const particleCount = 30;
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);

        // Store animation data for each particle (angle, radius, rotation speed)
        const particleAnimData: Array<{ angle: number; radius: number; speed: number }> = [];

        // Scatter particles around swarm with animation data
        for (let i = 0; i < particleCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = (Math.random() * 0.5 + 0.7) * swarm.size; // 0.7-1.2x radius
          const speed = (Math.random() - 0.5) * 2; // Random rotation speed (-1 to 1 rad/s)

          positions[i * 3] = Math.cos(angle) * radius;
          positions[i * 3 + 1] = Math.sin(angle) * radius;
          positions[i * 3 + 2] = 0;

          particleAnimData.push({ angle, radius, speed });
        }

        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const particleMaterial = new THREE.PointsMaterial({
          color: 0xff0088,
          size: 6, // Bigger particles
          transparent: true,
          opacity: 0.7,
          sizeAttenuation: false,
        });

        const particles = new THREE.Points(particleGeometry, particleMaterial);
        group.add(particles);

        // Store particle animation data
        this.swarmParticleData.set(id, particleAnimData);

        group.position.set(swarm.position.x, swarm.position.y, -0.3);

        this.scene.add(group);
        this.swarmMeshes.set(id, group);
        this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });
      }

      // Update target position for interpolation
      this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });

      // Update color based on state (get the mesh child from the group)
      const mesh = group.children[0] as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const particles = group.children[1] as THREE.Points;
      const particleMaterial = particles.material as THREE.PointsMaterial;

      if (swarm.state === 'chase') {
        material.color.setHex(0xff0044);
        material.opacity = 0.8;
        particleMaterial.color.setHex(0xff0044);
      } else {
        material.color.setHex(0xff0088);
        material.opacity = 0.6;
        particleMaterial.color.setHex(0xff0088);
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

  private updateSwarmParticles(dt: number): void {
    const deltaSeconds = dt / 1000;

    this.swarmMeshes.forEach((group, id) => {
      const particleAnimData = this.swarmParticleData.get(id);
      if (!particleAnimData) return;

      // Get the particles mesh (second child of the group)
      const particles = group.children[1] as THREE.Points;
      if (!particles) return;

      const positions = particles.geometry.attributes.position.array as Float32Array;

      // Update each particle position based on rotation
      for (let i = 0; i < particleAnimData.length; i++) {
        const data = particleAnimData[i];

        // Rotate the particle around the swarm center
        data.angle += data.speed * deltaSeconds;

        // Update position based on new angle
        positions[i * 3] = Math.cos(data.angle) * data.radius;
        positions[i * 3 + 1] = Math.sin(data.angle) * data.radius;
      }

      // Mark positions as needing update
      particles.geometry.attributes.position.needsUpdate = true;
    });
  }

  private syncNutrients(state: GameState): void {
    // Remove nutrients that no longer exist
    this.nutrientMeshes.forEach((mesh, id) => {
      if (!state.nutrients.has(id)) {
        this.scene.remove(mesh);
        // Don't dispose cached geometry
        this.nutrientMeshes.delete(id);
      }
    });

    // Add or update nutrients
    state.nutrients.forEach((nutrient, id) => {
      let mesh = this.nutrientMeshes.get(id);

      if (!mesh) {
        // Create new nutrient mesh (hexagon shape) with cached geometry
        const geometry = this.getGeometry('hexagon-nutrient', () =>
          new THREE.CircleGeometry(GAME_CONFIG.NUTRIENT_SIZE, 6)
        );

        // Determine color based on value multiplier
        let color: number;
        let materialKey: string;
        if (nutrient.valueMultiplier >= 5) {
          color = GAME_CONFIG.NUTRIENT_5X_COLOR; // Magenta (5x)
          materialKey = 'nutrient-5x';
        } else if (nutrient.valueMultiplier >= 3) {
          color = GAME_CONFIG.NUTRIENT_3X_COLOR; // Gold (3x)
          materialKey = 'nutrient-3x';
        } else if (nutrient.valueMultiplier >= 2) {
          color = GAME_CONFIG.NUTRIENT_2X_COLOR; // Cyan (2x)
          materialKey = 'nutrient-2x';
        } else {
          color = GAME_CONFIG.NUTRIENT_COLOR; // Green (1x)
          materialKey = 'nutrient-1x';
        }

        const material = this.getMaterial(materialKey, () =>
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 1.0, // Very strong glow for nutrients (data packets)
          })
        );

        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.nutrientMeshes.set(id, mesh);
      }

      // Update position
      mesh.position.set(nutrient.position.x, nutrient.position.y, 0);
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

      if (!cellGroup) {
        // Calculate size based on stage
        const radius = this.getPlayerRadius(player.stage);

        // Parse hex color (#RRGGBB → 0xRRGGBB)
        const colorHex = parseInt(player.color.replace('#', ''), 16);

        // Create cell group (membrane + organelle particles + nucleus)
        cellGroup = new THREE.Group();

        // === OUTER MEMBRANE (Transparent shell) ===
        const membraneGeometry = this.getGeometry(`sphere-membrane-${radius}`, () =>
          new THREE.SphereGeometry(radius, 32, 32)
        );

        const membraneMaterial = new THREE.MeshPhysicalMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.15, // Very transparent so you can see inside
          roughness: 0.1,
          metalness: 0.05,
          clearcoat: 0.8, // Glossy outer surface
        });

        const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
        cellGroup.add(membrane);

        // === CYTOPLASM (Volumetric jelly with shader) ===
        const nucleusRadius = radius * 0.3;
        const cytoplasmGeometry = this.getGeometry(`sphere-cytoplasm-${radius}`, () =>
          new THREE.SphereGeometry(radius * 0.95, 32, 32)
        );

        // Custom volumetric shader for jelly effect
        const cytoplasmMaterial = new THREE.ShaderMaterial({
          uniforms: {
            color: { value: new THREE.Color(colorHex) },
            opacity: { value: 0.5 },
            nucleusRadius: { value: nucleusRadius },
            cellRadius: { value: radius * 0.95 },
            healthRatio: { value: 1.0 }, // Will darken toward black as health drops
          },
          vertexShader: `
            varying vec3 vPosition;
            varying vec3 vNormal;

            void main() {
              vPosition = position;
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 color;
            uniform float opacity;
            uniform float nucleusRadius;
            uniform float cellRadius;
            uniform float healthRatio;

            varying vec3 vPosition;
            varying vec3 vNormal;

            void main() {
              // Distance from center
              float dist = length(vPosition);

              // Create gradient: denser near center, fading toward edges
              float gradient = smoothstep(cellRadius, nucleusRadius * 1.5, dist);

              // Fresnel effect (edges glow more)
              vec3 viewDir = normalize(cameraPosition - vPosition);
              float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);

              // Combine gradient with fresnel
              float alpha = mix(0.6, 0.2, gradient) * opacity;
              alpha += fresnel * 0.15;

              // Add depth-based darkening for volume feel
              float depthDarken = 1.0 - (dist / cellRadius) * 0.3;

              // Darken toward black as health drops
              vec3 finalColor = mix(vec3(0.0, 0.0, 0.0), color, healthRatio) * depthDarken;

              gl_FragColor = vec4(finalColor, alpha);
            }
          `,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.NormalBlending,
        });

        const cytoplasm = new THREE.Mesh(cytoplasmGeometry, cytoplasmMaterial);
        cellGroup.add(cytoplasm);

        // === ORGANELLE PARTICLES (Floating in the jelly) ===
        const particleCount = 15; // Fewer particles since we have volume now
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const minRadius = nucleusRadius * 1.3;
        const maxRadius = radius * 0.85;

        for (let i = 0; i < particleCount; i++) {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI;
          const r = minRadius + Math.random() * (maxRadius - minRadius);

          positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
          positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
          positions[i * 3 + 2] = r * Math.cos(phi);

          sizes[i] = 1.5 + Math.random() * 1.5;
        }

        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const particleMaterial = new THREE.PointsMaterial({
          color: colorHex,
          size: 2.5,
          transparent: true,
          opacity: 0.7,
          sizeAttenuation: false,
          blending: THREE.AdditiveBlending,
        });

        const organelles = new THREE.Points(particleGeometry, particleMaterial);
        cellGroup.add(organelles);

        // === INNER NUCLEUS (Glowing core) ===
        const nucleusGeometry = this.getGeometry(`sphere-nucleus-${nucleusRadius}`, () =>
          new THREE.SphereGeometry(nucleusRadius, 16, 16)
        );

        const nucleusMaterial = new THREE.MeshStandardMaterial({
          color: colorHex,
          emissive: colorHex,
          emissiveIntensity: 2.0, // Bright glow (will vary with energy)
          transparent: true,
          opacity: 1.0, // Will fade with health
          depthWrite: false, // Prevent z-fighting with transparent materials
        });

        const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
        cellGroup.add(nucleus);

        // Position group at player location
        cellGroup.position.set(player.position.x, player.position.y, 0);

        this.scene.add(cellGroup);
        this.playerMeshes.set(id, cellGroup);

        // Add white stroke outline for client player
        if (isMyPlayer) {
          const outlineGeometry = this.getGeometry(`ring-outline-${radius}`, () =>
            new THREE.RingGeometry(radius, radius + 3, 32)
          );
          // Don't cache outline material - needs to change opacity based on health
          const outlineMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
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

      // Update nucleus brightness based on energy and health (diegetic UI)
      this.updateCellEnergy(cellGroup, player.energy, player.maxEnergy, player.health, player.maxHealth);

      // Update outline opacity for client player based on health
      if (isMyPlayer) {
        const outline = this.playerOutlines.get(id);
        if (outline) {
          const healthRatio = player.health / player.maxHealth;
          const outlineMaterial = outline.material as THREE.MeshBasicMaterial;
          outlineMaterial.opacity = healthRatio; // Direct proportion: 1.0 at full health, 0.0 at death
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
      } else {
        // Fallback to direct position if no target
        cellGroup.position.set(player.position.x, player.position.y, 0);

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.set(player.position.x, player.position.y, 0.1);
        }
      }
    });
  }

  /**
   * Update cell visual state based on energy and health (diegetic UI)
   * Energy affects cytoplasm/organelles brightness
   * Health affects nucleus opacity (fades as health drops)
   */
  private updateCellEnergy(cellGroup: THREE.Group, energy: number, maxEnergy: number, health: number, maxHealth: number): void {
    const energyRatio = energy / maxEnergy;
    const healthRatio = health / maxHealth;

    // Get cell components (membrane, cytoplasm, organelles, nucleus)
    const membrane = cellGroup.children[0] as THREE.Mesh;
    const cytoplasm = cellGroup.children[1] as THREE.Mesh;
    const organelles = cellGroup.children[2] as THREE.Points;
    const nucleus = cellGroup.children[3] as THREE.Mesh;

    const membraneMaterial = membrane.material as THREE.MeshPhysicalMaterial;
    const cytoplasmMaterial = cytoplasm.material as THREE.ShaderMaterial;
    const organelleMaterial = organelles.material as THREE.PointsMaterial;
    const nucleusMaterial = nucleus.material as THREE.MeshStandardMaterial;

    // Nucleus fades based on health
    nucleusMaterial.opacity = 0.3 + healthRatio * 0.7; // 0.3-1.0 based on health

    // Cytoplasm darkens toward black as health drops
    cytoplasmMaterial.uniforms.healthRatio.value = healthRatio;

    // Update based on energy
    if (energyRatio > 0.5) {
      // High energy: bright and steady
      nucleusMaterial.emissiveIntensity = 2.5; // Bright nucleus!
      cytoplasmMaterial.uniforms.opacity.value = 0.5; // Healthy jelly
      organelleMaterial.opacity = 0.7; // Visible organelles
      membraneMaterial.opacity = 0.15; // Subtle membrane
      nucleus.scale.set(1, 1, 1); // Normal size
    } else if (energyRatio > 0.2) {
      // Medium energy: dimming
      nucleusMaterial.emissiveIntensity = 1.0 + energyRatio * 2; // 1.4-2.0
      cytoplasmMaterial.uniforms.opacity.value = 0.35 + energyRatio * 0.3; // 0.44-0.5
      organelleMaterial.opacity = 0.5 + energyRatio * 0.4; // 0.58-0.7
      membraneMaterial.opacity = 0.12 + energyRatio * 0.06; // 0.13-0.15
      nucleus.scale.set(1, 1, 1);
    } else if (energyRatio > 0.1) {
      // Low energy: dramatic flickering
      const time = Date.now() * 0.01;
      const flicker = Math.sin(time) * 0.5 + 0.5; // 0.0-1.0
      nucleusMaterial.emissiveIntensity = (0.3 + energyRatio * 2) * (0.4 + flicker * 0.6); // 0.12-0.7
      cytoplasmMaterial.uniforms.opacity.value = (0.25 + energyRatio * 0.3) * (0.7 + flicker * 0.3); // flickering
      organelleMaterial.opacity = 0.35 + energyRatio * 0.3 * flicker; // 0.35-0.41 flickering
      membraneMaterial.opacity = 0.1;
      // Subtle scale pulse
      const scalePulse = 0.95 + flicker * 0.1;
      nucleus.scale.set(scalePulse, scalePulse, scalePulse);
    } else {
      // Critical energy: URGENT pulsing
      const time = Date.now() * 0.015;
      const pulse = Math.sin(time) * 0.6 + 0.4; // 0.0-1.0
      nucleusMaterial.emissiveIntensity = 0.2 + pulse * 0.8; // 0.2-1.0 pulsing
      cytoplasmMaterial.uniforms.opacity.value = 0.15 + pulse * 0.2; // 0.15-0.35 pulsing jelly
      organelleMaterial.opacity = 0.2 + pulse * 0.25; // 0.2-0.45 pulsing
      membraneMaterial.opacity = 0.05 + pulse * 0.1; // 0.05-0.15 barely visible
      // Dramatic scale pulse
      const scalePulse = 0.85 + pulse * 0.25;
      nucleus.scale.set(scalePulse, scalePulse, scalePulse);
    }
  }

  private updateTrails(state: GameState): void {
    const maxTrailLength = 50; // Trail point history

    state.players.forEach((player, id) => {
      // Get or create trail points array
      let trailPoints = this.playerTrailPoints.get(id);
      if (!trailPoints) {
        trailPoints = [];
        this.playerTrailPoints.set(id, trailPoints);
      }

      // Add current GROUP position to trail (not server position!)
      const cellGroup = this.playerMeshes.get(id);
      if (cellGroup) {
        trailPoints.push({ x: cellGroup.position.x, y: cellGroup.position.y });
      }

      // Keep only last N points
      if (trailPoints.length > maxTrailLength) {
        trailPoints.shift();
      }

      // Get or create trail mesh
      let trailMesh = this.playerTrailLines.get(id);
      if (!trailMesh) {
        const geometry = new THREE.BufferGeometry();
        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const material = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          vertexColors: true,
        });
        trailMesh = new THREE.Mesh(geometry, material);
        trailMesh.position.z = -0.5;
        this.scene.add(trailMesh);
        this.playerTrailLines.set(id, trailMesh);
      }

      // Update trail opacity based on energy
      const energyRatio = player.energy / player.maxEnergy;
      const trailMaterial = trailMesh.material as THREE.MeshBasicMaterial;
      // Trail fades out as energy gets low
      trailMaterial.opacity = Math.max(0.2, energyRatio * 0.8 + 0.2); // 0.2-1.0 range

      // Calculate trail width based on nucleus size (not full cell size)
      const cellRadius = this.getPlayerRadius(player.stage);
      const nucleusRadius = cellRadius * 0.3;
      const maxWidth = nucleusRadius; // Trail width = nucleus radius

      // Create tapered ribbon geometry
      if (trailPoints.length >= 2) {
        const vertexCount = trailPoints.length * 2; // Two vertices per point (top and bottom of ribbon)
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        const indices: number[] = [];

        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const r = ((colorHex >> 16) & 255) / 255;
        const g = ((colorHex >> 8) & 255) / 255;
        const b = (colorHex & 255) / 255;

        for (let i = 0; i < trailPoints.length; i++) {
          const point = trailPoints[i];

          // Calculate width taper: thick at newest (i=length-1), thin at oldest (i=0)
          const age = i / (trailPoints.length - 1); // 0 = oldest, 1 = newest
          const width = maxWidth * age; // Taper from 0 to maxWidth

          // Calculate opacity fade
          const opacity = Math.pow(age, 1.5); // Fade from transparent to bright

          // Get perpendicular direction for ribbon width
          let perpX = 0, perpY = 1;
          if (i < trailPoints.length - 1) {
            const next = trailPoints[i + 1];
            const dx = next.x - point.x;
            const dy = next.y - point.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
              perpX = -dy / len;
              perpY = dx / len;
            }
          } else if (i > 0) {
            const prev = trailPoints[i - 1];
            const dx = point.x - prev.x;
            const dy = point.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
              perpX = -dy / len;
              perpY = dx / len;
            }
          }

          // Create two vertices (top and bottom of ribbon)
          const idx = i * 2;

          // Top vertex
          positions[idx * 3] = point.x + perpX * width;
          positions[idx * 3 + 1] = point.y + perpY * width;
          positions[idx * 3 + 2] = 0;

          colors[idx * 3] = r;
          colors[idx * 3 + 1] = g;
          colors[idx * 3 + 2] = b;

          // Bottom vertex
          positions[(idx + 1) * 3] = point.x - perpX * width;
          positions[(idx + 1) * 3 + 1] = point.y - perpY * width;
          positions[(idx + 1) * 3 + 2] = 0;

          colors[(idx + 1) * 3] = r * opacity;
          colors[(idx + 1) * 3 + 1] = g * opacity;
          colors[(idx + 1) * 3 + 2] = b * opacity;

          // Create triangle indices for ribbon
          if (i < trailPoints.length - 1) {
            const current = i * 2;
            const next = (i + 1) * 2;

            // Two triangles per segment
            indices.push(current, next, current + 1);
            indices.push(next, next + 1, current + 1);
          }
        }

        trailMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        trailMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        trailMesh.geometry.setIndex(indices);
        trailMesh.geometry.computeBoundingSphere();
      }
    });

    // Clean up trails for disconnected players
    this.playerTrailPoints.forEach((_, id) => {
      if (!state.players.has(id)) {
        const mesh = this.playerTrailLines.get(id);
        if (mesh) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          this.playerTrailLines.delete(id);
        }
        this.playerTrailPoints.delete(id);
      }
    });
  }

  private spawnDeathParticles(x: number, y: number, colorHex: number): void {
    const particleCount = 30;
    const duration = 800; // 0.8 seconds

    // Create particle geometry and material
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const particleData: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

    for (let i = 0; i < particleCount; i++) {
      // Random angle for radial burst
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 200; // pixels per second

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0.2; // Above everything else

      sizes[i] = 3 + Math.random() * 4;

      particleData.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0, // Start at full life
      });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      color: colorHex,
      size: 4,
      transparent: true,
      opacity: 1,
      sizeAttenuation: false,
    });

    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);

    // Track this animation
    this.deathAnimations.push({
      particles,
      particleData,
      startTime: Date.now(),
      duration,
    });
  }

  private updateDeathAnimations(dt: number): void {
    const deltaSeconds = dt / 1000;
    const now = Date.now();
    const finishedAnimations: number[] = [];

    this.deathAnimations.forEach((anim, index) => {
      const elapsed = now - anim.startTime;
      const progress = Math.min(elapsed / anim.duration, 1);

      if (progress >= 1) {
        // Animation finished - mark for removal
        finishedAnimations.push(index);
        return;
      }

      // Update particle positions and fade
      const positions = anim.particles.geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < anim.particleData.length; i++) {
        const p = anim.particleData[i];

        // Move particle
        p.x += p.vx * deltaSeconds;
        p.y += p.vy * deltaSeconds;

        // Update geometry position
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;

        // Fade out life
        p.life = 1 - progress;
      }

      anim.particles.geometry.attributes.position.needsUpdate = true;

      // Update material opacity for fade out
      const material = anim.particles.material as THREE.PointsMaterial;
      material.opacity = 1 - progress;
    });

    // Clean up finished animations (reverse order to avoid index shifting)
    for (let i = finishedAnimations.length - 1; i >= 0; i--) {
      const index = finishedAnimations[i];
      const anim = this.deathAnimations[index];

      this.scene.remove(anim.particles);
      anim.particles.geometry.dispose();
      (anim.particles.material as THREE.Material).dispose();

      this.deathAnimations.splice(index, 1);
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    const aspect = width / height;
    const frustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    this.camera.left = (frustumSize * aspect) / -2;
    this.camera.right = (frustumSize * aspect) / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = frustumSize / -2;
    this.camera.updateProjectionMatrix();
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
    this.swarmParticleData.clear(); // Clean up particle animation data

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

    // Dispose composer
    this.composer.dispose();

    // Dispose renderer
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
