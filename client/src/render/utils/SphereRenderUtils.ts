// ============================================
// SphereRenderUtils - Three.js sphere rendering helpers
// Converts spherical world positions to Three.js scene coordinates
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG, getSurfaceNormal, isSphereMode, type Position } from '#shared';

const PLANET_RADIUS = GAME_CONFIG.PLANET_RADIUS;

/**
 * Set mesh position from game Position
 * Handles both flat (2D) and spherical (3D) coordinate systems
 *
 * @param mesh - Three.js object to position
 * @param pos - Game position (x, y, z optional)
 * @param heightOffset - Additional offset above surface (e.g., for floating effects)
 */
export function setMeshPosition(
  mesh: THREE.Object3D,
  pos: Position,
  heightOffset: number = 0
): void {
  if (isSphereMode()) {
    // Spherical world: position directly, add height along surface normal
    if (heightOffset !== 0) {
      const normal = getSurfaceNormal(pos);
      mesh.position.set(
        pos.x + normal.x * heightOffset,
        pos.y + normal.y * heightOffset,
        (pos.z ?? 0) + (normal.z ?? 0) * heightOffset
      );
    } else {
      mesh.position.set(pos.x, pos.y, pos.z ?? 0);
    }
  } else {
    // Flat world: Y is height, negate game Y for Z (old coordinate system)
    mesh.position.set(pos.x, heightOffset, -(pos.y));
  }
}

/**
 * Orient mesh so its local Y-axis points away from planet center
 * This makes meshes "stand up" on the sphere surface
 *
 * @param mesh - Three.js object to orient
 * @param pos - Game position on sphere surface
 */
export function orientToSurface(mesh: THREE.Object3D, pos: Position): void {
  if (!isSphereMode()) {
    // Flat world: no special orientation needed
    return;
  }

  const normal = getSurfaceNormal(pos);

  // Create a quaternion that rotates from world up (0,1,0) to surface normal
  const up = new THREE.Vector3(0, 1, 0);
  const surfaceUp = new THREE.Vector3(normal.x, normal.y, normal.z ?? 0);

  // Handle edge case where normal is parallel to up
  if (Math.abs(surfaceUp.dot(up)) > 0.999) {
    // Near poles, just set identity or flip
    if (surfaceUp.y > 0) {
      mesh.quaternion.identity();
    } else {
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }
    return;
  }

  mesh.quaternion.setFromUnitVectors(up, surfaceUp);
}

/**
 * Orient a flat mesh to lie on the sphere surface
 * The mesh's flat face becomes tangent to the sphere
 * Used for single-cell and multi-cell organisms
 *
 * @param mesh - Three.js object to orient
 * @param pos - Game position on sphere surface
 */
export function orientFlatToSurface(mesh: THREE.Object3D, pos: Position): void {
  if (!isSphereMode()) {
    // Flat mode: standard -90° X rotation to lie in XZ plane
    mesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    return;
  }

  const normal = getSurfaceNormal(pos);
  const surfaceNormal = new THREE.Vector3(normal.x, normal.y, normal.z ?? 0);

  // We want the mesh's local -Z to point along surface normal
  // (after -90° X rotation, original +Y becomes -Z)
  // So: rotate from (0, 0, -1) to surfaceNormal
  const negZ = new THREE.Vector3(0, 0, -1);

  if (Math.abs(surfaceNormal.dot(negZ)) > 0.999) {
    // Surface normal is parallel to -Z
    if (surfaceNormal.z < 0) {
      // Pointing same direction, use flat-mode rotation
      mesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    } else {
      // Pointing opposite, flip
      mesh.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    }
    return;
  }

  mesh.quaternion.setFromUnitVectors(negZ, surfaceNormal);
}

/**
 * Get height offset above surface based on render mode
 * Different heights for soup (flat look) vs jungle (3D terrain)
 *
 * @param baseHeight - Base height value
 * @param renderMode - 'soup' or 'jungle'
 */
export function getSurfaceOffset(baseHeight: number, renderMode: 'soup' | 'jungle'): number {
  // For now, same height in both modes
  // In future, jungle might have terrain elevation
  return baseHeight;
}

/**
 * Create planet sphere mesh for scene background
 * Icosahedron geometry for smooth surface
 */
export function createPlanetMesh(): THREE.Mesh {
  // Subdivided icosahedron for smooth sphere
  const geometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, 5);
  const material = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    side: THREE.BackSide, // Render inside of sphere (we're inside it)
    wireframe: false,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Calculate camera position for top-down view on sphere
 * Camera orbits sphere, always looking toward center
 *
 * @param playerPos - Player position on sphere surface
 * @param cameraDistance - Distance above player
 */
export function getSphereCameraPosition(
  playerPos: Position,
  cameraDistance: number
): { position: THREE.Vector3; up: THREE.Vector3 } {
  if (!isSphereMode()) {
    // Flat world: traditional top-down camera
    return {
      position: new THREE.Vector3(playerPos.x, cameraDistance, -playerPos.y),
      up: new THREE.Vector3(0, 0, -1), // Z-negative is "up" in screen space
    };
  }

  const normal = getSurfaceNormal(playerPos);
  const normalVec = new THREE.Vector3(normal.x, normal.y, normal.z ?? 0);

  // Camera position: above player along surface normal
  const position = new THREE.Vector3(
    playerPos.x + normal.x * cameraDistance,
    playerPos.y + normal.y * cameraDistance,
    (playerPos.z ?? 0) + (normal.z ?? 0) * cameraDistance
  );

  // Camera up: tangent to surface, pointing toward "north" (positive Y on sphere)
  // This prevents camera from spinning as player moves around sphere
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, normalVec).normalize();

  // Handle poles where worldUp is parallel to normal
  if (right.length() < 0.001) {
    right.set(1, 0, 0); // Use X as right at poles
  }

  const up = new THREE.Vector3().crossVectors(normalVec, right).normalize();

  return { position, up };
}

/**
 * Transform local input direction to world space for spherical surface
 * WASD (local xy) -> world xyz tangent to surface
 *
 * @param localX - Local X input (-1 to 1, A/D keys)
 * @param localY - Local Y input (-1 to 1, W/S keys)
 * @param playerPos - Player position on sphere
 * @param cameraUp - Camera's current up vector (determines "forward")
 */
export function localToWorldDirection(
  localX: number,
  localY: number,
  playerPos: Position,
  cameraUp: THREE.Vector3
): { x: number; y: number; z: number } {
  if (!isSphereMode()) {
    // Flat world: local Y is forward (negative Z in Three.js)
    return { x: localX, y: localY, z: 0 };
  }

  const normal = getSurfaceNormal(playerPos);
  const normalVec = new THREE.Vector3(normal.x, normal.y, normal.z ?? 0);

  // Forward direction is camera's up (projected onto surface tangent)
  const forward = cameraUp.clone().projectOnPlane(normalVec).normalize();

  // Right is perpendicular to both normal and forward
  const right = new THREE.Vector3().crossVectors(normalVec, forward).normalize();

  // Combine local input with world directions
  return {
    x: right.x * localX + forward.x * localY,
    y: right.y * localX + forward.y * localY,
    z: right.z * localX + forward.z * localY,
  };
}

/**
 * Raycast onto sphere surface for click-to-target
 *
 * @param raycaster - Three.js raycaster (already set from camera)
 * @param planetMesh - Planet sphere mesh to intersect
 */
export function raycastToSphere(
  raycaster: THREE.Raycaster,
  planetMesh: THREE.Mesh
): Position | null {
  const intersects = raycaster.intersectObject(planetMesh);
  if (intersects.length > 0) {
    const p = intersects[0].point;
    return { x: p.x, y: p.y, z: p.z };
  }
  return null;
}

/**
 * Orient a hexapod (cyber-organism) mesh on sphere surface
 * - Local +Z (dorsal) points away from sphere center (along surface normal)
 * - Local -X (head) faces the heading direction
 *
 * @param mesh - The hexapod mesh group
 * @param pos - Position on sphere surface
 * @param headingDir - Desired forward direction (world space velocity direction)
 */
export function orientHexapodToSurface(
  mesh: THREE.Object3D,
  pos: Position,
  headingDir: THREE.Vector3
): void {
  if (!isSphereMode()) {
    // Flat mode: rotate around Y to face heading (mesh Z is up in flat mode view)
    // Head is at -X, so we want -X to point toward heading
    const yaw = Math.atan2(headingDir.z, headingDir.x);
    mesh.quaternion.setFromEuler(new THREE.Euler(0, -yaw + Math.PI, 0));
    return;
  }

  const normal = getSurfaceNormal(pos);
  const surfaceNormal = new THREE.Vector3(normal.x, normal.y, normal.z ?? 0);

  // Step 1: Get surface orientation (local +Z -> surface normal)
  const posZ = new THREE.Vector3(0, 0, 1);
  const surfaceQuat = new THREE.Quaternion();

  if (Math.abs(surfaceNormal.dot(posZ)) > 0.999) {
    if (surfaceNormal.z > 0) {
      surfaceQuat.identity();
    } else {
      surfaceQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }
  } else {
    surfaceQuat.setFromUnitVectors(posZ, surfaceNormal);
  }

  // Step 2: Calculate heading rotation around local Z (surface normal)
  // Project heading onto tangent plane
  const headingTangent = headingDir.clone().projectOnPlane(surfaceNormal);

  if (headingTangent.lengthSq() > 0.001) {
    headingTangent.normalize();

    // After surface rotation, find where local -X ends up (that's where head points)
    const localNegX = new THREE.Vector3(-1, 0, 0).applyQuaternion(surfaceQuat);

    // Calculate angle between current head direction and desired heading
    // We want head (-X) to point toward headingTangent
    const currentForward = localNegX.clone().projectOnPlane(surfaceNormal).normalize();

    if (currentForward.lengthSq() > 0.001) {
      // Angle between current and target heading
      let angle = Math.acos(Math.max(-1, Math.min(1, currentForward.dot(headingTangent))));

      // Determine sign using cross product
      const cross = new THREE.Vector3().crossVectors(currentForward, headingTangent);
      if (cross.dot(surfaceNormal) < 0) {
        angle = -angle;
      }

      // Apply heading rotation around surface normal
      const headingQuat = new THREE.Quaternion().setFromAxisAngle(surfaceNormal, angle);
      mesh.quaternion.copy(headingQuat.multiply(surfaceQuat));
    } else {
      mesh.quaternion.copy(surfaceQuat);
    }
  } else {
    mesh.quaternion.copy(surfaceQuat);
  }
}

/**
 * Interpolate position on sphere surface
 * Simple linear interpolation works for small distances
 *
 * @param current - Current position
 * @param target - Target position
 * @param t - Interpolation factor (0-1)
 */
export function lerpPosition(
  current: Position,
  target: Position,
  t: number
): Position {
  return {
    x: current.x + (target.x - current.x) * t,
    y: current.y + (target.y - current.y) * t,
    z: (current.z ?? 0) + ((target.z ?? 0) - (current.z ?? 0)) * t,
  };
}
