// ============================================
// EntropySerpentRenderSystem - Manages entropy serpent rendering
// Renders aggressive apex predator serpents in the jungle
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  GAME_CONFIG,
  type PositionComponent,
  type EntropySerpentComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';
import { frameLerp } from '../../utils/math';
import {
  createEntropySerpent,
  updateEntropySerpentAnimation,
  updateEntropySerpentState,
  disposeEntropySerpent,
  triggerClawSwipe,
} from '../meshes/EntropySerpentMesh';

/**
 * EntropySerpentRenderSystem - Manages entropy serpent rendering
 *
 * Owns:
 * - Serpent meshes (swarm-style body with clawed arms)
 * - State-based visual updates (patrol, chase, attack)
 * - Smooth interpolation and rotation toward targets
 */
export class EntropySerpentRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Serpent meshes
  private serpentMeshes: Map<string, THREE.Group> = new Map();

  // Interpolation targets for smooth movement
  private serpentTargets: Map<string, { x: number; y: number }> = new Map();

  // Current heading for smooth rotation
  private serpentHeadings: Map<string, number> = new Map();

  // Debug visualization
  private debugMode = false;
  private debugMarkers: Map<string, THREE.Group> = new Map();
  private _lastDebugLog = 0;
  private _lastPosLogs: Map<string, number> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync serpents by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode
    if (renderMode !== 'jungle') return;

    // Track which serpents exist in ECS
    const currentSerpentIds = new Set<string>();

    // Query ECS World for all entropy serpents
    this.world.forEachWithTag(Tags.EntropySerpent, (entity) => {
      const serpentId = getStringIdByEntity(entity);
      if (!serpentId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const serpent = this.world.getComponent<EntropySerpentComponent>(
        entity,
        Components.EntropySerpent
      );
      const interp = this.world.getComponent<InterpolationTargetComponent>(
        entity,
        Components.InterpolationTarget
      );
      if (!pos || !serpent) return;

      currentSerpentIds.add(serpentId);

      let group = this.serpentMeshes.get(serpentId);

      if (!group) {
        // Create serpent visual
        const radius = serpent.size || GAME_CONFIG.ENTROPY_SERPENT_BODY_SPHERE_SIZE;
        group = createEntropySerpent(radius);
        group.position.set(pos.x, 40, -pos.y); // Y=40 for proper ground level
        // Flip the mesh over (180° around Y axis)
        group.rotation.y = Math.PI;
        this.scene.add(group);
        this.serpentMeshes.set(serpentId, group);
        this.serpentTargets.set(serpentId, { x: pos.x, y: pos.y });
        this.serpentHeadings.set(serpentId, serpent.heading || 0);
      }

      // Update target position
      const targetX = interp ? interp.targetX : pos.x;
      const targetY = interp ? interp.targetY : pos.y;
      this.serpentTargets.set(serpentId, { x: targetX, y: targetY });

      // Update heading
      this.serpentHeadings.set(serpentId, serpent.heading || 0);

      // Update state-based visuals only when state changes (avoid expensive traverse every frame)
      if (group.userData.state !== serpent.state) {
        updateEntropySerpentState(group, serpent.state);
      }
    });

    // Remove serpents that no longer exist in ECS
    this.serpentMeshes.forEach((group, id) => {
      if (!currentSerpentIds.has(id)) {
        this.scene.remove(group);
        disposeEntropySerpent(group);
        this.serpentMeshes.delete(id);
        this.serpentTargets.delete(id);
        this.serpentHeadings.delete(id);
        this._lastPosLogs.delete(id);
        // Clean up debug markers
        const debugGroup = this.debugMarkers.get(id);
        if (debugGroup) {
          this.scene.remove(debugGroup);
          this.debugMarkers.delete(id);
        }
      }
    });

    // Update debug markers if debug mode is enabled
    if (this.debugMode) {
      this.updateDebugMarkers();
    }
  }

  /**
   * Interpolate serpent positions for smooth movement
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  interpolate(dt: number = 16.67): void {
    // Serpents move fast - use moderate lerp factor
    const lerpFactor = frameLerp(0.2, dt);
    const rotLerpFactor = frameLerp(0.15, dt);

    this.serpentMeshes.forEach((group, id) => {
      const target = this.serpentTargets.get(id);
      const targetHeading = this.serpentHeadings.get(id) ?? 0;

      if (target) {
        // Smooth position interpolation
        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;

        // Smooth rotation toward heading
        // Server heading = atan2(dy, dx) in 2D
        // Mesh uses XZY rotation order with -90° X tilt, so rotation.z controls heading
        // Try: use heading directly without PI offset
        const targetRotation = targetHeading;
        const rotDiff = targetRotation - group.rotation.z;
        // Normalize rotation difference to [-PI, PI]
        const normalizedDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff));
        group.rotation.z += normalizedDiff * rotLerpFactor;
      }
    });
  }

  /**
   * Update serpent animations (slithering, breathing, arm sway, particle storm)
   * @param dt - Delta time in seconds
   */
  updateAnimations(dt: number): void {
    this.serpentMeshes.forEach((group, id) => {
      const target = this.serpentTargets.get(id);
      // Determine if moving based on distance to target
      let isMoving = false;
      if (target) {
        const dx = target.x - group.position.x;
        const dz = -target.y - group.position.z;
        isMoving = Math.sqrt(dx * dx + dz * dz) > 5;
      }
      updateEntropySerpentAnimation(group, dt, isMoving);
    });
  }

  /**
   * Clear all serpent meshes
   */
  clearAll(): void {
    this.serpentMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeEntropySerpent(group);
    });
    this.serpentMeshes.clear();
    this.serpentTargets.clear();
    this.serpentHeadings.clear();
    this._lastPosLogs.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.serpentMeshes.size;
  }

  /**
   * Trigger claw swipe animation when serpent attacks
   * Visual slash effect is handled by EffectsSystem.spawnClawSlash
   */
  triggerAttack(serpentId: string): void {
    const group = this.serpentMeshes.get(serpentId);
    if (!group) return;

    // Trigger arm animation only - slash effect handled by EffectsSystem
    triggerClawSwipe(group);
  }

  /**
   * Flash serpent mesh to indicate damage taken
   * Uses emissive flash on materials
   */
  flashDamage(serpentId: string): void {
    const group = this.serpentMeshes.get(serpentId);
    if (!group) return;

    // Flash all mesh materials to white briefly
    const flashColor = new THREE.Color(0xffffff);
    const originalColors = new Map<THREE.Mesh, THREE.Color>();

    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        originalColors.set(child, child.material.emissive.clone());
        child.material.emissive.copy(flashColor);
        child.material.emissiveIntensity = 2;
      }
    });

    // Restore original colors after flash duration
    setTimeout(() => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          const original = originalColors.get(child);
          if (original) {
            child.material.emissive.copy(original);
            child.material.emissiveIntensity = 1;
          }
        }
      });
    }, 100);
  }

  /**
   * Toggle debug visualization mode
   * Shows: body center (blue), head position (red), attack arc (yellow)
   */
  toggleDebug(): boolean {
    this.debugMode = !this.debugMode;

    if (!this.debugMode) {
      // Remove all debug markers and clear debug state
      this.debugMarkers.forEach((group) => {
        this.scene.remove(group);
        group.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              (child.material as THREE.Material).dispose();
            }
          }
        });
      });
      this.debugMarkers.clear();
      this._lastPosLogs.clear();
      this._lastDebugLog = 0;
    }

    return this.debugMode;
  }

  /**
   * Update debug markers to show head position, body center, and attack arc
   */
  private updateDebugMarkers(): void {
    // ACTUAL head offset from mesh geometry:
    // 12 segments, spacing = radius * 1.6, centered, so head is at:
    // (BODY_SEGMENTS / 2) * radius * 1.6 = 6 * 80 * 1.6 = 768
    const headOffset = GAME_CONFIG.ENTROPY_SERPENT_HEAD_OFFSET; // 768 (6 * 80 * 1.6)
    const attackRange = GAME_CONFIG.ENTROPY_SERPENT_ATTACK_RANGE;

    // Debug: log once per second
    if (Math.floor(Date.now() / 1000) !== this._lastDebugLog) {
      this._lastDebugLog = Math.floor(Date.now() / 1000);
      console.log(
        `[SerpentDebug] updateDebugMarkers called, serpents: ${this.serpentMeshes.size}, markers: ${this.debugMarkers.size}`
      );
    }

    this.serpentMeshes.forEach((group, id) => {
      const target = this.serpentTargets.get(id);
      const heading = this.serpentHeadings.get(id) ?? 0;
      if (!target) return;

      let debugGroup = this.debugMarkers.get(id);
      if (!debugGroup) {
        debugGroup = this.createDebugMarkers();
        this.scene.add(debugGroup);
        this.debugMarkers.set(id, debugGroup);
        console.log(`[SerpentDebug] Created markers for ${id}`);
      }

      // Body center position (where the server tracks the entity)
      const bodyX = target.x;
      const bodyY = target.y;
      const bodyZ3D = 50; // Slightly above ground for visibility

      // Head position (server calculation: body + heading * SIZE)
      const headX = bodyX + Math.cos(heading) * headOffset;
      const headY = bodyY + Math.sin(heading) * headOffset;

      // Log positions once per second per serpent
      const lastPosLog = this._lastPosLogs.get(id) ?? 0;
      if (Math.floor(Date.now() / 2000) !== lastPosLog) {
        this._lastPosLogs.set(id, Math.floor(Date.now() / 2000));
        console.log(
          `[SerpentDebug] ${id}: body=(${bodyX.toFixed(0)}, ${bodyY.toFixed(0)}), head=(${headX.toFixed(0)}, ${headY.toFixed(0)}), heading=${((heading * 180) / Math.PI).toFixed(1)}°, offset=${headOffset}`
        );
        console.log(
          `[SerpentDebug] ${id}: mesh.rotation.z=${((group.rotation.z * 180) / Math.PI).toFixed(1)}°, expected=${(((heading + Math.PI) * 180) / Math.PI).toFixed(1)}°`
        );
      }

      // Update body center marker (blue sphere)
      const bodyMarker = debugGroup.getObjectByName('bodyCenter') as THREE.Mesh;
      if (bodyMarker) {
        bodyMarker.position.set(bodyX, bodyZ3D, -bodyY);
      }

      // Update head position marker (red sphere)
      const headMarker = debugGroup.getObjectByName('headPos') as THREE.Mesh;
      if (headMarker) {
        headMarker.position.set(headX, bodyZ3D, -headY);
      }

      // Update attack arc (yellow arc showing 120° cone from head)
      // Draw as: head -> arc edge -> head (closed cone shape)
      const arcMarker = debugGroup.getObjectByName('attackArc') as THREE.Line;
      if (arcMarker) {
        const positions = arcMarker.geometry.attributes.position.array as Float32Array;
        const arcSegments = 12;
        const halfArc = Math.PI / 3; // 60° each side = 120° total

        // Point 0: Start at head
        positions[0] = headX;
        positions[1] = bodyZ3D;
        positions[2] = -headY;

        // Points 1-13: Arc edge
        for (let i = 0; i <= arcSegments; i++) {
          const t = i / arcSegments;
          const angle = heading + (t - 0.5) * 2 * halfArc;
          const px = headX + Math.cos(angle) * attackRange;
          const py = headY + Math.sin(angle) * attackRange;

          const idx = (i + 1) * 3;
          positions[idx] = px;
          positions[idx + 1] = bodyZ3D;
          positions[idx + 2] = -py;
        }

        // Point 14: Close back to head
        const lastIdx = (arcSegments + 2) * 3;
        positions[lastIdx] = headX;
        positions[lastIdx + 1] = bodyZ3D;
        positions[lastIdx + 2] = -headY;

        arcMarker.geometry.attributes.position.needsUpdate = true;
      }

      // Update direction line (green line from body to head)
      const dirLine = debugGroup.getObjectByName('directionLine') as THREE.Line;
      if (dirLine) {
        const positions = dirLine.geometry.attributes.position.array as Float32Array;
        positions[0] = bodyX;
        positions[1] = bodyZ3D;
        positions[2] = -bodyY;
        positions[3] = headX;
        positions[4] = bodyZ3D;
        positions[5] = -headY;
        dirLine.geometry.attributes.position.needsUpdate = true;
      }
    });
  }

  /**
   * Create debug marker group with sphere markers and arc line
   */
  private createDebugMarkers(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'serpentDebugMarkers';

    // Body center - blue sphere
    const bodyGeo = new THREE.SphereGeometry(15, 8, 8);
    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0x0066ff,
      transparent: true,
      opacity: 0.7,
    });
    const bodyMarker = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMarker.name = 'bodyCenter';
    group.add(bodyMarker);

    // Head position - red sphere
    const headGeo = new THREE.SphereGeometry(20, 8, 8);
    const headMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.7,
    });
    const headMarker = new THREE.Mesh(headGeo, headMat);
    headMarker.name = 'headPos';
    group.add(headMarker);

    // Attack arc - yellow line showing 120° cone (head -> arc -> head)
    const arcSegments = 12;
    const arcPositions = new Float32Array((arcSegments + 3) * 3); // head + 13 arc points + head
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    const arcLine = new THREE.Line(arcGeo, arcMat);
    arcLine.name = 'attackArc';
    group.add(arcLine);

    // Direction line - green line from body to head
    const dirPositions = new Float32Array(6); // 2 points
    const dirGeo = new THREE.BufferGeometry();
    dirGeo.setAttribute('position', new THREE.BufferAttribute(dirPositions, 3));
    const dirMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    const dirLine = new THREE.Line(dirGeo, dirMat);
    dirLine.name = 'directionLine';
    group.add(dirLine);

    return group;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
    // Clean up debug markers
    this.debugMarkers.forEach((group) => {
      this.scene.remove(group);
    });
    this.debugMarkers.clear();
    this._lastPosLogs.clear();
  }
}
