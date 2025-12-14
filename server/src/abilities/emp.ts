import type { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage, Components } from '#shared';
import type { EMPActivatedMessage, StunnedComponent, EntityId, World } from '#shared';
import { getConfig } from '../dev';
import { logger } from '../logger';
import {
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
  subtractEnergy,
  forEachPlayer,
  forEachSwarm,
} from '../ecs/factories';
import { distance } from '../helpers/math';

/**
 * Fire EMP ability (Stage 2 Multi-Cell only)
 * Disables nearby swarms and stuns nearby players
 * @returns true if EMP was fired successfully
 */
export function fireEMP(
  world: World,
  io: Server,
  entity: EntityId,
  playerId: string
): boolean {

  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const posComp = getPosition(world, entity);
  const stunnedComp = getStunned(world, entity);
  if (!energyComp || !stageComp || !posComp) return false;

  // Stage 2 (Multi-Cell) only
  if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;
  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;
  if (energyComp.current < getConfig('EMP_ENERGY_COST')) return false;

  // Cooldown check
  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = cooldowns.lastEMPTime || 0;
  if (now - lastUse < getConfig('EMP_COOLDOWN')) return false;

  // Apply energy cost
  subtractEnergy(world, entity, getConfig('EMP_ENERGY_COST'));

  const playerPosition = { x: posComp.x, y: posComp.y };

  // Find affected entities within range
  const affectedSwarmIds: string[] = [];
  const affectedPlayerIds: string[] = [];

  // Check swarms
  forEachSwarm(
    world,
    (_swarmEntity, swarmId, swarmPosComp, _velocityComp, swarmComp, _swarmEnergyComp) => {
      const swarmPosition = { x: swarmPosComp.x, y: swarmPosComp.y };
      const dist = distance(playerPosition, swarmPosition);
      if (dist <= getConfig('EMP_RANGE')) {
        swarmComp.disabledUntil = now + getConfig('EMP_DISABLE_DURATION');
        affectedSwarmIds.push(swarmId);
      }
    }
  );

  // Check other players
  forEachPlayer(world, (otherEntity, otherPlayerId) => {
    if (otherPlayerId === playerId) return;

    const otherEnergy = getEnergy(world, otherEntity);
    const otherStage = getStage(world, otherEntity);
    const otherPos = getPosition(world, otherEntity);
    const otherStunned = getStunned(world, otherEntity);
    if (!otherEnergy || !otherStage || !otherPos) return;
    if (otherEnergy.current <= 0) return;

    const dist = distance(playerPosition, { x: otherPos.x, y: otherPos.y });
    if (dist <= getConfig('EMP_RANGE')) {
      // Single-cells get 50% stun duration
      const stunDuration =
        otherStage.stage === EvolutionStage.SINGLE_CELL
          ? getConfig('EMP_DISABLE_DURATION') * 0.5
          : getConfig('EMP_DISABLE_DURATION');

      if (otherStunned) {
        otherStunned.until = now + stunDuration;
      } else {
        world.addComponent<StunnedComponent>(otherEntity, Components.Stunned, {
          until: now + stunDuration,
        });
      }

      // Multi-cells also lose energy when hit
      if (otherStage.stage === EvolutionStage.MULTI_CELL) {
        subtractEnergy(world, otherEntity, GAME_CONFIG.EMP_MULTI_CELL_ENERGY_DRAIN);
      }

      affectedPlayerIds.push(otherPlayerId);
    }
  });

  // Update cooldown
  cooldowns.lastEMPTime = now;

  // Broadcast to clients
  const empMessage: EMPActivatedMessage = {
    type: 'empActivated',
    playerId,
    position: playerPosition,
    affectedSwarmIds,
    affectedPlayerIds,
  };
  io.emit('empActivated', empMessage);

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
 * Check if a player can use EMP (has the ability and it's off cooldown)
 */
export function canFireEMP(world: World, entity: EntityId): boolean {
  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const stunnedComp = getStunned(world, entity);
  if (!energyComp || !stageComp) return false;

  if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;
  if (energyComp.current < getConfig('EMP_ENERGY_COST')) return false;
  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;

  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = cooldowns.lastEMPTime || 0;
  return now - lastUse >= getConfig('EMP_COOLDOWN');
}
