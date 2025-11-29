// ============================================
// Network Broadcast System
// Handles all network broadcasts at end of tick
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';
import type {
  EnergyUpdateMessage,
  DetectionUpdateMessage,
  PlayerDrainStateMessage,
  DetectedEntity,
  DamageSource,
} from '@godcell/shared';
import { EvolutionStage, GAME_CONFIG } from '@godcell/shared';
import { distance } from '../../helpers';
import { getConfig } from '../../dev';

// Broadcast intervals (in ticks)
const ENERGY_UPDATE_INTERVAL = 10; // ~6 times/sec at 60fps
const DETECTION_UPDATE_INTERVAL = 15; // ~4 times/sec at 60fps

/**
 * NetworkBroadcastSystem - Handles end-of-tick broadcasts
 *
 * Broadcasts:
 * - Energy updates (throttled)
 * - Detection updates (throttled)
 * - Drain state updates
 *
 * This system runs last (highest priority number).
 *
 * TODO Phase 5: Replace players/nutrients Map iteration with ECS iteration
 */
export class NetworkBroadcastSystem implements System {
  readonly name = 'NetworkBroadcastSystem';

  // Tick counters for throttled broadcasts
  private energyUpdateTicks = 0;
  private detectionUpdateTicks = 0;

  update(ctx: GameContext): void {
    this.broadcastEnergyUpdates(ctx);
    this.broadcastDrainState(ctx);
    this.broadcastDetectionUpdates(ctx);
  }

  /**
   * Broadcast energy updates to clients (throttled)
   * Energy-only system: energy is the sole resource
   */
  private broadcastEnergyUpdates(ctx: GameContext): void {
    const { io, players } = ctx;

    this.energyUpdateTicks++;

    if (this.energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
      this.energyUpdateTicks = 0;

      for (const [playerId, player] of players) {
        // Skip dead players (no need to broadcast their energy)
        if (player.energy <= 0) continue;

        const updateMessage: EnergyUpdateMessage = {
          type: 'energyUpdate',
          playerId,
          energy: player.energy,
        };
        io.emit('energyUpdate', updateMessage);
      }
    }
  }

  /**
   * Broadcast drain state updates to clients
   * Sends comprehensive damage info for variable-intensity drain auras
   */
  private broadcastDrainState(ctx: GameContext): void {
    const { io, pseudopodHitDecays, activeSwarmDrains, activeDamage, recordDamage } = ctx;

    // Add pseudopod hit decays to active damage (if not expired)
    const now = Date.now();
    for (const [playerId, decay] of pseudopodHitDecays) {
      if (now < decay.expiresAt) {
        recordDamage(playerId, decay.rate, 'beam');
      } else {
        pseudopodHitDecays.delete(playerId); // Clean up expired
      }
    }

    // Aggregate damage info per player
    const damageInfo: Record<string, { totalDamageRate: number; primarySource: DamageSource; proximityFactor?: number }> = {};

    for (const [playerId, damages] of activeDamage) {
      // Sum total damage rate
      const totalDamageRate = damages.reduce((sum, d) => sum + d.damageRate, 0);

      // Find dominant source (highest damage)
      const sorted = damages.sort((a, b) => b.damageRate - a.damageRate);
      const primarySource = sorted[0].source;

      // Average proximity factors for gravity (if any)
      const proximityFactors = damages
        .filter(d => d.proximityFactor !== undefined)
        .map(d => d.proximityFactor!);
      const proximityFactor =
        proximityFactors.length > 0
          ? proximityFactors.reduce((sum, p) => sum + p, 0) / proximityFactors.length
          : undefined;

      damageInfo[playerId] = { totalDamageRate, primarySource, proximityFactor };
    }

    // Build damage info for swarms being consumed
    const swarmDamageInfo: Record<string, { totalDamageRate: number; primarySource: DamageSource }> = {};

    for (const swarmId of activeSwarmDrains) {
      // Swarms being consumed are taking damage from predation (multi-cell contact drain)
      swarmDamageInfo[swarmId] = {
        totalDamageRate: GAME_CONFIG.SWARM_CONSUMPTION_RATE,
        primarySource: 'predation',
      };
    }

    const drainStateMessage: PlayerDrainStateMessage = {
      type: 'playerDrainState',
      drainedPlayerIds: [], // deprecated
      drainedSwarmIds: [],  // deprecated
      damageInfo,
      swarmDamageInfo,
    };

    io.emit('playerDrainState', drainStateMessage);

    // Clear for next tick
    activeDamage.clear();
  }

  /**
   * Broadcast detected entities to multi-cell players (chemical sensing)
   * Multi-cells can "smell" nearby prey and nutrients from extended range
   */
  private broadcastDetectionUpdates(ctx: GameContext): void {
    const { io, players, nutrients, getSwarms } = ctx;

    this.detectionUpdateTicks++;

    if (this.detectionUpdateTicks >= DETECTION_UPDATE_INTERVAL) {
      this.detectionUpdateTicks = 0;

      for (const [playerId, player] of players) {
        // Only multi-cells and above have chemical sensing
        if (player.stage === EvolutionStage.SINGLE_CELL) continue;
        if (player.energy <= 0) continue; // Skip dead players

        const detected: DetectedEntity[] = [];

        // Detect other players (potential prey or threats)
        for (const [otherId, otherPlayer] of players) {
          if (otherId === playerId) continue; // Don't detect yourself
          if (otherPlayer.energy <= 0) continue; // Skip dead players

          const dist = distance(player.position, otherPlayer.position);
          if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
            detected.push({
              id: otherId,
              position: otherPlayer.position,
              entityType: 'player',
              stage: otherPlayer.stage,
            });
          }
        }

        // Detect nutrients
        for (const [nutrientId, nutrient] of nutrients) {
          const dist = distance(player.position, nutrient.position);
          if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
            detected.push({
              id: nutrientId,
              position: nutrient.position,
              entityType: 'nutrient',
            });
          }
        }

        // Detect swarms (potential prey for multi-cells)
        for (const [swarmId, swarm] of getSwarms()) {
          const dist = distance(player.position, swarm.position);
          if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
            detected.push({
              id: swarmId,
              position: swarm.position,
              entityType: 'swarm',
            });
          }
        }

        // Send detection update to this player only (private information)
        const socket = io.sockets.sockets.get(playerId);
        if (socket) {
          const detectionMessage: DetectionUpdateMessage = {
            type: 'detectionUpdate',
            detected,
          };
          socket.emit('detectionUpdate', detectionMessage);
        }
      }
    }
  }
}
