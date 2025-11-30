// ============================================
// PseudopodRenderSystem - Manages pseudopod beam rendering
// Owns pseudopod meshes (lightning bolt projectiles)
// Queries ECS World directly for pseudopod entities
// ============================================

import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type VelocityComponent,
  type PseudopodComponent,
} from '../../ecs';

/**
 * PseudopodRenderSystem - Manages pseudopod beam rendering
 *
 * Owns:
 * - Pseudopod meshes (lightning bolt geometry using three-stdlib LightningStrike)
 */
export class PseudopodRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Pseudopod meshes (lightning bolt projectiles)
  private pseudopodMeshes: Map<string, THREE.Mesh> = new Map();

  /**
   * Initialize pseudopod system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync pseudopods by querying ECS World directly
   * Creates new meshes for new pseudopods, removes meshes for retracted pseudopods
   * Updates position for projectile-mode pseudopods
   */
  sync(): void {
    // Track which pseudopods exist in ECS
    const currentPseudopodIds = new Set<string>();

    // Query ECS World for all pseudopods
    this.world.forEachWithTag(Tags.Pseudopod, (entity) => {
      const beamId = getStringIdByEntity(entity);
      if (!beamId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const vel = this.world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const beam = this.world.getComponent<PseudopodComponent>(entity, Components.Pseudopod);
      if (!pos || !beam) return;

      currentPseudopodIds.add(beamId);

      const velocity = vel ? { x: vel.x, y: vel.y } : { x: 0, y: 0 };

      let mesh = this.pseudopodMeshes.get(beamId);

      if (!mesh) {
        // Determine if hitscan or projectile mode based on velocity magnitude
        // Hitscan: velocity holds end position (low magnitude from position)
        // Projectile: velocity holds actual velocity vector (high magnitude)
        const vx = velocity.x - pos.x;
        const vy = velocity.y - pos.y;
        const velocityMag = Math.sqrt(vx * vx + vy * vy);
        const isHitscan = velocityMag < 100; // Hitscan if "velocity" is actually end position

        let startPos: THREE.Vector3;
        let endPos: THREE.Vector3;

        if (isHitscan) {
          // Hitscan mode: velocity is the end position (XZ plane, Y=height)
          startPos = new THREE.Vector3(pos.x, 1, -pos.y);
          endPos = new THREE.Vector3(velocity.x, 1, -velocity.y);
        } else {
          // Projectile mode: create short lightning bolt in direction of travel
          const boltLength = 80; // Fixed visual length
          const mag = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
          // Guard against zero velocity (fallback to +X direction)
          const dirX = mag > 0.001 ? velocity.x / mag : 1;
          const dirY = mag > 0.001 ? velocity.y / mag : 0;

          // XZ plane: game Y maps to -Z
          startPos = new THREE.Vector3(pos.x, 1, -pos.y);
          endPos = new THREE.Vector3(
            pos.x + dirX * boltLength,
            1,
            -(pos.y + dirY * boltLength)
          );
        }

        // Calculate beam direction and length
        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const length = direction.length();

        // Create lightning bolt geometry
        // rayParams configures the procedural lightning appearance
        const rayParams = {
          sourceOffset: new THREE.Vector3(0, 0, 0),
          destOffset: new THREE.Vector3(0, length, 0),
          radius0: beam.width / 2,       // Start radius
          radius1: beam.width / 3,       // End radius (tapers)
          minRadius: 2.5,                // Minimum branch radius
          maxIterations: 7,              // Recursion depth for jagged effect
          isEternal: true,               // Stays visible until removed
          timeScale: 0.7,                // Animation speed
          propagationTimeFactor: 0.05,   // How fast lightning propagates
          vanishingTimeFactor: 0.95,     // Fade-out timing
          subrayPeriod: 3.5,             // How often sub-branches spawn
          subrayDutyCycle: 0.6,          // Sub-branch visibility duration
          maxSubrayRecursion: 1,         // Max depth of sub-branches
          ramification: 3,               // Number of sub-branches
          recursionProbability: 0.4,     // Chance of recursive branching
        };

        const lightningGeometry = new LightningStrike(rayParams);

        // Create mesh with lightning geometry
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(beam.color),
          transparent: true,
          opacity: 0.9,
        });

        mesh = new THREE.Mesh(lightningGeometry, material);

        // Position at beam start
        mesh.position.copy(startPos);

        // Rotate to point from start to end
        // Lightning geometry points in +Y direction by default
        // Use quaternion to rotate from +Y to the actual direction
        const defaultDir = new THREE.Vector3(0, 1, 0);
        const targetDir = direction.clone().normalize();
        mesh.quaternion.setFromUnitVectors(defaultDir, targetDir);

        this.scene.add(mesh);
        this.pseudopodMeshes.set(beamId, mesh);
      } else {
        // Update projectile position (projectile mode only - hitscan beams are static)
        // Check if this is a projectile beam
        const vx = velocity.x - pos.x;
        const vy = velocity.y - pos.y;
        const velocityMag = Math.sqrt(vx * vx + vy * vy);
        const isProjectile = velocityMag >= 100;

        if (isProjectile) {
          // Update position for moving projectile (XZ plane)
          mesh.position.x = pos.x;
          mesh.position.z = -pos.y;
        }
      }
    });

    // Remove pseudopods that no longer exist in ECS
    this.pseudopodMeshes.forEach((mesh, id) => {
      if (!currentPseudopodIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.pseudopodMeshes.delete(id);
      }
    });
  }

  /**
   * Clear all pseudopod meshes
   * Called when needed (e.g., player death, mode transitions)
   */
  clearAll(): void {
    this.pseudopodMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.pseudopodMeshes.clear();
  }

  /**
   * Get count of pseudopod meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.pseudopodMeshes.size;
  }

  /**
   * Dispose all pseudopod resources
   */
  dispose(): void {
    this.clearAll();
  }
}
