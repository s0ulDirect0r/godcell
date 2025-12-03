// ============================================
// TrapRenderSystem - Manages trap rendering
// Renders traps as orange-tinted DataFruit variants (disguised mines)
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  GAME_CONFIG,
  type PositionComponent,
  type TrapComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

// Orange color for traps (matches trap specialization theme)
const TRAP_COLOR = 0xff6600; // Bright orange
const TRAP_GLOW_COLOR = 0xff8800; // Lighter orange for glow

/**
 * TrapRenderSystem - Manages trap rendering
 *
 * Owns:
 * - Trap meshes (orange-tinted orbs similar to DataFruit)
 * - Subtle pulsing animation to hint at danger
 */
export class TrapRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Trap meshes (orange orbs, similar to DataFruit but slightly smaller)
  private trapMeshes: Map<string, THREE.Group> = new Map();

  // Animation phase for pulsing
  private animationPhase: Map<string, number> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync traps by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode - traps are Stage 3+ entities
    if (renderMode !== 'jungle') return;

    // Track which traps exist in ECS
    const currentTrapIds = new Set<string>();

    // Query ECS World for all traps
    this.world.forEachWithTag(Tags.Trap, (entity) => {
      const trapId = getStringIdByEntity(entity);
      if (!trapId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const trap = this.world.getComponent<TrapComponent>(entity, Components.Trap);
      if (!pos || !trap) return;

      currentTrapIds.add(trapId);

      let group = this.trapMeshes.get(trapId);

      if (!group) {
        // Create trap visual
        group = this.createTrapMesh(trap.color);
        group.position.set(pos.x, 5, -pos.y); // Y=5 for low elevation (ground mine)
        this.scene.add(group);
        this.trapMeshes.set(trapId, group);
        this.animationPhase.set(trapId, Math.random() * Math.PI * 2);
      }

      // Update position (traps don't move, but keep sync for consistency)
      group.position.set(pos.x, 5, -pos.y);
    });

    // Remove traps that no longer exist in ECS
    this.trapMeshes.forEach((group, id) => {
      if (!currentTrapIds.has(id)) {
        this.scene.remove(group);
        this.disposeGroup(group);
        this.trapMeshes.delete(id);
        this.animationPhase.delete(id);
      }
    });
  }

  /**
   * Update trap animations (subtle pulsing to hint at danger)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    const time = performance.now() / 1000;

    this.trapMeshes.forEach((group, id) => {
      const phase = this.animationPhase.get(id) || 0;

      // Subtle pulsing scale (faster than DataFruit for ominous feel)
      const pulse = 1 + Math.sin(time * 3 + phase) * 0.15;
      group.scale.setScalar(pulse);

      // Slow rotation
      group.rotation.y += dt * 0.0005;
    });
  }

  /**
   * Create a trap mesh (orange-tinted orb, slightly smaller than DataFruit)
   * Designed to look like a DataFruit at first glance (deceptive!)
   * @param color - Optional custom color from trap data (hex string like "#ff6600")
   */
  private createTrapMesh(color?: string): THREE.Group {
    const group = new THREE.Group();

    // Use 70% of DataFruit size for trap (slightly smaller, more suspicious)
    const radius = GAME_CONFIG.TRAP_TRIGGER_RADIUS * 0.5;

    // Parse color if provided, otherwise use default orange
    const trapColor = color ? parseInt(color.replace('#', ''), 16) : TRAP_COLOR;
    const glowColor = color ? this.lightenColor(trapColor) : TRAP_GLOW_COLOR;

    // Core sphere (orange, looks similar to ripe DataFruit)
    const coreGeometry = new THREE.SphereGeometry(radius, 16, 16);
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: trapColor,
      emissive: trapColor,
      emissiveIntensity: 0.5, // Slightly brighter than DataFruit
      transparent: true,
      opacity: 0.85,
      roughness: 0.3,
      metalness: 0.4,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);

    // Outer glow shell (orange glow)
    const glowGeometry = new THREE.SphereGeometry(radius * 1.4, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.25,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    group.add(glow);

    // Optional: inner danger core (darker center for subtle warning)
    const innerGeometry = new THREE.SphereGeometry(radius * 0.4, 12, 12);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3300, // Darker red-orange
      transparent: true,
      opacity: 0.6,
    });
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);
    group.add(inner);

    return group;
  }

  /**
   * Lighten a color for glow effect
   */
  private lightenColor(color: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + 50);
    const g = Math.min(255, ((color >> 8) & 0xff) + 50);
    const b = Math.min(255, (color & 0xff) + 50);
    return (r << 16) | (g << 8) | b;
  }

  /**
   * Clear all trap meshes
   */
  clearAll(): void {
    this.trapMeshes.forEach((group) => {
      this.scene.remove(group);
      this.disposeGroup(group);
    });
    this.trapMeshes.clear();
    this.animationPhase.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.trapMeshes.size;
  }

  /**
   * Dispose group resources
   */
  private disposeGroup(group: THREE.Group): void {
    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clearAll();
  }
}
