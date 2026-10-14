import { faunaTargets, damageFauna, blockedByTree } from './fauna';
import type { Server } from 'socket.io';
import { GAME_CONFIG, Components } from '#shared';
import type {
  MeleeAttackType,
  MeleeAttackExecutedMessage,
  CombatSpecializationComponent,
  KnockbackComponent,
  EntityId,
  World,
} from '#shared';
import { logger } from '../logger';
import { isJungleStage } from '../helpers/stages';
import {
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
  subtractEnergy,
  forEachPlayer,
} from '../ecs/factories';
import { distance } from '../helpers/math';

/**
 * Fire melee attack (Stage 3 Melee specialization only)
 * Performs an arc-based instant hit check with knockback
 * @param attackType 'swipe' (90°) or 'thrust' (30°)
 * @returns true if attack was executed successfully
 */
export function fireMeleeAttack(
  world: World,
  io: Server,
  entity: EntityId,
  playerId: string,
  attackType: MeleeAttackType,
  targetX: number,
  targetY: number
): boolean {
  // Validate target coordinates
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const posComp = getPosition(world, entity);
  const stunnedComp = getStunned(world, entity);

  if (!energyComp || !stageComp || !posComp) return false;

  // Stage 3+ only
  if (!isJungleStage(stageComp.stage)) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;

  // Check specialization - must be melee
  const specComp = world.getComponent<CombatSpecializationComponent>(
    entity,
    Components.CombatSpecialization
  );
  if (!specComp || specComp.specialization !== 'melee') return false;

  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;

  // Get attack parameters based on type
  const isSwipe = attackType === 'swipe';
  const energyCost = isSwipe
    ? GAME_CONFIG.MELEE_SWIPE_ENERGY_COST
    : GAME_CONFIG.MELEE_THRUST_ENERGY_COST;
  const cooldown = isSwipe ? GAME_CONFIG.MELEE_SWIPE_COOLDOWN : GAME_CONFIG.MELEE_THRUST_COOLDOWN;
  const range = isSwipe ? GAME_CONFIG.MELEE_SWIPE_RANGE : GAME_CONFIG.MELEE_THRUST_RANGE;
  const arc = isSwipe ? GAME_CONFIG.MELEE_SWIPE_ARC : GAME_CONFIG.MELEE_THRUST_ARC;
  const damage = isSwipe ? GAME_CONFIG.MELEE_SWIPE_DAMAGE : GAME_CONFIG.MELEE_THRUST_DAMAGE;
  const knockback = isSwipe
    ? GAME_CONFIG.MELEE_SWIPE_KNOCKBACK
    : GAME_CONFIG.MELEE_THRUST_KNOCKBACK;

  if (energyComp.current < energyCost) return false;

  // Cooldown check
  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = isSwipe ? cooldowns.lastMeleeSwipeTime || 0 : cooldowns.lastMeleeThrustTime || 0;
  if (now - lastUse < cooldown) return false;

  // Deduct energy (subtractEnergy clamps to 0)
  subtractEnergy(world, entity, energyCost);

  const playerPosition = { x: posComp.x, y: posComp.y };

  // Calculate attack direction from player toward target
  const dx = targetX - playerPosition.x;
  const dy = targetY - playerPosition.y;
  const attackAngle = Math.atan2(dy, dx);
  const halfArcRad = (arc / 2) * (Math.PI / 180);

  // Find all entities within range and arc
  const hitPlayerIds: string[] = [];
  const hitEntities: number[] = [];
  const killedBugIds: string[] = [];
  const killedCreatureIds: string[] = [];

  // Check players
  forEachPlayer(world, (targetEntity, targetPlayerId) => {
    if (targetPlayerId === playerId) return;

    const targetEnergy = getEnergy(world, targetEntity);
    const targetStage = getStage(world, targetEntity);
    const targetPos = getPosition(world, targetEntity);
    if (!targetEnergy || !targetStage || !targetPos) return;
    if (targetEnergy.current <= 0) return;

    // Only hit jungle-scale players (Stage 3+)
    if (!isJungleStage(targetStage.stage)) return;

    const targetPosition = { x: targetPos.x, y: targetPos.y };
    const dist = distance(playerPosition, targetPosition);

    // Get target's collision radius
    const targetRadius = targetStage.radius;

    // Check if within range
    if (dist > range + targetRadius || blockedByTree(world, playerPosition, targetPosition)) return;

    // Check if within arc
    const toTargetAngle = Math.atan2(
      targetPos.y - playerPosition.y,
      targetPos.x - playerPosition.x
    );
    let angleDiff = Math.abs(toTargetAngle - attackAngle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    if (angleDiff <= halfArcRad) {
      hitPlayerIds.push(targetPlayerId);
      hitEntities.push(targetEntity);

      // Apply damage (subtractEnergy clamps to 0)
      subtractEnergy(world, targetEntity, damage);

      // Apply knockback via KnockbackComponent
      const knockbackDir = Math.atan2(
        targetPos.y - playerPosition.y,
        targetPos.x - playerPosition.x
      );
      const knockbackForceX = Math.cos(knockbackDir) * knockback;
      const knockbackForceY = Math.sin(knockbackDir) * knockback;

      if (world.hasComponent(targetEntity, Components.Knockback)) {
        const kbComp = world.getComponent<KnockbackComponent>(targetEntity, Components.Knockback)!;
        kbComp.forceX += knockbackForceX;
        kbComp.forceY += knockbackForceY;
      } else {
        world.addComponent<KnockbackComponent>(targetEntity, Components.Knockback, {
          forceX: knockbackForceX,
          forceY: knockbackForceY,
          decayRate: GAME_CONFIG.MELEE_KNOCKBACK_DECAY_RATE,
        });
      }

      logger.info({
        event: 'melee_attack_hit',
        attacker: playerId,
        target: targetPlayerId,
        attackType,
        damage,
        knockback,
      });
    }
  });

  const struck = new Set<number>();
  for (const target of faunaTargets(world)) {
    if (struck.has(target.entity) || blockedByTree(world, playerPosition, target.position))
      continue;
    const dx = target.position.x - posComp.x;
    const dy = target.position.y - posComp.y;
    if (Math.hypot(dx, dy) > range + target.radius) continue;
    const diff = Math.atan2(
      Math.sin(Math.atan2(dy, dx) - attackAngle),
      Math.cos(Math.atan2(dy, dx) - attackAngle)
    );
    if (Math.abs(diff) > halfArcRad) continue;
    struck.add(target.entity);
    const killed = damageFauna(world, io, target.entity, playerId, damage);
    if (killed && target.type === 'cyberbug') killedBugIds.push(target.id);
    if (killed && target.type === 'creature') killedCreatureIds.push(target.id);
  }

  // Update cooldown
  if (isSwipe) {
    cooldowns.lastMeleeSwipeTime = now;
  } else {
    cooldowns.lastMeleeThrustTime = now;
  }

  // Broadcast attack to all clients
  const attackMessage: MeleeAttackExecutedMessage = {
    type: 'meleeAttackExecuted',
    playerId,
    attackType,
    position: playerPosition,
    direction: { x: Math.cos(attackAngle), y: Math.sin(attackAngle) },
    hitPlayerIds,
  };
  io.emit('meleeAttackExecuted', attackMessage);

  logger.info({
    event: 'melee_attack_executed',
    playerId,
    attackType,
    playerHits: hitPlayerIds.length,
    bugKills: killedBugIds.length,
    creatureKills: killedCreatureIds.length,
    energySpent: energyCost,
  });

  return true;
}

/**
 * Check if a player can fire melee attack (melee specialization and off cooldown)
 * Returns true if either swipe or thrust is available
 */
export function canFireMeleeAttack(world: World, entity: EntityId): boolean {
  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const stunnedComp = getStunned(world, entity);
  if (!energyComp || !stageComp) return false;

  if (!isJungleStage(stageComp.stage)) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;

  // Check specialization - must be melee
  const specComp = world.getComponent<CombatSpecializationComponent>(
    entity,
    Components.CombatSpecialization
  );
  if (!specComp || specComp.specialization !== 'melee') return false;

  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;

  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;

  // Check if either swipe or thrust is available
  const swipeReady =
    energyComp.current >= GAME_CONFIG.MELEE_SWIPE_ENERGY_COST &&
    now - (cooldowns.lastMeleeSwipeTime || 0) >= GAME_CONFIG.MELEE_SWIPE_COOLDOWN;
  const thrustReady =
    energyComp.current >= GAME_CONFIG.MELEE_THRUST_ENERGY_COST &&
    now - (cooldowns.lastMeleeThrustTime || 0) >= GAME_CONFIG.MELEE_THRUST_COOLDOWN;

  return swipeReady || thrustReady;
}
