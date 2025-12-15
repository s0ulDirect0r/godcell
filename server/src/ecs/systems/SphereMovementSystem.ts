// ============================================
// Sphere Movement System
// Handles player movement on a spherical world surface
// Separate from flat-world MovementSystem for clean isolation
// ============================================

import type { Server } from 'socket.io';
import {
  Tags,
  Components,
  type World,
  GAME_CONFIG,
  projectToSphere,
  makeTangent,
  getCameraUp,
  inputToWorldDirection,
  type Vec3,
} from '#shared';
import type { PlayerMovedMessage } from '#shared';
import type { System } from './types';
import {
  getSocketIdByEntity,
  requireEnergy,
  requirePosition,
  requireStage,
  requireVelocity,
  requireInput,
  setEnergy,
} from '../factories';
import { getConfig } from '../../dev';

// Gravity well positions on sphere (spherical coordinates)
// These match the visual wells in client sphere-test.ts
interface SphereGravityWell {
  pos: Vec3;
  radius: number; // Influence radius
  strength: number; // Gravity strength multiplier
}

/**
 * SphereMovementSystem - Handles player movement on sphere surface
 *
 * Key differences from flat MovementSystem:
 * - Input is transformed from 2D screen space to 3D tangent direction
 * - Velocity is kept tangent to sphere surface
 * - Position is projected back to sphere after movement
 * - No rectangular bounds clamping (sphere wraps naturally)
 * - Includes sphere-specific gravity wells
 */
export class SphereMovementSystem implements System {
  readonly name = 'SphereMovementSystem';

  // Store camera up per player (momentum-locked orientation)
  private playerCameraUp = new Map<string, Vec3>();

  // Gravity wells on sphere surface
  private gravityWells: SphereGravityWell[] = [];
  private initialized = false;

  /**
   * Initialize gravity wells on sphere surface
   */
  private initGravityWells(): void {
    if (this.initialized) return;
    this.initialized = true;

    const sphereRadius = GAME_CONFIG.SPHERE_RADIUS;
    // Geodesic max distance is π * radius ≈ 9600 for radius 3060
    // Use 4000 to cover ~40% of max range - enough to catch most spawns
    const wellRadius = 4000;
    const wellStrength = GAME_CONFIG.OBSTACLE_GRAVITY_STRENGTH;

    // Define well positions in spherical coordinates
    const wellCoords = [
      { theta: 0, phi: Math.PI / 2 }, // Equator front
      { theta: Math.PI, phi: Math.PI / 2 }, // Equator back
      { theta: Math.PI / 2, phi: Math.PI / 3 }, // Upper right quadrant
      { theta: -Math.PI / 2, phi: (2 * Math.PI) / 3 }, // Lower left quadrant
    ];

    for (const { theta, phi } of wellCoords) {
      const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
      const y = sphereRadius * Math.cos(phi);
      const z = sphereRadius * Math.sin(phi) * Math.sin(theta);

      this.gravityWells.push({
        pos: { x, y, z },
        radius: wellRadius,
        strength: wellStrength,
      });
    }

    console.log(`[SPHERE] Initialized ${this.gravityWells.length} gravity wells (radius=${wellRadius})`);
  }

  /**
   * Calculate geodesic distance between two points on sphere surface
   * (Great circle distance)
   */
  private geodesicDistance(p1: Vec3, p2: Vec3, radius: number): number {
    // Normalize to unit sphere
    const n1 = this.normalize(p1);
    const n2 = this.normalize(p2);

    // Dot product gives cos of angle between vectors
    const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    // Clamp to avoid acos domain errors
    const clampedDot = Math.max(-1, Math.min(1, dot));

    // Arc length = radius * angle
    return radius * Math.acos(clampedDot);
  }

  private normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len === 0) return { x: 1, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  /**
   * Get tangent direction from p1 toward p2 on sphere surface
   */
  private tangentToward(from: Vec3, to: Vec3): Vec3 {
    // Direction in 3D space
    const dir = {
      x: to.x - from.x,
      y: to.y - from.y,
      z: to.z - from.z,
    };

    // Project onto tangent plane at 'from'
    const normal = this.normalize(from);
    const dot = dir.x * normal.x + dir.y * normal.y + dir.z * normal.z;

    const tangent = {
      x: dir.x - dot * normal.x,
      y: dir.y - dot * normal.y,
      z: dir.z - dot * normal.z,
    };

    // Normalize
    const len = Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y + tangent.z * tangent.z);
    if (len < 0.0001) return { x: 0, y: 0, z: 0 };

    return { x: tangent.x / len, y: tangent.y / len, z: tangent.z / len };
  }

  update(world: World, deltaTime: number, io: Server): void {
    this.initGravityWells();
    const sphereRadius = GAME_CONFIG.SPHERE_RADIUS;
    const acceleration = GAME_CONFIG.PLAYER_SPEED * 8;
    const friction = GAME_CONFIG.MOVEMENT_FRICTION;
    const maxSpeed = GAME_CONFIG.PLAYER_SPEED * 1.2;

    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;

      // Get ECS components
      const energyComponent = requireEnergy(world, entity);
      const positionComponent = requirePosition(world, entity);
      const velocityComponent = requireVelocity(world, entity);
      const inputComponent = requireInput(world, entity);

      // Skip dead players
      if (energyComponent.current <= 0) return;

      const inputDirection = inputComponent.direction;

      // Normalize diagonal input
      const inputLength = Math.sqrt(
        inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y
      );
      const inputNormX = inputLength > 0 ? inputDirection.x / inputLength : 0;
      const inputNormY = inputLength > 0 ? inputDirection.y / inputLength : 0;

      // Current position as Vec3
      const pos: Vec3 = {
        x: positionComponent.x,
        y: positionComponent.y,
        z: positionComponent.z ?? 0,
      };

      // Get or initialize camera up for this player
      let camUp = this.playerCameraUp.get(playerId);
      if (!camUp) {
        camUp = getCameraUp(pos);
        this.playerCameraUp.set(playerId, camUp);
      }

      // Transform 2D input to 3D world direction tangent to sphere
      const worldDir = inputToWorldDirection(inputNormX, inputNormY, pos, camUp);

      // Apply acceleration in 3D
      velocityComponent.x += worldDir.x * acceleration * deltaTime;
      velocityComponent.y += worldDir.y * acceleration * deltaTime;
      velocityComponent.z = (velocityComponent.z ?? 0) + worldDir.z * acceleration * deltaTime;

      // Keep velocity tangent to sphere surface
      const tangentVel = makeTangent(pos, {
        x: velocityComponent.x,
        y: velocityComponent.y,
        z: velocityComponent.z ?? 0,
      });
      velocityComponent.x = tangentVel.x;
      velocityComponent.y = tangentVel.y;
      velocityComponent.z = tangentVel.z;

      // Calculate current speed (3D)
      const currentSpeed = Math.sqrt(
        velocityComponent.x * velocityComponent.x +
          velocityComponent.y * velocityComponent.y +
          (velocityComponent.z ?? 0) * (velocityComponent.z ?? 0)
      );

      // Cap velocity to max speed
      if (currentSpeed > maxSpeed) {
        const scale = maxSpeed / currentSpeed;
        velocityComponent.x *= scale;
        velocityComponent.y *= scale;
        velocityComponent.z = (velocityComponent.z ?? 0) * scale;
      }

      // Apply friction (exponential decay)
      const frictionFactor = Math.pow(friction, deltaTime);
      velocityComponent.x *= frictionFactor;
      velocityComponent.y *= frictionFactor;
      velocityComponent.z = (velocityComponent.z ?? 0) * frictionFactor;

      // Apply gravity from sphere gravity wells
      let closestWellDist = Infinity;
      let appliedGravity = false;

      for (const well of this.gravityWells) {
        const dist = this.geodesicDistance(pos, well.pos, sphereRadius);

        if (dist < closestWellDist) {
          closestWellDist = dist;
        }

        // Only apply gravity within influence radius
        if (dist > well.radius) continue;

        appliedGravity = true;

        // Inverse-square gravity with distance falloff
        // Closer = stronger pull
        const proximityFactor = 1 - dist / well.radius; // 1 at center, 0 at edge
        const gravityStrength = well.strength * 5000000; // Scale factor for sphere (50x boost)

        // Force magnitude with inverse-square falloff (minimum distance to prevent explosion)
        const effectiveDist = Math.max(dist, 20);
        const forceMagnitude = (gravityStrength * proximityFactor) / (effectiveDist * effectiveDist);

        // Get tangent direction from player toward well
        const gravityDir = this.tangentToward(pos, well.pos);

        // Energy drain based on proximity (like flat-world GravitySystem)
        // Closer = stronger drain (simulates energy being pulled into the singularity)
        const drainRate = getConfig('OBSTACLE_ENERGY_DRAIN_RATE');
        const energyDrain = drainRate * proximityFactor * proximityFactor * deltaTime;
        if (energyDrain > 0) {
          const newEnergy = Math.max(0, energyComponent.current - energyDrain);
          setEnergy(world, entity, newEnergy);
        }

        // DEBUG: Gravity logging disabled for cleaner output
        // Uncomment to debug: console.log(`[GRAVITY] dist=${dist.toFixed(0)} proxFactor=${proximityFactor.toFixed(2)} force=${forceMagnitude.toFixed(1)}`);

        // Apply gravitational acceleration (tangent to sphere)
        velocityComponent.x += gravityDir.x * forceMagnitude * deltaTime;
        velocityComponent.y += gravityDir.y * forceMagnitude * deltaTime;
        velocityComponent.z = (velocityComponent.z ?? 0) + gravityDir.z * forceMagnitude * deltaTime;
      }

      // DEBUG: Gravity check logging disabled
      // Uncomment to debug: if (Math.random() < 0.01) console.log(`[GRAVITY-CHECK] closestWell=${closestWellDist.toFixed(0)} inRange=${appliedGravity}`);

      // Re-apply tangent constraint after gravity (keep on sphere surface)
      const postGravityTangent = makeTangent(pos, {
        x: velocityComponent.x,
        y: velocityComponent.y,
        z: velocityComponent.z ?? 0,
      });
      velocityComponent.x = postGravityTangent.x;
      velocityComponent.y = postGravityTangent.y;
      velocityComponent.z = postGravityTangent.z;

      // Update camera up based on velocity (momentum-locked feel)
      const postGravitySpeed = Math.sqrt(
        velocityComponent.x * velocityComponent.x +
          velocityComponent.y * velocityComponent.y +
          (velocityComponent.z ?? 0) * (velocityComponent.z ?? 0)
      );
      if (postGravitySpeed > 5) {
        camUp.x = velocityComponent.x / postGravitySpeed;
        camUp.y = velocityComponent.y / postGravitySpeed;
        camUp.z = (velocityComponent.z ?? 0) / postGravitySpeed;
      }

      // Skip if no movement
      const vz = velocityComponent.z ?? 0;
      if (velocityComponent.x === 0 && velocityComponent.y === 0 && vz === 0) {
        return;
      }

      // Calculate distance moved for energy cost
      const distanceMoved =
        Math.sqrt(
          velocityComponent.x * velocityComponent.x +
            velocityComponent.y * velocityComponent.y +
            vz * vz
        ) * deltaTime;

      // Update position in 3D
      positionComponent.x += velocityComponent.x * deltaTime;
      positionComponent.y += velocityComponent.y * deltaTime;
      positionComponent.z = (positionComponent.z ?? 0) + vz * deltaTime;

      // Project position back to sphere surface
      const projected = projectToSphere(
        {
          x: positionComponent.x,
          y: positionComponent.y,
          z: positionComponent.z ?? 0,
        },
        sphereRadius
      );
      positionComponent.x = projected.x;
      positionComponent.y = projected.y;
      positionComponent.z = projected.z;

      // Deduct movement energy
      if (energyComponent.current > 0) {
        energyComponent.current -= distanceMoved * GAME_CONFIG.MOVEMENT_ENERGY_COST;
        energyComponent.current = Math.max(0, energyComponent.current);
      }

      // Broadcast position update (include z for sphere mode)
      const moveMessage: PlayerMovedMessage = {
        type: 'playerMoved',
        playerId,
        position: {
          x: positionComponent.x,
          y: positionComponent.y,
          z: positionComponent.z,
        },
      };
      io.emit('playerMoved', moveMessage);
    });
  }

  /**
   * Clean up camera state when player disconnects
   */
  removePlayer(playerId: string): void {
    this.playerCameraUp.delete(playerId);
  }
}
