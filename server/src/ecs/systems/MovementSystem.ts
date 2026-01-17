// ============================================
// Movement System
// Handles player movement on a spherical world surface
// ============================================

import type { Server } from 'socket.io';
import {
  Tags,
  Components,
  type World,
  GAME_CONFIG,
  EvolutionStage,
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
 * MovementSystem - Handles player movement on sphere surface
 *
 * Key behaviors:
 * - Input is transformed from 2D screen space to 3D tangent direction
 * - Velocity is kept tangent to sphere surface
 * - Position is projected back to sphere after movement
 * - Sphere wraps naturally (no bounds clamping)
 *
 * NOTE: Gravity is handled by GravitySystem (which is sphere-aware)
 */
export class MovementSystem implements System {
  readonly name = 'MovementSystem';

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
      const stageComp = requireStage(world, entity);

      // Skip Stage 5 Godcells - handled by GodcellFlightSystem
      if (stageComp.stage === EvolutionStage.GODCELL) return;

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

      // Get camera up for input transformation
      // Bots use stable geographic reference (getCameraUp) so their AI steering works correctly
      // Human players use momentum-locked cameraUp for smoother control feel
      const isBot = playerId.startsWith('bot-');
      let camUp: Vec3;

      if (isBot) {
        // Bots: always use stable geographic reference frame
        // This matches what steerTowardsSphere() uses to compute input
        camUp = getCameraUp(pos);
      } else {
        // Human players: momentum-locked camera for smoother feel
        let storedCamUp = this.playerCameraUp.get(playerId);
        if (!storedCamUp) {
          storedCamUp = getCameraUp(pos);
          this.playerCameraUp.set(playerId, storedCamUp);
        }
        camUp = storedCamUp;
      }

      // Surface-attached: tangent movement only
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

      // Update camera up based on velocity (momentum-locked feel) - human players only
      // Bots use stable geographic reference, so skip this for them
      const speed = Math.sqrt(
        velocityComponent.x * velocityComponent.x +
          velocityComponent.y * velocityComponent.y +
          (velocityComponent.z ?? 0) * (velocityComponent.z ?? 0)
      );
      if (!isBot && speed > 5) {
        const storedCamUp = this.playerCameraUp.get(playerId);
        if (storedCamUp) {
          storedCamUp.x = velocityComponent.x / speed;
          storedCamUp.y = velocityComponent.y / speed;
          storedCamUp.z = (velocityComponent.z ?? 0) / speed;
        }
      }

      // Zero out tiny residual velocities to prevent jitter
      // Exponential friction decay never reaches exactly zero, so we threshold it
      const VELOCITY_THRESHOLD = 2.0; // units/sec - below this, consider stopped

      if (speed < VELOCITY_THRESHOLD) {
        velocityComponent.x = 0;
        velocityComponent.y = 0;
        velocityComponent.z = 0;
        return;
      }

      // Calculate distance moved for energy cost
      const vz = velocityComponent.z ?? 0;
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

      // Project position back to sphere surface (all stages 1-4 are surface-attached)
      const beforeMag = Math.sqrt(
        positionComponent.x * positionComponent.x +
          positionComponent.y * positionComponent.y +
          (positionComponent.z ?? 0) * (positionComponent.z ?? 0)
      );
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

      // DEBUG: Log sphere projection for cyber-organism (once per ~60 frames)
      if (stageComp.stage === EvolutionStage.CYBER_ORGANISM && Math.random() < 0.017) {
        const afterMag = Math.sqrt(
          projected.x * projected.x + projected.y * projected.y + projected.z * projected.z
        );
        console.log(
          `[MovementSystem DEBUG] stage=${stageComp.stage} sphereRadius=${sphereRadius} ` +
            `beforeMag=${beforeMag.toFixed(1)} afterMag=${afterMag.toFixed(1)} ` +
            `expected=${GAME_CONFIG.JUNGLE_SPHERE_RADIUS} ` +
            `MISMATCH=${Math.abs(afterMag - GAME_CONFIG.JUNGLE_SPHERE_RADIUS) > 10 ? 'YES!' : 'no'}`
        );
      }

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
        serverTime: Date.now(),
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
