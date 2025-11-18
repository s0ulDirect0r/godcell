import pino from 'pino';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

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
export function logPlayerDeath(playerId: string, cause: 'starvation' | 'singularity') {
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
 * Log bot death
 */
export function logBotDeath(botId: string) {
  logger.info({ botId, event: 'bot_died' }, 'Bot died');
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
 */
export function logAggregateStats(stats: {
  totalPlayers: number;
  alivePlayers: number;
  deadPlayers: number;
  totalBots: number;
  aliveBots: number;
  avgPlayerEnergy: number;
  avgPlayerHealth: number;
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
 */
export function logGameStateSnapshot(snapshot: {
  timestamp: number;
  players: Array<{
    id: string;
    isBot: boolean;
    stage: string;
    health: number;
    maxHealth: number;
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
