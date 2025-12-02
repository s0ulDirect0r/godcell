// ============================================
// JungleCreatureRenderSystem - Manages jungle creature rendering
// Renders variant-specific creature meshes (grazer, stalker, ambusher)
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  GAME_CONFIG,
  type PositionComponent,
  type JungleCreatureComponent,
  type InterpolationTargetComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

// Variant color schemes
const VARIANT_COLORS = {
  grazer: { primary: 0x44aa44, secondary: 0x88ff88 },   // Green - passive herbivore
  stalker: { primary: 0xaa4444, secondary: 0xff8888 },  // Red - aggressive hunter
  ambusher: { primary: 0x8844aa, secondary: 0xcc88ff }, // Purple - sneaky predator
};

/**
 * JungleCreatureRenderSystem - Manages jungle creature rendering
 *
 * Owns:
 * - Creature meshes (variant-specific shapes and colors)
 * - State-based visual updates (idle, patrol, hunt)
 */
export class JungleCreatureRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Creature meshes
  private creatureMeshes: Map<string, THREE.Group> = new Map();

  // Creature variants for visual updates
  private creatureVariants: Map<string, string> = new Map();

  // Interpolation targets for smooth movement
  private creatureTargets: Map<string, { x: number; y: number }> = new Map();

  // Animation data
  private animationPhase: Map<string, number> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync creatures by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode
    if (renderMode !== 'jungle') return;

    // Track which creatures exist in ECS
    const currentCreatureIds = new Set<string>();

    // Query ECS World for all jungle creatures
    this.world.forEachWithTag(Tags.JungleCreature, (entity) => {
      const creatureId = getStringIdByEntity(entity);
      if (!creatureId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const creature = this.world.getComponent<JungleCreatureComponent>(entity, Components.JungleCreature);
      const interp = this.world.getComponent<InterpolationTargetComponent>(entity, Components.InterpolationTarget);
      if (!pos || !creature) return;

      currentCreatureIds.add(creatureId);

      let group = this.creatureMeshes.get(creatureId);

      if (!group) {
        // Create creature visual based on variant
        group = this.createCreatureMesh(creature.variant);
        group.position.set(pos.x, 20, -pos.y); // Y=20 for ground level
        this.scene.add(group);
        this.creatureMeshes.set(creatureId, group);
        this.creatureVariants.set(creatureId, creature.variant);
        this.creatureTargets.set(creatureId, { x: pos.x, y: pos.y });
        this.animationPhase.set(creatureId, Math.random() * Math.PI * 2);
      }

      // Update target position
      const targetX = interp ? interp.targetX : pos.x;
      const targetY = interp ? interp.targetY : pos.y;
      this.creatureTargets.set(creatureId, { x: targetX, y: targetY });

      // Update state-based visuals
      this.updateCreatureState(group, creature.state, creature.variant);
    });

    // Remove creatures that no longer exist in ECS
    this.creatureMeshes.forEach((group, id) => {
      if (!currentCreatureIds.has(id)) {
        this.scene.remove(group);
        this.disposeGroup(group);
        this.creatureMeshes.delete(id);
        this.creatureVariants.delete(id);
        this.creatureTargets.delete(id);
        this.animationPhase.delete(id);
      }
    });
  }

  /**
   * Interpolate creature positions for smooth movement
   */
  interpolate(): void {
    const lerpFactor = 0.25; // Slower interpolation for larger creatures

    this.creatureMeshes.forEach((group, id) => {
      const target = this.creatureTargets.get(id);
      if (target) {
        // Calculate movement direction for rotation
        const dx = target.x - group.position.x;
        const dz = -target.y - group.position.z;

        group.position.x += (target.x - group.position.x) * lerpFactor;
        const targetZ = -target.y;
        group.position.z += (targetZ - group.position.z) * lerpFactor;

        // Face movement direction (smooth rotation)
        if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
          const targetRotation = Math.atan2(dx, dz);
          const rotDiff = targetRotation - group.rotation.y;
          // Normalize rotation difference
          const normalizedDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff));
          group.rotation.y += normalizedDiff * 0.1;
        }
      }
    });
  }

  /**
   * Update creature animations (breathing, movement wobble)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(_dt: number): void {
    const time = performance.now() / 1000;

    this.creatureMeshes.forEach((group, id) => {
      const phase = this.animationPhase.get(id) || 0;
      const variant = this.creatureVariants.get(id) || 'grazer';

      // Breathing scale (different rates per variant)
      const breathRate = variant === 'stalker' ? 2 : variant === 'ambusher' ? 1 : 1.5;
      const breathScale = 1 + Math.sin(time * breathRate + phase) * 0.03;
      group.scale.setScalar(breathScale);

      // Subtle head bob for movement feel
      const bobAmount = variant === 'grazer' ? 2 : 1;
      group.position.y = 20 + Math.sin(time * 3 + phase) * bobAmount;
    });
  }

  /**
   * Create a creature mesh based on variant
   */
  private createCreatureMesh(variant: string): THREE.Group {
    const group = new THREE.Group();
    const colors = VARIANT_COLORS[variant as keyof typeof VARIANT_COLORS] || VARIANT_COLORS.grazer;
    const size = GAME_CONFIG.JUNGLE_CREATURE_COLLISION_RADIUS;

    // Different shapes per variant
    if (variant === 'grazer') {
      // Grazer: Rounded, friendly-looking shape
      this.createGrazerMesh(group, colors, size);
    } else if (variant === 'stalker') {
      // Stalker: Angular, predatory shape
      this.createStalkerMesh(group, colors, size);
    } else {
      // Ambusher: Low, wide, menacing shape
      this.createAmbusherMesh(group, colors, size);
    }

    return group;
  }

  private createGrazerMesh(group: THREE.Group, colors: { primary: number; secondary: number }, size: number): void {
    // Body: Large rounded sphere
    const bodyGeometry = new THREE.SphereGeometry(size, 16, 16);
    bodyGeometry.scale(1.2, 0.8, 1);
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: colors.primary,
      emissive: colors.secondary,
      emissiveIntensity: 0.2,
      roughness: 0.6,
      metalness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    // Head: Smaller sphere at front
    const headGeometry = new THREE.SphereGeometry(size * 0.4, 12, 12);
    const head = new THREE.Mesh(headGeometry, bodyMaterial.clone());
    head.position.set(0, size * 0.3, size * 0.8);
    group.add(head);

    // Glow effect
    const glowGeometry = new THREE.SphereGeometry(size * 1.3, 12, 12);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: colors.secondary,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    group.add(glow);
  }

  private createStalkerMesh(group: THREE.Group, colors: { primary: number; secondary: number }, size: number): void {
    // Body: Angular, sleek shape
    const bodyGeometry = new THREE.ConeGeometry(size * 0.8, size * 2, 6);
    bodyGeometry.rotateX(Math.PI / 2);
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: colors.primary,
      emissive: colors.secondary,
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0.5,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    // Spikes/fins on back
    for (let i = 0; i < 3; i++) {
      const spikeGeometry = new THREE.ConeGeometry(size * 0.15, size * 0.5, 4);
      const spike = new THREE.Mesh(spikeGeometry, bodyMaterial.clone());
      spike.position.set(0, size * 0.3, -size * 0.5 + i * size * 0.5);
      group.add(spike);
    }

    // Glowing eyes - bright red for predatory look
    const eyeGeometry = new THREE.SphereGeometry(size * 0.1, 6, 6);
    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
    });
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-size * 0.25, size * 0.1, size * 0.9);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial.clone());
    rightEye.position.set(size * 0.25, size * 0.1, size * 0.9);
    group.add(rightEye);
  }

  private createAmbusherMesh(group: THREE.Group, colors: { primary: number; secondary: number }, size: number): void {
    // Body: Low, wide, spider-like
    const bodyGeometry = new THREE.SphereGeometry(size, 16, 16);
    bodyGeometry.scale(1.5, 0.4, 1.5);
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: colors.primary,
      emissive: colors.secondary,
      emissiveIntensity: 0.2,
      roughness: 0.7,
      metalness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    // Multiple "legs" (simplified as spheres at edges)
    const legPositions = [
      { x: 1, z: 0.7 }, { x: -1, z: 0.7 },
      { x: 1.2, z: 0 }, { x: -1.2, z: 0 },
      { x: 1, z: -0.7 }, { x: -1, z: -0.7 },
    ];
    const legGeometry = new THREE.SphereGeometry(size * 0.15, 6, 6);
    const legMaterial = new THREE.MeshPhysicalMaterial({
      color: colors.primary,
      emissive: colors.secondary,
      emissiveIntensity: 0.3,
    });
    legPositions.forEach((pos) => {
      const leg = new THREE.Mesh(legGeometry, legMaterial.clone());
      leg.position.set(pos.x * size, -size * 0.2, pos.z * size);
      group.add(leg);
    });

    // Eyes: Multiple small glowing dots - bright purple
    const eyeGeometry = new THREE.SphereGeometry(size * 0.08, 4, 4);
    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0xcc00ff,
    });
    for (let i = -2; i <= 2; i++) {
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial.clone());
      eye.position.set(i * size * 0.15, size * 0.15, size * 0.7);
      group.add(eye);
    }
  }

  /**
   * Update creature visual based on state
   */
  private updateCreatureState(group: THREE.Group, state: string, _variant: string): void {
    const isHunting = state === 'hunt';

    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial) {
        if (isHunting) {
          // Hunting: Brighter, more aggressive glow
          child.material.emissiveIntensity = 0.6;
        } else {
          child.material.emissiveIntensity = 0.2;
        }
      }
    });
  }

  /**
   * Clear all creature meshes
   */
  clearAll(): void {
    this.creatureMeshes.forEach((group) => {
      this.scene.remove(group);
      this.disposeGroup(group);
    });
    this.creatureMeshes.clear();
    this.creatureVariants.clear();
    this.creatureTargets.clear();
    this.animationPhase.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.creatureMeshes.size;
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
