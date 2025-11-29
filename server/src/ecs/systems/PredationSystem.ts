// ============================================
// Predation System
// Handles predator-prey interactions (engulfing, draining)
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type { Position, PlayerEngulfedMessage, PlayerDiedMessage } from '@godcell/shared';
import { EvolutionStage, GAME_CONFIG } from '@godcell/shared';
import { getEnergyBySocketId, setEnergyBySocketId, addEnergyBySocketId } from '../index';
import { distance, getPlayerRadius } from '../../helpers';
import { hasGodMode, getConfig } from '../../dev';
import { handleBotDeath } from '../../bots';
import { logger } from '../../logger';

/**
 * PredationSystem - Manages predation between players
 *
 * Handles:
 * - Contact predation (Stage 2 draining Stage 1)
 * - Energy transfer between predator and prey
 * - Kill tracking and death broadcasts
 *
 * TODO Phase 5: Replace players Map iteration with ECS iteration
 */
export class PredationSystem implements System {
  readonly name = 'PredationSystem';

  update(ctx: GameContext): void {
    const {
      world,
      io,
      deltaTime,
      players,
      playerVelocities,
      playerInputDirections,
      playerLastDamageSource,
      activeDrains,
      isBot,
      recordDamage,
    } = ctx;

    const currentDrains = new Set<string>(); // Track prey being drained this tick

    for (const [predatorId, predator] of players) {
      // Only Stage 2 (MULTI_CELL) can drain via contact
      // Stage 1 can't drain, Stage 3+ have evolved past soup predation
      if (predator.stage !== EvolutionStage.MULTI_CELL) continue;
      if (predator.energy <= 0) continue;
      if (predator.isEvolving) continue;
      if (predator.stunnedUntil && Date.now() < predator.stunnedUntil) continue; // Can't drain while stunned

      const predatorRadius = getPlayerRadius(predator.stage);

      // Check collision with all other players (Stage 1 only)
      for (const [preyId, prey] of players) {
        if (preyId === predatorId) continue; // Don't drain yourself
        if (prey.stage !== EvolutionStage.SINGLE_CELL) continue; // Only drain Stage 1
        if (prey.energy <= 0) continue; // Skip dead prey
        if (prey.isEvolving) continue; // Skip evolving prey

        const preyRadius = getPlayerRadius(prey.stage);
        const dist = distance(predator.position, prey.position);
        const collisionDist = predatorRadius + preyRadius;

        if (dist < collisionDist) {
          // God mode players can't be drained
          if (hasGodMode(preyId)) continue;

          // Contact! Drain energy from prey (energy-only system)
          // Predation bypasses damage resistance - being engulfed is inescapable
          const damage = getConfig('CONTACT_DRAIN_RATE') * deltaTime;

          // Write damage to ECS (not the cached player object)
          const preyEnergyComp = getEnergyBySocketId(world, preyId);
          if (preyEnergyComp) {
            preyEnergyComp.current -= damage;
          }

          // Transfer drained energy to predator
          addEnergyBySocketId(world, predatorId, damage);

          currentDrains.add(preyId);

          // Track which predator is draining this prey (for kill credit)
          activeDrains.set(preyId, predatorId);

          // Mark damage source for death tracking
          playerLastDamageSource.set(preyId, 'predation');

          // Record damage for drain aura system
          recordDamage(preyId, getConfig('CONTACT_DRAIN_RATE'), 'predation');

          // Check if prey is killed (instant engulf)
          if (preyEnergyComp && preyEnergyComp.current <= 0) {
            this.engulfPrey(ctx, predatorId, preyId, prey.position);
          }

          // Only one predator can drain a prey at a time (first contact wins)
          break;
        }
      }
    }

    // Clear drains for prey that escaped contact this tick
    for (const [preyId, _predatorId] of activeDrains) {
      if (!currentDrains.has(preyId)) {
        activeDrains.delete(preyId);
      }
    }
  }

  /**
   * Handle prey being fully engulfed by predator
   */
  private engulfPrey(ctx: GameContext, predatorId: string, preyId: string, position: Position): void {
    const { world, io, players, playerVelocities, playerInputDirections, playerLastDamageSource, isBot } = ctx;

    const predator = players.get(predatorId);
    const prey = players.get(preyId);

    if (!predator || !prey) return;

    // Calculate rewards (gain % of victim's maxEnergy)
    const energyGain = prey.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
    // Write to ECS (not the cached player object)
    addEnergyBySocketId(world, predatorId, energyGain);

    // Kill prey (energy-only: set energy to 0)
    setEnergyBySocketId(world, preyId, 0);
    playerLastDamageSource.set(preyId, 'predation');

    // Broadcast engulfment
    io.emit('playerEngulfed', {
      type: 'playerEngulfed',
      predatorId,
      preyId,
      position,
      energyGained: energyGain,
    } as PlayerEngulfedMessage);

    // Broadcast death
    io.emit('playerDied', {
      type: 'playerDied',
      playerId: preyId,
      position,
      color: prey.color,
      cause: 'predation',
    } as PlayerDiedMessage);

    // Handle bot death (respawn logic)
    if (isBot(preyId)) {
      handleBotDeath(preyId, 'predation', io, players, playerInputDirections, playerVelocities);
    }

    logger.info({
      event: 'player_engulfed',
      predatorId,
      preyId,
      isBot: isBot(preyId),
      energyGained: energyGain.toFixed(1),
    });
  }
}
