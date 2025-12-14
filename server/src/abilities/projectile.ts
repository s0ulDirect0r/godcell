import { GAME_CONFIG, Components } from '#shared';
import type {
  Projectile,
  ProjectileSpawnedMessage,
  CombatSpecializationComponent,
  EntityId,
} from '#shared';
import { logger } from '../logger';
import { isJungleStage } from '../helpers/stages';
import {
  createProjectile as ecsCreateProjectile,
  getPlayerBySocketId,
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
} from '../ecs/factories';
import type { AbilityContext } from './types';

/**
 * Fire projectile (Stage 3 Ranged specialization only)
 * Fires a hunting projectile toward jungle fauna and other players
 * @returns true if projectile was fired successfully
 */
export function fireProjectile(
  ctx: AbilityContext,
  entity: EntityId,
  playerId: string,
  targetX: number,
  targetY: number
): boolean {
  const { world } = ctx;

  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const posComp = getPosition(world, entity);
  const stunnedComp = getStunned(world, entity);
  const player = getPlayerBySocketId(world, playerId);

  logger.debug({
    event: 'projectile_attempt',
    playerId,
    targetX,
    targetY,
    hasEnergy: !!energyComp,
    hasStage: !!stageComp,
    hasPos: !!posComp,
    hasPlayer: !!player,
    stage: stageComp?.stage,
    isJungle: stageComp ? isJungleStage(stageComp.stage) : false,
    energy: energyComp?.current,
  });

  if (!energyComp || !stageComp || !posComp || !player) return false;

  // Stage 3+ only
  if (!isJungleStage(stageComp.stage)) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;

  // Check specialization - must be ranged
  const specComp = world.getComponent<CombatSpecializationComponent>(
    entity,
    Components.CombatSpecialization
  );
  if (!specComp || specComp.specialization !== 'ranged') return false;

  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;
  if (energyComp.current < GAME_CONFIG.PROJECTILE_ENERGY_COST) return false;

  // Cooldown check
  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = cooldowns.lastOrganismProjectileTime || 0;
  if (now - lastUse < GAME_CONFIG.PROJECTILE_COOLDOWN) return false;

  const playerPosition = { x: posComp.x, y: posComp.y };
  const targetPosition = { x: targetX, y: targetY };

  // Deduct energy
  energyComp.current -= GAME_CONFIG.PROJECTILE_ENERGY_COST;

  const projectileId = `proj-${playerId}-${now}`;

  ecsCreateProjectile(
    world,
    projectileId,
    entity,
    playerId,
    playerPosition,
    targetPosition,
    player.color
  );

  // Update cooldown
  cooldowns.lastOrganismProjectileTime = now;

  // Broadcast to clients
  const projectile: Projectile = {
    id: projectileId,
    ownerId: playerId,
    position: playerPosition,
    targetPosition,
    state: 'traveling',
    color: player.color,
  };
  ctx.io.emit('projectileSpawned', {
    type: 'projectileSpawned',
    projectile,
  } as ProjectileSpawnedMessage);

  logger.info({
    event: 'projectile_fired',
    playerId,
    targetX,
    targetY,
    energySpent: GAME_CONFIG.PROJECTILE_ENERGY_COST,
  });

  return true;
}

/**
 * Check if a player can fire projectile (ranged specialization and off cooldown)
 */
export function canFireProjectile(ctx: AbilityContext, entity: EntityId): boolean {
  const { world } = ctx;
  const energyComp = getEnergy(world, entity);
  const stageComp = getStage(world, entity);
  const stunnedComp = getStunned(world, entity);
  if (!energyComp || !stageComp) return false;

  if (!isJungleStage(stageComp.stage)) return false;
  if (energyComp.current <= 0) return false;
  if (stageComp.isEvolving) return false;

  // Check specialization - must be ranged
  const specComp = world.getComponent<CombatSpecializationComponent>(
    entity,
    Components.CombatSpecialization
  );
  if (!specComp || specComp.specialization !== 'ranged') return false;

  if (energyComp.current < GAME_CONFIG.PROJECTILE_ENERGY_COST) return false;
  const now = Date.now();
  if (stunnedComp?.until && now < stunnedComp.until) return false;

  const cooldowns = getCooldowns(world, entity);
  if (!cooldowns) return false;
  const lastUse = cooldowns.lastOrganismProjectileTime || 0;
  return now - lastUse >= GAME_CONFIG.PROJECTILE_COOLDOWN;
}
