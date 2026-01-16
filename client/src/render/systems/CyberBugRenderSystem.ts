// ============================================
// CyberBugRenderSystem - Manages cyber bug rendering
// Renders small glowing bugs that flee from players
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type CyberBugComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';
import { frameLerp } from '../../utils/math';
import {
  createCyberBug,
  updateCyberBugAnimation,
  updateCyberBugState,
  disposeCyberBug,
} from '../meshes/CyberBugMesh';
import type { SnapshotBuffer } from '../../core/net/SnapshotBuffer';

/**
 * CyberBugRenderSystem - Manages cyber bug rendering
 *
 * Owns:
 * - Bug meshes (small glowing insect-like shapes)
 * - State-based visual updates (idle, patrol, flee)
 */
export class CyberBugRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Bug meshes (small glowing shapes)
  private bugMeshes: Map<string, THREE.Group> = new Map();

  // Interpolation targets for smooth movement
  private bugTargets: Map<string, { x: number; y: number }> = new Map();

  // Animation data
  private animationPhase: Map<string, number> = new Map();
  private wingFlutter: Map<string, number> = new Map();

  // Snapshot buffer for jitter-compensated interpolation (set externally)
  private snapshotBuffer: SnapshotBuffer | null = null;

  /**
   * Set the snapshot buffer for jitter-compensated position interpolation.
   */
  setSnapshotBuffer(buffer: SnapshotBuffer): void {
    this.snapshotBuffer = buffer;
  }

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync bugs by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode
    if (renderMode !== 'jungle') return;

    // Track which bugs exist in ECS
    const currentBugIds = new Set<string>();

    // Query ECS World for all cyber bugs
    this.world.forEachWithTag(Tags.CyberBug, (entity) => {
      const bugId = getStringIdByEntity(entity);
      if (!bugId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const bug = this.world.getComponent<CyberBugComponent>(entity, Components.CyberBug);
      const interp = this.world.getComponent<InterpolationTargetComponent>(
        entity,
        Components.InterpolationTarget
      );
      if (!pos || !bug) return;

      currentBugIds.add(bugId);

      let group = this.bugMeshes.get(bugId);

      if (!group) {
        // Create bug visual
        const result = createCyberBug(bug.size, bug.state);
        group = result.group;
        group.position.set(pos.x, 5, -pos.y); // Y=5 for slight elevation
        this.scene.add(group);
        this.bugMeshes.set(bugId, group);
        this.bugTargets.set(bugId, { x: pos.x, y: pos.y });
        this.animationPhase.set(bugId, Math.random() * Math.PI * 2);
        this.wingFlutter.set(bugId, Math.random() * 10);
      }

      // Update target position
      // Priority: snapshot buffer (jitter-compensated) > interp component > raw position
      let targetX = pos.x;
      let targetY = pos.y;

      if (this.snapshotBuffer && this.snapshotBuffer.hasEntity(bugId)) {
        const playbackTime = performance.now() - this.snapshotBuffer.getBufferDelay();
        const bufferedPos = this.snapshotBuffer.getInterpolated(bugId, playbackTime);
        if (bufferedPos) {
          targetX = bufferedPos.x;
          targetY = bufferedPos.y;
        }
      } else if (interp) {
        targetX = interp.targetX;
        targetY = interp.targetY;
      }

      this.bugTargets.set(bugId, { x: targetX, y: targetY });

      // Update state-based visuals (color changes when fleeing)
      updateCyberBugState(group, bug.state);
    });

    // Remove bugs that no longer exist in ECS
    this.bugMeshes.forEach((group, id) => {
      if (!currentBugIds.has(id)) {
        this.scene.remove(group);
        disposeCyberBug(group);
        this.bugMeshes.delete(id);
        this.bugTargets.delete(id);
        this.animationPhase.delete(id);
        this.wingFlutter.delete(id);
      }
    });
  }

  /**
   * Interpolate bug positions for smooth movement
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  interpolate(dt: number = 16.67): void {
    // Bugs use 0.4 (faster than default 0.3) because they're quick
    const lerpFactor = frameLerp(0.4, dt);

    this.bugMeshes.forEach((group, id) => {
      const target = this.bugTargets.get(id);
      if (target) {
        // Calculate movement direction for rotation
        const dx = target.x - group.position.x;
        const dz = -target.y - group.position.z;

        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;

        // Face movement direction
        if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
          group.rotation.y = Math.atan2(dx, dz);
        }
      }
    });
  }

  /**
   * Update bug animations (wing flutter, bobbing)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.bugMeshes.forEach((group, id) => {
      const phase = this.animationPhase.get(id) || 0;
      const flutter = this.wingFlutter.get(id) || 0;
      updateCyberBugAnimation(group, dt, phase, flutter);
    });
  }

  /**
   * Clear all bug meshes
   */
  clearAll(): void {
    this.bugMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeCyberBug(group);
    });
    this.bugMeshes.clear();
    this.bugTargets.clear();
    this.animationPhase.clear();
    this.wingFlutter.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.bugMeshes.size;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
