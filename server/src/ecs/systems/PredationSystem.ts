// ============================================
// Predation System
// Handles predator-prey interactions (engulfing, draining)
// ============================================

import type { Server } from 'socket.io';
import type { Position, PlayerEngulfedMessage, PlayerDiedMessage } from '@shared';
import { EvolutionStage, GAME_CONFIG, type World } from '@shared';
import type { System } from './types';
import {
  forEachPlayer,
  getEnergy,
  setEnergy,
  addEnergy,
  getEntityBySocketId,
  getSocketIdByEntity,
  setDrainTarget,
  clearDrainTarget,
  forEachDrainTarget,
  getDamageTracking,
  recordDamage,
  requireEnergy,
  requirePosition,
  requireStage,
  Components,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
  type StunnedComponent,
  type PlayerComponent,
} from '../index';
import { distance } from '../../helpers';
import { getConfig } from '../../dev';
import { isBot } from '../../bots';
import { logger } from '../../logger';

/**
 * PredationSystem - Manages predation between players
 *
 * Handles:
 * - Contact predation (Stage 2 draining Stage 1)
 * - Energy transfer between predator and prey
 * - Kill tracking and death broadcasts
 */
export class PredationSystem implements System {
  readonly name = 'PredationSystem';

  update(world: World, deltaTime: number, io: Server): void {

    const currentDrains = new Set<string>(); // Track prey being drained this tick

    // Iterate predators via ECS
    forEachPlayer(world, (predatorEntity, predatorId) => {
      const predatorStage = requireStage(world, predatorEntity);
      const predatorEnergy = requireEnergy(world, predatorEntity);
      const predatorPos = requirePosition(world, predatorEntity);
      const predatorStunned = world.getComponent<StunnedComponent>(predatorEntity, Components.Stunned);

      // Only Stage 2 (MULTI_CELL) can drain via contact
      if (predatorStage.stage !== EvolutionStage.MULTI_CELL) return;
      if (predatorEnergy.current <= 0) return;
      if (predatorStage.isEvolving) return;
      if (predatorStunned?.until && Date.now() < predatorStunned.until) return;

      const predatorRadius = predatorStage.radius;
      const predatorPosition = { x: predatorPos.x, y: predatorPos.y };

      // Check collision with all other players (Stage 1 only)
      forEachPlayer(world, (preyEntity, preyId) => {
        if (preyId === predatorId) return; // Don't drain yourself

        const preyStage = requireStage(world, preyEntity);
        const preyEnergy = requireEnergy(world, preyEntity);
        const preyPos = requirePosition(world, preyEntity);

        if (preyStage.stage !== EvolutionStage.SINGLE_CELL) return; // Only drain Stage 1
        if (preyEnergy.current <= 0) return; // Skip dead prey
        if (preyStage.isEvolving) return; // Skip evolving prey

        const preyRadius = preyStage.radius;
        const preyPosition = { x: preyPos.x, y: preyPos.y };
        const dist = distance(predatorPosition, preyPosition);
        const collisionDist = predatorRadius + preyRadius;

        if (dist < collisionDist) {
          // Contact! Drain energy from prey (energy-only system)
          const damage = getConfig('CONTACT_DRAIN_RATE') * deltaTime;
          preyEnergy.current -= damage;

          // Transfer drained energy to predator (entity-based)
          addEnergy(world, predatorEntity, damage);

          currentDrains.add(preyId);

          // Track which predator is draining this prey (for kill credit)
          setDrainTarget(world, preyId, predatorId);

          // Mark damage source for death tracking in ECS (entity-based)
          const damageTracking = getDamageTracking(world, preyEntity);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'predation';
          }

          // Record damage for drain aura system
          recordDamage(world, preyEntity, getConfig('CONTACT_DRAIN_RATE'), 'predation');

          // Check if prey is killed (instant engulf)
          if (preyEnergy.current <= 0) {
            this.engulfPrey(world, io, predatorEntity, preyEntity, preyId, preyPosition, preyEnergy.max);
          }
        }
      });
    });

    // Clear drains for prey that escaped contact this tick
    // Collect first, then clear - can't modify Map during iteration
    const escapedPreyIds: string[] = [];
    forEachDrainTarget(world, (preyId, _predatorId) => {
      if (!currentDrains.has(preyId)) {
        escapedPreyIds.push(preyId);
      }
    });
    for (const preyId of escapedPreyIds) {
      clearDrainTarget(world, preyId);
    }
  }

  /**
   * Handle prey being fully engulfed by predator
   */
  private engulfPrey(
    world: World,
    io: Server,
    predatorEntity: number,
    preyEntity: number,
    preyId: string,
    position: Position,
    preyMaxEnergy: number
  ): void {

    // Get prey color from ECS
    const preyPlayer = world.getComponent<PlayerComponent>(preyEntity, Components.Player);
    const preyColor = preyPlayer?.color ?? '#ffffff';

    // Get predator socket ID for network messages
    const predatorId = getSocketIdByEntity(predatorEntity) ?? 'unknown';

    // Calculate rewards (gain % of victim's maxEnergy)
    const energyGain = preyMaxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
    addEnergy(world, predatorEntity, energyGain);

    // Kill prey (energy-only: set energy to 0)
    setEnergy(world, preyEntity, 0);
    // Mark damage source in ECS for death cause logging
    const damageTracking = getDamageTracking(world, preyEntity);
    if (damageTracking) {
      damageTracking.lastDamageSource = 'predation';
    }

    // Broadcast engulfment
    io.emit('playerEngulfed', {
      type: 'playerEngulfed',
      predatorId,
      preyId,
      position,
      energyGained: energyGain,
    } as PlayerEngulfedMessage);

    // Note: Death broadcast and bot respawn handled by DeathSystem
    // We just set energy to 0 and damage source, DeathSystem does the rest

    logger.info({
      event: 'player_engulfed',
      predatorId,
      preyId,
      isBot: isBot(preyId),
      energyGained: energyGain.toFixed(1),
    });
  }
}
