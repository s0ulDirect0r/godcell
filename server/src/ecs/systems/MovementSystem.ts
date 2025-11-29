// ============================================
// Movement System
// Handles player movement, velocity, and position updates
// ============================================

import { EvolutionStage, Tags, Components } from '@godcell/shared';
import type {
  PlayerMovedMessage,
  EnergyComponent,
  PositionComponent,
  StageComponent,
  StunnedComponent,
  VelocityComponent,
  InputComponent,
} from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { getConfig } from '../../dev';
import { getSocketIdByEntity, hasDrainTarget } from '../factories';

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

  update(ctx: GameContext): void {
    const {
      world,
      playerSprintState,
      tickData,
      deltaTime,
      io,
      getPlayerRadius,
      getWorldBoundsForStage,
    } = ctx;

    const slowedPlayerIds = tickData.slowedPlayerIds;

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

      // Normalize diagonal input for consistent acceleration
      const inputLength = Math.sqrt(inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y);
      const inputNormX = inputLength > 0 ? inputDirection.x / inputLength : 0;
      const inputNormY = inputLength > 0 ? inputDirection.y / inputLength : 0;

      // Base acceleration (8x speed for responsive controls)
      let acceleration = getConfig('PLAYER_SPEED') * 8;

      // Stage-specific acceleration modifiers
      if (stage === EvolutionStage.MULTI_CELL) {
        acceleration *= 0.8; // 20% slower than single-cells
      } else if (stage === EvolutionStage.CYBER_ORGANISM) {
        acceleration *= getConfig('CYBER_ORGANISM_ACCELERATION_MULT');
      }
      // TODO: HUMANOID and GODCELL acceleration

      // Swarm slow debuff
      if (slowedPlayerIds.has(playerId)) {
        acceleration *= getConfig('SWARM_SLOW_EFFECT');
      }

      // Contact drain slow debuff
      if (hasDrainTarget(world, playerId)) {
        acceleration *= 0.5;
      }

      // Apply input as acceleration
      velocityComponent.x += inputNormX * acceleration * deltaTime;
      velocityComponent.y += inputNormY * acceleration * deltaTime;

      // Calculate max speed
      const currentSpeed = Math.sqrt(velocityComponent.x * velocityComponent.x + velocityComponent.y * velocityComponent.y);
      let maxSpeed = getConfig('PLAYER_SPEED') * 1.2; // Allow 20% overspeed for gravity boost

      // Stage-specific max speed modifiers
      if (stage === EvolutionStage.MULTI_CELL) {
        maxSpeed *= 0.8;
      } else if (stage === EvolutionStage.CYBER_ORGANISM) {
        maxSpeed *= getConfig('CYBER_ORGANISM_MAX_SPEED_MULT');

        // Sprint boost (Stage 3+)
        const isSprinting = playerSprintState.get(playerId);
        if (isSprinting && energyComponent.current > energyComponent.max * 0.2) {
          maxSpeed *= getConfig('CYBER_ORGANISM_SPRINT_SPEED_MULT');
          // Deduct sprint energy cost - write to ECS component directly
          energyComponent.current -= getConfig('CYBER_ORGANISM_SPRINT_ENERGY_COST') * deltaTime;
        } else if (isSprinting) {
          // Auto-disable sprint when energy too low
          playerSprintState.set(playerId, false);
        }
      }
      // TODO: HUMANOID and GODCELL max speed

      // Apply slow effects to max speed cap
      if (slowedPlayerIds.has(playerId)) {
        maxSpeed *= getConfig('SWARM_SLOW_EFFECT');
      }
      if (hasDrainTarget(world, playerId)) {
        maxSpeed *= 0.5;
      }

      // Cap velocity
      if (currentSpeed > maxSpeed) {
        const scale = maxSpeed / currentSpeed;
        velocityComponent.x *= scale;
        velocityComponent.y *= scale;
      }

      // Skip if no movement
      if (velocityComponent.x === 0 && velocityComponent.y === 0) return;

      // Calculate distance for energy cost
      const distanceMoved = Math.sqrt(velocityComponent.x * velocityComponent.x + velocityComponent.y * velocityComponent.y) * deltaTime;

      // Update position - write to ECS component directly
      positionComponent.x += velocityComponent.x * deltaTime;
      positionComponent.y += velocityComponent.y * deltaTime;

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

      // Broadcast position update
      const moveMessage: PlayerMovedMessage = {
        type: 'playerMoved',
        playerId,
        position: { x: positionComponent.x, y: positionComponent.y },
      };
      io.emit('playerMoved', moveMessage);
    });
  }
}
