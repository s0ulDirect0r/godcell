// ============================================
// Movement System
// Handles player movement, velocity, and position updates
// ============================================

import type { Server } from 'socket.io';
import { EvolutionStage, Tags, Components, type World } from '@godcell/shared';
import type {
  PlayerMovedMessage,
  EnergyComponent,
  PositionComponent,
  StageComponent,
  StunnedComponent,
  VelocityComponent,
  InputComponent,
  SprintComponent,
} from '@godcell/shared';
import type { System } from './types';
import { getConfig } from '../../dev';
import { getSocketIdByEntity, hasDrainTarget } from '../factories';
import { getPlayerRadius, getWorldBoundsForStage } from '../../helpers';

/**
 * MovementSystem - Handles all player movement
 *
 * Uses ECS components directly for all reads and writes.
 *
 * Responsibilities:
 * - Process player input into velocity
 * - Apply stage-specific speed modifiers
 * - Apply debuffs (swarm slow, drain slow)
 * - Handle sprinting (Stage 3+)
 * - Cap velocity to max speed
 * - Update positions
 * - Deduct movement energy cost
 * - Clamp to world bounds
 * - Broadcast position updates
 */
export class MovementSystem implements System {
  readonly name = 'MovementSystem';

  update(world: World, deltaTime: number, io: Server): void {

    // Iterate over all player entities in ECS
    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;

      // Get ECS components directly
      const energyComponent = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const positionComponent = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComponent = world.getComponent<StageComponent>(entity, Components.Stage);
      const velocityComponent = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const inputComponent = world.getComponent<InputComponent>(entity, Components.Input);
      if (!energyComponent || !positionComponent || !stageComponent || !velocityComponent || !inputComponent) return;

      // Skip dead players
      if (energyComponent.current <= 0) return;

      // Stunned players can't move
      const stunnedComponent = world.getComponent<StunnedComponent>(entity, Components.Stunned);
      if (stunnedComponent?.until && Date.now() < stunnedComponent.until) {
        velocityComponent.x = 0;
        velocityComponent.y = 0;
        return;
      }

      const inputDirection = inputComponent.direction;

      const stage = stageComponent.stage;

      // Get z input for Stage 5 (godcell) 3D movement
      const inputZ = stage === EvolutionStage.GODCELL ? (inputDirection.z ?? 0) : 0;

      // Normalize diagonal input for consistent acceleration
      // For Stage 5, normalize in 3D; for others, normalize in 2D
      const inputLengthXY = Math.sqrt(inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y);
      const inputLength3D = Math.sqrt(inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y + inputZ * inputZ);
      const inputLength = stage === EvolutionStage.GODCELL ? inputLength3D : inputLengthXY;
      const inputNormX = inputLength > 0 ? inputDirection.x / inputLength : 0;
      const inputNormY = inputLength > 0 ? inputDirection.y / inputLength : 0;
      const inputNormZ = inputLength > 0 ? inputZ / inputLength : 0;

      // Base acceleration (8x speed for responsive controls)
      let acceleration = getConfig('PLAYER_SPEED') * 8;

      // Stage-specific acceleration modifiers
      if (stage === EvolutionStage.MULTI_CELL) {
        acceleration *= 0.8; // 20% slower than single-cells
      } else if (stage === EvolutionStage.CYBER_ORGANISM) {
        acceleration *= getConfig('CYBER_ORGANISM_ACCELERATION_MULT');
      } else if (stage === EvolutionStage.HUMANOID) {
        acceleration *= getConfig('HUMANOID_ACCELERATION_MULT');
      } else if (stage === EvolutionStage.GODCELL) {
        acceleration *= getConfig('GODCELL_ACCELERATION_MULT');
      }

      // Swarm slow debuff - read from ECS tag set by SwarmCollisionSystem
      const isSlowed = world.hasTag(entity, Tags.SlowedThisTick);
      if (isSlowed) {
        acceleration *= getConfig('SWARM_SLOW_EFFECT');
      }

      // Contact drain slow debuff
      if (hasDrainTarget(world, playerId)) {
        acceleration *= 0.5;
      }

      // Apply input as acceleration
      velocityComponent.x += inputNormX * acceleration * deltaTime;
      velocityComponent.y += inputNormY * acceleration * deltaTime;

      // Apply z acceleration for Stage 5 (godcell) 3D flight
      if (stage === EvolutionStage.GODCELL) {
        const currentVZ = velocityComponent.z ?? 0;
        velocityComponent.z = currentVZ + inputNormZ * acceleration * deltaTime;
      }

      // Calculate max speed (2D for most stages, 3D for godcell)
      const vz = velocityComponent.z ?? 0;
      const currentSpeedXY = Math.sqrt(velocityComponent.x * velocityComponent.x + velocityComponent.y * velocityComponent.y);
      const currentSpeed3D = Math.sqrt(velocityComponent.x * velocityComponent.x + velocityComponent.y * velocityComponent.y + vz * vz);
      const currentSpeed = stage === EvolutionStage.GODCELL ? currentSpeed3D : currentSpeedXY;
      let maxSpeed = getConfig('PLAYER_SPEED') * 1.2; // Allow 20% overspeed for gravity boost

      // Stage-specific max speed modifiers
      if (stage === EvolutionStage.MULTI_CELL) {
        maxSpeed *= 0.8;
      } else if (stage === EvolutionStage.CYBER_ORGANISM) {
        maxSpeed *= getConfig('CYBER_ORGANISM_MAX_SPEED_MULT');

        // Sprint boost (Stage 3+) - read directly from ECS SprintComponent
        const sprintComponent = world.getComponent<SprintComponent>(entity, Components.Sprint);
        if (sprintComponent?.isSprinting && energyComponent.current > energyComponent.max * 0.2) {
          maxSpeed *= getConfig('CYBER_ORGANISM_SPRINT_SPEED_MULT');
          // Deduct sprint energy cost - write to ECS component directly
          energyComponent.current -= getConfig('CYBER_ORGANISM_SPRINT_ENERGY_COST') * deltaTime;
        } else if (sprintComponent?.isSprinting) {
          // Auto-disable sprint when energy too low - write to ECS component directly
          sprintComponent.isSprinting = false;
        }
      } else if (stage === EvolutionStage.HUMANOID) {
        maxSpeed *= getConfig('HUMANOID_MAX_SPEED_MULT');

        // Sprint boost for humanoid (Stage 4)
        const sprintComponent = world.getComponent<SprintComponent>(entity, Components.Sprint);
        if (sprintComponent?.isSprinting && energyComponent.current > energyComponent.max * 0.2) {
          maxSpeed *= getConfig('HUMANOID_SPRINT_SPEED_MULT');
          // Deduct sprint energy cost - write to ECS component directly
          energyComponent.current -= getConfig('HUMANOID_SPRINT_ENERGY_COST') * deltaTime;
        } else if (sprintComponent?.isSprinting) {
          // Auto-disable sprint when energy too low - write to ECS component directly
          sprintComponent.isSprinting = false;
        }
      } else if (stage === EvolutionStage.GODCELL) {
        maxSpeed *= getConfig('GODCELL_MAX_SPEED_MULT');
        // Note: Godcells don't use sprint - they have 3D flight instead
      }

      // Apply slow effects to max speed cap
      if (isSlowed) {
        maxSpeed *= getConfig('SWARM_SLOW_EFFECT');
      }
      if (hasDrainTarget(world, playerId)) {
        maxSpeed *= 0.5;
      }

      // Cap velocity (include z for godcell 3D movement)
      if (currentSpeed > maxSpeed) {
        const scale = maxSpeed / currentSpeed;
        velocityComponent.x *= scale;
        velocityComponent.y *= scale;
        if (stage === EvolutionStage.GODCELL) {
          velocityComponent.z = (velocityComponent.z ?? 0) * scale;
        }
      }

      // Apply friction (velocity decay) - stage-specific for different movement feels
      // Use exponential decay for smooth deceleration: v = v * friction^dt
      let friction: number;
      if (stage === EvolutionStage.CYBER_ORGANISM) {
        friction = getConfig('CYBER_ORGANISM_FRICTION'); // Quick stop (0.25)
      } else if (stage === EvolutionStage.HUMANOID) {
        friction = getConfig('HUMANOID_FRICTION'); // FPS-style tight control (0.35)
      } else if (stage === EvolutionStage.GODCELL) {
        friction = getConfig('GODCELL_FRICTION'); // 3D flight friction (0.4)
      } else {
        friction = getConfig('MOVEMENT_FRICTION'); // Soup friction (0.66) - floaty feel
      }

      const frictionFactor = Math.pow(friction, deltaTime);
      velocityComponent.x *= frictionFactor;
      velocityComponent.y *= frictionFactor;
      if (stage === EvolutionStage.GODCELL) {
        velocityComponent.z = (velocityComponent.z ?? 0) * frictionFactor;
      }

      // Skip if no movement (include z for godcell)
      const currentVZ = velocityComponent.z ?? 0;
      const hasMovement = stage === EvolutionStage.GODCELL
        ? (velocityComponent.x !== 0 || velocityComponent.y !== 0 || currentVZ !== 0)
        : (velocityComponent.x !== 0 || velocityComponent.y !== 0);
      if (!hasMovement) return;

      // Calculate distance for energy cost (3D for godcell)
      const distanceMovedXY = Math.sqrt(velocityComponent.x * velocityComponent.x + velocityComponent.y * velocityComponent.y) * deltaTime;
      const distanceMoved3D = Math.sqrt(velocityComponent.x * velocityComponent.x + velocityComponent.y * velocityComponent.y + currentVZ * currentVZ) * deltaTime;
      const distanceMoved = stage === EvolutionStage.GODCELL ? distanceMoved3D : distanceMovedXY;

      // Update position - write to ECS component directly
      positionComponent.x += velocityComponent.x * deltaTime;
      positionComponent.y += velocityComponent.y * deltaTime;

      // Update z position for Stage 5 (godcell) 3D flight
      if (stage === EvolutionStage.GODCELL) {
        const currentZ = positionComponent.z ?? 0;
        positionComponent.z = currentZ + currentVZ * deltaTime;
      }

      // Deduct movement energy - write to ECS component directly
      if (energyComponent.current > 0) {
        energyComponent.current -= distanceMoved * getConfig('MOVEMENT_ENERGY_COST');
        energyComponent.current = Math.max(0, energyComponent.current);
      }

      // Clamp to world bounds - write to ECS component directly
      const playerRadius = getPlayerRadius(stage);
      const bounds = getWorldBoundsForStage(stage);
      positionComponent.x = Math.max(
        bounds.minX + playerRadius,
        Math.min(bounds.maxX - playerRadius, positionComponent.x)
      );
      positionComponent.y = Math.max(
        bounds.minY + playerRadius,
        Math.min(bounds.maxY - playerRadius, positionComponent.y)
      );

      // Clamp z for Stage 5 (godcell) 3D flight
      if (stage === EvolutionStage.GODCELL && positionComponent.z !== undefined) {
        const zMin = getConfig('GODCELL_Z_MIN');
        const zMax = getConfig('GODCELL_Z_MAX');
        positionComponent.z = Math.max(zMin, Math.min(zMax, positionComponent.z));
      }

      // Broadcast position update (include z for godcell)
      const moveMessage: PlayerMovedMessage = {
        type: 'playerMoved',
        playerId,
        position: {
          x: positionComponent.x,
          y: positionComponent.y,
          ...(stage === EvolutionStage.GODCELL && positionComponent.z !== undefined
            ? { z: positionComponent.z }
            : {}),
        },
      };
      io.emit('playerMoved', moveMessage);
    });
  }
}
