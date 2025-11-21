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
  private playerMeshes: Map<string, THREE.Mesh> = new Map();
  private playerOutlines: Map<string, THREE.Mesh> = new Map(); // White stroke for client player
  private obstacleMeshes: Map<string, THREE.Group> = new Map();
  private swarmMeshes: Map<string, THREE.Group> = new Map(); // Changed to Group to include particles

  // Trails (using efficient BufferGeometry)
  private playerTrailPoints: Map<string, Array<{ x: number; y: number }>> = new Map();
  private playerTrailLines: Map<string, THREE.Line> = new Map();

  // Interpolation targets
  private swarmTargets: Map<string, { x: number; y: number }> = new Map();

  // Background particles (using efficient Points system)
  private dataParticles!: THREE.Points;
  private particleData: Array<{ x: number; y: number; vx: number; vy: number; size: number }> = [];

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
    // No event listeners needed for now
    // Camera shake is triggered by health changes in render loop
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

    // Sync all entities
    this.syncPlayers(state);
    this.syncNutrients(state);
    this.syncObstacles(state);
    this.syncSwarms(state);

    // Interpolate swarm positions
    this.interpolateSwarms();

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
        const sizes = new Float32Array(particleCount);

        // Scatter particles around swarm
        for (let i = 0; i < particleCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * swarm.size * 1.2;
          positions[i * 3] = Math.cos(angle) * radius;
          positions[i * 3 + 1] = Math.sin(angle) * radius;
          positions[i * 3 + 2] = 0;
          sizes[i] = Math.random() * 2 + 1;
        }

        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const particleMaterial = new THREE.PointsMaterial({
          color: 0xff0088,
          size: 2,
          transparent: true,
          opacity: 0.8,
          sizeAttenuation: false,
        });

        const particles = new THREE.Points(particleGeometry, particleMaterial);
        group.add(particles);

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
      if (swarm.state === 'chase') {
        material.color.setHex(0xff0044);
        material.opacity = 0.8;
      } else {
        material.color.setHex(0xff0088);
        material.opacity = 0.6;
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
    this.playerMeshes.forEach((mesh, id) => {
      if (!state.players.has(id)) {
        this.scene.remove(mesh);
        // Don't dispose cached geometry
        // Material is disposed in materialCache during dispose()
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
      let mesh = this.playerMeshes.get(id);
      const isMyPlayer = id === state.myPlayerId;

      if (!mesh) {
        // Create player mesh with cached geometry and emissive material
        const geometry = this.getGeometry('circle-player', () =>
          new THREE.CircleGeometry(GAME_CONFIG.PLAYER_SIZE, 32)
        );

        // Parse hex color (#RRGGBB → 0xRRGGBB)
        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const material = this.getMaterial(`player-${player.color}`, () =>
          new THREE.MeshStandardMaterial({
            color: colorHex,
            emissive: colorHex,
            emissiveIntensity: 0.8, // Strong glow for players (visible with bloom)
          })
        );

        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.playerMeshes.set(id, mesh);

        // Add white stroke outline for client player
        if (isMyPlayer) {
          const outlineGeometry = this.getGeometry('ring-outline', () =>
            new THREE.RingGeometry(GAME_CONFIG.PLAYER_SIZE, GAME_CONFIG.PLAYER_SIZE + 3, 32)
          );
          const outlineMaterial = this.getMaterial('outline-white', () =>
            new THREE.MeshBasicMaterial({
              color: 0xffffff,
              transparent: true,
              opacity: 0.8,
            })
          );
          const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
          outline.position.z = 0.1; // Slightly above player
          this.scene.add(outline);
          this.playerOutlines.set(id, outline);
        }
      }

      // Update position with client-side interpolation
      const target = state.playerTargets.get(id);
      if (target) {
        // Lerp toward server position
        const lerpFactor = 0.3;
        mesh.position.x += (target.x - mesh.position.x) * lerpFactor;
        mesh.position.y += (target.y - mesh.position.y) * lerpFactor;

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.x = mesh.position.x;
          outline.position.y = mesh.position.y;
        }
      } else {
        // Fallback to direct position if no target
        mesh.position.set(player.position.x, player.position.y, 0);

        // Update outline position if it exists
        const outline = this.playerOutlines.get(id);
        if (outline) {
          outline.position.set(player.position.x, player.position.y, 0.1);
        }
      }
    });
  }

  private updateTrails(state: GameState): void {
    const maxTrailLength = 60;

    state.players.forEach((player, id) => {
      // Get or create trail points array
      let trailPoints = this.playerTrailPoints.get(id);
      if (!trailPoints) {
        trailPoints = [];
        this.playerTrailPoints.set(id, trailPoints);
      }

      // Add current MESH position to trail (not server position!)
      const mesh = this.playerMeshes.get(id);
      if (mesh) {
        trailPoints.push({ x: mesh.position.x, y: mesh.position.y });
      }

      // Keep only last N points
      if (trailPoints.length > maxTrailLength) {
        trailPoints.shift();
      }

      // Get or create trail line
      let trailLine = this.playerTrailLines.get(id);
      if (!trailLine) {
        const geometry = new THREE.BufferGeometry();
        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const material = new THREE.LineBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.6,
          linewidth: 3, // Note: linewidth only works in some browsers/WebGL implementations
        });
        trailLine = new THREE.Line(geometry, material);
        trailLine.position.z = -0.5;
        this.scene.add(trailLine);
        this.playerTrailLines.set(id, trailLine);
      }

      // Update trail line geometry with current points
      if (trailPoints.length > 1) {
        const positions = new Float32Array(trailPoints.length * 3);
        for (let i = 0; i < trailPoints.length; i++) {
          positions[i * 3] = trailPoints[i].x;
          positions[i * 3 + 1] = trailPoints[i].y;
          positions[i * 3 + 2] = 0;
        }
        trailLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        trailLine.geometry.computeBoundingSphere();
      }
    });

    // Clean up trails for disconnected players
    this.playerTrailPoints.forEach((_, id) => {
      if (!state.players.has(id)) {
        const line = this.playerTrailLines.get(id);
        if (line) {
          this.scene.remove(line);
          line.geometry.dispose();
          (line.material as THREE.Material).dispose();
          this.playerTrailLines.delete(id);
        }
        this.playerTrailPoints.delete(id);
      }
    });
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

    this.swarmMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.swarmMeshes.clear();

    // Clean up particle system
    if (this.dataParticles) {
      this.dataParticles.geometry.dispose();
      (this.dataParticles.material as THREE.Material).dispose();
      const material = this.dataParticles.material as THREE.PointsMaterial;
      if (material.map) {
        material.map.dispose();
      }
    }

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
