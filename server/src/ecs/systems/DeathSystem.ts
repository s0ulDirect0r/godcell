// ============================================
// Death System
// Handles player and swarm death checks and processing
// ============================================

import type { Server } from 'socket.io';
import type { EnergyUpdateMessage, PlayerDiedMessage, DeathCause } from '#shared';
import { EvolutionStage, GAME_CONFIG, type World } from '#shared';
import type { System } from './types';
import {
  Components,
  forEachPlayer,
  forEachSwarm,
  getEntityBySocketId,
  getEnergy,
  setEnergy,
  setMaxEnergy,
  addEnergy,
  getDamageTracking,
  getDrainPredatorId,
  clearDrainTarget,
  entityToLegacyPlayer,
  requireEnergy,
  type DamageTrackingComponent,
} from '../index';
import { isBot, handleBotDeath } from '../../bots';
import { logger, recordLifetimeDeath, logPlayerDeath } from '../../logger';
import { removeSwarm } from '../../swarms';

/**
 * DeathSystem - Checks for and processes player and swarm deaths
 *
 * Handles:
 * - Death detection (energy <= 0 with tracked damage source)
 * - Kill rewards (predation and beam kills award maxEnergy)
 * - Death broadcasts (final energy update, death event)
 * - Bot auto-respawn scheduling
 * - Swarm death and kill rewards
 * - Marks death as processed (sentinel value) to prevent reprocessing
 */
export class DeathSystem implements System {
  readonly name = 'DeathSystem';

  update(world: World, _deltaTime: number, io: Server): void {
    forEachPlayer(world, (entity, _playerId) => {
      const energyComp = requireEnergy(world, entity);

      // Get damage tracking from ECS (entity-based)
      const damageTracking = getDamageTracking(world, entity);

      // Only process if:
      // 1. Energy is at or below 0
      // 2. We have a damage source tracked (meaning this is a fresh death, not already processed)
      if (energyComp.current <= 0 && damageTracking?.lastDamageSource) {
        const cause = damageTracking.lastDamageSource;

        // Get Player object for death handling (legacy format for network messages)
        const player = entityToLegacyPlayer(world, entity);
        if (!player) return;

        // Handle predation kill rewards (contact drain)
        if (cause === 'predation') {
          const predatorSocketId = getDrainPredatorId(world, player.id);
          if (predatorSocketId) {
            const predatorEntity = getEntityBySocketId(predatorSocketId);
            const predatorEnergy = predatorEntity ? getEnergy(world, predatorEntity) : undefined;
            if (predatorEntity && predatorEnergy) {
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
              setMaxEnergy(world, predatorEntity, predatorEnergy.max + maxEnergyGain);
              // Clamp current energy to new max (addEnergy with 0 does this)
              addEnergy(world, predatorEntity, 0);

              logger.info({
                event: 'predation_kill',
                predatorId: predatorSocketId,
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
          const shooterSocketId = damageTracking.lastBeamShooter;
          if (shooterSocketId) {
            const shooterEntity = getEntityBySocketId(shooterSocketId);
            const shooterEnergy = shooterEntity ? getEnergy(world, shooterEntity) : undefined;
            if (shooterEntity && shooterEnergy) {
              // Only multi-cells can be killed by beams, always award 80%
              const maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;

              // Award maxEnergy increase AND current energy to shooter (write to ECS)
              const newMaxEnergy = shooterEnergy.max + maxEnergyGain;
              setMaxEnergy(world, shooterEntity, newMaxEnergy);
              const energyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN; // 30% of victim's maxEnergy
              addEnergy(world, shooterEntity, energyGain);

              logger.info({
                event: 'beam_kill',
                shooterId: shooterSocketId,
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
        setEnergy(world, entity, -1);

        // Clear damage source in ECS to prevent reprocessing same death
        damageTracking.lastDamageSource = undefined;
      }
    });

    // ============================================
    // Swarm Death Handling
    // ============================================
    // Collect dead swarms first to avoid mutation during iteration
    const deadSwarms: {
      entity: number;
      swarmId: string;
      x: number;
      y: number;
      killerId?: string;
      damageSource?: DeathCause;
      peakEnergy: number; // Peak energy swarm reached (for percentage-based rewards)
    }[] = [];

    forEachSwarm(world, (entity, swarmId, posComp, _velComp, _swarmComp, energyComp) => {
      if (energyComp.current <= 0) {
        // Get damage tracking to find killer
        const damageTracking = world.getComponent<DamageTrackingComponent>(
          entity,
          Components.DamageTracking
        );
        deadSwarms.push({
          entity,
          swarmId,
          x: posComp.x,
          y: posComp.y,
          killerId: damageTracking?.lastBeamShooter,
          damageSource: damageTracking?.lastDamageSource,
          peakEnergy: energyComp.max, // max tracks peak energy absorbed
        });
      }
    });

    // Process swarm deaths
    for (const swarm of deadSwarms) {
      // Calculate maxEnergy reward as percentage of swarm's peak energy
      // Consumption: 25% bonus (since max is drained during consumption itself)
      // Beam: 10% bonus (beam doesn't drain max, so smaller bonus)
      const rewardPct = swarm.damageSource === 'consumption' ? 0.25 : 0.1;
      const maxEnergyGain = Math.floor(swarm.peakEnergy * rewardPct);

      // Award kill rewards to killer
      if (swarm.killerId) {
        const killerEntity = getEntityBySocketId(swarm.killerId);
        if (killerEntity) {
          addEnergy(world, killerEntity, GAME_CONFIG.SWARM_ENERGY_GAIN);
          const killerEnergy = getEnergy(world, killerEntity);
          if (killerEnergy) {
            setMaxEnergy(world, killerEntity, killerEnergy.max + maxEnergyGain);
          }

          logger.info({
            event: 'swarm_killed',
            killerId: swarm.killerId,
            swarmId: swarm.swarmId,
            damageSource: swarm.damageSource,
            swarmPeakEnergy: swarm.peakEnergy,
            rewardPct: rewardPct,
            energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
            maxEnergyGained: maxEnergyGain,
          });
        }
      }

      io.emit('swarmConsumed', {
        type: 'swarmConsumed',
        consumerId: swarm.killerId || 'unknown',
        swarmId: swarm.swarmId,
        energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
        maxEnergyGained: maxEnergyGain,
      });

      // Remove swarm and schedule respawn
      removeSwarm(world, swarm.swarmId);
    }
  }
}
