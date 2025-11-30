// ============================================
// Death System
// Handles player death checks and processing
// ============================================

import type { Server } from 'socket.io';
import type { EnergyUpdateMessage, PlayerDiedMessage, DeathCause } from '@godcell/shared';
import { EvolutionStage, GAME_CONFIG, type World } from '@godcell/shared';
import type { System } from './types';
import {
  Components,
  forEachPlayer,
  getPlayerBySocketId,
  getEnergyBySocketId,
  setEnergyBySocketId,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
  getDrainPredatorId,
  clearDrainTarget,
  getDamageTrackingBySocketId,
  type EnergyComponent,
  type DamageTrackingComponent,
} from '../index';
import { isBot, handleBotDeath } from '../../bots';
import { logger, recordLifetimeDeath, logPlayerDeath } from '../../logger';

/**
 * DeathSystem - Checks for and processes player deaths
 *
 * Handles:
 * - Death detection (energy <= 0 with tracked damage source)
 * - Kill rewards (predation and beam kills award maxEnergy)
 * - Death broadcasts (final energy update, death event)
 * - Bot auto-respawn scheduling
 * - Marks death as processed (sentinel value) to prevent reprocessing
 */
export class DeathSystem implements System {
  readonly name = 'DeathSystem';

  update(world: World, _deltaTime: number, io: Server): void {

    forEachPlayer(world, (entity, playerId) => {
      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      if (!energyComp) return;

      // Get damage tracking from ECS
      const damageTracking = getDamageTrackingBySocketId(world, playerId);

      // Only process if:
      // 1. Energy is at or below 0
      // 2. We have a damage source tracked (meaning this is a fresh death, not already processed)
      if (energyComp.current <= 0 && damageTracking?.lastDamageSource) {
        const cause = damageTracking.lastDamageSource;

        // Get Player object for death handling
        const player = getPlayerBySocketId(world, playerId);
        if (!player) return;

        // Handle predation kill rewards (contact drain)
        if (cause === 'predation') {
          const predatorId = getDrainPredatorId(world, player.id);
          if (predatorId) {
            const predatorEnergy = getEnergyBySocketId(world, predatorId);
            if (predatorEnergy) {
              // Calculate reward based on victim stage
              let maxEnergyGain = 0;
              if (player.stage === EvolutionStage.SINGLE_CELL) {
                // Killing single-cell: 30% of maxEnergy
                maxEnergyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
              } else {
                // Killing multi-cell: 80% of maxEnergy (huge reward)
                maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;
              }

              // Award maxEnergy increase to predator (write to ECS)
              setMaxEnergyBySocketId(world, predatorId, predatorEnergy.max + maxEnergyGain);
              // Clamp current energy to new max (addEnergy with 0 does this)
              addEnergyBySocketId(world, predatorId, 0);

              logger.info({
                event: 'predation_kill',
                predatorId,
                victimId: player.id,
                victimStage: player.stage,
                maxEnergyGained: maxEnergyGain.toFixed(1),
              });
            }
            // Clear drain tracking
            clearDrainTarget(world, player.id);
          }
        }

        // Handle beam kill rewards (pseudopod)
        if (cause === 'beam') {
          const shooterId = damageTracking.lastBeamShooter;
          if (shooterId) {
            const shooterEnergy = getEnergyBySocketId(world, shooterId);
            if (shooterEnergy) {
              // Only multi-cells can be killed by beams, always award 80%
              const maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;

              // Award maxEnergy increase AND current energy to shooter (write to ECS)
              const newMaxEnergy = shooterEnergy.max + maxEnergyGain;
              setMaxEnergyBySocketId(world, shooterId, newMaxEnergy);
              const energyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN; // 30% of victim's maxEnergy
              addEnergyBySocketId(world, shooterId, energyGain);

              logger.info({
                event: 'beam_kill',
                shooterId,
                victimId: player.id,
                victimStage: player.stage,
                maxEnergyGained: maxEnergyGain.toFixed(1),
                energyGained: energyGain.toFixed(1),
              });
            }
            // Clear beam shooter tracking in ECS
            damageTracking.lastBeamShooter = undefined;
          }
        }

        // Send final energy update showing 0 before death message
        const finalEnergyUpdate: EnergyUpdateMessage = {
          type: 'energyUpdate',
          playerId: player.id,
          energy: 0, // Ensure client sees energy at 0
        };
        io.emit('energyUpdate', finalEnergyUpdate);

        // Record death for lifetime stats
        recordLifetimeDeath(cause);

        // Broadcast death event (for dilution effect)
        const deathMessage: PlayerDiedMessage = {
          type: 'playerDied',
          playerId: player.id,
          position: { ...player.position },
          color: player.color,
          cause: cause as 'starvation' | 'singularity' | 'swarm' | 'obstacle' | 'predation',
        };
        io.emit('playerDied', deathMessage);

        // Auto-respawn bots after delay, log human player deaths
        if (isBot(player.id)) {
          handleBotDeath(player.id, cause, io);
        } else {
          logPlayerDeath(player.id, cause);
        }

        // Mark as "death processed" - sentinel value prevents catch-all from re-triggering
        // Respawn will set energy back to positive value
        setEnergyBySocketId(world, playerId, -1);

        // Clear damage source in ECS to prevent reprocessing same death
        damageTracking.lastDamageSource = undefined;
      }
    });
  }
}
