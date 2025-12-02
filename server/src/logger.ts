import pino from 'pino';
import type { DeathCause } from '@godcell/shared';

// ============================================
// Logger Configuration
// ============================================

const LOG_DIR = process.env.LOG_DIR || 'logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Create a logger with console + rotating file output
 * pino-roll is used as a Pino transport for file rotation
 * @param filename - Log file name (e.g., 'server.log')
 * @param component - Component name for filtering (e.g., 'server', 'perf', 'client')
 */
function createLogger(filename: string, component: string) {
  const targets: pino.TransportTargetOptions[] = [];

  // Console stream with pretty printing (development only)
  if (IS_DEV) {
    targets.push({
      level: LOG_LEVEL,
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    });
  }

  // Rotating file stream with JSON (always enabled)
  targets.push({
    level: 'info',
    target: 'pino-roll',
    options: {
      file: `${LOG_DIR}/${filename}`,
      size: '10m',         // Rotate at 10MB
      limit: { count: 5 }, // Keep last 5 rotated files
      mkdir: true,         // Create logs dir if needed
    },
  });

  return pino(
    {
      level: LOG_LEVEL,
      base: { component }, // Add component field to all log entries
    },
    pino.transport({ targets })
  );
}

// ============================================
// Logger Instances
// ============================================

// Game events (deaths, evolutions, spawns, game state)
export const logger = createLogger('server.log', 'server');

// Performance metrics (FPS, draw calls, entity counts)
export const perfLogger = createLogger('performance.log', 'perf');

// Client debug info (camera, debug commands, errors)
export const clientLogger = createLogger('client.log', 'client');

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
  totalDataFruits: number;
  stageDistribution: Record<string, number>; // e.g., {"single-cell": 3, "multi-cell": 1}
}) {
  logger.info(
    {
      ...stats,
      event: 'aggregate_stats',
    },
    `Stats: ${stats.alivePlayers}/${stats.totalPlayers} players alive, ${stats.totalNutrients} nutrients, ${stats.totalDataFruits} fruits, avg energy: ${stats.avgPlayerEnergy.toFixed(0)}`
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

  // Also record for lifetime stats (forward reference, defined later in file)
  recordLifetimeEvolutionInternal(isBot);
}

// Internal function to avoid circular reference - will be set up after lifetime stats section
let recordLifetimeEvolutionInternal = (_isBot: boolean) => {};
let recordLifetimeCollectionInternal = (_isBot: boolean, _energy: number) => {};
let recordLifetimeDeathInternal = (_cause: DeathCause) => {};

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

// ============================================
// Nutrient Collection Rate Tracking
// ============================================

const NUTRIENT_RATE_WINDOW_MS = 60_000; // 60 second rolling window
const NUTRIENT_RATE_REPORT_INTERVAL_MS = 30_000; // Report every 30 seconds

interface NutrientCollectionRecord {
  timestamp: number;
  isBot: boolean;
  energyGained: number;
}

const nutrientRecords: NutrientCollectionRecord[] = [];
let lastNutrientRateReport = Date.now();

/**
 * Record a nutrient collection event
 */
export function recordNutrientCollection(entityId: string, energyGained: number): void {
  const isBot = entityId.startsWith('bot-');
  nutrientRecords.push({
    timestamp: Date.now(),
    isBot,
    energyGained,
  });
  // Also record for lifetime stats
  recordLifetimeCollectionInternal(isBot, energyGained);
}

/**
 * Get nutrient collection rate stats for the rolling window
 */
export function getNutrientCollectionStats(): {
  collectionsPerMinute: number;
  botCollections: number;
  playerCollections: number;
  totalEnergyGained: number;
  avgEnergyPerCollection: number;
} {
  const now = Date.now();
  const windowStart = now - NUTRIENT_RATE_WINDOW_MS;

  // Clean old records
  while (nutrientRecords.length > 0 && nutrientRecords[0].timestamp < windowStart) {
    nutrientRecords.shift();
  }

  const totalCollections = nutrientRecords.length;
  const botCollections = nutrientRecords.filter((r) => r.isBot).length;
  const playerCollections = totalCollections - botCollections;
  const totalEnergyGained = nutrientRecords.reduce((sum, r) => sum + r.energyGained, 0);

  // Calculate rate per minute
  const windowMinutes = NUTRIENT_RATE_WINDOW_MS / 60000;
  const collectionsPerMinute = totalCollections / windowMinutes;
  const avgEnergyPerCollection = totalCollections > 0 ? totalEnergyGained / totalCollections : 0;

  return {
    collectionsPerMinute,
    botCollections,
    playerCollections,
    totalEnergyGained,
    avgEnergyPerCollection,
  };
}

/**
 * Maybe log nutrient collection rate stats (throttled)
 */
export function maybeLogNutrientCollectionStats(): boolean {
  const now = Date.now();
  if (now - lastNutrientRateReport < NUTRIENT_RATE_REPORT_INTERVAL_MS) {
    return false;
  }
  lastNutrientRateReport = now;

  const stats = getNutrientCollectionStats();
  logger.info(
    {
      event: 'nutrient_collection_rate',
      ...stats,
    },
    `Nutrients: ${stats.collectionsPerMinute.toFixed(1)}/min (${stats.botCollections} bots, ${stats.playerCollections} players) | Avg ${stats.avgEnergyPerCollection.toFixed(1)} energy/collection`
  );
  return true;
}

// ============================================
// Lifetime Statistics (Server Uptime Averages)
// ============================================

const serverStartTime = Date.now();

// Lifetime counters
const lifetimeStats = {
  totalDeaths: 0,
  deathsByCause: {
    starvation: 0,
    singularity: 0,
    swarm: 0,
    obstacle: 0,
    predation: 0,
    beam: 0,
  } as Record<string, number>,
  totalEvolutions: 0,
  botEvolutions: 0,
  playerEvolutions: 0,
  totalNutrientCollections: 0,
  botCollections: 0,
  playerCollections: 0,
  totalEnergyCollected: 0,
};

/**
 * Record a death for lifetime stats
 */
export function recordLifetimeDeath(cause: DeathCause): void {
  lifetimeStats.totalDeaths++;
  lifetimeStats.deathsByCause[cause] = (lifetimeStats.deathsByCause[cause] || 0) + 1;
}

/**
 * Record an evolution for lifetime stats
 */
export function recordLifetimeEvolution(isBot: boolean): void {
  lifetimeStats.totalEvolutions++;
  if (isBot) {
    lifetimeStats.botEvolutions++;
  } else {
    lifetimeStats.playerEvolutions++;
  }
}

/**
 * Record a nutrient collection for lifetime stats
 */
export function recordLifetimeCollection(isBot: boolean, energy: number): void {
  lifetimeStats.totalNutrientCollections++;
  lifetimeStats.totalEnergyCollected += energy;
  if (isBot) {
    lifetimeStats.botCollections++;
  } else {
    lifetimeStats.playerCollections++;
  }
}

// Wire up the internal functions now that they're defined
recordLifetimeEvolutionInternal = recordLifetimeEvolution;
recordLifetimeCollectionInternal = recordLifetimeCollection;
recordLifetimeDeathInternal = recordLifetimeDeath;

/**
 * Get lifetime average stats
 */
export function getLifetimeStats(): {
  uptimeMinutes: number;
  avgDeathsPerMinute: number;
  avgDeathsByCausePerMinute: Record<string, number>;
  avgEvolutionsPerMinute: number;
  avgBotEvolutionsPerMinute: number;
  avgCollectionsPerMinute: number;
  avgBotCollectionsPerMinute: number;
  avgEnergyPerCollection: number;
  totals: typeof lifetimeStats;
} {
  const uptimeMs = Date.now() - serverStartTime;
  const uptimeMinutes = uptimeMs / 60_000;

  // Avoid division by zero for first few seconds
  const safeMinutes = Math.max(uptimeMinutes, 0.1);

  const avgDeathsByCausePerMinute: Record<string, number> = {};
  for (const [cause, count] of Object.entries(lifetimeStats.deathsByCause)) {
    avgDeathsByCausePerMinute[cause] = count / safeMinutes;
  }

  return {
    uptimeMinutes,
    avgDeathsPerMinute: lifetimeStats.totalDeaths / safeMinutes,
    avgDeathsByCausePerMinute,
    avgEvolutionsPerMinute: lifetimeStats.totalEvolutions / safeMinutes,
    avgBotEvolutionsPerMinute: lifetimeStats.botEvolutions / safeMinutes,
    avgCollectionsPerMinute: lifetimeStats.totalNutrientCollections / safeMinutes,
    avgBotCollectionsPerMinute: lifetimeStats.botCollections / safeMinutes,
    avgEnergyPerCollection: lifetimeStats.totalNutrientCollections > 0
      ? lifetimeStats.totalEnergyCollected / lifetimeStats.totalNutrientCollections
      : 0,
    totals: { ...lifetimeStats },
  };
}

const LIFETIME_STATS_REPORT_INTERVAL_MS = 60_000; // Report every 60 seconds
let lastLifetimeStatsReport = Date.now();

/**
 * Maybe log lifetime stats (throttled to once per minute)
 */
export function maybeLogLifetimeStats(): boolean {
  const now = Date.now();
  if (now - lastLifetimeStatsReport < LIFETIME_STATS_REPORT_INTERVAL_MS) {
    return false;
  }
  lastLifetimeStatsReport = now;

  const stats = getLifetimeStats();
  logger.info(
    {
      event: 'lifetime_stats',
      ...stats,
    },
    `LIFETIME (${stats.uptimeMinutes.toFixed(1)}min): Deaths ${stats.avgDeathsPerMinute.toFixed(1)}/min | Evolutions ${stats.avgEvolutionsPerMinute.toFixed(2)}/min (${stats.avgBotEvolutionsPerMinute.toFixed(2)} bots) | Collections ${stats.avgCollectionsPerMinute.toFixed(1)}/min`
  );
  return true;
}
