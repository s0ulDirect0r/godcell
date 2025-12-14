import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Components } from '#shared';
import type {
  Pseudopod,
  PseudopodSpawnedMessage,
  PseudopodStrikeMessage,
  StageComponent,
  EnergyComponent,
  DamageTrackingComponent,
  EntityId,
  PendingExpirationComponent,
  World,
  Position,
} from '#shared';
import { getConfig } from '../dev';
import { logger } from '../logger';
import {
  createPseudopod as ecsCreatePseudopod,
  getPlayerBySocketId,
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
  addEnergy,
  getDamageTracking,
  forEachPlayer,
  forEachSwarm,
  recordDamage,
} from '../ecs/factories';

// Type for hitscan collision check function (used in hitscan mode only)
type CheckBeamHitscan = (start: Position, end: Position, shooterId: string) => string | null;

/**
 * Fire pseudopod beam (Stage 2 Multi-Cell only)
 * Fires a damaging beam toward the target position
 * @returns true if pseudopod was fired successfully
 */
export function firePseudopod(
  world: World,
  io: Server,
  entity: EntityId,
  playerId: string,
  targetX: number,
  targetY: number,
  checkBeamHitscan: CheckBeamHitscan = () => null
): boolean {

  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const posComp = getPosition(world, entity);
  const stunnedComp = getStunned(world, entity);
  const player = getPlayerBySocketId(world, playerId);
  if (!energyComp || !stageComp || !posComp || !player) return false;

  // Stage 2 (Multi-Cell) only
  if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;
  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;
  if (energyComp.current < getConfig('PSEUDOPOD_ENERGY_COST')) return false;

  // Cooldown check
  const cooldowns = getCooldowns(world, entity);
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
  const playerRadius = stageComp.radius;
  const maxRange =
    GAME_CONFIG.PSEUDOPOD_MODE === 'strike'
      ? getConfig('PSEUDOPOD_RANGE')
      : playerRadius * getConfig('PSEUDOPOD_RANGE');

  // For strike mode, clamp target to max range
  if (GAME_CONFIG.PSEUDOPOD_MODE === 'strike' && targetDist > maxRange) {
    targetX = playerPosition.x + dirX * maxRange;
    targetY = playerPosition.y + dirY * maxRange;
  }

  // Deduct energy
  energyComp.current -= getConfig('PSEUDOPOD_ENERGY_COST');

  if (GAME_CONFIG.PSEUDOPOD_MODE === 'strike') {
    handleStrikeMode(world, io, entity, playerId, playerPosition, targetX, targetY, player.color);
  } else if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') {
    handleHitscanMode(
      world,
      io,
      checkBeamHitscan,
      entity,
      playerId,
      playerPosition,
      dirX,
      dirY,
      targetDist,
      maxRange,
      player.color,
      now
    );
  } else {
    handleProjectileMode(
      world,
      io,
      entity,
      playerId,
      playerPosition,
      dirX,
      dirY,
      maxRange,
      player.color,
      now
    );
  }

  // Update cooldown
  cooldowns.lastPseudopodTime = now;
  return true;
}

function handleStrikeMode(
  world: World,
  io: Server,
  entity: EntityId,
  playerId: string,
  playerPosition: { x: number; y: number },
  targetX: number,
  targetY: number,
  color: string
): void {
  const aoeRadius = getConfig('PSEUDOPOD_AOE_RADIUS');
  const drainPerHit = getConfig('PSEUDOPOD_DRAIN_RATE');
  const hitTargetIds: string[] = [];
  let totalDrained = 0;

  // Find all soup-stage entities within AoE radius
  forEachPlayer(world, (targetEntity, targetId) => {
    if (targetId === playerId) return;

    const targetStage = world.getComponent<StageComponent>(targetEntity, Components.Stage);
    const targetEnergy = world.getComponent<EnergyComponent>(targetEntity, Components.Energy);
    const targetPos = world.getComponent(targetEntity, Components.Position) as
      | { x: number; y: number }
      | undefined;
    if (!targetStage || !targetEnergy || !targetPos) return;

    if (
      targetStage.stage !== EvolutionStage.SINGLE_CELL &&
      targetStage.stage !== EvolutionStage.MULTI_CELL
    )
      return;
    if (targetEnergy.current <= 0) return;
    if (targetStage.isEvolving) return;

    const dx = targetPos.x - targetX;
    const dy = targetPos.y - targetY;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    if (distToTarget <= aoeRadius + targetStage.radius) {
      const actualDrain = Math.min(drainPerHit, targetEnergy.current);
      targetEnergy.current -= actualDrain;
      totalDrained += actualDrain;
      hitTargetIds.push(targetId);

      recordDamage(world, targetEntity, drainPerHit, 'beam');

      const targetDamageTracking = getDamageTracking(world, targetEntity);
      if (targetDamageTracking) {
        targetDamageTracking.pseudopodHitRate = drainPerHit;
        targetDamageTracking.pseudopodHitExpiresAt = Date.now() + 500;
      }

      logger.info({
        event: 'strike_hit_player',
        striker: playerId,
        target: targetId,
        damage: actualDrain,
        targetEnergyRemaining: targetEnergy.current.toFixed(0),
      });
    }
  });

  // Check swarms
  forEachSwarm(
    world,
    (swarmEntity, swarmId, swarmPosComp, _velComp, swarmComp, swarmEnergyComp) => {
      const dx = swarmPosComp.x - targetX;
      const dy = swarmPosComp.y - targetY;
      const distToSwarm = Math.sqrt(dx * dx + dy * dy);

      if (distToSwarm <= aoeRadius + swarmComp.size) {
        const actualDrain = Math.min(drainPerHit, swarmEnergyComp.current);
        swarmEnergyComp.current -= actualDrain;
        totalDrained += actualDrain;
        hitTargetIds.push(swarmId);

        const damageTracking = world.getComponent<DamageTrackingComponent>(
          swarmEntity,
          Components.DamageTracking
        );
        if (damageTracking) {
          damageTracking.lastDamageSource = 'beam';
          damageTracking.lastBeamShooter = playerId;
        }

        recordDamage(world, swarmEntity, actualDrain, 'beam');

        logger.info({
          event: 'strike_hit_swarm',
          striker: playerId,
          swarmId,
          damage: actualDrain,
          swarmEnergyRemaining: swarmEnergyComp.current.toFixed(0),
        });
      }
    }
  );

  // Give drained energy to the attacker
  if (totalDrained > 0) {
    addEnergy(world, entity, totalDrained);
    logger.info({
      event: 'strike_energy_absorbed',
      striker: playerId,
      energyGained: totalDrained,
      targetsHit: hitTargetIds.length,
    });
  }

  io.emit('pseudopodStrike', {
    type: 'pseudopodStrike',
    strikerId: playerId,
    strikerPosition: playerPosition,
    targetPosition: { x: targetX, y: targetY },
    aoeRadius,
    hitTargetIds,
    totalDrained,
    color,
  } as PseudopodStrikeMessage);

  logger.info({
    event: 'pseudopod_strike',
    playerId,
    targetPosition: { x: targetX.toFixed(0), y: targetY.toFixed(0) },
    targetsHit: hitTargetIds.length,
    totalDrained,
    isBot: playerId.startsWith('bot-'),
  });
}

function handleHitscanMode(
  world: World,
  io: Server,
  checkBeamHitscan: CheckBeamHitscan,
  entity: EntityId,
  playerId: string,
  playerPosition: { x: number; y: number },
  dirX: number,
  dirY: number,
  targetDist: number,
  maxRange: number,
  color: string,
  now: number
): void {
  const actualDist = Math.min(targetDist, maxRange);
  const endX = playerPosition.x + dirX * actualDist;
  const endY = playerPosition.y + dirY * actualDist;

  const hitTargetId = checkBeamHitscan(playerPosition, { x: endX, y: endY }, playerId);

  const pseudopod: Pseudopod = {
    id: `beam-${playerId}-${now}`,
    ownerId: playerId,
    position: { x: playerPosition.x, y: playerPosition.y },
    velocity: { x: endX, y: endY },
    width: GAME_CONFIG.PSEUDOPOD_WIDTH,
    maxDistance: actualDist,
    distanceTraveled: 0,
    createdAt: now,
    color,
  };

  const beamEntity = ecsCreatePseudopod(
    world,
    pseudopod.id,
    entity,
    playerId,
    pseudopod.position,
    pseudopod.velocity,
    pseudopod.width,
    pseudopod.maxDistance,
    pseudopod.color
  );

  // Add expiration - AbilityIntentSystem will destroy entity when time's up
  // Client handles entity disappearance via normal state updates (no event needed)
  world.addComponent<PendingExpirationComponent>(beamEntity, Components.PendingExpiration, {
    expiresAt: now + 500,
  });

  io.emit('pseudopodSpawned', {
    type: 'pseudopodSpawned',
    pseudopod,
  } as PseudopodSpawnedMessage);

  logger.info({
    event: 'pseudopod_fired',
    mode: 'hitscan',
    playerId,
    targetId: hitTargetId || 'miss',
    range: actualDist.toFixed(0),
    isBot: playerId.startsWith('bot-'),
  });
}

function handleProjectileMode(
  world: World,
  io: Server,
  entity: EntityId,
  playerId: string,
  playerPosition: { x: number; y: number },
  dirX: number,
  dirY: number,
  maxRange: number,
  color: string,
  now: number
): void {

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
    color,
  };

  ecsCreatePseudopod(
    world,
    pseudopod.id,
    entity,
    playerId,
    pseudopod.position,
    pseudopod.velocity,
    pseudopod.width,
    pseudopod.maxDistance,
    pseudopod.color
  );

  io.emit('pseudopodSpawned', {
    type: 'pseudopodSpawned',
    pseudopod,
  } as PseudopodSpawnedMessage);

  logger.info({
    event: 'pseudopod_fired',
    mode: 'projectile',
    playerId,
    direction: { x: dirX.toFixed(2), y: dirY.toFixed(2) },
    isBot: playerId.startsWith('bot-'),
  });
}

/**
 * Check if a player can fire pseudopod
 */
export function canFirePseudopod(world: World, entity: EntityId): boolean {
  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const stunnedComp = getStunned(world, entity);
  if (!energyComp || !stageComp) return false;

  if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;
  if (energyComp.current < getConfig('PSEUDOPOD_ENERGY_COST')) return false;
  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;

  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = cooldowns.lastPseudopodTime || 0;
  return now - lastUse >= getConfig('PSEUDOPOD_COOLDOWN');
}
