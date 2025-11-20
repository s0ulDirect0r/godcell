// ============================================
// Three.js Renderer - Proof-of-Concept
// ============================================

import * as THREE from 'three';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG } from '@godcell/shared';

/**
 * Three.js-based renderer (proof-of-concept)
 * Phase 5: Renders nutrients only to validate Three.js integration
 */
export class ThreeRenderer implements Renderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private container!: HTMLElement;

  // Entity meshes
  private nutrientMeshes: Map<string, THREE.Mesh> = new Map();
  private playerMeshes: Map<string, THREE.Mesh> = new Map();
  private obstacleMeshes: Map<string, THREE.Group> = new Map();
  private swarmMeshes: Map<string, THREE.Mesh> = new Map();

  // Trails (store position history and meshes)
  private playerTrailPoints: Map<string, Array<{ x: number; y: number }>> = new Map();
  private playerTrailMeshes: Map<string, THREE.Mesh[]> = new Map();

  // Interpolation targets
  private swarmTargets: Map<string, { x: number; y: number }> = new Map();

  // Background particles
  private dataParticles: Array<{ mesh: THREE.Mesh; velocity: { x: number; y: number } }> = [];

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
      -100, // Near plane (negative for orthographic to see objects behind camera)
      100   // Far plane
    );
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    // Basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(5, 10, 7.5);
    this.scene.add(keyLight);
  }

  render(state: GameState, dt: number): void {
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
    const myPlayer = state.getMyPlayer();
    if (myPlayer) {
      const mesh = this.playerMeshes.get(myPlayer.id);
      if (mesh) {
        // Lerp camera toward mesh position (which is already interpolated)
        const lerpFactor = 0.2;
        this.camera.position.x += (mesh.position.x - this.camera.position.x) * lerpFactor;
        this.camera.position.y += (mesh.position.y - this.camera.position.y) * lerpFactor;
      }
    }

    // Render scene
    this.renderer.render(this.scene, this.camera);
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
    for (let i = 0; i < GAME_CONFIG.MAX_PARTICLES; i++) {
      const x = Math.random() * GAME_CONFIG.WORLD_WIDTH;
      const y = Math.random() * GAME_CONFIG.WORLD_HEIGHT;
      const size = GAME_CONFIG.PARTICLE_MIN_SIZE + Math.random() * (GAME_CONFIG.PARTICLE_MAX_SIZE - GAME_CONFIG.PARTICLE_MIN_SIZE);

      const geometry = new THREE.CircleGeometry(size, 16);
      const material = new THREE.MeshBasicMaterial({
        color: GAME_CONFIG.PARTICLE_COLOR,
        transparent: true,
        opacity: 0.6
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, -0.8);
      this.scene.add(mesh);

      // Calculate velocity (diagonal flow)
      const baseAngle = Math.PI / 4; // 45 degrees
      const variance = (Math.random() - 0.5) * Math.PI / 2;
      const angle = baseAngle + variance;
      const speed = GAME_CONFIG.PARTICLE_SPEED_MIN + Math.random() * (GAME_CONFIG.PARTICLE_SPEED_MAX - GAME_CONFIG.PARTICLE_SPEED_MIN);

      const velocity = {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      };

      this.dataParticles.push({ mesh, velocity });
    }
  }

  private updateDataParticles(dt: number): void {
    const deltaSeconds = dt / 1000;

    for (const particle of this.dataParticles) {
      particle.mesh.position.x += particle.velocity.x * deltaSeconds;
      particle.mesh.position.y += particle.velocity.y * deltaSeconds;

      // Wrap around world bounds
      if (particle.mesh.position.x > GAME_CONFIG.WORLD_WIDTH + 10) particle.mesh.position.x = -10;
      if (particle.mesh.position.y > GAME_CONFIG.WORLD_HEIGHT + 10) particle.mesh.position.y = -10;
      if (particle.mesh.position.x < -10) particle.mesh.position.x = GAME_CONFIG.WORLD_WIDTH + 10;
      if (particle.mesh.position.y < -10) particle.mesh.position.y = GAME_CONFIG.WORLD_HEIGHT + 10;
    }
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
    this.swarmMeshes.forEach((mesh, id) => {
      if (!state.swarms.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.swarmMeshes.delete(id);
        this.swarmTargets.delete(id);
      }
    });

    // Add or update swarms
    state.swarms.forEach((swarm, id) => {
      let mesh = this.swarmMeshes.get(id);

      if (!mesh) {
        // Create swarm mesh (circle with outline)
        const geometry = new THREE.CircleGeometry(swarm.size, 32);
        const material = new THREE.MeshBasicMaterial({
          color: 0xff0088,
          transparent: true,
          opacity: 0.6
        });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(swarm.position.x, swarm.position.y, -0.3);

        this.scene.add(mesh);
        this.swarmMeshes.set(id, mesh);
        this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });
      }

      // Update target position for interpolation
      this.swarmTargets.set(id, { x: swarm.position.x, y: swarm.position.y });

      // Update color based on state
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

    this.swarmMeshes.forEach((mesh, id) => {
      const target = this.swarmTargets.get(id);
      if (target) {
        mesh.position.x += (target.x - mesh.position.x) * lerpFactor;
        mesh.position.y += (target.y - mesh.position.y) * lerpFactor;
      }
    });
  }

  private syncNutrients(state: GameState): void {
    // Remove nutrients that no longer exist
    this.nutrientMeshes.forEach((mesh, id) => {
      if (!state.nutrients.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.nutrientMeshes.delete(id);
      }
    });

    // Add or update nutrients
    state.nutrients.forEach((nutrient, id) => {
      let mesh = this.nutrientMeshes.get(id);

      if (!mesh) {
        // Create new nutrient mesh (hexagon shape)
        const geometry = new THREE.CircleGeometry(GAME_CONFIG.NUTRIENT_SIZE, 6);

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

        const material = new THREE.MeshBasicMaterial({ color });
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
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.playerMeshes.delete(id);
      }
    });

    // Add or update players
    state.players.forEach((player, id) => {
      let mesh = this.playerMeshes.get(id);

      if (!mesh) {
        // Create player mesh (circle)
        const geometry = new THREE.CircleGeometry(GAME_CONFIG.PLAYER_SIZE, 32);

        // Parse hex color (#RRGGBB → 0xRRGGBB)
        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const material = new THREE.MeshBasicMaterial({ color: colorHex });

        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.playerMeshes.set(id, mesh);
      }

      // Update position with client-side interpolation
      const target = state.playerTargets.get(id);
      if (target) {
        // Lerp toward server position
        const lerpFactor = 0.3;
        mesh.position.x += (target.x - mesh.position.x) * lerpFactor;
        mesh.position.y += (target.y - mesh.position.y) * lerpFactor;
      } else {
        // Fallback to direct position if no target
        mesh.position.set(player.position.x, player.position.y, 0);
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

      // Clean up old trail meshes
      let trailMeshes = this.playerTrailMeshes.get(id);
      if (trailMeshes) {
        trailMeshes.forEach(mesh => {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        });
      }
      trailMeshes = [];

      // Render trail as circles (like Phaser)
      const colorHex = parseInt(player.color.replace('#', ''), 16);
      for (let i = 0; i < trailPoints.length; i++) {
        const pos = trailPoints[i];
        const alpha = (i / trailPoints.length) * 0.7;
        const size = 8 + (i / trailPoints.length) * 18;

        const geometry = new THREE.CircleGeometry(size, 16);
        const material = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: alpha,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(pos.x, pos.y, -0.5);
        this.scene.add(mesh);
        trailMeshes.push(mesh);
      }

      this.playerTrailMeshes.set(id, trailMeshes);
    });

    // Clean up trails for disconnected players
    this.playerTrailPoints.forEach((_, id) => {
      if (!state.players.has(id)) {
        const meshes = this.playerTrailMeshes.get(id);
        if (meshes) {
          meshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
          });
          this.playerTrailMeshes.delete(id);
        }
        this.playerTrailPoints.delete(id);
      }
    });
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
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
    // Clean up geometries/materials
    this.nutrientMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });

    this.playerMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });

    this.obstacleMeshes.forEach(group => {
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });

    this.swarmMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });

    this.dataParticles.forEach(particle => {
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
    });

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
