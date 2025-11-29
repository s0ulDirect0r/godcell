// ============================================
// Movement System
// Handles player movement, velocity, and position updates
// ============================================

import { EvolutionStage, Tags, Components } from '@godcell/shared';
import type { PlayerMovedMessage, EnergyComponent, PositionComponent, StageComponent, StunnedComponent } from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { getConfig } from '../../dev';
import { getSocketIdByEntity } from '../factories';

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
      playerVelocities,
      playerInputDirections,
      playerSprintState,
      activeDrains,
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
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !posComp || !stageComp) return;

      // Skip dead players
      if (energyComp.current <= 0) return;

      // Stunned players can't move
      const stunnedComp = world.getComponent<StunnedComponent>(entity, Components.Stunned);
      if (stunnedComp?.until && Date.now() < stunnedComp.until) {
        const velocity = playerVelocities.get(playerId);
        if (velocity) {
          velocity.x = 0;
          velocity.y = 0;
        }
        return;
      }

      const inputDirection = playerInputDirections.get(playerId);
      const velocity = playerVelocities.get(playerId);
      if (!inputDirection || !velocity) return;

      const stage = stageComp.stage;

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
      if (activeDrains.has(playerId)) {
        acceleration *= 0.5;
      }

      // Apply input as acceleration
      velocity.x += inputNormX * acceleration * deltaTime;
      velocity.y += inputNormY * acceleration * deltaTime;

      // Calculate max speed
      const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
      let maxSpeed = getConfig('PLAYER_SPEED') * 1.2; // Allow 20% overspeed for gravity boost

      // Stage-specific max speed modifiers
      if (stage === EvolutionStage.MULTI_CELL) {
        maxSpeed *= 0.8;
      } else if (stage === EvolutionStage.CYBER_ORGANISM) {
        maxSpeed *= getConfig('CYBER_ORGANISM_MAX_SPEED_MULT');

        // Sprint boost (Stage 3+)
        const isSprinting = playerSprintState.get(playerId);
        if (isSprinting && energyComp.current > energyComp.max * 0.2) {
          maxSpeed *= getConfig('CYBER_ORGANISM_SPRINT_SPEED_MULT');
          // Deduct sprint energy cost - write to ECS component directly
          energyComp.current -= getConfig('CYBER_ORGANISM_SPRINT_ENERGY_COST') * deltaTime;
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
      if (activeDrains.has(playerId)) {
        maxSpeed *= 0.5;
      }

      // Cap velocity
      if (currentSpeed > maxSpeed) {
        const scale = maxSpeed / currentSpeed;
        velocity.x *= scale;
        velocity.y *= scale;
      }

      // Skip if no movement
      if (velocity.x === 0 && velocity.y === 0) return;

      // Calculate distance for energy cost
      const distanceMoved = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) * deltaTime;

      // Update position - write to ECS component directly
      posComp.x += velocity.x * deltaTime;
      posComp.y += velocity.y * deltaTime;

      // Deduct movement energy - write to ECS component directly
      if (energyComp.current > 0) {
        energyComp.current -= distanceMoved * getConfig('MOVEMENT_ENERGY_COST');
        energyComp.current = Math.max(0, energyComp.current);
      }

      // Clamp to world bounds - write to ECS component directly
      const playerRadius = getPlayerRadius(stage);
      const bounds = getWorldBoundsForStage(stage);
      posComp.x = Math.max(
        bounds.minX + playerRadius,
        Math.min(bounds.maxX - playerRadius, posComp.x)
      );
      posComp.y = Math.max(
        bounds.minY + playerRadius,
        Math.min(bounds.maxY - playerRadius, posComp.y)
      );

      // Broadcast position update
      const moveMessage: PlayerMovedMessage = {
        type: 'playerMoved',
        playerId,
        position: { x: posComp.x, y: posComp.y },
      };
      io.emit('playerMoved', moveMessage);
    });
  }
}
