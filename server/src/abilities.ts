import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Position,
  Pseudopod, // Still needed for local pseudopod object creation
  EMPActivatedMessage,
  PseudopodSpawnedMessage,
  PseudopodRetractedMessage,
} from '@godcell/shared';
import type { Server } from 'socket.io';
import { getConfig } from './dev';
import { logger } from './logger';
import {
  createPseudopod as ecsCreatePseudopod,
  destroyEntity as ecsDestroyEntity,
  getEntityBySocketId,
  getEntityByStringId,
  getPlayerBySocketId,
  getEnergyBySocketId,
  getStageBySocketId,
  getPositionBySocketId,
  getStunnedBySocketId,
  getCooldownsBySocketId,
  forEachPlayer,
  forEachSwarm,
  subtractEnergyBySocketId,
  type World,
} from './ecs';

// ============================================
// Ability System - Manages all player/bot abilities
// ============================================

/**
 * Game context required by the ability system.
 * Passed at construction to avoid circular dependencies.
 */
export interface AbilityContext {
  // ECS World (source of truth for all player state)
  // Swarms are queried via forEachSwarm
  world: World;
  io: Server;

  // NOTE: Pseudopods migrated to ECS PseudopodComponent - see PseudopodSystem
  // NOTE: Cooldowns migrated to ECS CooldownsComponent
  // NOTE: Swarms migrated to ECS - use forEachSwarm

  // Functions from main module
  checkBeamHitscan: (start: Position, end: Position, shooterId: string) => string | null;
  getPlayerRadius: (stage: EvolutionStage) => number;
}

/**
 * AbilitySystem manages all active abilities in the game.
 *
 * Stage-ability mapping:
 * - Stage 1 (Single-Cell): No abilities
 * - Stage 2 (Multi-Cell): EMP, Pseudopod
 * - Stage 3 (Cyber-Organism): Sprint, Projectiles (future)
 * - Stage 4 (Humanoid): TBD
 * - Stage 5 (Godcell): TBD
 */
export class AbilitySystem {
  constructor(private ctx: AbilityContext) {}

  // ============================================
  // Stage 2: Multi-Cell Abilities
  // ============================================

  /**
   * Fire EMP ability (Stage 2 Multi-Cell only)
   * Disables nearby swarms and stuns nearby players
   * @returns true if EMP was fired successfully
   */
  fireEMP(playerId: string): boolean {
    const { world } = this.ctx;

    // Get player state from ECS
    const energyComp = getEnergyBySocketId(world, playerId);
    const stageComp = getStageBySocketId(world, playerId);
    const posComp = getPositionBySocketId(world, playerId);
    const stunnedComp = getStunnedBySocketId(world, playerId);
    if (!energyComp || !stageComp || !posComp) return false;

    // Stage 2 (Multi-Cell) only - not available to other stages
    if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;
    if (energyComp.current < getConfig('EMP_ENERGY_COST')) return false;

    // Cooldown check via ECS
    const cooldowns = getCooldownsBySocketId(world, playerId);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastEMPTime || 0;
    if (now - lastUse < getConfig('EMP_COOLDOWN')) return false;

    // Apply energy cost (directly to ECS)
    energyComp.current -= getConfig('EMP_ENERGY_COST');

    const playerPosition = { x: posComp.x, y: posComp.y };

    // Find affected entities within range
    const affectedSwarmIds: string[] = [];
    const affectedPlayerIds: string[] = [];

    // Check swarms (from ECS)
    forEachSwarm(world, (_swarmEntity, swarmId, swarmPosComp, _velocityComp, swarmComp, swarmEnergyComp) => {
      const swarmPosition = { x: swarmPosComp.x, y: swarmPosComp.y };
      const dist = this.distance(playerPosition, swarmPosition);
      if (dist <= getConfig('EMP_RANGE')) {
        // Disable swarm and reset energy via ECS components
        swarmComp.disabledUntil = now + getConfig('EMP_DISABLE_DURATION');
        swarmEnergyComp.current = swarmEnergyComp.max; // Reset to full health
        affectedSwarmIds.push(swarmId);
      }
    });

    // Check other players using ECS iteration
    forEachPlayer(world, (entity, otherPlayerId) => {
      if (otherPlayerId === playerId) return;

      const otherEnergy = getEnergyBySocketId(world, otherPlayerId);
      const otherStage = getStageBySocketId(world, otherPlayerId);
      const otherPos = getPositionBySocketId(world, otherPlayerId);
      const otherStunned = getStunnedBySocketId(world, otherPlayerId);
      if (!otherEnergy || !otherStage || !otherPos) return;
      if (otherEnergy.current <= 0) return;

      const dist = this.distance(playerPosition, { x: otherPos.x, y: otherPos.y });
      if (dist <= getConfig('EMP_RANGE')) {
        // Single-cells get 50% stun duration (they're more nimble)
        const stunDuration = otherStage.stage === EvolutionStage.SINGLE_CELL
          ? getConfig('EMP_DISABLE_DURATION') * 0.5
          : getConfig('EMP_DISABLE_DURATION');

        // Set stun via component (create if needed or update)
        if (otherStunned) {
          otherStunned.until = now + stunDuration;
        }
        // Note: If no stunned component, the shared ECS may need component creation
        // For now, stun tracking happens via the component if present

        // Multi-cells also lose energy when hit
        if (otherStage.stage === EvolutionStage.MULTI_CELL) {
          subtractEnergyBySocketId(world, otherPlayerId, GAME_CONFIG.EMP_MULTI_CELL_ENERGY_DRAIN);
        }

        affectedPlayerIds.push(otherPlayerId);
      }
    });

    // Update cooldown in ECS
    cooldowns.lastEMPTime = now;

    // Broadcast to clients
    this.ctx.io.emit('empActivated', {
      type: 'empActivated',
      playerId: playerId,
      position: playerPosition,
      affectedSwarmIds,
      affectedPlayerIds,
    } as EMPActivatedMessage);

    logger.info({
      event: 'emp_activated',
      playerId: playerId,
      swarmsHit: affectedSwarmIds.length,
      playersHit: affectedPlayerIds.length,
      energySpent: getConfig('EMP_ENERGY_COST'),
      isBot: playerId.startsWith('bot-'),
    });

    return true;
  }

  /**
   * Fire pseudopod beam (Stage 2 Multi-Cell only)
   * Fires a damaging beam toward the target position
   * @returns true if pseudopod was fired successfully
   */
  firePseudopod(playerId: string, targetX: number, targetY: number): boolean {
    const { world } = this.ctx;

    // Get player state from ECS
    const energyComp = getEnergyBySocketId(world, playerId);
    const stageComp = getStageBySocketId(world, playerId);
    const posComp = getPositionBySocketId(world, playerId);
    const stunnedComp = getStunnedBySocketId(world, playerId);
    const player = getPlayerBySocketId(world, playerId); // For color
    if (!energyComp || !stageComp || !posComp || !player) return false;

    // Stage 2 (Multi-Cell) only - not available to other stages
    if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;
    if (energyComp.current < getConfig('PSEUDOPOD_ENERGY_COST')) return false;

    // Cooldown check via ECS
    const cooldowns = getCooldownsBySocketId(world, playerId);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastPseudopodTime || 0;
    if (now - lastUse < getConfig('PSEUDOPOD_COOLDOWN')) return false;

    const playerPosition = { x: posComp.x, y: posComp.y };

    // Calculate direction to target
    const dx = targetX - playerPosition.x;
    const dy = targetY - playerPosition.y;
    const targetDist = Math.sqrt(dx * dx + dy * dy);

    if (targetDist < 1) return false;

    const dirX = dx / targetDist;
    const dirY = dy / targetDist;

    // Calculate max range
    const playerRadius = this.ctx.getPlayerRadius(stageComp.stage);
    const maxRange = playerRadius * GAME_CONFIG.PSEUDOPOD_RANGE;

    // Deduct energy (directly to ECS)
    energyComp.current -= getConfig('PSEUDOPOD_ENERGY_COST');

    if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') {
      // HITSCAN MODE: Instant raycast
      const actualDist = Math.min(targetDist, maxRange);
      const endX = playerPosition.x + dirX * actualDist;
      const endY = playerPosition.y + dirY * actualDist;

      const hitTargetId = this.ctx.checkBeamHitscan(playerPosition, { x: endX, y: endY }, playerId);

      const pseudopod: Pseudopod = {
        id: `beam-${playerId}-${now}`,
        ownerId: playerId,
        position: { x: playerPosition.x, y: playerPosition.y },
        velocity: { x: endX, y: endY }, // End position for visual
        width: GAME_CONFIG.PSEUDOPOD_WIDTH,
        maxDistance: actualDist,
        distanceTraveled: 0,
        createdAt: now,
        color: player.color,
      };

      // Add to ECS (sole source of truth for pseudopods)
      const ownerEntity = getEntityBySocketId(playerId);
      if (ownerEntity !== undefined) {
        ecsCreatePseudopod(
          world,
          pseudopod.id,
          ownerEntity,
          playerId,
          pseudopod.position,
          pseudopod.velocity,
          pseudopod.width,
          pseudopod.maxDistance,
          pseudopod.color
        );
      }

      // Auto-remove after visual duration
      const beamId = pseudopod.id;
      setTimeout(() => {
        const beamEntity = getEntityByStringId(beamId);
        if (beamEntity !== undefined) {
          ecsDestroyEntity(world, beamEntity);
        }
        this.ctx.io.emit('pseudopodRetracted', {
          type: 'pseudopodRetracted',
          pseudopodId: beamId,
        } as PseudopodRetractedMessage);
      }, 500);

      this.ctx.io.emit('pseudopodSpawned', {
        type: 'pseudopodSpawned',
        pseudopod,
      } as PseudopodSpawnedMessage);

      logger.info({
        event: 'pseudopod_fired',
        mode: 'hitscan',
        playerId: playerId,
        targetId: hitTargetId || 'miss',
        range: actualDist.toFixed(0),
        isBot: playerId.startsWith('bot-'),
      });
    } else {
      // PROJECTILE MODE: Traveling beam
      const pseudopod: Pseudopod = {
        id: `beam-${playerId}-${now}`,
        ownerId: playerId,
        position: { x: playerPosition.x, y: playerPosition.y },
        velocity: {
          x: dirX * getConfig('PSEUDOPOD_PROJECTILE_SPEED'),
          y: dirY * getConfig('PSEUDOPOD_PROJECTILE_SPEED'),
        },
        width: GAME_CONFIG.PSEUDOPOD_WIDTH,
        maxDistance: maxRange,
        distanceTraveled: 0,
        createdAt: now,
        color: player.color,
      };

      // Add to ECS (sole source of truth for pseudopods)
      const ownerEntity = getEntityBySocketId(playerId);
      if (ownerEntity !== undefined) {
        ecsCreatePseudopod(
          world,
          pseudopod.id,
          ownerEntity,
          playerId,
          pseudopod.position,
          pseudopod.velocity,
          pseudopod.width,
          pseudopod.maxDistance,
          pseudopod.color
        );
      }

      this.ctx.io.emit('pseudopodSpawned', {
        type: 'pseudopodSpawned',
        pseudopod,
      } as PseudopodSpawnedMessage);

      logger.info({
        event: 'pseudopod_fired',
        mode: 'projectile',
        playerId: playerId,
        direction: { x: dirX.toFixed(2), y: dirY.toFixed(2) },
        isBot: playerId.startsWith('bot-'),
      });
    }

    // Update cooldown in ECS
    cooldowns.lastPseudopodTime = now;
    return true;
  }

  // ============================================
  // Utility Methods
  // ============================================

  private distance(p1: Position, p2: Position): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ============================================
  // Stage Ability Queries (for UI/bot AI)
  // ============================================

  /**
   * Check if a player can use EMP (has the ability and it's off cooldown)
   */
  canFireEMP(playerId: string): boolean {
    const { world } = this.ctx;
    const energyComp = getEnergyBySocketId(world, playerId);
    const stageComp = getStageBySocketId(world, playerId);
    const stunnedComp = getStunnedBySocketId(world, playerId);
    if (!energyComp || !stageComp) return false;

    if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;
    if (energyComp.current < getConfig('EMP_ENERGY_COST')) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;

    const cooldowns = getCooldownsBySocketId(world, playerId);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastEMPTime || 0;
    return now - lastUse >= getConfig('EMP_COOLDOWN');
  }

  /**
   * Check if a player can fire pseudopod (has the ability and it's off cooldown)
   */
  canFirePseudopod(playerId: string): boolean {
    const { world } = this.ctx;
    const energyComp = getEnergyBySocketId(world, playerId);
    const stageComp = getStageBySocketId(world, playerId);
    const stunnedComp = getStunnedBySocketId(world, playerId);
    if (!energyComp || !stageComp) return false;

    if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;
    if (energyComp.current < getConfig('PSEUDOPOD_ENERGY_COST')) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;

    const cooldowns = getCooldownsBySocketId(world, playerId);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastPseudopodTime || 0;
    return now - lastUse >= getConfig('PSEUDOPOD_COOLDOWN');
  }
}
