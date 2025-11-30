// ============================================
// PseudopodRenderSystem - Manages pseudopod beam rendering
// Owns pseudopod meshes (lightning bolt projectiles)
// ============================================

import * as THREE from 'three';
import { LightningStrike } from 'three-stdlib';

/**
 * Pseudopod beam data needed for rendering
 */
export interface PseudopodData {
  id: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  width: number;
  color: string;
}

/**
 * PseudopodRenderSystem - Manages pseudopod beam rendering
 *
 * Owns:
 * - Pseudopod meshes (lightning bolt geometry using three-stdlib LightningStrike)
 */
export class PseudopodRenderSystem {
  private scene!: THREE.Scene;

  // Pseudopod meshes (lightning bolt projectiles)
  private pseudopodMeshes: Map<string, THREE.Mesh> = new Map();

  /**
   * Initialize pseudopod system with scene reference
   */
  init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Sync pseudopods from game state
   * Creates new meshes for new pseudopods, removes meshes for retracted pseudopods
   * Updates position for projectile-mode pseudopods
   * @param pseudopods - Map of pseudopod ID to pseudopod data
   */
  sync(pseudopods: Map<string, PseudopodData>): void {
    // Remove pseudopods that no longer exist
    this.pseudopodMeshes.forEach((mesh, id) => {
      if (!pseudopods.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.pseudopodMeshes.delete(id);
      }
    });

    // Add or update pseudopods
    pseudopods.forEach((beam, id) => {
      let mesh = this.pseudopodMeshes.get(id);

      if (!mesh) {
        // Determine if hitscan or projectile mode based on velocity magnitude
        // Hitscan: velocity holds end position (low magnitude from position)
        // Projectile: velocity holds actual velocity vector (high magnitude)
        const vx = beam.velocity.x - beam.position.x;
        const vy = beam.velocity.y - beam.position.y;
        const velocityMag = Math.sqrt(vx * vx + vy * vy);
        const isHitscan = velocityMag < 100; // Hitscan if "velocity" is actually end position

        let startPos: THREE.Vector3;
        let endPos: THREE.Vector3;

        if (isHitscan) {
          // Hitscan mode: beam.velocity is the end position (XZ plane, Y=height)
          startPos = new THREE.Vector3(beam.position.x, 1, -beam.position.y);
          endPos = new THREE.Vector3(beam.velocity.x, 1, -beam.velocity.y);
        } else {
          // Projectile mode: create short lightning bolt in direction of travel
          const boltLength = 80; // Fixed visual length
          const dirX = beam.velocity.x / Math.sqrt(beam.velocity.x ** 2 + beam.velocity.y ** 2);
          const dirY = beam.velocity.y / Math.sqrt(beam.velocity.x ** 2 + beam.velocity.y ** 2);

          // XZ plane: game Y maps to -Z
          startPos = new THREE.Vector3(beam.position.x, 1, -beam.position.y);
          endPos = new THREE.Vector3(
            beam.position.x + dirX * boltLength,
            1,
            -(beam.position.y + dirY * boltLength)
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
        this.pseudopodMeshes.set(id, mesh);
      } else {
        // Update projectile position (projectile mode only - hitscan beams are static)
        // Check if this is a projectile beam
        const vx = beam.velocity.x - beam.position.x;
        const vy = beam.velocity.y - beam.position.y;
        const velocityMag = Math.sqrt(vx * vx + vy * vy);
        const isProjectile = velocityMag >= 100;

        if (isProjectile) {
          // Update position for moving projectile (XZ plane)
          mesh.position.x = beam.position.x;
          mesh.position.z = -beam.position.y;
        }
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
