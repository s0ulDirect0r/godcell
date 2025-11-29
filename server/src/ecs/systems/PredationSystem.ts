// ============================================
// Predation System
// Handles predator-prey interactions (engulfing, draining)
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type { Position, PlayerEngulfedMessage, PlayerDiedMessage } from '@godcell/shared';
import { EvolutionStage, GAME_CONFIG } from '@godcell/shared';
import {
  forEachPlayer,
  getEnergyBySocketId,
  setEnergyBySocketId,
  addEnergyBySocketId,
  getEntityBySocketId,
  setDrainTarget,
  clearDrainTarget,
  forEachDrainTarget,
  getDamageTrackingBySocketId,
  Components,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
  type StunnedComponent,
  type PlayerComponent,
} from '../index';
import { distance, getPlayerRadius } from '../../helpers';
import { hasGodMode, getConfig } from '../../dev';
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

  update(ctx: GameContext): void {
    const {
      world,
      io,
      deltaTime,
      recordDamage,
    } = ctx;

    const currentDrains = new Set<string>(); // Track prey being drained this tick

    // Iterate predators via ECS
    forEachPlayer(world, (predatorEntity, predatorId) => {
      const predatorStage = world.getComponent<StageComponent>(predatorEntity, Components.Stage);
      const predatorEnergy = world.getComponent<EnergyComponent>(predatorEntity, Components.Energy);
      const predatorPos = world.getComponent<PositionComponent>(predatorEntity, Components.Position);
      const predatorStunned = world.getComponent<StunnedComponent>(predatorEntity, Components.Stunned);
      if (!predatorStage || !predatorEnergy || !predatorPos) return;

      // Only Stage 2 (MULTI_CELL) can drain via contact
      if (predatorStage.stage !== EvolutionStage.MULTI_CELL) return;
      if (predatorEnergy.current <= 0) return;
      if (predatorStage.isEvolving) return;
      if (predatorStunned?.until && Date.now() < predatorStunned.until) return;

      const predatorRadius = getPlayerRadius(predatorStage.stage);
      const predatorPosition = { x: predatorPos.x, y: predatorPos.y };

      // Check collision with all other players (Stage 1 only)
      forEachPlayer(world, (preyEntity, preyId) => {
        if (preyId === predatorId) return; // Don't drain yourself

        const preyStage = world.getComponent<StageComponent>(preyEntity, Components.Stage);
        const preyEnergy = world.getComponent<EnergyComponent>(preyEntity, Components.Energy);
        const preyPos = world.getComponent<PositionComponent>(preyEntity, Components.Position);
        if (!preyStage || !preyEnergy || !preyPos) return;

        if (preyStage.stage !== EvolutionStage.SINGLE_CELL) return; // Only drain Stage 1
        if (preyEnergy.current <= 0) return; // Skip dead prey
        if (preyStage.isEvolving) return; // Skip evolving prey

        const preyRadius = getPlayerRadius(preyStage.stage);
        const preyPosition = { x: preyPos.x, y: preyPos.y };
        const dist = distance(predatorPosition, preyPosition);
        const collisionDist = predatorRadius + preyRadius;

        if (dist < collisionDist) {
          // God mode players can't be drained
          if (hasGodMode(preyId)) return;

          // Contact! Drain energy from prey (energy-only system)
          // Predation bypasses damage resistance - being engulfed is inescapable
          const damage = getConfig('CONTACT_DRAIN_RATE') * deltaTime;
          preyEnergy.current -= damage;

          // Transfer drained energy to predator
          addEnergyBySocketId(world, predatorId, damage);

          currentDrains.add(preyId);

          // Track which predator is draining this prey (for kill credit)
          setDrainTarget(world, preyId, predatorId);

          // Mark damage source for death tracking in ECS
          const damageTracking = getDamageTrackingBySocketId(world, preyId);
          if (damageTracking) {
            damageTracking.lastDamageSource = 'predation';
          }

          // Record damage for drain aura system
          recordDamage(preyId, getConfig('CONTACT_DRAIN_RATE'), 'predation');

          // Check if prey is killed (instant engulf)
          if (preyEnergy.current <= 0) {
            this.engulfPrey(ctx, predatorId, preyId, preyPosition, preyEnergy.max);
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
    ctx: GameContext,
    predatorId: string,
    preyId: string,
    position: Position,
    preyMaxEnergy: number
  ): void {
    const { world, io } = ctx;

    // Get prey color from ECS
    const preyEntity = getEntityBySocketId(preyId);
    const preyPlayer = preyEntity !== undefined
      ? world.getComponent<PlayerComponent>(preyEntity, Components.Player)
      : null;
    const preyColor = preyPlayer?.color ?? '#ffffff';

    // Calculate rewards (gain % of victim's maxEnergy)
    const energyGain = preyMaxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
    addEnergyBySocketId(world, predatorId, energyGain);

    // Kill prey (energy-only: set energy to 0)
    setEnergyBySocketId(world, preyId, 0);
    // Mark damage source in ECS for death cause logging
    const damageTracking = getDamageTrackingBySocketId(world, preyId);
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
