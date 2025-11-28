import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Position,
  Pseudopod,
  EntropySwarm,
  EMPActivatedMessage,
  PseudopodSpawnedMessage,
  PseudopodRetractedMessage,
} from '@godcell/shared';
import type { Server } from 'socket.io';
import { getConfig } from './dev';
import { logger } from './logger';

// ============================================
// Ability System - Manages all player/bot abilities
// ============================================

/**
 * Game context required by the ability system.
 * Passed at construction to avoid circular dependencies.
 */
export interface AbilityContext {
  // Core game state
  players: Map<string, Player>;
  io: Server;

  // Pseudopod state
  pseudopods: Map<string, Pseudopod>;
  pseudopodHits: Map<string, Set<string>>;

  // Cooldown tracking
  playerEMPCooldowns: Map<string, number>;
  playerPseudopodCooldowns: Map<string, number>;

  // Functions from main module
  getSwarms: () => Map<string, EntropySwarm>;
  checkBeamHitscan: (start: Position, end: Position, shooterId: string) => string | null;
  applyDamageWithResistance: (player: Player, baseDamage: number) => number;
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
    const player = this.ctx.players.get(playerId);
    if (!player) return false;

    // Stage 2 (Multi-Cell) only - not available to other stages
    if (player.stage !== EvolutionStage.MULTI_CELL) return false;
    if (player.energy <= 0) return false;
    if (player.isEvolving) return false;
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) return false;
    if (player.energy < getConfig('EMP_ENERGY_COST')) return false;

    // Cooldown check
    const lastUse = this.ctx.playerEMPCooldowns.get(playerId) || 0;
    const now = Date.now();
    if (now - lastUse < getConfig('EMP_COOLDOWN')) return false;

    // Apply energy cost
    player.energy -= getConfig('EMP_ENERGY_COST');

    // Find affected entities within range
    const affectedSwarmIds: string[] = [];
    const affectedPlayerIds: string[] = [];

    // Check swarms
    for (const [swarmId, swarm] of this.ctx.getSwarms()) {
      const dist = this.distance(player.position, swarm.position);
      if (dist <= getConfig('EMP_RANGE')) {
        swarm.disabledUntil = now + getConfig('EMP_DISABLE_DURATION');
        swarm.energy = GAME_CONFIG.SWARM_ENERGY;
        affectedSwarmIds.push(swarmId);
      }
    }

    // Check other players
    for (const [otherPlayerId, otherPlayer] of this.ctx.players) {
      if (otherPlayerId === playerId) continue;
      if (otherPlayer.energy <= 0) continue;

      const dist = this.distance(player.position, otherPlayer.position);
      if (dist <= getConfig('EMP_RANGE')) {
        otherPlayer.stunnedUntil = now + getConfig('EMP_DISABLE_DURATION');

        // Multi-cells also lose energy when hit
        if (otherPlayer.stage === EvolutionStage.MULTI_CELL) {
          this.ctx.applyDamageWithResistance(otherPlayer, GAME_CONFIG.EMP_MULTI_CELL_ENERGY_DRAIN);
        }

        affectedPlayerIds.push(otherPlayerId);
      }
    }

    // Update cooldown
    this.ctx.playerEMPCooldowns.set(playerId, now);
    player.lastEMPTime = now;

    // Broadcast to clients
    this.ctx.io.emit('empActivated', {
      type: 'empActivated',
      playerId: playerId,
      position: player.position,
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
    const player = this.ctx.players.get(playerId);
    if (!player) return false;

    // Stage 2 (Multi-Cell) only - not available to other stages
    if (player.stage !== EvolutionStage.MULTI_CELL) return false;
    if (player.energy <= 0) return false;
    if (player.isEvolving) return false;
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) return false;
    if (player.energy < getConfig('PSEUDOPOD_ENERGY_COST')) return false;

    // Cooldown check
    const lastUse = this.ctx.playerPseudopodCooldowns.get(playerId) || 0;
    const now = Date.now();
    if (now - lastUse < getConfig('PSEUDOPOD_COOLDOWN')) return false;

    // Calculate direction to target
    const dx = targetX - player.position.x;
    const dy = targetY - player.position.y;
    const targetDist = Math.sqrt(dx * dx + dy * dy);

    if (targetDist < 1) return false;

    const dirX = dx / targetDist;
    const dirY = dy / targetDist;

    // Calculate max range
    const playerRadius = this.ctx.getPlayerRadius(player.stage);
    const maxRange = playerRadius * GAME_CONFIG.PSEUDOPOD_RANGE;

    // Deduct energy
    player.energy -= getConfig('PSEUDOPOD_ENERGY_COST');

    if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') {
      // HITSCAN MODE: Instant raycast
      const actualDist = Math.min(targetDist, maxRange);
      const endX = player.position.x + dirX * actualDist;
      const endY = player.position.y + dirY * actualDist;

      const hitTargetId = this.ctx.checkBeamHitscan(player.position, { x: endX, y: endY }, playerId);

      const pseudopod: Pseudopod = {
        id: `beam-${playerId}-${now}`,
        ownerId: playerId,
        position: { x: player.position.x, y: player.position.y },
        velocity: { x: endX, y: endY }, // End position for visual
        width: GAME_CONFIG.PSEUDOPOD_WIDTH,
        maxDistance: actualDist,
        distanceTraveled: 0,
        createdAt: now,
        color: player.color,
      };

      this.ctx.pseudopods.set(pseudopod.id, pseudopod);

      // Auto-remove after visual duration
      setTimeout(() => {
        this.ctx.pseudopods.delete(pseudopod.id);
        this.ctx.pseudopodHits.delete(pseudopod.id);
        this.ctx.io.emit('pseudopodRetracted', {
          type: 'pseudopodRetracted',
          pseudopodId: pseudopod.id,
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
        position: { x: player.position.x, y: player.position.y },
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

      this.ctx.pseudopods.set(pseudopod.id, pseudopod);
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

    this.ctx.playerPseudopodCooldowns.set(playerId, now);
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
    const player = this.ctx.players.get(playerId);
    if (!player) return false;
    if (player.stage !== EvolutionStage.MULTI_CELL) return false;
    if (player.energy <= 0) return false;
    if (player.isEvolving) return false;
    if (player.energy < getConfig('EMP_ENERGY_COST')) return false;
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) return false;

    const lastUse = this.ctx.playerEMPCooldowns.get(playerId) || 0;
    return Date.now() - lastUse >= getConfig('EMP_COOLDOWN');
  }

  /**
   * Check if a player can fire pseudopod (has the ability and it's off cooldown)
   */
  canFirePseudopod(playerId: string): boolean {
    const player = this.ctx.players.get(playerId);
    if (!player) return false;
    if (player.stage !== EvolutionStage.MULTI_CELL) return false;
    if (player.energy <= 0) return false;
    if (player.isEvolving) return false;
    if (player.energy < getConfig('PSEUDOPOD_ENERGY_COST')) return false;
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) return false;

    const lastUse = this.ctx.playerPseudopodCooldowns.get(playerId) || 0;
    return Date.now() - lastUse >= getConfig('PSEUDOPOD_COOLDOWN');
  }
}
