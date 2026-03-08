import type { Server } from 'socket.io';
import { EvolutionStage, Components } from '#shared';
import type {
  PseudopodStrikeMessage,
  StageComponent,
  EnergyComponent,
  DamageTrackingComponent,
  EntityId,
  World,
} from '#shared';
import { getConfig } from '../dev';
import { logger } from '../logger';
import {
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

// Duration pseudopod visual effects persist (hit flash duration)
const PSEUDOPOD_VISUAL_DURATION_MS = 500;

/**
 * Fire pseudopod strike (Stage 2 Multi-Cell only)
 * Fires an instant AoE energy whip at the target position
 * @returns true if pseudopod was fired successfully
 */
export function firePseudopod(
  world: World,
  io: Server,
  entity: EntityId,
  playerId: string,
  targetX: number,
  targetY: number
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

  // Clamp target to max range
  const maxRange = getConfig('PSEUDOPOD_RANGE');
  if (targetDist > maxRange) {
    const dirX = dx / targetDist;
    const dirY = dy / targetDist;
    targetX = playerPosition.x + dirX * maxRange;
    targetY = playerPosition.y + dirY * maxRange;
  }

  // Deduct energy
  energyComp.current -= getConfig('PSEUDOPOD_ENERGY_COST');

  handleStrikeMode(world, io, entity, playerId, playerPosition, targetX, targetY, player.color);

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
        targetDamageTracking.pseudopodHitExpiresAt = Date.now() + PSEUDOPOD_VISUAL_DURATION_MS;
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
