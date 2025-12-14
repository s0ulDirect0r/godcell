// ============================================
// Telemetry Module
// Functions for calculating aggregate game statistics
// and creating periodic game state snapshots for logging
// ============================================

import {
  forEachPlayer,
  getEnergy,
  getPosition,
  getStage,
  getNutrientCount,
  getDataFruitCount,
  getAllNutrientSnapshots,
  getAllObstacleSnapshots,
  type World,
} from './ecs';
import { isBot } from './bots';

/**
 * Aggregate statistics about the game state
 */
export interface AggregateStats {
  totalPlayers: number;
  alivePlayers: number;
  deadPlayers: number;
  totalBots: number;
  aliveBots: number;
  avgPlayerEnergy: number;
  totalNutrients: number;
  totalDataFruits: number;
  stageDistribution: Record<string, number>;
}

/**
 * Player snapshot for game state logging
 */
export interface PlayerSnapshot {
  id: string;
  isBot: boolean;
  stage: string;
  energy: number;
  maxEnergy: number;
  position: { x: number; y: number };
  alive: boolean;
}

/**
 * Complete world snapshot for periodic telemetry logging
 */
export interface WorldSnapshot {
  timestamp: number;
  players: PlayerSnapshot[];
  nutrients: Array<{
    id: string;
    position: { x: number; y: number };
    value: number;
  }>;
  obstacles: Array<{
    id: string;
    position: { x: number; y: number };
    radius: number;
  }>;
}

/**
 * Calculate aggregate statistics about the game state
 * Energy-only system: energy is the sole life resource
 */
export function calculateAggregateStats(world: World): AggregateStats {
  // Collect stats using ECS iteration
  const stats = {
    totalPlayers: 0,
    alivePlayers: 0,
    deadPlayers: 0,
    totalBots: 0,
    aliveBots: 0,
    totalEnergy: 0,
    stageDistribution: {} as Record<string, number>,
  };

  forEachPlayer(world, (entity, id) => {
    // Use entity-based helpers directly (entity is already available from forEachPlayer)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    if (!energyComp || !stageComp) return;

    stats.totalPlayers++;
    const isAlive = energyComp.current > 0;
    const isBotPlayer = isBot(id);

    if (isAlive) {
      stats.alivePlayers++;
      stats.totalEnergy += energyComp.current;
      stats.stageDistribution[stageComp.stage] =
        (stats.stageDistribution[stageComp.stage] || 0) + 1;
    } else {
      stats.deadPlayers++;
    }

    if (isBotPlayer) {
      stats.totalBots++;
      if (isAlive) stats.aliveBots++;
    }
  });

  return {
    totalPlayers: stats.totalPlayers,
    alivePlayers: stats.alivePlayers,
    deadPlayers: stats.deadPlayers,
    totalBots: stats.totalBots,
    aliveBots: stats.aliveBots,
    avgPlayerEnergy: stats.alivePlayers > 0 ? stats.totalEnergy / stats.alivePlayers : 0,
    totalNutrients: getNutrientCount(world),
    totalDataFruits: getDataFruitCount(world),
    stageDistribution: stats.stageDistribution,
  };
}

/**
 * Create a complete world snapshot for telemetry logging
 * Energy-only system: energy is the sole life resource
 */
export function createWorldSnapshot(world: World): WorldSnapshot {
  // Build players array using ECS iteration
  const playerSnapshots: PlayerSnapshot[] = [];

  forEachPlayer(world, (entity, id) => {
    // Use entity-based helpers directly (entity is already available from forEachPlayer)
    const energyComp = getEnergy(world, entity);
    const stageComp = getStage(world, entity);
    const posComp = getPosition(world, entity);
    if (!energyComp || !stageComp || !posComp) return;

    playerSnapshots.push({
      id,
      isBot: isBot(id),
      stage: stageComp.stage,
      energy: energyComp.current,
      maxEnergy: energyComp.max,
      position: { x: posComp.x, y: posComp.y },
      alive: energyComp.current > 0,
    });
  });

  return {
    timestamp: Date.now(),
    players: playerSnapshots,
    nutrients: getAllNutrientSnapshots(world).map((n) => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      value: n.value,
    })),
    obstacles: getAllObstacleSnapshots(world).map((o) => ({
      id: o.id,
      position: { x: o.position.x, y: o.position.y },
      radius: o.radius,
    })),
  };
}
