// ============================================
// TreeRenderSystem - Manages digital jungle tree rendering
// Only renders for Stage 3+ players (jungle scale)
// Queries ECS World directly for tree entities
// ============================================

import * as THREE from 'three';
import {
  createDataTree,
  updateDataTreeAnimation,
  disposeDataTree,
} from '../meshes/DataTreeMesh';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type TreeComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

/**
 * TreeRenderSystem - Manages digital jungle tree rendering
 *
 * Stage-filtered visibility:
 * - Soup mode (Stage 1-2): Trees are NOT rendered (invisible to soup-scale players)
 * - Jungle mode (Stage 3+): Trees ARE rendered (visible obstacles)
 *
 * Owns:
 * - Tree meshes (trunk + canopy geometry)
 * - Animation state (glow pulse, sway)
 */
export class TreeRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Tree meshes
  private treeMeshes: Map<string, THREE.Group> = new Map();

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
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Skip entirely in soup mode - trees are invisible to soup-scale players
    if (renderMode === 'soup') {
      // If switching from jungle to soup, clear all trees
      if (this.treeMeshes.size > 0) {
        this.clearAll();
      }
      return;
    }

    // Track which trees exist in ECS
    const currentTreeIds = new Set<string>();
    let treeCount = 0;

    // Query ECS World for all trees
    this.world.forEachWithTag(Tags.Tree, (entity) => {
      treeCount++;
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
        // Three.js coords: X = game X, Y = height (up), Z = -game Y
        // Trees sit at ground level (Y=0)
        group.position.set(pos.x, 0, -pos.y);

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

    // Debug: log tree sync status (every 60 frames via caller)
    if (treeCount > 0 && this.treeMeshes.size === 0) {
      console.log('[TreeRenderSystem] ECS has', treeCount, 'trees but no meshes created');
    } else if (this.treeMeshes.size > 0 && this._lastLoggedCount !== this.treeMeshes.size) {
      console.log('[TreeRenderSystem] Synced', this.treeMeshes.size, 'tree meshes');
      this._lastLoggedCount = this.treeMeshes.size;
    }
  }

  private _lastLoggedCount = 0;

  /**
   * Update tree animations (glow pulse, subtle sway)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.treeMeshes.forEach((group) => {
      updateDataTreeAnimation(group, dt);
    });
  }

  /**
   * Clear all tree meshes
   * Called when transitioning from jungle to soup mode
   */
  clearAll(): void {
    this.treeMeshes.forEach((group) => {
      disposeDataTree(group);
      this.scene.remove(group);
    });
    this.treeMeshes.clear();
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
