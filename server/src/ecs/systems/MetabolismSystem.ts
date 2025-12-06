// ============================================
// Metabolism System
// Handles energy decay, starvation, and evolution checks
// ============================================

import type { Server } from 'socket.io';
import type { World } from '@godcell/shared';
import type {
  PlayerEvolutionStartedMessage,
  PlayerEvolvedMessage,
  SpecializationPromptMessage,
} from '@godcell/shared';
import { EvolutionStage, GAME_CONFIG } from '@godcell/shared';
import type { System } from './types';
import {
  Components,
  forEachPlayer,
  getStage,
  getEnergy,
  getEntityBySocketId,
  setPlayerStage,
  hasPlayer,
  getDamageTracking,
  recordDamage,
  type EnergyComponent,
  type StageComponent,
  type CombatSpecializationComponent,
} from '../index';
import { getConfig } from '../../dev';
import { getNextEvolutionStage, getStageMaxEnergy, getEnergyDecayRate } from '../../helpers';
import { recordEvolution, logger } from '../../logger';
import { isBot } from '../../bots';

/**
 * MetabolismSystem - Manages player metabolism
 *
 * Handles:
 * - Passive energy decay (starvation)
 * - Death detection (energy <= 0)
 * - Evolution checks and progression
 */
export class MetabolismSystem implements System {
  readonly name = 'MetabolismSystem';

  update(world: World, deltaTime: number, io: Server): void {

    forEachPlayer(world, (entity, playerId) => {
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !stageComp) return;

      // Skip dead players waiting for respawn (energy < 0 means death already processed)
      // Catch-all: if energy is exactly 0 but no death cause tracked (e.g., from movement/ability costs),
      // set 'starvation' as default cause so DeathSystem will process them
      if (energyComp.current < 0) {
        return; // Already dead, waiting for respawn
      }
      const damageTracking = getDamageTracking(world, entity);
      if (energyComp.current === 0 && !damageTracking?.lastDamageSource) {
        if (damageTracking) {
          damageTracking.lastDamageSource = 'starvation';
        }
        return;
      }
      if (energyComp.current === 0) {
        return; // Death already tracked, will be processed by DeathSystem
      }

      // Skip metabolism during evolution molting (invulnerable)
      if (stageComp.isEvolving) return;

      // Energy decay (passive drain) - stage-specific metabolic efficiency
      // No damage resistance applies to passive decay
      const decayRate = getEnergyDecayRate(stageComp.stage);
      energyComp.current -= decayRate * deltaTime;

      // Energy-only: when energy hits 0, mark for death
      if (energyComp.current <= 0) {
        energyComp.current = 0;
        // Track damage source in ECS for death cause logging
        const damageTrackingForDeath = getDamageTracking(world, entity);
        if (damageTrackingForDeath) {
          damageTrackingForDeath.lastDamageSource = 'starvation';
        }
        // Record for drain aura (shows starvation state)
        recordDamage(world, entity, decayRate, 'starvation');
      }

      // Check for evolution (only if still alive)
      if (energyComp.current > 0) {
        this.checkEvolution(entity, playerId, world, io);
      }
    });
  }

  /**
   * Check if player can evolve and trigger evolution if conditions met
   */
  private checkEvolution(entity: number, playerId: string, world: World, io: Server): void {

    const stageComp = getStage(world, entity);
    const energyComp = getEnergy(world, entity);
    if (!stageComp || !energyComp) return;

    if (stageComp.isEvolving) return; // Already evolving

    const nextEvolution = getNextEvolutionStage(stageComp.stage);
    if (!nextEvolution) return; // Already at max stage

    // Check capacity gate (maxEnergy threshold)
    if (energyComp.max < nextEvolution.threshold) return;

    // Capacity threshold met - trigger evolution!
    stageComp.isEvolving = true;

    // Broadcast evolution start
    const startMessage: PlayerEvolutionStartedMessage = {
      type: 'playerEvolutionStarted',
      playerId: playerId,
      currentStage: stageComp.stage,
      targetStage: nextEvolution.stage,
      duration: getConfig('EVOLUTION_MOLTING_DURATION'),
    };
    io.emit('playerEvolutionStarted', startMessage);

    // Capture current stage before async callback (for evolution tracking)
    const fromStage = stageComp.stage;
    const targetStage = nextEvolution.stage;

    // Schedule evolution completion after molting duration
    setTimeout(() => {
      // Check if player still exists (they might have disconnected during molting)
      if (!hasPlayer(world, playerId)) return;

      // Re-fetch entity and components (entity may have changed due to respawn)
      const entityNow = getEntityBySocketId(playerId);
      if (!entityNow) return;

      const stageCompNow = getStage(world, entityNow);
      const energyCompNow = getEnergy(world, entityNow);
      if (!stageCompNow || !energyCompNow) return;

      stageCompNow.stage = targetStage;
      stageCompNow.isEvolving = false;

      // Update energy pool for new stage
      // Evolution grants the new stage's max energy pool (fully restored)
      const newMaxEnergy = getStageMaxEnergy(stageCompNow.stage);
      energyCompNow.max = Math.max(energyCompNow.max, newMaxEnergy);
      energyCompNow.current = energyCompNow.max; // Evolution fully restores energy

      // Also update ECS stage abilities via setPlayerStage
      setPlayerStage(world, entityNow, targetStage);

      // Stage 3 (Cyber-Organism): Add combat specialization component
      // Player must choose melee, ranged, or traps pathway
      if (targetStage === EvolutionStage.CYBER_ORGANISM) {
        const now = Date.now();
        const deadline = now + GAME_CONFIG.SPECIALIZATION_SELECTION_DURATION;

        // Add the combat specialization component with pending selection
        world.addComponent<CombatSpecializationComponent>(entityNow, Components.CombatSpecialization, {
          specialization: null,
          selectionPending: true,
          selectionDeadline: deadline,
        });

        // Emit specialization prompt to the evolving player
        const promptMessage: SpecializationPromptMessage = {
          type: 'specializationPrompt',
          playerId: playerId,
          deadline: deadline,
        };
        io.emit('specializationPrompt', promptMessage);

        logger.info({
          event: isBot(playerId) ? 'bot_specialization_prompt_sent' : 'player_specialization_prompt_sent',
          playerId,
          deadline,
        });
      }

      // Broadcast evolution event
      const evolveMessage: PlayerEvolvedMessage = {
        type: 'playerEvolved',
        playerId: playerId,
        newStage: stageCompNow.stage,
        newMaxEnergy: energyCompNow.max,
        radius: stageCompNow.radius,
      };
      io.emit('playerEvolved', evolveMessage);

      // Track evolution for rate tracking (includes survival time calculation)
      recordEvolution(playerId, fromStage, stageCompNow.stage, isBot(playerId));
    }, getConfig('EVOLUTION_MOLTING_DURATION'));
  }
}
