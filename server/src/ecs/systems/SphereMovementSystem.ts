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
  type SphereContextComponent,
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
} from '../factories';
import { getConfig } from '../../dev';

/**
 * SphereMovementSystem - Handles player movement on sphere surface
 *
 * Key differences from flat MovementSystem:
 * - Input is transformed from 2D screen space to 3D tangent direction
 * - Velocity is kept tangent to sphere surface
 * - Position is projected back to sphere after movement
 * - No rectangular bounds clamping (sphere wraps naturally)
 *
 * NOTE: Gravity is handled by GravitySystem (which is now sphere-aware)
 */
export class SphereMovementSystem implements System {
  readonly name = 'SphereMovementSystem';

  // Store camera up per player (momentum-locked orientation)
  private playerCameraUp = new Map<string, Vec3>();

  update(world: World, deltaTime: number, io: Server): void {
    const baseAcceleration = GAME_CONFIG.PLAYER_SPEED * 8;
    const friction = GAME_CONFIG.MOVEMENT_FRICTION;
    const baseMaxSpeed = GAME_CONFIG.PLAYER_SPEED * 1.2;

    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;

      // Get ECS components
      const energyComponent = requireEnergy(world, entity);
      const positionComponent = requirePosition(world, entity);
      const velocityComponent = requireVelocity(world, entity);
      const inputComponent = requireInput(world, entity);

      // Get sphere context - determines which sphere surface this entity is on
      const sphereContext = world.getComponent<SphereContextComponent>(
        entity,
        Components.SphereContext
      );
      const sphereRadius = sphereContext?.surfaceRadius ?? GAME_CONFIG.SOUP_SPHERE_RADIUS;

      // Skip dead players
      if (energyComponent.current <= 0) return;

      // Swarm slow debuff - read from ECS tag set by SwarmCollisionSystem
      let acceleration = baseAcceleration;
      let maxSpeed = baseMaxSpeed;
      const isSlowed = world.hasTag(entity, Tags.SlowedThisTick);
      if (isSlowed) {
        acceleration *= getConfig('SWARM_SLOW_EFFECT');
        maxSpeed *= getConfig('SWARM_SLOW_EFFECT');
      }

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

      // NOTE: Gravity is handled by GravitySystem (sphere-aware)

      // Update camera up based on velocity (momentum-locked feel)
      const speed = Math.sqrt(
        velocityComponent.x * velocityComponent.x +
          velocityComponent.y * velocityComponent.y +
          (velocityComponent.z ?? 0) * (velocityComponent.z ?? 0)
      );
      if (speed > 5) {
        camUp.x = velocityComponent.x / speed;
        camUp.y = velocityComponent.y / speed;
        camUp.z = (velocityComponent.z ?? 0) / speed;
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
        velocity: {
          x: velocityComponent.x,
          y: velocityComponent.y,
          z: velocityComponent.z,
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
