// ============================================
// OrganismProjectileRenderSystem - Manages organism projectile rendering
// Renders Stage 3 attack projectiles (similar to pseudopod beam)
// ============================================

import * as THREE from 'three';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  GAME_CONFIG,
  type PositionComponent,
  type OrganismProjectileComponent,
  type VelocityComponent,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

/**
 * OrganismProjectileRenderSystem - Manages organism projectile rendering
 *
 * Owns:
 * - Projectile meshes (glowing energy bolts)
 * - Trail effects
 */
export class OrganismProjectileRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Projectile meshes
  private projectileMeshes: Map<string, THREE.Group> = new Map();

  // Trail geometry for each projectile
  private trailPoints: Map<string, THREE.Vector3[]> = new Map();
  private trailMeshes: Map<string, THREE.Line> = new Map();

  /**
   * Initialize system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync projectiles by querying ECS World directly
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Only render in jungle mode (Stage 3+ entity)
    if (renderMode !== 'jungle') return;

    // Track which projectiles exist in ECS
    const currentProjectileIds = new Set<string>();

    // Query ECS World for all organism projectiles
    this.world.forEachWithTag(Tags.OrganismProjectile, (entity) => {
      const projId = getStringIdByEntity(entity);
      if (!projId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const proj = this.world.getComponent<OrganismProjectileComponent>(entity, Components.OrganismProjectile);
      const vel = this.world.getComponent<VelocityComponent>(entity, Components.Velocity);
      if (!pos || !proj) return;

      currentProjectileIds.add(projId);

      let group = this.projectileMeshes.get(projId);

      if (!group) {
        // Create projectile visual
        group = this.createProjectileMesh(proj.color);
        group.position.set(pos.x, 30, -pos.y); // Y=30 for flying height above ground
        this.scene.add(group);
        this.projectileMeshes.set(projId, group);

        // Initialize trail
        this.trailPoints.set(projId, [new THREE.Vector3(pos.x, 30, -pos.y)]);
        this.createTrailMesh(projId, proj.color);
      }

      // Update position directly (no interpolation - fast projectiles)
      group.position.set(pos.x, 30, -pos.y);

      // Update rotation to face velocity direction
      if (vel && (vel.x !== 0 || vel.y !== 0)) {
        group.rotation.y = Math.atan2(vel.x, -vel.y);
      }

      // Update trail
      this.updateTrail(projId, pos.x, -pos.y);
    });

    // Remove projectiles that no longer exist in ECS
    this.projectileMeshes.forEach((group, id) => {
      if (!currentProjectileIds.has(id)) {
        this.scene.remove(group);
        this.disposeGroup(group);
        this.projectileMeshes.delete(id);

        // Remove trail
        const trail = this.trailMeshes.get(id);
        if (trail) {
          this.scene.remove(trail);
          trail.geometry.dispose();
          (trail.material as THREE.LineBasicMaterial).dispose();
          this.trailMeshes.delete(id);
        }
        this.trailPoints.delete(id);
      }
    });
  }

  /**
   * No interpolation needed - projectiles update position directly
   */
  interpolate(): void {
    // Projectiles are fast and update position directly in sync
  }

  /**
   * Update projectile animations and movement
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    const time = performance.now() / 1000;
    const dtSeconds = dt / 1000;

    // Move projectiles based on velocity (client-side prediction)
    // Server doesn't broadcast position updates for fast projectiles
    this.world.forEachWithTag(Tags.OrganismProjectile, (entity) => {
      const projId = getStringIdByEntity(entity);
      if (!projId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const vel = this.world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const group = this.projectileMeshes.get(projId);

      if (pos && vel && group) {
        // Update ECS position based on velocity
        pos.x += vel.x * dtSeconds;
        pos.y += vel.y * dtSeconds;

        // Update mesh position
        group.position.set(pos.x, 30, -pos.y);

        // Update trail
        this.updateTrail(projId, pos.x, -pos.y);
      }
    });

    this.projectileMeshes.forEach((group) => {
      // Pulsing glow
      const pulse = 1 + Math.sin(time * 20) * 0.2;
      group.scale.setScalar(pulse);

      // Spin effect
      group.rotation.z += dt * 0.02;
    });

    // Fade out trail segments
    this.trailMeshes.forEach((trail) => {
      const material = trail.material as THREE.LineBasicMaterial;
      material.opacity = 0.6 + Math.sin(time * 15) * 0.2;
    });
  }

  /**
   * Create a projectile mesh (glowing energy bolt for jungle scale)
   * Scaled up from soup-scale pseudopod for visibility at jungle camera distance
   */
  private createProjectileMesh(color: string): THREE.Group {
    const group = new THREE.Group();
    // Jungle-scale size (collision radius is 50, visual slightly larger)
    const size = GAME_CONFIG.ORGANISM_PROJECTILE_COLLISION_RADIUS;

    // Parse color string
    const colorValue = parseInt(color.replace('#', ''), 16) || 0x00ffff;

    // Core bolt (elongated sphere pointing in travel direction)
    const coreGeometry = new THREE.SphereGeometry(size, 12, 12);
    coreGeometry.scale(0.6, 0.6, 2.0); // Elongated along Z (travel direction)
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: colorValue,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);

    // Inner bright core
    const innerGeometry = new THREE.SphereGeometry(size * 0.5, 8, 8);
    innerGeometry.scale(0.5, 0.5, 1.5);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, // White hot center
    });
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);
    group.add(inner);

    // Outer glow
    const glowGeometry = new THREE.SphereGeometry(size * 2, 12, 12);
    glowGeometry.scale(0.8, 0.8, 2.5);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: colorValue,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    group.add(glow);

    // Point light for dynamic lighting effect
    const light = new THREE.PointLight(colorValue, 1.5, size * 15);
    group.add(light);

    return group;
  }

  /**
   * Create trail mesh for a projectile
   */
  private createTrailMesh(projId: string, color: string): void {
    const colorValue = parseInt(color.replace('#', ''), 16) || 0x00ffff;

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color: colorValue,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });

    const trail = new THREE.Line(geometry, material);
    this.scene.add(trail);
    this.trailMeshes.set(projId, trail);
  }

  /**
   * Update trail points
   */
  private updateTrail(projId: string, x: number, z: number): void {
    const points = this.trailPoints.get(projId);
    const trail = this.trailMeshes.get(projId);
    if (!points || !trail) return;

    // Add new point
    points.push(new THREE.Vector3(x, 30, z));

    // Limit trail length
    const maxPoints = 15;
    while (points.length > maxPoints) {
      points.shift();
    }

    // Update geometry
    if (points.length >= 2) {
      trail.geometry.setFromPoints(points);
    }
  }

  /**
   * Clear all projectile meshes
   */
  clearAll(): void {
    this.projectileMeshes.forEach((group) => {
      this.scene.remove(group);
      this.disposeGroup(group);
    });
    this.projectileMeshes.clear();

    this.trailMeshes.forEach((trail) => {
      this.scene.remove(trail);
      trail.geometry.dispose();
      (trail.material as THREE.LineBasicMaterial).dispose();
    });
    this.trailMeshes.clear();
    this.trailPoints.clear();
  }

  /**
   * Get mesh count for debugging
   */
  getMeshCount(): number {
    return this.projectileMeshes.size;
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
      } else if (child instanceof THREE.PointLight) {
        // Lights don't need disposal
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
