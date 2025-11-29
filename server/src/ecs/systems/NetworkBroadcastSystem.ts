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
import {
  forEachPlayer,
  forEachNutrient,
  Components,
  type EnergyComponent,
  type PositionComponent,
  type StageComponent,
} from '../index';
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
    const { world, io } = ctx;

    this.energyUpdateTicks++;

    if (this.energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
      this.energyUpdateTicks = 0;

      forEachPlayer(world, (entity, playerId) => {
        const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
        if (!energyComp || energyComp.current <= 0) return;

        const updateMessage: EnergyUpdateMessage = {
          type: 'energyUpdate',
          playerId,
          energy: energyComp.current,
        };
        io.emit('energyUpdate', updateMessage);
      });
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
      if (damages.length === 0) continue; // Defensive check

      // Sum total damage rate
      const totalDamageRate = damages.reduce((sum, d) => sum + d.damageRate, 0);

      // Find dominant source (highest damage) - use spread to avoid mutating shared state
      const sorted = [...damages].sort((a, b) => b.damageRate - a.damageRate);
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
    const { world, io, getSwarms } = ctx;

    this.detectionUpdateTicks++;

    if (this.detectionUpdateTicks >= DETECTION_UPDATE_INTERVAL) {
      this.detectionUpdateTicks = 0;

      forEachPlayer(world, (entity, playerId) => {
        const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
        const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
        const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
        if (!stageComp || !energyComp || !posComp) return;

        // Only multi-cells and above have chemical sensing
        if (stageComp.stage === EvolutionStage.SINGLE_CELL) return;
        if (energyComp.current <= 0) return;

        const playerPosition = { x: posComp.x, y: posComp.y };
        const detected: DetectedEntity[] = [];

        // Detect other players (potential prey or threats)
        forEachPlayer(world, (otherEntity, otherId) => {
          if (otherId === playerId) return;

          const otherEnergy = world.getComponent<EnergyComponent>(otherEntity, Components.Energy);
          const otherPos = world.getComponent<PositionComponent>(otherEntity, Components.Position);
          const otherStage = world.getComponent<StageComponent>(otherEntity, Components.Stage);
          if (!otherEnergy || !otherPos || !otherStage) return;
          if (otherEnergy.current <= 0) return;

          const otherPosition = { x: otherPos.x, y: otherPos.y };
          const dist = distance(playerPosition, otherPosition);
          if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
            detected.push({
              id: otherId,
              position: otherPosition,
              entityType: 'player',
              stage: otherStage.stage,
            });
          }
        });

        // Detect nutrients (from ECS)
        forEachNutrient(world, (_entity, nutrientId, nutrientPos) => {
          const dist = distance(playerPosition, nutrientPos);
          if (dist <= getConfig('MULTI_CELL_DETECTION_RADIUS')) {
            detected.push({
              id: nutrientId,
              position: nutrientPos,
              entityType: 'nutrient',
            });
          }
        });

        // Detect swarms (potential prey for multi-cells)
        for (const [swarmId, swarm] of getSwarms()) {
          const dist = distance(playerPosition, swarm.position);
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
      });
    }
  }
}
