// ============================================
// TreeRenderSystem - Manages digital jungle tree rendering
// Only renders for Stage 3+ players (jungle scale)
// Queries ECS World directly for tree entities
// ============================================

import * as THREE from 'three';
import { createDataTree, updateDataTreeAnimation, disposeDataTree } from '../meshes/DataTreeMesh';
import { createRootNetworkFromTrees, updateRootNetworkAnimation } from '../three/JungleBackground';
import {
  createSphereRootNetwork,
  updateSphereRootAnimation,
} from '../three/SphereJungleBackground';
import { setMeshPosition, orientToSurface } from '../utils/SphereRenderUtils';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  isSphereMode,
  GAME_CONFIG,
  type PositionComponent,
  type TreeComponent,
} from '../../ecs';

/**
 * TreeRenderSystem - Manages digital jungle tree rendering
 *
 * Stage-filtered visibility:
 * - Soup mode (Stage 1-2): Trees are NOT rendered (invisible to soup-scale players)
 * - Jungle mode (Stage 3+): Trees ARE rendered (visible obstacles)
 *
 * Owns:
 * - Tree meshes (trunk + canopy geometry)
 * - Root network (energy lines connecting trees to ground)
 * - Animation state (glow pulse, sway)
 */
export class TreeRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Tree meshes
  private treeMeshes: Map<string, THREE.Group> = new Map();

  // Root network (glowing lines emanating from tree bases)
  private rootNetwork: THREE.Group | null = null;
  private rootNetworkTreeCount = 0; // Track when to rebuild

  /**
   * Initialize tree system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync trees by querying ECS World directly
   * Creates new meshes for new trees, removes meshes for despawned trees
   * Trees don't move, so only create once
   */
  sync(): void {

    // Track which trees exist in ECS
    const currentTreeIds = new Set<string>();

    // Query ECS World for all trees
    this.world.forEachWithTag(Tags.Tree, (entity) => {
      const treeId = getStringIdByEntity(entity);
      if (!treeId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const tree = this.world.getComponent<TreeComponent>(entity, Components.Tree);
      if (!pos || !tree) return;

      currentTreeIds.add(treeId);

      // Add trees (they don't move, so only create once)
      if (!this.treeMeshes.has(treeId)) {
        const group = createDataTree(tree.radius, tree.height, tree.variant);

        // Position tree in world space
        // setMeshPosition handles both flat and sphere modes
        setMeshPosition(group, pos);
        // orientToSurface makes tree point outward from sphere center
        orientToSurface(group, pos);

        this.scene.add(group);
        this.treeMeshes.set(treeId, group);
      }
    });

    // Remove trees that no longer exist in ECS
    this.treeMeshes.forEach((group, id) => {
      if (!currentTreeIds.has(id)) {
        disposeDataTree(group);
        this.scene.remove(group);
        this.treeMeshes.delete(id);
      }
    });

    // Create/update root network when tree count changes
    if (this.treeMeshes.size > 0 && this.treeMeshes.size !== this.rootNetworkTreeCount) {
      this.rebuildRootNetwork();
    }
  }

  /**
   * Debug: log tree bounds for camera comparison
   */
  debugLogBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    if (this.treeMeshes.size === 0) return null;

    let minX = Infinity,
      maxX = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;

    this.treeMeshes.forEach((group) => {
      minX = Math.min(minX, group.position.x);
      maxX = Math.max(maxX, group.position.x);
      minZ = Math.min(minZ, group.position.z);
      maxZ = Math.max(maxZ, group.position.z);
    });

    return { minX, maxX, minZ, maxZ };
  }

  /**
   * Update tree animations (glow pulse, subtle sway) and root network pulse
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    // Update tree animations
    this.treeMeshes.forEach((group) => {
      updateDataTreeAnimation(group, dt);
    });

    // Update root network pulse animation
    if (this.rootNetwork) {
      if (isSphereMode()) {
        // Sphere roots use great circle arcs with pulsing emissive
        updateSphereRootAnimation(this.rootNetwork, dt / 1000);
      } else {
        // Flat roots use 2D ground-level lines
        updateRootNetworkAnimation(this.rootNetwork, dt / 1000);
      }
    }
  }

  /**
   * Rebuild root network from current tree positions
   * Called when tree count changes
   * Sphere mode: great circle arcs connecting nearby trees on sphere surface
   * Flat mode: ground-level lines in 2D
   */
  private rebuildRootNetwork(): void {
    // Remove existing root network
    if (this.rootNetwork) {
      this.rootNetwork.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
      this.scene.remove(this.rootNetwork);
      this.rootNetwork = null;
    }

    if (isSphereMode()) {
      // Sphere mode: collect 3D positions for great circle arcs
      const treePositions3D: Array<{ x: number; y: number; z: number }> = [];
      this.treeMeshes.forEach((group) => {
        // Positions are already in Three.js world space on sphere surface
        treePositions3D.push({
          x: group.position.x,
          y: group.position.y,
          z: group.position.z,
        });
      });

      // Create sphere root network with great circle arcs
      this.rootNetwork = createSphereRootNetwork(
        treePositions3D,
        GAME_CONFIG.JUNGLE_SPHERE_RADIUS
      );
    } else {
      // Flat mode: collect 2D positions for ground-level lines
      const treePositions: Array<{ x: number; y: number }> = [];
      this.treeMeshes.forEach((group) => {
        // Convert back from Three.js coords to game coords
        // Three.js: X = game X, Z = -game Y
        treePositions.push({
          x: group.position.x,
          y: -group.position.z, // Convert back to game Y
        });
      });

      // Create flat root network
      this.rootNetwork = createRootNetworkFromTrees(treePositions);
    }

    this.scene.add(this.rootNetwork);
    this.rootNetworkTreeCount = this.treeMeshes.size;
  }

  /**
   * Clear all tree meshes and root network
   * Called when transitioning from jungle to soup mode
   */
  clearAll(): void {
    // Clear tree meshes
    this.treeMeshes.forEach((group) => {
      disposeDataTree(group);
      this.scene.remove(group);
    });
    this.treeMeshes.clear();

    // Clear root network
    if (this.rootNetwork) {
      this.rootNetwork.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
      this.scene.remove(this.rootNetwork);
      this.rootNetwork = null;
      this.rootNetworkTreeCount = 0;
    }
  }

  /**
   * Get count of tree meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.treeMeshes.size;
  }

  /**
   * Dispose all tree resources
   */
  dispose(): void {
    this.clearAll();
  }
}
