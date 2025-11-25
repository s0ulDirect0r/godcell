import pino from 'pino';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { DeathCause } from '@godcell/shared';

// ============================================
// Logger Configuration
// ============================================

// Ensure logs directory exists
const LOG_DIR = process.env.LOG_DIR || 'logs';
const LOG_FILE = `${LOG_DIR}/server.log`;

await mkdir(LOG_DIR, { recursive: true });

// Create a multistream that writes to both console and file
const streams = [
  // Console stream with pretty printing for development
  {
    level: process.env.LOG_LEVEL || 'info',
    stream: pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    }),
  },
  // File stream with JSON for production/debugging
  {
    level: 'info',
    stream: createWriteStream(LOG_FILE, { flags: 'a' }),
  },
];

// Create logger with multiple outputs
export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
  },
  pino.multistream(streams)
);

// ============================================
// Convenience Methods for Game Events
// ============================================

/**
 * Log a player connection
 */
export function logPlayerConnected(socketId: string) {
  logger.info({ socketId, event: 'player_connected' }, 'Player connected');
}

/**
 * Log a player disconnection
 */
export function logPlayerDisconnected(socketId: string) {
  logger.info({ socketId, event: 'player_disconnected' }, 'Player disconnected');
}

/**
 * Log a player death
 */
export function logPlayerDeath(playerId: string, cause: DeathCause) {
  logger.info({ playerId, cause, event: 'player_died' }, `Player died: ${cause}`);
}

/**
 * Log a player respawn
 */
export function logPlayerRespawn(playerId: string) {
  logger.info({ playerId, event: 'player_respawned' }, 'Player respawned');
}

/**
 * Log a player evolution
 */
export function logPlayerEvolution(playerId: string, stage: string) {
  logger.info({ playerId, stage, event: 'player_evolved' }, `Player evolved to ${stage}`);
}

/**
 * Log bot spawning
 */
export function logBotsSpawned(count: number) {
  logger.info({ count, event: 'bots_spawned' }, `Spawned ${count} AI bots`);
}

/**
 * Log bot death with cause
 */
export function logBotDeath(botId: string, cause?: DeathCause, stage?: string) {
  logger.info({ botId, cause, stage, event: 'bot_died' }, `Bot died: ${cause || 'unknown'}`);

  // Track for death rate metrics
  if (cause) {
    recordBotDeath(cause, stage);
  }
}

/**
 * Log bot respawn
 */
export function logBotRespawn(botId: string) {
  logger.info({ botId, event: 'bot_respawned' }, 'Bot respawned');
}

/**
 * Log server startup
 */
export function logServerStarted(port: number) {
  logger.info({ port, event: 'server_started' }, `Game server running on port ${port}`);
}

/**
 * Log nutrient spawning
 */
export function logNutrientsSpawned(count: number) {
  logger.info({ count, event: 'nutrients_spawned' }, `Spawned ${count} nutrients`);
}

/**
 * Log obstacle spawning
 */
export function logObstaclesSpawned(count: number) {
  logger.info({ count, event: 'obstacles_spawned' }, `Spawned ${count} gravity distortions`);
}

/**
 * Log gravity/physics debug info
 */
export function logGravityDebug(playerId: string, distance: number, force: number, velocity: { x: number; y: number }) {
  logger.debug(
    { playerId, distance, force, velocity, event: 'gravity_applied' },
    `Gravity applied: dist=${distance.toFixed(0)}px, force=${force.toFixed(2)} px/s`
  );
}

/**
 * Log singularity crush
 */
export function logSingularityCrush(playerId: string, distance: number) {
  logger.info(
    { playerId, distance, event: 'singularity_crush' },
    `Player crushed by singularity at dist ${distance.toFixed(1)}px`
  );
}

// ============================================
// Game State Logging
// ============================================

/**
 * Log aggregate game statistics (lightweight, frequent)
 * Use this for high-level monitoring without overwhelming logs
 * Energy-only system: energy is the sole life resource
 */
export function logAggregateStats(stats: {
  totalPlayers: number;
  alivePlayers: number;
  deadPlayers: number;
  totalBots: number;
  aliveBots: number;
  avgPlayerEnergy: number;
  totalNutrients: number;
  stageDistribution: Record<string, number>; // e.g., {"single-cell": 3, "multi-cell": 1}
}) {
  logger.info(
    {
      ...stats,
      event: 'aggregate_stats',
    },
    `Stats: ${stats.alivePlayers}/${stats.totalPlayers} players alive, ${stats.totalNutrients} nutrients, avg energy: ${stats.avgPlayerEnergy.toFixed(0)}`
  );
}

/**
 * Log complete game state snapshot (heavy, infrequent)
 * Use this for detailed debugging and post-mortem analysis
 * Energy-only system: energy is the sole life resource
 */
export function logGameStateSnapshot(snapshot: {
  timestamp: number;
  players: Array<{
    id: string;
    isBot: boolean;
    stage: string;
    energy: number;
    maxEnergy: number;
    position: { x: number; y: number };
    alive: boolean;
  }>;
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
}) {
  logger.info(
    {
      ...snapshot,
      event: 'game_state_snapshot',
      playerCount: snapshot.players.length,
      nutrientCount: snapshot.nutrients.length,
      obstacleCount: snapshot.obstacles.length,
    },
    `Game state snapshot: ${snapshot.players.length} players, ${snapshot.nutrients.length} nutrients`
  );
}

// ============================================
// Bot Death Rate Tracking
// ============================================

// Rolling window for death tracking (default: 60 seconds)
const DEATH_RATE_WINDOW_MS = 60_000;

// Death records with timestamps
interface DeathRecord {
  timestamp: number;
  cause: DeathCause;
  stage?: string;
}

// In-memory death tracking (rolling window)
const deathRecords: DeathRecord[] = [];

// Last report time for periodic logging
let lastDeathRateReport = Date.now();
const DEATH_RATE_REPORT_INTERVAL_MS = 30_000; // Report every 30 seconds

/**
 * Record a bot death for rate tracking
 * Called internally by logBotDeath
 */
function recordBotDeath(cause: DeathCause, stage?: string): void {
  const now = Date.now();

  // Add new death record
  deathRecords.push({ timestamp: now, cause, stage });

  // Prune old records outside the window
  const cutoff = now - DEATH_RATE_WINDOW_MS;
  while (deathRecords.length > 0 && deathRecords[0].timestamp < cutoff) {
    deathRecords.shift();
  }
}

/**
 * Get current death rate statistics
 * Returns deaths per minute by cause, plus totals
 */
export function getDeathRateStats(): {
  totalDeaths: number;
  deathsPerMinute: number;
  byCause: Record<DeathCause, number>;
  byStage: Record<string, number>;
  windowSeconds: number;
} {
  const now = Date.now();
  const cutoff = now - DEATH_RATE_WINDOW_MS;

  // Filter to only records within window
  const recentDeaths = deathRecords.filter((d) => d.timestamp >= cutoff);

  // Count by cause
  const byCause: Record<DeathCause, number> = {
    starvation: 0,
    singularity: 0,
    swarm: 0,
    obstacle: 0,
    predation: 0,
    beam: 0,
  };

  // Count by stage
  const byStage: Record<string, number> = {};

  for (const death of recentDeaths) {
    byCause[death.cause]++;
    if (death.stage) {
      byStage[death.stage] = (byStage[death.stage] || 0) + 1;
    }
  }

  // Calculate deaths per minute
  const windowMinutes = DEATH_RATE_WINDOW_MS / 60_000;
  const totalDeaths = recentDeaths.length;
  const deathsPerMinute = totalDeaths / windowMinutes;

  return {
    totalDeaths,
    deathsPerMinute,
    byCause,
    byStage,
    windowSeconds: DEATH_RATE_WINDOW_MS / 1000,
  };
}

/**
 * Log death rate statistics if interval has passed
 * Call this from the main game loop periodically
 * Returns true if a report was logged
 */
export function maybeLogDeathRateStats(): boolean {
  const now = Date.now();
  if (now - lastDeathRateReport < DEATH_RATE_REPORT_INTERVAL_MS) {
    return false;
  }

  lastDeathRateReport = now;
  const stats = getDeathRateStats();

  // Only log if there were any deaths in the window
  if (stats.totalDeaths === 0) {
    return false;
  }

  // Format cause breakdown (only non-zero causes)
  const causeBreakdown = Object.entries(stats.byCause)
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => `${cause}:${count}`)
    .join(', ');

  // Format stage breakdown (only non-zero stages)
  const stageBreakdown = Object.entries(stats.byStage)
    .filter(([, count]) => count > 0)
    .map(([stage, count]) => `${stage}:${count}`)
    .join(', ');

  logger.info(
    {
      event: 'bot_death_rate',
      ...stats,
    },
    `Bot deaths: ${stats.deathsPerMinute.toFixed(1)}/min (${stats.totalDeaths} in ${stats.windowSeconds}s) | Causes: ${causeBreakdown || 'none'}${stageBreakdown ? ` | Stages: ${stageBreakdown}` : ''}`
  );

  return true;
}

/**
 * Force log death rate stats immediately (useful for debugging)
 */
export function logDeathRateStats(): void {
  const stats = getDeathRateStats();

  const causeBreakdown = Object.entries(stats.byCause)
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => `${cause}:${count}`)
    .join(', ');

  logger.info(
    {
      event: 'bot_death_rate',
      ...stats,
    },
    `Bot deaths: ${stats.deathsPerMinute.toFixed(1)}/min (${stats.totalDeaths} in ${stats.windowSeconds}s) | Causes: ${causeBreakdown || 'none'}`
  );
}

/**
 * Reset death tracking (useful for comparing before/after changes)
 */
export function resetDeathTracking(): void {
  deathRecords.length = 0;
  lastDeathRateReport = Date.now();
  logger.info({ event: 'death_tracking_reset' }, 'Death rate tracking reset');
}

// ============================================
// Evolution Rate Tracking
// ============================================

// Rolling window for evolution tracking (default: 60 seconds)
const EVOLUTION_RATE_WINDOW_MS = 60_000;

// Evolution records with timestamps
interface EvolutionRecord {
  timestamp: number;
  fromStage: string;
  toStage: string;
  isBot: boolean;
  survivalTime: number; // How long they survived at previous stage (ms)
}

// In-memory evolution tracking (rolling window)
const evolutionRecords: EvolutionRecord[] = [];

// Track spawn times to calculate survival duration
const spawnTimes: Map<string, { timestamp: number; stage: string }> = new Map();

// Last report time for periodic logging
let lastEvolutionRateReport = Date.now();
const EVOLUTION_RATE_REPORT_INTERVAL_MS = 30_000; // Report every 30 seconds

/**
 * Record when an entity spawns (to track survival time until evolution)
 */
export function recordSpawn(entityId: string, stage: string): void {
  spawnTimes.set(entityId, { timestamp: Date.now(), stage });
}

/**
 * Record an evolution event for rate tracking
 * Call this when a bot or player evolves
 */
export function recordEvolution(entityId: string, fromStage: string, toStage: string, isBot: boolean): void {
  const now = Date.now();

  // Calculate survival time at previous stage
  let survivalTime = 0;
  const spawnInfo = spawnTimes.get(entityId);
  if (spawnInfo) {
    survivalTime = now - spawnInfo.timestamp;
    // Update spawn time to track time at new stage
    spawnTimes.set(entityId, { timestamp: now, stage: toStage });
  }

  // Add evolution record
  evolutionRecords.push({ timestamp: now, fromStage, toStage, isBot, survivalTime });

  // Prune old records outside the window
  const cutoff = now - EVOLUTION_RATE_WINDOW_MS;
  while (evolutionRecords.length > 0 && evolutionRecords[0].timestamp < cutoff) {
    evolutionRecords.shift();
  }
}

/**
 * Clean up spawn tracking when entity dies/disconnects
 */
export function clearSpawnTime(entityId: string): void {
  spawnTimes.delete(entityId);
}

/**
 * Get current evolution rate statistics
 * Returns evolutions per minute by transition type
 */
export function getEvolutionRateStats(): {
  totalEvolutions: number;
  evolutionsPerMinute: number;
  byTransition: Record<string, number>; // e.g., "single-cell→multi-cell": 5
  botEvolutions: number;
  playerEvolutions: number;
  avgSurvivalTimeMs: Record<string, number>; // avg time at each stage before evolving
  windowSeconds: number;
} {
  const now = Date.now();
  const cutoff = now - EVOLUTION_RATE_WINDOW_MS;

  // Filter to only records within window
  const recentEvolutions = evolutionRecords.filter((e) => e.timestamp >= cutoff);

  // Count by transition
  const byTransition: Record<string, number> = {};
  const survivalTimes: Record<string, number[]> = {};
  let botEvolutions = 0;
  let playerEvolutions = 0;

  for (const evo of recentEvolutions) {
    const transitionKey = `${evo.fromStage}→${evo.toStage}`;
    byTransition[transitionKey] = (byTransition[transitionKey] || 0) + 1;

    // Track survival times by fromStage
    if (!survivalTimes[evo.fromStage]) {
      survivalTimes[evo.fromStage] = [];
    }
    if (evo.survivalTime > 0) {
      survivalTimes[evo.fromStage].push(evo.survivalTime);
    }

    if (evo.isBot) {
      botEvolutions++;
    } else {
      playerEvolutions++;
    }
  }

  // Calculate average survival times
  const avgSurvivalTimeMs: Record<string, number> = {};
  for (const [stage, times] of Object.entries(survivalTimes)) {
    if (times.length > 0) {
      avgSurvivalTimeMs[stage] = times.reduce((a, b) => a + b, 0) / times.length;
    }
  }

  // Calculate evolutions per minute
  const windowMinutes = EVOLUTION_RATE_WINDOW_MS / 60_000;
  const totalEvolutions = recentEvolutions.length;
  const evolutionsPerMinute = totalEvolutions / windowMinutes;

  return {
    totalEvolutions,
    evolutionsPerMinute,
    byTransition,
    botEvolutions,
    playerEvolutions,
    avgSurvivalTimeMs,
    windowSeconds: EVOLUTION_RATE_WINDOW_MS / 1000,
  };
}

/**
 * Log evolution rate statistics if interval has passed
 * Returns true if a report was logged
 */
export function maybeLogEvolutionRateStats(): boolean {
  const now = Date.now();
  if (now - lastEvolutionRateReport < EVOLUTION_RATE_REPORT_INTERVAL_MS) {
    return false;
  }

  lastEvolutionRateReport = now;
  const stats = getEvolutionRateStats();

  // Only log if there were any evolutions in the window
  if (stats.totalEvolutions === 0) {
    return false;
  }

  // Format transition breakdown
  const transitionBreakdown = Object.entries(stats.byTransition)
    .map(([transition, count]) => `${transition}:${count}`)
    .join(', ');

  // Format average survival times (convert to seconds for readability)
  const survivalBreakdown = Object.entries(stats.avgSurvivalTimeMs)
    .map(([stage, ms]) => `${stage}:${(ms / 1000).toFixed(1)}s`)
    .join(', ');

  logger.info(
    {
      event: 'evolution_rate',
      ...stats,
    },
    `Evolutions: ${stats.evolutionsPerMinute.toFixed(1)}/min (${stats.botEvolutions} bots, ${stats.playerEvolutions} players) | ${transitionBreakdown}${survivalBreakdown ? ` | Avg survival: ${survivalBreakdown}` : ''}`
  );

  return true;
}

/**
 * Force log evolution rate stats immediately
 */
export function logEvolutionRateStats(): void {
  const stats = getEvolutionRateStats();

  const transitionBreakdown = Object.entries(stats.byTransition)
    .map(([transition, count]) => `${transition}:${count}`)
    .join(', ');

  const survivalBreakdown = Object.entries(stats.avgSurvivalTimeMs)
    .map(([stage, ms]) => `${stage}:${(ms / 1000).toFixed(1)}s`)
    .join(', ');

  logger.info(
    {
      event: 'evolution_rate',
      ...stats,
    },
    `Evolutions: ${stats.evolutionsPerMinute.toFixed(1)}/min (${stats.botEvolutions} bots, ${stats.playerEvolutions} players) | ${transitionBreakdown || 'none'}${survivalBreakdown ? ` | Avg survival: ${survivalBreakdown}` : ''}`
  );
}

/**
 * Reset evolution tracking
 */
export function resetEvolutionTracking(): void {
  evolutionRecords.length = 0;
  spawnTimes.clear();
  lastEvolutionRateReport = Date.now();
  logger.info({ event: 'evolution_tracking_reset' }, 'Evolution rate tracking reset');
}
