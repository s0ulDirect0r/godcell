// ============================================
// TreeRenderSystem - Manages digital jungle tree rendering
// Only renders for Stage 3+ players (jungle scale)
// Queries ECS World directly for tree entities
// ============================================

import * as THREE from 'three';
import { DataTreeForest, type TreeInstance } from '../meshes/DataTreeForest';
import { createRootNetworkFromTrees } from '../three/JungleBackground';
import {
  World,
  getLocalPlayer,
  Tags,
  Components,
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
 * - The instanced forest (every tree in a handful of draw calls)
 * - Root network (energy lines connecting trees to ground)
 *
 * Trees are static and arrive with the initial snapshot, so the forest is rebuilt
 * only when the set of tree entities changes.
 */
export class TreeRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  private forest: DataTreeForest | null = null;
  private forestKey = ''; // Entity ids the current forest was built from

  // Root network (glowing lines emanating from tree bases)
  private rootNetwork: THREE.Group | null = null;

  /**
   * Initialize tree system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Rebuild the forest if the tree entities changed
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Trees are invisible to soup-scale players
    if (renderMode === 'soup') {
      if (this.forest) this.clearAll();
      return;
    }

    const entities = this.world.getEntitiesWithTag(Tags.Tree);
    const key = entities.join(',');
    if (key === this.forestKey) return;

    const trees: TreeInstance[] = [];
    for (const entity of entities) {
      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const tree = this.world.getComponent<TreeComponent>(entity, Components.Tree);
      if (pos && tree) trees.push({ x: pos.x, y: pos.y, ...tree });
    }

    this.clearAll();
    this.forestKey = key;
    if (trees.length === 0) return;
    this.forest = new DataTreeForest(trees);
    this.scene.add(this.forest.group);
    this.rootNetwork = createRootNetworkFromTrees(trees);
    this.scene.add(this.rootNetwork);
  }

  /**
   * Fade canopies around the local player (glow, pulse and sway run on the GPU)
   */
  updateAnimations(_dt: number): void {
    if (!this.forest) return;
    const player = getLocalPlayer(this.world);
    if (player) DataTreeForest.setViewer(player.position.x, player.position.y);
    else DataTreeForest.clearViewer();
  }

  /**
   * Clear the forest and root network
   * Called when transitioning from jungle to soup mode
   */
  clearAll(): void {
    if (this.forest) {
      this.scene.remove(this.forest.group);
      this.forest.dispose();
      this.forest = null;
    }
    if (this.rootNetwork) {
      this.rootNetwork.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(this.rootNetwork);
      this.rootNetwork = null;
    }
    this.forestKey = '';
  }

  /**
   * Draw calls used by trees and roots (for debug logging)
   */
  getDrawCalls(): number {
    return (this.forest?.drawCalls ?? 0) + (this.rootNetwork ? 1 : 0);
  }

  /**
   * Dispose all tree resources
   */
  dispose(): void {
    this.clearAll();
  }
}
