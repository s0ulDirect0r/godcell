import { GAME_CONFIG, Components } from '#shared';
import type {
  MeleeAttackType,
  MeleeAttackExecutedMessage,
  CombatSpecializationComponent,
  KnockbackComponent,
  EntityId,
} from '#shared';
import { logger } from '../logger';
import { isJungleStage } from '../helpers/stages';
import {
  getPlayerBySocketId,
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
  addEnergy,
  setMaxEnergy,
  forEachPlayer,
  forEachCyberBug,
  forEachJungleCreature,
  destroyEntity,
} from '../ecs/factories';
import type { AbilityContext } from './types';
import { distance } from '../helpers/math';

/**
 * Fire melee attack (Stage 3 Melee specialization only)
 * Performs an arc-based instant hit check with knockback
 * @param attackType 'swipe' (90°) or 'thrust' (30°)
 * @returns true if attack was executed successfully
 */
export function fireMeleeAttack(
  ctx: AbilityContext,
  entity: EntityId,
  playerId: string,
  attackType: MeleeAttackType,
  targetX: number,
  targetY: number
): boolean {
  const { world } = ctx;

  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const posComp = getPosition(world, entity);
  const stunnedComp = getStunned(world, entity);
  const player = getPlayerBySocketId(world, playerId);

  if (!energyComp || !stageComp || !posComp || !player) return false;

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
  const lastUse = isSwipe
    ? cooldowns.lastMeleeSwipeTime || 0
    : cooldowns.lastMeleeThrustTime || 0;
  if (now - lastUse < cooldown) return false;

  // Deduct energy
  energyComp.current -= energyCost;

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

    // Check if within range (min 200px to match visual, max = range + target size)
    if (dist < 200 || dist > range + targetRadius) return;

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

      // Apply damage
      targetEnergy.current -= damage;

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

  // Check CyberBugs (one-shot kills, award energy)
  const bugsToKill: {
    entity: number;
    id: string;
    pos: { x: number; y: number };
    value: number;
    capacityIncrease: number;
  }[] = [];
  forEachCyberBug(world, (bugEntity, bugId, bugPos, bugComp) => {
    const bugPosition = { x: bugPos.x, y: bugPos.y };
    const dist = distance(playerPosition, bugPosition);

    if (dist < 200 || dist > range + bugComp.size) return;

    const toTargetAngle = Math.atan2(bugPos.y - playerPosition.y, bugPos.x - playerPosition.x);
    let angleDiff = Math.abs(toTargetAngle - attackAngle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    if (angleDiff <= halfArcRad) {
      bugsToKill.push({
        entity: bugEntity,
        id: bugId,
        pos: bugPosition,
        value: bugComp.value,
        capacityIncrease: bugComp.capacityIncrease,
      });
    }
  });

  // Process bug kills
  for (const bug of bugsToKill) {
    addEnergy(world, entity, bug.value);
    const attackerEnergy = getEnergy(world, entity);
    if (attackerEnergy) {
      setMaxEnergy(world, entity, attackerEnergy.max + bug.capacityIncrease);
    }

    ctx.io.emit('cyberBugKilled', {
      type: 'cyberBugKilled',
      bugId: bug.id,
      killerId: playerId,
      position: bug.pos,
      energyGained: bug.value,
      capacityGained: bug.capacityIncrease,
    });

    killedBugIds.push(bug.id);
    destroyEntity(world, bug.entity);

    logger.info({
      event: 'melee_kill_bug',
      attacker: playerId,
      bugId: bug.id,
      attackType,
      energyGained: bug.value,
      capacityGained: bug.capacityIncrease,
    });
  }

  // Check JungleCreatures (one-shot kills, award energy)
  const creaturesToKill: {
    entity: number;
    id: string;
    pos: { x: number; y: number };
    value: number;
    capacityIncrease: number;
    variant: string;
  }[] = [];
  forEachJungleCreature(world, (creatureEntity, creatureId, creaturePos, creatureComp) => {
    const creaturePosition = { x: creaturePos.x, y: creaturePos.y };
    const dist = distance(playerPosition, creaturePosition);

    if (dist < 200 || dist > range + creatureComp.size) return;

    const toTargetAngle = Math.atan2(
      creaturePos.y - playerPosition.y,
      creaturePos.x - playerPosition.x
    );
    let angleDiff = Math.abs(toTargetAngle - attackAngle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    if (angleDiff <= halfArcRad) {
      creaturesToKill.push({
        entity: creatureEntity,
        id: creatureId,
        pos: creaturePosition,
        value: creatureComp.value,
        capacityIncrease: creatureComp.capacityIncrease,
        variant: creatureComp.variant,
      });
    }
  });

  // Process creature kills
  for (const creature of creaturesToKill) {
    addEnergy(world, entity, creature.value);
    const attackerEnergy2 = getEnergy(world, entity);
    if (attackerEnergy2) {
      setMaxEnergy(world, entity, attackerEnergy2.max + creature.capacityIncrease);
    }

    ctx.io.emit('jungleCreatureKilled', {
      type: 'jungleCreatureKilled',
      creatureId: creature.id,
      killerId: playerId,
      position: creature.pos,
      energyGained: creature.value,
      capacityGained: creature.capacityIncrease,
    });

    killedCreatureIds.push(creature.id);
    destroyEntity(world, creature.entity);

    logger.info({
      event: 'melee_kill_creature',
      attacker: playerId,
      creatureId: creature.id,
      variant: creature.variant,
      attackType,
      energyGained: creature.value,
      capacityGained: creature.capacityIncrease,
    });
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
  ctx.io.emit('meleeAttackExecuted', attackMessage);

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
