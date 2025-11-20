/**
 * Main 2D scene - renders all game entities using Three.js orthographic camera
 */

import * as THREE from 'three';
import type { GameState } from '../../../core/state/GameState';
import type { InterpolatedPosition } from '../../../core/sim/interpolator';
import { getInterpolatedPositions } from '../../../core/sim/interpolator';
import {
  getPlayerMaterial,
  getNutrientMaterial,
  getObstacleMaterial,
  getObstacleCoreMaterial,
  getGridMaterial,
} from '../materials/materials';
import { GAME_CONFIG } from '../../../core/config/gameConfig';
import { getAllPlayers, getAllNutrients, getAllObstacles } from '../../../core/state/selectors';

/**
 * Scene2D handles all 2D entity rendering
 */
export class Scene2D {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;

  // Entity meshes
  private playerMeshes = new Map<string, THREE.Mesh>();
  private nutrientMeshes = new Map<string, THREE.Mesh>();
  private obstacleMeshes = new Map<string, THREE.Group>();

  // Background grid
  private gridLines: THREE.LineSegments | null = null;

  // Stage size multipliers (cached to avoid recreation)
  private static readonly STAGE_SIZES = {
    single_cell: 1,
    multi_cell: 4,
    cyber_organism: 6,
    humanoid: 8,
    godcell: 12,
  };

  constructor(container: HTMLElement) {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(GAME_CONFIG.BACKGROUND_COLOR);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Create background grid
    this.createGrid();
  }

  /**
   * Create background grid
   */
  private createGrid(): void {
    const gridSize = 200; // Grid cell size
    const gridCount = 50; // Number of grid lines in each direction

    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];

    // Vertical lines
    for (let i = -gridCount; i <= gridCount; i++) {
      const x = i * gridSize;
      positions.push(x, -gridCount * gridSize, 0);
      positions.push(x, gridCount * gridSize, 0);
    }

    // Horizontal lines
    for (let i = -gridCount; i <= gridCount; i++) {
      const y = i * gridSize;
      positions.push(-gridCount * gridSize, y, 0);
      positions.push(gridCount * gridSize, y, 0);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    this.gridLines = new THREE.LineSegments(geometry, getGridMaterial());
    this.scene.add(this.gridLines);
  }

  /**
   * Update scene with current game state
   */
  update(state: GameState, renderTime: number): void {
    // Get interpolated positions for all entities
    const playerPositions = getInterpolatedPositions(state, 'player', renderTime);
    const nutrientPositions = getInterpolatedPositions(state, 'nutrient', renderTime);

    // Update players
    this.updatePlayers(state, playerPositions);

    // Update nutrients
    this.updateNutrients(state, nutrientPositions);

    // Update obstacles (static, no interpolation needed)
    this.updateObstacles(state);
  }

  /**
   * Update player meshes
   */
  private updatePlayers(state: GameState, positions: Map<string, InterpolatedPosition>): void {
    const players = getAllPlayers(state);

    // Update existing players and create new ones
    players.forEach((player) => {
      let mesh = this.playerMeshes.get(player.id);

      if (!mesh) {
        // Create new player mesh
        const geometry = new THREE.CircleGeometry(GAME_CONFIG.PLAYER_SIZE, 32);
        const material = getPlayerMaterial(player.color);
        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.playerMeshes.set(player.id, mesh);
      }

      // Update position (interpolated if available)
      const interpolated = positions.get(player.id);
      if (interpolated) {
        mesh.position.x = interpolated.position.x;
        mesh.position.y = interpolated.position.y;
      } else {
        mesh.position.x = player.position.x;
        mesh.position.y = player.position.y;
      }

      // Update size based on evolution stage
      const sizeMultiplier = Scene2D.STAGE_SIZES[player.stage] || 1;
      mesh.scale.setScalar(sizeMultiplier);
    });

    // Remove players that no longer exist
    const playerIds = new Set(players.map((p) => p.id));
    this.playerMeshes.forEach((mesh, id) => {
      if (!playerIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.playerMeshes.delete(id);
      }
    });
  }

  /**
   * Update nutrient meshes
   */
  private updateNutrients(state: GameState, positions: Map<string, InterpolatedPosition>): void {
    const nutrients = getAllNutrients(state);

    // Update existing nutrients and create new ones
    nutrients.forEach((nutrient) => {
      let mesh = this.nutrientMeshes.get(nutrient.id);

      if (!mesh) {
        // Create new nutrient mesh (hexagon)
        const geometry = new THREE.CircleGeometry(GAME_CONFIG.NUTRIENT_SIZE, 6);
        const material = getNutrientMaterial(this.getNutrientColor(nutrient.valueMultiplier));
        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.nutrientMeshes.set(nutrient.id, mesh);
      }

      // Update position (interpolated if available)
      const interpolated = positions.get(nutrient.id);
      if (interpolated) {
        mesh.position.x = interpolated.position.x;
        mesh.position.y = interpolated.position.y;
      } else {
        mesh.position.x = nutrient.position.x;
        mesh.position.y = nutrient.position.y;
      }
    });

    // Remove nutrients that no longer exist
    const nutrientIds = new Set(nutrients.map((n) => n.id));
    this.nutrientMeshes.forEach((mesh, id) => {
      if (!nutrientIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.nutrientMeshes.delete(id);
      }
    });
  }

  /**
   * Update obstacle meshes
   */
  private updateObstacles(state: GameState): void {
    const obstacles = getAllObstacles(state);

    // Update existing obstacles and create new ones
    obstacles.forEach((obstacle) => {
      let group = this.obstacleMeshes.get(obstacle.id);

      if (!group) {
        // Create obstacle group (outer circle + inner core)
        group = new THREE.Group();

        // Outer gravity well
        const outerGeometry = new THREE.CircleGeometry(obstacle.radius, 64);
        const outerMesh = new THREE.Mesh(outerGeometry, getObstacleMaterial());
        group.add(outerMesh);

        // Inner singularity core
        const coreRadius = GAME_CONFIG.OBSTACLE_CORE_RADIUS;
        const coreGeometry = new THREE.CircleGeometry(coreRadius, 32);
        const coreMesh = new THREE.Mesh(coreGeometry, getObstacleCoreMaterial());
        group.add(coreMesh);

        group.position.x = obstacle.position.x;
        group.position.y = obstacle.position.y;

        this.scene.add(group);
        this.obstacleMeshes.set(obstacle.id, group);
      }
    });

    // Remove obstacles that no longer exist
    const obstacleIds = new Set(obstacles.map((o) => o.id));
    this.obstacleMeshes.forEach((group, id) => {
      if (!obstacleIds.has(id)) {
        this.scene.remove(group);
        group.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
          }
        });
        this.obstacleMeshes.delete(id);
      }
    });
  }

  /**
   * Get nutrient color based on value multiplier
   */
  private getNutrientColor(multiplier: number): number {
    if (multiplier >= 5) return GAME_CONFIG.NUTRIENT_5X_COLOR;
    if (multiplier >= 3) return GAME_CONFIG.NUTRIENT_3X_COLOR;
    if (multiplier >= 2) return GAME_CONFIG.NUTRIENT_2X_COLOR;
    return GAME_CONFIG.NUTRIENT_COLOR;
  }

  /**
   * Render the scene with camera
   */
  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  /**
   * Resize renderer
   */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Dispose all meshes
    this.playerMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });
    this.playerMeshes.clear();

    this.nutrientMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });
    this.nutrientMeshes.clear();

    this.obstacleMeshes.forEach((group) => {
      this.scene.remove(group);
      group.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
    });
    this.obstacleMeshes.clear();

    // Dispose grid
    if (this.gridLines) {
      this.scene.remove(this.gridLines);
      this.gridLines.geometry.dispose();
    }

    // Dispose renderer
    this.renderer.dispose();
  }
}
