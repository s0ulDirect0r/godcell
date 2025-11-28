// ============================================
// Movement System
// Handles player movement, velocity, and position updates
// ============================================

import { EvolutionStage } from '@godcell/shared';
import type { PlayerMovedMessage } from '@godcell/shared';
import type { System } from './types';
import type { GameContext } from './GameContext';
import { getConfig } from '../../dev';

/**
 * MovementSystem - Handles all player movement
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
      players,
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

    for (const [playerId, player] of players) {
      // Skip dead players
      if (player.energy <= 0) continue;

      // Stunned players can't move
      if (player.stunnedUntil && Date.now() < player.stunnedUntil) {
        const velocity = playerVelocities.get(playerId);
        if (velocity) {
          velocity.x = 0;
          velocity.y = 0;
        }
        continue;
      }

      const inputDirection = playerInputDirections.get(playerId);
      const velocity = playerVelocities.get(playerId);
      if (!inputDirection || !velocity) continue;

      // Normalize diagonal input for consistent acceleration
      const inputLength = Math.sqrt(inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y);
      const inputNormX = inputLength > 0 ? inputDirection.x / inputLength : 0;
      const inputNormY = inputLength > 0 ? inputDirection.y / inputLength : 0;

      // Base acceleration (8x speed for responsive controls)
      let acceleration = getConfig('PLAYER_SPEED') * 8;

      // Stage-specific acceleration modifiers
      if (player.stage === EvolutionStage.MULTI_CELL) {
        acceleration *= 0.8; // 20% slower than single-cells
      } else if (player.stage === EvolutionStage.CYBER_ORGANISM) {
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
      if (player.stage === EvolutionStage.MULTI_CELL) {
        maxSpeed *= 0.8;
      } else if (player.stage === EvolutionStage.CYBER_ORGANISM) {
        maxSpeed *= getConfig('CYBER_ORGANISM_MAX_SPEED_MULT');

        // Sprint boost (Stage 3+)
        const isSprinting = playerSprintState.get(playerId);
        if (isSprinting && player.energy > player.maxEnergy * 0.2) {
          maxSpeed *= getConfig('CYBER_ORGANISM_SPRINT_SPEED_MULT');
          player.energy -= getConfig('CYBER_ORGANISM_SPRINT_ENERGY_COST') * deltaTime;
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
      if (velocity.x === 0 && velocity.y === 0) continue;

      // Calculate distance for energy cost
      const distanceMoved = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) * deltaTime;

      // Update position
      player.position.x += velocity.x * deltaTime;
      player.position.y += velocity.y * deltaTime;

      // Deduct movement energy
      if (player.energy > 0) {
        player.energy -= distanceMoved * getConfig('MOVEMENT_ENERGY_COST');
        player.energy = Math.max(0, player.energy);
      }

      // Clamp to world bounds
      const playerRadius = getPlayerRadius(player.stage);
      const bounds = getWorldBoundsForStage(player.stage);
      player.position.x = Math.max(
        bounds.minX + playerRadius,
        Math.min(bounds.maxX - playerRadius, player.position.x)
      );
      player.position.y = Math.max(
        bounds.minY + playerRadius,
        Math.min(bounds.maxY - playerRadius, player.position.y)
      );

      // Broadcast position update
      const moveMessage: PlayerMovedMessage = {
        type: 'playerMoved',
        playerId,
        position: player.position,
      };
      io.emit('playerMoved', moveMessage);
    }
  }
}
