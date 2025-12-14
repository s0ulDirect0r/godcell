import { GAME_CONFIG, Components } from '#shared';
import type { Trap, TrapPlacedMessage, CombatSpecializationComponent, EntityId } from '#shared';
import { logger } from '../logger';
import { isJungleStage } from '../helpers/stages';
import {
  createTrap as ecsCreateTrap,
  countTrapsForPlayer,
  getPlayerBySocketId,
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
} from '../ecs/factories';
import type { AbilityContext } from './types';

/**
 * Place a trap (Stage 3 Traps specialization only)
 * Places a disguised mine at the player's current position
 * @returns true if trap was placed successfully
 */
export function placeTrap(ctx: AbilityContext, entity: EntityId, playerId: string): boolean {
  const { world } = ctx;

  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const posComp = getPosition(world, entity);
  const stunnedComp = getStunned(world, entity);
  const player = getPlayerBySocketId(world, playerId);

  if (!energyComp || !stageComp || !posComp || !player) {
    logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'missing_components' });
    return false;
  }

  // Stage 3+ only
  if (!isJungleStage(stageComp.stage)) {
    logger.debug({
      event: 'player_trap_place_denied',
      playerId,
      reason: 'wrong_stage',
      stage: stageComp.stage,
    });
    return false;
  }
  if (energyComp.current <= 0) {
    logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'no_energy' });
    return false;
  }
  if (stageComp.isEvolving) {
    logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'evolving' });
    return false;
  }

  // Check specialization - must be traps
  const specComp = world.getComponent<CombatSpecializationComponent>(
    entity,
    Components.CombatSpecialization
  );
  if (!specComp || specComp.specialization !== 'traps') {
    logger.debug({
      event: 'player_trap_place_denied',
      playerId,
      reason: 'wrong_specialization',
      hasSpec: !!specComp,
      spec: specComp?.specialization ?? 'none',
    });
    return false;
  }

  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) {
    logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'stunned' });
    return false;
  }
  if (energyComp.current < GAME_CONFIG.TRAP_ENERGY_COST) {
    logger.debug({
      event: 'player_trap_place_denied',
      playerId,
      reason: 'insufficient_energy',
      energy: energyComp.current,
      cost: GAME_CONFIG.TRAP_ENERGY_COST,
    });
    return false;
  }

  // Cooldown check
  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) {
    logger.debug({
      event: 'player_trap_place_denied',
      playerId,
      reason: 'no_cooldowns_component',
    });
    return false;
  }
  const lastUse = cooldowns.lastTrapPlaceTime || 0;
  if (now - lastUse < GAME_CONFIG.TRAP_COOLDOWN) {
    logger.debug({
      event: 'player_trap_place_denied',
      playerId,
      reason: 'cooldown',
      remaining: GAME_CONFIG.TRAP_COOLDOWN - (now - lastUse),
    });
    return false;
  }

  // Check max active traps
  const activeTraps = countTrapsForPlayer(world, playerId);
  if (activeTraps >= GAME_CONFIG.TRAP_MAX_ACTIVE) {
    logger.debug({
      event: 'player_trap_place_denied',
      playerId,
      reason: 'max_active_reached',
      activeTraps,
      max: GAME_CONFIG.TRAP_MAX_ACTIVE,
    });
    return false;
  }

  // Deduct energy
  energyComp.current -= GAME_CONFIG.TRAP_ENERGY_COST;

  const trapPosition = { x: posComp.x, y: posComp.y };
  const trapId = `trap-${playerId}-${now}`;

  // Create trap via ECS factory
  ecsCreateTrap(world, trapId, entity, playerId, trapPosition, player.color);

  // Update cooldown
  cooldowns.lastTrapPlaceTime = now;

  // Broadcast to clients
  const trap: Trap = {
    id: trapId,
    ownerId: playerId,
    position: trapPosition,
    triggerRadius: GAME_CONFIG.TRAP_TRIGGER_RADIUS,
    damage: GAME_CONFIG.TRAP_DAMAGE,
    stunDuration: GAME_CONFIG.TRAP_STUN_DURATION,
    placedAt: now,
    lifetime: GAME_CONFIG.TRAP_LIFETIME,
    color: player.color,
  };
  ctx.io.emit('trapPlaced', {
    type: 'trapPlaced',
    trap,
  } as TrapPlacedMessage);

  logger.info({
    event: 'player_trap_placed',
    playerId,
    trapId,
    position: trapPosition,
    activeTraps: activeTraps + 1,
    energySpent: GAME_CONFIG.TRAP_ENERGY_COST,
    remainingEnergy: energyComp.current,
  });

  return true;
}

/**
 * Check if a player can place a trap (traps specialization and off cooldown)
 */
export function canPlaceTrap(ctx: AbilityContext, entity: EntityId, playerId: string): boolean {
  const { world } = ctx;
  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const stunnedComp = getStunned(world, entity);
  if (!energyComp || !stageComp) return false;

  if (!isJungleStage(stageComp.stage)) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;

  // Check specialization - must be traps
  const specComp = world.getComponent<CombatSpecializationComponent>(
    entity,
    Components.CombatSpecialization
  );
  if (!specComp || specComp.specialization !== 'traps') return false;

  if (energyComp.current < GAME_CONFIG.TRAP_ENERGY_COST) return false;
  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;

  // Check max active traps
  const activeTraps = countTrapsForPlayer(world, playerId);
  if (activeTraps >= GAME_CONFIG.TRAP_MAX_ACTIVE) return false;

  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = cooldowns.lastTrapPlaceTime || 0;
  return now - lastUse >= GAME_CONFIG.TRAP_COOLDOWN;
}
