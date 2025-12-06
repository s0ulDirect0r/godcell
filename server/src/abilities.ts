import { GAME_CONFIG, EvolutionStage, Components } from '@shared';
import type {
  Position,
  Pseudopod, // Still needed for local pseudopod object creation
  Projectile,
  Trap,
  MeleeAttackType,
  MeleeAttackExecutedMessage,
  EMPActivatedMessage,
  PseudopodSpawnedMessage,
  PseudopodRetractedMessage,
  PseudopodStrikeMessage,
  ProjectileSpawnedMessage,
  TrapPlacedMessage,
  CombatSpecializationComponent,
  KnockbackComponent,
  EnergyComponent,
  StageComponent,
  DamageTrackingComponent,
} from '@shared';
import type { Server } from 'socket.io';
import { getConfig } from './dev';
import { logger } from './logger';
import { isJungleStage } from './helpers/stages';
import type { EntityId } from '@shared';
import {
  createPseudopod as ecsCreatePseudopod,
  createProjectile,
  createTrap,
  countTrapsForPlayer,
  destroyEntity as ecsDestroyEntity,
  getEntityBySocketId,
  getEntityByStringId,
  getPlayerBySocketId,
  // Entity-based component helpers (game layer)
  getEnergy,
  getStage,
  getPosition,
  getStunned,
  getCooldowns,
  addEnergy,
  setMaxEnergy,
  subtractEnergy,
  getDamageTracking,
  forEachPlayer,
  forEachSwarm,
  forEachCyberBug,
  forEachJungleCreature,
  destroyEntity,
  recordDamage,
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

  // Functions from main module
  checkBeamHitscan: (start: Position, end: Position, shooterId: string) => string | null;
  // Note: getPlayerRadius removed - use stageComp.radius directly from ECS
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
  fireEMP(entity: EntityId, playerId: string): boolean {
    const { world } = this.ctx;

    // Get player state from ECS (entity-based)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const posComp = getPosition(world, entity);
    const stunnedComp = getStunned(world, entity);
    if (!energyComp || !stageComp || !posComp) return false;

    // Stage 2 (Multi-Cell) only - not available to other stages
    if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;
    if (energyComp.current < getConfig('EMP_ENERGY_COST')) return false;

    // Cooldown check via ECS (entity-based)
    const cooldowns = getCooldowns(world, entity);
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

    // Check other players using ECS iteration (entity-based)
    forEachPlayer(world, (otherEntity, otherPlayerId) => {
      if (otherPlayerId === playerId) return;

      const otherEnergy = getEnergy(world, otherEntity);
      const otherStage = getStage(world, otherEntity);
      const otherPos = getPosition(world, otherEntity);
      const otherStunned = getStunned(world, otherEntity);
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

        // Multi-cells also lose energy when hit (entity-based)
        if (otherStage.stage === EvolutionStage.MULTI_CELL) {
          subtractEnergy(world, otherEntity, GAME_CONFIG.EMP_MULTI_CELL_ENERGY_DRAIN);
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
  firePseudopod(entity: EntityId, playerId: string, targetX: number, targetY: number): boolean {
    const { world } = this.ctx;

    // Get player state from ECS (entity-based)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const posComp = getPosition(world, entity);
    const stunnedComp = getStunned(world, entity);
    const player = getPlayerBySocketId(world, playerId); // For color (still need socket lookup for legacy Player)
    if (!energyComp || !stageComp || !posComp || !player) return false;

    // Stage 2 (Multi-Cell) only - not available to other stages
    if (stageComp.stage !== EvolutionStage.MULTI_CELL) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;
    if (energyComp.current < getConfig('PSEUDOPOD_ENERGY_COST')) return false;

    // Cooldown check via ECS (entity-based)
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

    // Calculate max range (strike mode uses fixed range, legacy modes use radius multiplier)
    const playerRadius = stageComp.radius;
    const maxRange = GAME_CONFIG.PSEUDOPOD_MODE === 'strike'
      ? getConfig('PSEUDOPOD_RANGE')
      : playerRadius * getConfig('PSEUDOPOD_RANGE');

    // For strike mode, clamp target to max range (fire at max range in cursor direction)
    if (GAME_CONFIG.PSEUDOPOD_MODE === 'strike' && targetDist > maxRange) {
      targetX = playerPosition.x + dirX * maxRange;
      targetY = playerPosition.y + dirY * maxRange;
    }

    // Deduct energy (directly to ECS)
    energyComp.current -= getConfig('PSEUDOPOD_ENERGY_COST');

    if (GAME_CONFIG.PSEUDOPOD_MODE === 'strike') {
      // STRIKE MODE: Instant AoE at target location (energy whip)
      const aoeRadius = getConfig('PSEUDOPOD_AOE_RADIUS');
      const drainPerHit = getConfig('PSEUDOPOD_DRAIN_RATE');
      const hitTargetIds: string[] = [];
      let totalDrained = 0;

      // Find all soup-stage entities within AoE radius at target position
      forEachPlayer(world, (targetEntity, targetId) => {
        if (targetId === playerId) return; // Can't hit yourself

        const targetStage = world.getComponent<StageComponent>(targetEntity, Components.Stage);
        const targetEnergy = world.getComponent<EnergyComponent>(targetEntity, Components.Energy);
        const targetPos = world.getComponent(targetEntity, Components.Position) as { x: number; y: number } | undefined;
        if (!targetStage || !targetEnergy || !targetPos) return;

        // Only hit soup-stage targets (single-cell and multi-cell)
        if (targetStage.stage !== EvolutionStage.SINGLE_CELL &&
            targetStage.stage !== EvolutionStage.MULTI_CELL) return;
        if (targetEnergy.current <= 0) return; // Skip dead players
        if (targetStage.isEvolving) return; // Skip evolving players

        // Check if target is within AoE radius of strike location
        const dx = targetPos.x - targetX;
        const dy = targetPos.y - targetY;
        const distToTarget = Math.sqrt(dx * dx + dy * dy);

        if (distToTarget <= aoeRadius + targetStage.radius) {
          // Hit! Drain energy from target
          const actualDrain = Math.min(drainPerHit, targetEnergy.current);
          targetEnergy.current -= actualDrain;
          totalDrained += actualDrain;
          hitTargetIds.push(targetId);

          // Record damage for drain aura visual (persists for 500ms)
          recordDamage(world, targetEntity, drainPerHit, 'beam');

          // Set decay timer for persistent drain aura after hit (entity-based)
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

      // Also check swarms in AoE - set damage tracking, DeathSystem handles kills
      forEachSwarm(world, (swarmEntity, swarmId, swarmPosComp, _velComp, swarmComp, swarmEnergyComp) => {
        const dx = swarmPosComp.x - targetX;
        const dy = swarmPosComp.y - targetY;
        const distToSwarm = Math.sqrt(dx * dx + dy * dy);

        if (distToSwarm <= aoeRadius + swarmComp.size) {
          const actualDrain = Math.min(drainPerHit, swarmEnergyComp.current);
          swarmEnergyComp.current -= actualDrain;
          totalDrained += actualDrain;
          hitTargetIds.push(swarmId);

          // Set damage tracking so DeathSystem knows who killed it
          const damageTracking = world.getComponent<DamageTrackingComponent>(swarmEntity, Components.DamageTracking);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'beam';
            damageTracking.lastBeamShooter = playerId;
          }

          // Record damage for drain aura visual
          recordDamage(world, swarmEntity, drainPerHit, 'beam');

          logger.info({
            event: 'strike_hit_swarm',
            striker: playerId,
            swarmId,
            damage: actualDrain,
            swarmEnergyRemaining: swarmEnergyComp.current.toFixed(0),
          });
        }
      });

      // Give drained energy to the attacker (energy absorption, entity-based)
      if (totalDrained > 0) {
        addEnergy(world, entity, totalDrained);
        logger.info({
          event: 'strike_energy_absorbed',
          striker: playerId,
          energyGained: totalDrained,
          targetsHit: hitTargetIds.length,
        });
      }

      // Broadcast strike to clients for visual effect
      this.ctx.io.emit('pseudopodStrike', {
        type: 'pseudopodStrike',
        strikerId: playerId,
        strikerPosition: playerPosition,
        targetPosition: { x: targetX, y: targetY },
        aoeRadius,
        hitTargetIds,
        totalDrained,
        color: player.color,
      } as PseudopodStrikeMessage);

      logger.info({
        event: 'pseudopod_strike',
        playerId,
        targetPosition: { x: targetX.toFixed(0), y: targetY.toFixed(0) },
        range: targetDist.toFixed(0),
        targetsHit: hitTargetIds.length,
        totalDrained,
        isBot: playerId.startsWith('bot-'),
      });

    } else if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') {
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
      // Already have entity from function parameter
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
      // Already have entity from function parameter
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
  // Stage 3: Cyber-Organism Abilities
  // ============================================

  /**
   * Fire projectile (Stage 3 Ranged specialization only)
   * Fires a hunting projectile toward jungle fauna and other players
   * @returns true if projectile was fired successfully
   */
  fireProjectile(entity: EntityId, playerId: string, targetX: number, targetY: number): boolean {
    const { world } = this.ctx;

    // Get player state from ECS (entity-based)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const posComp = getPosition(world, entity);
    const stunnedComp = getStunned(world, entity);
    const player = getPlayerBySocketId(world, playerId); // For color

    // Debug: log what we received
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

    // Stage 3+ only (Cyber-Organism and above)
    if (!isJungleStage(stageComp.stage)) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;

    // Check specialization - must be ranged
    const specComp = world.getComponent<CombatSpecializationComponent>(entity, Components.CombatSpecialization);
    if (!specComp || specComp.specialization !== 'ranged') return false;

    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;
    if (energyComp.current < GAME_CONFIG.PROJECTILE_ENERGY_COST) return false;

    // Cooldown check via ECS (entity-based)
    const cooldowns = getCooldowns(world, entity);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastOrganismProjectileTime || 0;
    if (now - lastUse < GAME_CONFIG.PROJECTILE_COOLDOWN) return false;

    const playerPosition = { x: posComp.x, y: posComp.y };
    const targetPosition = { x: targetX, y: targetY };

    // Deduct energy (only after all validation passes)
    energyComp.current -= GAME_CONFIG.PROJECTILE_ENERGY_COST;

    // Create projectile ID
    const projectileId = `proj-${playerId}-${now}`;

    // Create projectile via ECS factory
    createProjectile(
      world,
      projectileId,
      entity,
      playerId,
      playerPosition,
      targetPosition,
      player.color
    );

    // Update cooldown in ECS
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
    this.ctx.io.emit('projectileSpawned', {
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
   * Fire melee attack (Stage 3 Melee specialization only)
   * Performs an arc-based instant hit check with knockback
   * @param attackType 'swipe' (90°) or 'thrust' (30°)
   * @returns true if attack was executed successfully
   */
  fireMeleeAttack(entity: EntityId, playerId: string, attackType: MeleeAttackType, targetX: number, targetY: number): boolean {
    const { world } = this.ctx;

    // Get player state from ECS (entity-based)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const posComp = getPosition(world, entity);
    const stunnedComp = getStunned(world, entity);
    const player = getPlayerBySocketId(world, playerId); // For color

    if (!energyComp || !stageComp || !posComp || !player) return false;

    // Stage 3+ only (Cyber-Organism and above)
    if (!isJungleStage(stageComp.stage)) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;

    // Check specialization - must be melee
    const specComp = world.getComponent<CombatSpecializationComponent>(entity, Components.CombatSpecialization);
    if (!specComp || specComp.specialization !== 'melee') return false;

    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;

    // Get attack parameters based on type
    const isSwipe = attackType === 'swipe';
    const energyCost = isSwipe ? GAME_CONFIG.MELEE_SWIPE_ENERGY_COST : GAME_CONFIG.MELEE_THRUST_ENERGY_COST;
    const cooldown = isSwipe ? GAME_CONFIG.MELEE_SWIPE_COOLDOWN : GAME_CONFIG.MELEE_THRUST_COOLDOWN;
    const range = isSwipe ? GAME_CONFIG.MELEE_SWIPE_RANGE : GAME_CONFIG.MELEE_THRUST_RANGE;
    const arc = isSwipe ? GAME_CONFIG.MELEE_SWIPE_ARC : GAME_CONFIG.MELEE_THRUST_ARC;
    const damage = isSwipe ? GAME_CONFIG.MELEE_SWIPE_DAMAGE : GAME_CONFIG.MELEE_THRUST_DAMAGE;
    const knockback = isSwipe ? GAME_CONFIG.MELEE_SWIPE_KNOCKBACK : GAME_CONFIG.MELEE_THRUST_KNOCKBACK;

    if (energyComp.current < energyCost) return false;

    // Cooldown check via ECS (entity-based)
    const cooldowns = getCooldowns(world, entity);
    if (!cooldowns) return false;
    const lastUse = isSwipe ? (cooldowns.lastMeleeSwipeTime || 0) : (cooldowns.lastMeleeThrustTime || 0);
    if (now - lastUse < cooldown) return false;

    // Deduct energy
    energyComp.current -= energyCost;

    const playerPosition = { x: posComp.x, y: posComp.y };

    // Calculate attack direction from player toward target
    const dx = targetX - playerPosition.x;
    const dy = targetY - playerPosition.y;
    const attackAngle = Math.atan2(dy, dx); // Radians
    const halfArcRad = (arc / 2) * (Math.PI / 180); // Convert half arc to radians

    // Find all entities within range and arc
    const hitPlayerIds: string[] = [];
    const hitEntities: number[] = [];
    const killedBugIds: string[] = [];
    const killedCreatureIds: string[] = [];

    // Check players (entity-based)
    forEachPlayer(world, (targetEntity, targetPlayerId) => {
      if (targetPlayerId === playerId) return; // Can't hit yourself

      const targetEnergy = getEnergy(world, targetEntity);
      const targetStage = getStage(world, targetEntity);
      const targetPos = getPosition(world, targetEntity);
      if (!targetEnergy || !targetStage || !targetPos) return;
      if (targetEnergy.current <= 0) return; // Skip dead players

      // Only hit jungle-scale players (Stage 3+)
      if (!isJungleStage(targetStage.stage)) return;

      const targetPosition = { x: targetPos.x, y: targetPos.y };
      const dist = this.distance(playerPosition, targetPosition);

      // Get target's collision radius (cyber-organism is 144px, etc.)
      const targetRadius = targetStage.radius;

      // Check if within range (min 200px to match visual, max = range + target size)
      if (dist < 200 || dist > range + targetRadius) return;

      // Check if within arc
      const toTargetAngle = Math.atan2(targetPos.y - playerPosition.y, targetPos.x - playerPosition.x);
      let angleDiff = Math.abs(toTargetAngle - attackAngle);
      // Normalize to [-PI, PI]
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      if (angleDiff <= halfArcRad) {
        hitPlayerIds.push(targetPlayerId);
        hitEntities.push(targetEntity);

        // Apply damage
        targetEnergy.current -= damage;

        // Apply knockback via KnockbackComponent
        const knockbackDir = Math.atan2(targetPos.y - playerPosition.y, targetPos.x - playerPosition.x);
        const knockbackForceX = Math.cos(knockbackDir) * knockback;
        const knockbackForceY = Math.sin(knockbackDir) * knockback;

        // Add or update KnockbackComponent on target
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
    const bugsToKill: { entity: number; id: string; pos: { x: number; y: number }; value: number; capacityIncrease: number }[] = [];
    forEachCyberBug(world, (bugEntity, bugId, bugPos, bugComp) => {
      const bugPosition = { x: bugPos.x, y: bugPos.y };
      const dist = this.distance(playerPosition, bugPosition);

      // Check if within range (min 200px to match visual, max = range + bug size)
      if (dist < 200 || dist > range + bugComp.size) return;

      // Check if within arc
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

    // Process bug kills (after iteration to avoid mutation during iteration)
    for (const bug of bugsToKill) {
      // Award energy and capacity to attacker (entity-based)
      addEnergy(world, entity, bug.value);
      const attackerEnergy = getEnergy(world, entity);
      if (attackerEnergy) {
        setMaxEnergy(world, entity, attackerEnergy.max + bug.capacityIncrease);
      }

      // Emit kill event
      this.ctx.io.emit('cyberBugKilled', {
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
    const creaturesToKill: { entity: number; id: string; pos: { x: number; y: number }; value: number; capacityIncrease: number; variant: string }[] = [];
    forEachJungleCreature(world, (creatureEntity, creatureId, creaturePos, creatureComp) => {
      const creaturePosition = { x: creaturePos.x, y: creaturePos.y };
      const dist = this.distance(playerPosition, creaturePosition);

      // Check if within range (min 200px to match visual, max = range + creature size)
      if (dist < 200 || dist > range + creatureComp.size) return;

      // Check if within arc
      const toTargetAngle = Math.atan2(creaturePos.y - playerPosition.y, creaturePos.x - playerPosition.x);
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

    // Process creature kills (entity-based)
    for (const creature of creaturesToKill) {
      // Award energy and capacity to attacker
      addEnergy(world, entity, creature.value);
      const attackerEnergy2 = getEnergy(world, entity);
      if (attackerEnergy2) {
        setMaxEnergy(world, entity, attackerEnergy2.max + creature.capacityIncrease);
      }

      // Emit kill event
      this.ctx.io.emit('jungleCreatureKilled', {
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
    this.ctx.io.emit('meleeAttackExecuted', attackMessage);

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
   * Place a trap (Stage 3 Traps specialization only)
   * Places a disguised mine at the player's current position
   * @returns true if trap was placed successfully
   */
  placeTrap(entity: EntityId, playerId: string): boolean {
    const { world } = this.ctx;

    // Get player state from ECS (entity-based)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const posComp = getPosition(world, entity);
    const stunnedComp = getStunned(world, entity);
    const player = getPlayerBySocketId(world, playerId); // For color

    if (!energyComp || !stageComp || !posComp || !player) {
      logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'missing_components' });
      return false;
    }

    // Stage 3+ only (Cyber-Organism and above)
    if (!isJungleStage(stageComp.stage)) {
      logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'wrong_stage', stage: stageComp.stage });
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
    const specComp = world.getComponent<CombatSpecializationComponent>(entity, Components.CombatSpecialization);
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
      logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'insufficient_energy', energy: energyComp.current, cost: GAME_CONFIG.TRAP_ENERGY_COST });
      return false;
    }

    // Cooldown check via ECS (entity-based)
    const cooldowns = getCooldowns(world, entity);
    if (!cooldowns) {
      logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'no_cooldowns_component' });
      return false;
    }
    const lastUse = cooldowns.lastTrapPlaceTime || 0;
    if (now - lastUse < GAME_CONFIG.TRAP_COOLDOWN) {
      logger.debug({ event: 'player_trap_place_denied', playerId, reason: 'cooldown', remaining: GAME_CONFIG.TRAP_COOLDOWN - (now - lastUse) });
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
    createTrap(world, trapId, entity, playerId, trapPosition, player.color);

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
    this.ctx.io.emit('trapPlaced', {
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
  canFireEMP(entity: EntityId): boolean {
    const { world } = this.ctx;
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

  /**
   * Check if a player can fire pseudopod (has the ability and it's off cooldown)
   */
  canFirePseudopod(entity: EntityId): boolean {
    const { world } = this.ctx;
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

  /**
   * Check if a player can fire projectile (ranged specialization and off cooldown)
   */
  canFireProjectile(entity: EntityId): boolean {
    const { world } = this.ctx;
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const stunnedComp = getStunned(world, entity);
    if (!energyComp || !stageComp) return false;

    if (!isJungleStage(stageComp.stage)) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;

    // Check specialization - must be ranged
    const specComp = world.getComponent<CombatSpecializationComponent>(entity, Components.CombatSpecialization);
    if (!specComp || specComp.specialization !== 'ranged') return false;

    if (energyComp.current < GAME_CONFIG.PROJECTILE_ENERGY_COST) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;

    const cooldowns = getCooldowns(world, entity);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastOrganismProjectileTime || 0;
    return now - lastUse >= GAME_CONFIG.PROJECTILE_COOLDOWN;
  }

  /**
   * Check if a player can place a trap (traps specialization and off cooldown)
   */
  canPlaceTrap(entity: EntityId, playerId: string): boolean {
    const { world } = this.ctx;
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const stunnedComp = getStunned(world, entity);
    if (!energyComp || !stageComp) return false;

    if (!isJungleStage(stageComp.stage)) return false;
    if (energyComp.current <= 0) return false;
    if (stageComp.isEvolving) return false;

    // Check specialization - must be traps
    const specComp = world.getComponent<CombatSpecializationComponent>(entity, Components.CombatSpecialization);
    if (!specComp || specComp.specialization !== 'traps') return false;

    if (energyComp.current < GAME_CONFIG.TRAP_ENERGY_COST) return false;
    const now = Date.now();
    if (stunnedComp?.until && now < stunnedComp.until) return false;

    // Check max active traps (still uses playerId for ownership query)
    const activeTraps = countTrapsForPlayer(world, playerId);
    if (activeTraps >= GAME_CONFIG.TRAP_MAX_ACTIVE) return false;

    const cooldowns = getCooldowns(world, entity);
    if (!cooldowns) return false;
    const lastUse = cooldowns.lastTrapPlaceTime || 0;
    return now - lastUse >= GAME_CONFIG.TRAP_COOLDOWN;
  }
}
