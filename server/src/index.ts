import { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Position,
  Nutrient,
  Obstacle,
  DeathCause,
  DamageSource,
  Pseudopod,
  PlayerMoveMessage,
  PlayerRespawnRequestMessage,
  PseudopodFireMessage,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  NutrientMovedMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PlayerEvolutionStartedMessage,
  PlayerEvolvedMessage,
  PseudopodSpawnedMessage,
  PseudopodMovedMessage,
  PseudopodRetractedMessage,
  PlayerEngulfedMessage,
  DetectedEntity,
  DetectionUpdateMessage,
  EMPActivateMessage,
  EMPActivatedMessage,
  SwarmConsumedMessage,
  PlayerDrainStateMessage,
} from '@godcell/shared';
import { initializeBots, updateBots, isBot, handleBotDeath, spawnBotAt, removeBotPermanently } from './bots';
import { initializeSwarms, updateSwarms, updateSwarmPositions, checkSwarmCollisions, getSwarmsRecord, getSwarms, removeSwarm, processSwarmRespawns, spawnSwarmAt } from './swarms';
import { initDevHandler, handleDevCommand, isGamePaused, getTimeScale, hasGodMode, shouldRunTick, getConfig } from './dev';
import type { DevCommandMessage } from '@godcell/shared';
import {
  logger,
  logServerStarted,
  logPlayerConnected,
  logPlayerDisconnected,
  logPlayerDeath,
  logPlayerRespawn,
  logPlayerEvolution,
  logNutrientsSpawned,
  logObstaclesSpawned,
  logGravityDebug,
  logSingularityCrush,
  logAggregateStats,
  logGameStateSnapshot,
} from './logger';

// ============================================
// Server Configuration
// ============================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const TICK_RATE = 60; // Server updates 60 times per second
const TICK_INTERVAL = 1000 / TICK_RATE;

// ============================================
// Game State
// ============================================

// All players currently in the game
// Maps socket ID → Player data
const players: Map<string, Player> = new Map();

// Player input directions (from keyboard/controller)
// Maps socket ID → {x, y} direction (-1, 0, or 1)
const playerInputDirections: Map<string, { x: number; y: number }> = new Map();

// Player velocities (actual velocity in pixels/second, accumulates forces)
// Maps socket ID → {x, y} velocity
const playerVelocities: Map<string, { x: number; y: number }> = new Map();

// Track what last damaged each player (for death cause logging)
// Maps player ID → damage source
const playerLastDamageSource: Map<string, DeathCause> = new Map();

// Track who fired the beam that last hit each player (for kill rewards)
// Maps target player ID → shooter player ID
const playerLastBeamShooter: Map<string, string> = new Map();

// Pseudopods (hunting tentacles extended by multi-cells)
// Maps pseudopod ID → Pseudopod data
const pseudopods: Map<string, Pseudopod> = new Map();

// Pseudopod hit tracking (prevent multiple hits on same target per beam)
// Maps beam ID → Set of player IDs already hit
const pseudopodHits: Map<string, Set<string>> = new Map();

// Pseudopod cooldowns (prevent spam)
// Maps player ID → timestamp of last pseudopod extension
const playerPseudopodCooldowns: Map<string, number> = new Map();

// EMP cooldowns (prevent spam)
// Maps player ID → timestamp of last EMP use
const playerEMPCooldowns: Map<string, number> = new Map();

// Active energy drains (multi-cell draining prey on contact)
// Maps prey ID → predator ID
const activeDrains: Map<string, string> = new Map();

// Active swarm consumption (multi-cells eating disabled swarms)
// Set of swarm IDs currently being consumed
const activeSwarmDrains: Set<string> = new Set();

// NEW: Damage tracking system for variable-intensity drain auras
// Track all active damage sources per entity this tick
interface ActiveDamage {
  damageRate: number;        // DPS this tick
  source: DamageSource;      // Which damage source
  proximityFactor?: number;  // For gravity gradient (0-1, higher = closer to center)
}
const activeDamageThisTick = new Map<string, ActiveDamage[]>();

// Pseudopod hit decay timers (for brief aura after beam hits)
// Maps playerId → {rate, expiresAt}
const pseudopodHitDecays = new Map<string, { rate: number; expiresAt: number }>();

// All nutrients currently in the world
// Maps nutrient ID → Nutrient data
const nutrients: Map<string, Nutrient> = new Map();

// Timers for nutrient respawning
// Maps nutrient ID → NodeJS.Timeout
const nutrientRespawnTimers: Map<string, NodeJS.Timeout> = new Map();

// Counter for generating unique nutrient IDs
let nutrientIdCounter = 0;

// All gravity obstacles in the world
// Maps obstacle ID → Obstacle data
const obstacles: Map<string, Obstacle> = new Map();

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a random neon color for a new cyber-cell
 */
function randomColor(): string {
  return GAME_CONFIG.CELL_COLORS[Math.floor(Math.random() * GAME_CONFIG.CELL_COLORS.length)];
}

/**
 * Bridson's Poisson Disc Sampling Algorithm
 * Guarantees minimum separation between points while efficiently filling space
 * Returns array of positions with guaranteed minDist separation
 */
function poissonDiscSampling(
  width: number,
  height: number,
  minDist: number,
  maxPoints: number,
  existingPoints: Position[] = [],
  avoidanceZones: Array<{ position: Position; radius: number }> = []
): Position[] {
  const k = 30; // Candidates to try per active point
  const cellSize = minDist / Math.sqrt(2);
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);

  // Grid for O(1) neighbor lookups
  const grid: (Position | null)[][] = Array(gridWidth).fill(null).map(() => Array(gridHeight).fill(null));

  const points: Position[] = [];
  const active: Position[] = [];

  // Helper: Check if point is valid (far enough from all existing points and avoidance zones)
  const isValid = (point: Position): boolean => {
    // Check bounds
    if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) {
      return false;
    }

    // Check avoidance zones
    for (const zone of avoidanceZones) {
      if (distance(point, zone.position) < zone.radius) {
        return false;
      }
    }

    // Check existing points (from previous runs)
    for (const existing of existingPoints) {
      if (distance(point, existing) < minDist) {
        return false;
      }
    }

    // Check grid neighbors
    const gridX = Math.floor(point.x / cellSize);
    const gridY = Math.floor(point.y / cellSize);

    const searchRadius = 2; // Check 5x5 grid around point
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const nx = gridX + dx;
        const ny = gridY + dy;
        if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
          const neighbor = grid[nx][ny];
          if (neighbor && distance(point, neighbor) < minDist) {
            return false;
          }
        }
      }
    }

    return true;
  };

  // Start with random initial point (retry if invalid)
  let initial: Position | null = null;
  let initialAttempts = 0;
  const maxInitialAttempts = 100;

  while (initialAttempts < maxInitialAttempts && !initial) {
    const candidate = {
      x: Math.random() * width,
      y: Math.random() * height,
    };

    if (isValid(candidate)) {
      initial = candidate;
      points.push(initial);
      active.push(initial);
      const gridX = Math.floor(initial.x / cellSize);
      const gridY = Math.floor(initial.y / cellSize);
      grid[gridX][gridY] = initial;
    }

    initialAttempts++;
  }

  // If we can't find a valid initial point, the constraints are too tight
  if (!initial) {
    return points; // Return empty array
  }

  // Generate points
  while (active.length > 0 && points.length < maxPoints) {
    const randomIndex = Math.floor(Math.random() * active.length);
    const point = active[randomIndex];
    let found = false;

    // Try k candidates in annulus around this point
    for (let i = 0; i < k; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = minDist * (1 + Math.random()); // Between minDist and 2*minDist

      const candidate = {
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      };

      if (isValid(candidate)) {
        points.push(candidate);
        active.push(candidate);
        const gridX = Math.floor(candidate.x / cellSize);
        const gridY = Math.floor(candidate.y / cellSize);
        grid[gridX][gridY] = candidate;
        found = true;
        break;
      }
    }

    // Remove from active list if no valid candidates found
    if (!found) {
      active.splice(randomIndex, 1);
    }
  }

  return points;
}

/**
 * Generate a random spawn position in the digital ocean
 * Avoids spawning directly in obstacle death zones (200px safety radius)
 */
function randomSpawnPosition(): Position {
  const padding = 100;
  const MIN_DIST_FROM_OBSTACLE_CORE = 200; // Don't spawn in event horizon
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const position = {
      x: padding + Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2),
      y: padding + Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2),
    };

    // Check distance from all obstacle cores
    let tooClose = false;
    for (const obstacle of obstacles.values()) {
      if (distance(position, obstacle.position) < MIN_DIST_FROM_OBSTACLE_CORE) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      return position;
    }
  }

  // If we can't find a safe spot after maxAttempts, spawn anyway
  // (extremely unlikely with 12 obstacles on a 4800x3200 map)
  return {
    x: padding + Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2),
    y: padding + Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2),
  };
}

/**
 * Calculate distance between two positions
 */
function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a line segment (ray) intersects a circle
 * Returns the distance along the ray to the intersection, or null if no intersection
 */
function rayCircleIntersection(
  rayStart: Position,
  rayEnd: Position,
  circleCenter: Position,
  circleRadius: number
): number | null {
  // Ray direction vector
  const dx = rayEnd.x - rayStart.x;
  const dy = rayEnd.y - rayStart.y;
  const rayLength = Math.sqrt(dx * dx + dy * dy);

  if (rayLength < 0.001) return null; // Degenerate ray

  // Normalized ray direction
  const dirX = dx / rayLength;
  const dirY = dy / rayLength;

  // Vector from ray start to circle center
  const toCircleX = circleCenter.x - rayStart.x;
  const toCircleY = circleCenter.y - rayStart.y;

  // Project circle center onto ray
  const projection = toCircleX * dirX + toCircleY * dirY;

  // Find closest point on ray to circle center
  const closestT = Math.max(0, Math.min(rayLength, projection));
  const closestX = rayStart.x + dirX * closestT;
  const closestY = rayStart.y + dirY * closestT;

  // Distance from closest point to circle center
  const distToCenter = distance({ x: closestX, y: closestY }, circleCenter);

  // Check if intersection occurs
  if (distToCenter <= circleRadius) {
    return closestT; // Return distance along ray to intersection
  }

  return null;
}

/**
 * Hitscan raycast for pseudopod beam
 * Checks line-circle intersection against all multi-cell players
 * Applies damage to closest hit and returns target ID
 */
function checkBeamHitscan(start: Position, end: Position, shooterId: string): string | null {
  let closestHit: { playerId: string; distance: number } | null = null;

  for (const [playerId, target] of players) {
    // Skip shooter
    if (playerId === shooterId) continue;

    // Only multi-cells can be hit by beams
    if (target.stage === EvolutionStage.SINGLE_CELL) continue;

    // Skip dead/evolving/stunned players
    if (target.energy <= 0) continue;
    if (target.isEvolving) continue;
    if (target.stunnedUntil && Date.now() < target.stunnedUntil) continue;

    const targetRadius = getPlayerRadius(target.stage);
    const hitDist = rayCircleIntersection(start, end, target.position, targetRadius);

    if (hitDist !== null) {
      // Track closest hit
      if (!closestHit || hitDist < closestHit.distance) {
        closestHit = { playerId, distance: hitDist };
      }
    }
  }

  // Apply damage to closest hit
  if (closestHit) {
    const target = players.get(closestHit.playerId);
    if (target) {
      applyDamageWithResistance(target, getConfig('PSEUDOPOD_DRAIN_RATE'));
      playerLastDamageSource.set(closestHit.playerId, 'beam');
      playerLastBeamShooter.set(closestHit.playerId, shooterId); // Track shooter for kill rewards

      logger.info({
        event: 'beam_hit',
        shooter: shooterId,
        target: closestHit.playerId,
        damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
        targetEnergyRemaining: target.energy.toFixed(0),
      });
    }

    return closestHit.playerId;
  }

  return null;
}

/**
 * Check if nutrient spawn position is safe
 * Nutrients can spawn inside gravity well and even outer edge of event horizon (180-240px)
 * Only exclude the inner event horizon (0-180px) where escape is truly impossible
 */
function isNutrientSpawnSafe(position: Position): boolean {
  const INNER_EVENT_HORIZON = 180; // Inner 180px - truly inescapable, no nutrients

  for (const obstacle of obstacles.values()) {
    if (distance(position, obstacle.position) < INNER_EVENT_HORIZON) {
      return false; // Inside inner event horizon - too dangerous
    }
  }

  return true; // Safe (can spawn anywhere >= 180px from obstacle centers)
}

/**
 * Calculate nutrient value multiplier based on proximity to nearest obstacle
 * Gradient system creates risk/reward:
 * - 400-600px (outer gravity well): 2x
 * - 240-400px (inner gravity well): 3x
 * - 180-240px (outer event horizon): 5x - high risk, high reward!
 * - <180px: N/A (nutrients don't spawn here)
 */
function calculateNutrientValueMultiplier(position: Position): number {
  let closestDist = Infinity;

  for (const obstacle of obstacles.values()) {
    const dist = distance(position, obstacle.position);
    if (dist < closestDist) {
      closestDist = dist;
    }
  }

  const GRAVITY_RADIUS = getConfig('OBSTACLE_GRAVITY_RADIUS'); // 600px

  // Not in any gravity well
  if (closestDist >= GRAVITY_RADIUS) {
    return 1; // Base value
  }

  // Gradient system
  if (closestDist >= 400) {
    return 2; // Outer gravity well
  } else if (closestDist >= 240) {
    return 3; // Inner gravity well, approaching danger
  } else {
    return 5; // Outer event horizon - extreme risk, extreme reward!
  }
}

/**
 * Spawn a nutrient at a random location
 * Nutrients near obstacles get enhanced value based on gradient system (2x/3x/5x multipliers)
 * Note: "Respawn" creates a NEW nutrient with a new ID, not reusing the old one
 */
function spawnNutrient(emitEvent: boolean = false): Nutrient {
  const padding = 100;
  const maxAttempts = 20;
  let attempts = 0;
  let position: Position = {
    x: GAME_CONFIG.WORLD_WIDTH / 2,
    y: GAME_CONFIG.WORLD_HEIGHT / 2,
  };

  // Find a safe position (not inside event horizon)
  while (attempts < maxAttempts) {
    const candidate = {
      x: Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2) + padding,
      y: Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2) + padding,
    };

    if (obstacles.size === 0 || isNutrientSpawnSafe(candidate)) {
      position = candidate;
      break; // Found safe position
    }

    attempts++;
  }

  // Log warning if we had to use fallback
  if (attempts >= maxAttempts) {
    logger.warn('Could not find safe nutrient spawn position after max attempts, using fallback');
  }

  return spawnNutrientAt(position, undefined, emitEvent);
}

/**
 * Spawn a nutrient at a specific position
 * Used for prey drops and specific spawn locations
 * @param position - Where to spawn the nutrient
 * @param overrideMultiplier - Optional multiplier override (1/2/3/5) for dev tools
 */
function spawnNutrientAt(position: Position, overrideMultiplier?: number, emitEvent: boolean = false): Nutrient {
  // Calculate nutrient value based on proximity to obstacles (gradient system)
  // Or use override multiplier if provided (dev tool)
  const valueMultiplier = overrideMultiplier ?? calculateNutrientValueMultiplier(position);
  const isHighValue = valueMultiplier > 1; // Any multiplier > 1 is "high value"

  const nutrient: Nutrient = {
    id: `nutrient-${nutrientIdCounter++}`,
    position,
    value: getConfig('NUTRIENT_ENERGY_VALUE') * valueMultiplier,
    capacityIncrease: getConfig('NUTRIENT_CAPACITY_INCREASE') * valueMultiplier,
    valueMultiplier, // Store multiplier for client color rendering
    isHighValue,
  };

  nutrients.set(nutrient.id, nutrient);

  // Emit spawn event for client-side spawn animations (only after initial load)
  if (emitEvent && typeof io !== 'undefined') {
    const spawnMessage: NutrientSpawnedMessage = {
      type: 'nutrientSpawned',
      nutrient,
    };
    io.emit('nutrientSpawned', spawnMessage);
  }

  return nutrient;
}

/**
 * Schedule a nutrient to respawn after delay
 */
function respawnNutrient(nutrientId: string) {
  const timer = setTimeout(() => {
    spawnNutrient(true); // emitEvent=true for spawn animations
    nutrientRespawnTimers.delete(nutrientId);
  }, getConfig('NUTRIENT_RESPAWN_TIME'));

  nutrientRespawnTimers.set(nutrientId, timer);
}

/**
 * Initialize nutrients on server start using Bridson's algorithm
 * Ensures even distribution while allowing clustering near obstacles for risk/reward
 */
function initializeNutrients() {
  const MIN_NUTRIENT_SEPARATION = 200; // Good visual spacing across the map
  const INNER_EVENT_HORIZON = 180; // Don't spawn in inescapable zones

  // Create avoidance zones for obstacle inner event horizons only
  const avoidanceZones = Array.from(obstacles.values()).map(obstacle => ({
    position: obstacle.position,
    radius: INNER_EVENT_HORIZON,
  }));

  // Generate nutrient positions using Bridson's
  const nutrientPositions = poissonDiscSampling(
    GAME_CONFIG.WORLD_WIDTH,
    GAME_CONFIG.WORLD_HEIGHT,
    MIN_NUTRIENT_SEPARATION,
    GAME_CONFIG.NUTRIENT_COUNT,
    [], // No existing points
    avoidanceZones // Avoid inner event horizons only
  );

  // Create nutrients from generated positions
  for (const position of nutrientPositions) {
    spawnNutrientAt(position);
  }

  logNutrientsSpawned(nutrients.size);

  if (nutrients.size < GAME_CONFIG.NUTRIENT_COUNT) {
    logger.warn(`Only placed ${nutrients.size}/${GAME_CONFIG.NUTRIENT_COUNT} nutrients (space constraints)`);
  }
}

/**
 * Initialize gravity obstacles using Bridson's Poisson Disc Sampling
 * Pure spatial distribution - no safe zones, obstacles fill the map naturally
 * Guarantees 850px separation between obstacles for good coverage
 * Keeps obstacles away from walls (event horizon + buffer = 330px)
 */
function initializeObstacles() {
  const MIN_OBSTACLE_SEPARATION = 850; // Good spacing for 12 obstacles on 4800×3200 map
  const WALL_PADDING = 330; // Event horizon (180px) + 150px buffer
  let obstacleIdCounter = 0;

  // Generate obstacle positions using Bridson's algorithm on a padded area
  const paddedWidth = GAME_CONFIG.WORLD_WIDTH - WALL_PADDING * 2;
  const paddedHeight = GAME_CONFIG.WORLD_HEIGHT - WALL_PADDING * 2;

  const obstaclePositions = poissonDiscSampling(
    paddedWidth,
    paddedHeight,
    MIN_OBSTACLE_SEPARATION,
    GAME_CONFIG.OBSTACLE_COUNT
  );

  // Offset positions to account for padding
  const offsetPositions = obstaclePositions.map(pos => ({
    x: pos.x + WALL_PADDING,
    y: pos.y + WALL_PADDING,
  }));

  // Create obstacles from generated positions
  for (const position of offsetPositions) {
    const obstacle: Obstacle = {
      id: `obstacle-${obstacleIdCounter++}`,
      position,
      radius: getConfig('OBSTACLE_GRAVITY_RADIUS'),
      strength: getConfig('OBSTACLE_GRAVITY_STRENGTH'),
      damageRate: GAME_CONFIG.OBSTACLE_DAMAGE_RATE,
    };

    obstacles.set(obstacle.id, obstacle);
  }

  logObstaclesSpawned(obstacles.size);

  if (obstacles.size < GAME_CONFIG.OBSTACLE_COUNT) {
    logger.warn(`Only placed ${obstacles.size}/${GAME_CONFIG.OBSTACLE_COUNT} obstacles (space constraints)`);
  }
}

/**
 * Get stage-specific max energy pool
 * Energy-only system: this is the full health+energy pool combined
 */
function getStageMaxEnergy(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
    case EvolutionStage.MULTI_CELL:
      return GAME_CONFIG.MULTI_CELL_MAX_ENERGY;
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.CYBER_ORGANISM_MAX_ENERGY;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.HUMANOID_MAX_ENERGY;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.GODCELL_MAX_ENERGY;
  }
}

/**
 * Get damage resistance for evolution stage
 * Higher stages have more stable information structures
 * Resistance reduces energy drain from external threats (NOT passive decay)
 */
function getDamageResistance(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return GAME_CONFIG.SINGLE_CELL_DAMAGE_RESISTANCE;
    case EvolutionStage.MULTI_CELL:
      return GAME_CONFIG.MULTI_CELL_DAMAGE_RESISTANCE;
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.CYBER_ORGANISM_DAMAGE_RESISTANCE;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.HUMANOID_DAMAGE_RESISTANCE;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.GODCELL_DAMAGE_RESISTANCE;
  }
}

/**
 * Apply damage to player with resistance factored in
 * Returns actual damage dealt after resistance
 * God mode players take no damage
 */
function applyDamageWithResistance(player: Player, baseDamage: number): number {
  // God mode players are immune to damage
  if (hasGodMode(player.id)) return 0;

  const resistance = getDamageResistance(player.stage);
  const actualDamage = baseDamage * (1 - resistance);
  player.energy -= actualDamage;
  return actualDamage;
}

/**
 * Get energy decay rate based on evolution stage (metabolic efficiency)
 */
function getEnergyDecayRate(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return getConfig('SINGLE_CELL_ENERGY_DECAY_RATE');
    case EvolutionStage.MULTI_CELL:
      return getConfig('MULTI_CELL_ENERGY_DECAY_RATE');
    case EvolutionStage.CYBER_ORGANISM:
      return getConfig('CYBER_ORGANISM_ENERGY_DECAY_RATE');
    case EvolutionStage.HUMANOID:
      return getConfig('HUMANOID_ENERGY_DECAY_RATE');
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.GODCELL_ENERGY_DECAY_RATE;
  }
}

/**
 * Get player collision radius based on evolution stage
 * Returns scaled radius for hitbox calculations
 */
function getPlayerRadius(stage: EvolutionStage): number {
  const baseRadius = GAME_CONFIG.PLAYER_SIZE;
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return baseRadius * GAME_CONFIG.SINGLE_CELL_SIZE_MULTIPLIER;
    case EvolutionStage.MULTI_CELL:
      return baseRadius * GAME_CONFIG.MULTI_CELL_SIZE_MULTIPLIER;
    case EvolutionStage.CYBER_ORGANISM:
      return baseRadius * GAME_CONFIG.CYBER_ORGANISM_SIZE_MULTIPLIER;
    case EvolutionStage.HUMANOID:
      return baseRadius * GAME_CONFIG.HUMANOID_SIZE_MULTIPLIER;
    case EvolutionStage.GODCELL:
      return baseRadius * GAME_CONFIG.GODCELL_SIZE_MULTIPLIER;
  }
}

/**
 * Get energy values for an evolution stage (for dev tools)
 * Uses getConfig() to respect runtime config overrides from dev panel
 */
function getStageEnergy(stage: EvolutionStage): { energy: number; maxEnergy: number } {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return {
        energy: getConfig('SINGLE_CELL_ENERGY'),
        maxEnergy: getConfig('SINGLE_CELL_MAX_ENERGY'),
      };
    case EvolutionStage.MULTI_CELL:
      return {
        energy: getConfig('MULTI_CELL_ENERGY'),
        maxEnergy: getConfig('MULTI_CELL_MAX_ENERGY'),
      };
    case EvolutionStage.CYBER_ORGANISM:
      return {
        energy: getConfig('CYBER_ORGANISM_ENERGY'),
        maxEnergy: getConfig('CYBER_ORGANISM_MAX_ENERGY'),
      };
    case EvolutionStage.HUMANOID:
      return {
        energy: getConfig('HUMANOID_ENERGY'),
        maxEnergy: getConfig('HUMANOID_MAX_ENERGY'),
      };
    case EvolutionStage.GODCELL:
      return {
        energy: getConfig('GODCELL_ENERGY'),
        maxEnergy: getConfig('GODCELL_MAX_ENERGY'),
      };
  }
}

/**
 * Line-circle intersection test
 * Returns true if line segment intersects circle
 */
function lineCircleIntersection(
  lineStart: Position,
  lineEnd: Position,
  circleCenter: Position,
  circleRadius: number,
  currentLength: number
): boolean {
  // Calculate actual end position based on current extension
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const totalLength = Math.sqrt(dx * dx + dy * dy);
  if (totalLength === 0) return false;

  const progress = currentLength / totalLength;
  const actualEndX = lineStart.x + dx * progress;
  const actualEndY = lineStart.y + dy * progress;

  // Vector from line start to circle center
  const fx = circleCenter.x - lineStart.x;
  const fy = circleCenter.y - lineStart.y;

  // Vector from line start to actual end
  const lx = actualEndX - lineStart.x;
  const ly = actualEndY - lineStart.y;

  // Project circle center onto line segment
  const lineLengthSq = lx * lx + ly * ly;
  if (lineLengthSq === 0) return false;

  const t = Math.max(0, Math.min(1, (fx * lx + fy * ly) / lineLengthSq));

  // Closest point on line to circle center
  const closestX = lineStart.x + t * lx;
  const closestY = lineStart.y + t * ly;

  // Distance from closest point to circle center
  const distX = circleCenter.x - closestX;
  const distY = circleCenter.y - closestY;
  const distSq = distX * distX + distY * distY;

  return distSq <= circleRadius * circleRadius;
}

/**
 * Check beam collision with multi-cell players
 * Drains energy from hit targets
 * Returns true if hit something
 */
function checkBeamCollision(beam: Pseudopod): boolean {
  const shooter = players.get(beam.ownerId);
  if (!shooter) return false;

  // Get or create hit tracking set for this beam
  let hitSet = pseudopodHits.get(beam.id);
  if (!hitSet) {
    hitSet = new Set<string>();
    pseudopodHits.set(beam.id, hitSet);
  }

  let hitSomething = false;

  // Check collision with all multi-cell players
  for (const [targetId, target] of players) {
    if (targetId === beam.ownerId) continue; // Can't hit yourself
    if (hitSet.has(targetId)) continue; // Already hit this target
    if (target.stage === EvolutionStage.SINGLE_CELL) continue; // Beams only hit multi-cells
    if (target.energy <= 0) continue; // Skip dead players
    if (target.isEvolving) continue; // Skip evolving players
    if (target.stunnedUntil && Date.now() < target.stunnedUntil) continue; // Skip stunned players

    // Circle-circle collision: beam position vs target position
    const targetRadius = getPlayerRadius(target.stage);
    const dist = distance(beam.position, target.position);
    const collisionDist = beam.width / 2 + targetRadius;

    if (dist < collisionDist) {
      // Hit! Drain energy from target (one-time damage per beam, with resistance)
      applyDamageWithResistance(target, getConfig('PSEUDOPOD_DRAIN_RATE'));
      hitSomething = true;

      // Track damage source and shooter for kill credit
      playerLastDamageSource.set(targetId, 'beam');
      playerLastBeamShooter.set(targetId, beam.ownerId);

      // Mark this target as hit by this beam
      hitSet.add(targetId);

      logger.info({
        event: 'beam_hit',
        shooter: beam.ownerId,
        target: targetId,
        damage: getConfig('PSEUDOPOD_DRAIN_RATE'),
        targetEnergyRemaining: target.energy.toFixed(0),
      });

      // Emit hit event for visual effects
      io.emit('pseudopodHit', {
        type: 'pseudopodHit',
        beamId: beam.id,
        targetId,
        hitPosition: { x: beam.position.x, y: beam.position.y },
      });

      // Add decay timer for brief drain aura after hit (1.5 seconds)
      pseudopodHitDecays.set(targetId, {
        rate: getConfig('PSEUDOPOD_DRAIN_RATE'),
        expiresAt: Date.now() + 1500, // 1.5 second decay
      });

      // Beam continues traveling, can hit multiple different targets
    }
  }

  return hitSomething;
}

/**
 * Engulf prey (phagocytosis)
 * Kills prey, rewards predator with energy and nutrient drops
 */
function engulfPrey(predatorId: string, preyId: string, position: Position) {
  const predator = players.get(predatorId);
  const prey = players.get(preyId);

  if (!predator || !prey) return;

  // Calculate rewards (gain % of victim's maxEnergy)
  const energyGain = prey.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
  predator.energy = Math.min(predator.maxEnergy, predator.energy + energyGain);

  // Kill prey (energy-only: set energy to 0)
  prey.energy = 0;
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
    handleBotDeath(preyId, io, players, playerInputDirections, playerVelocities);
  }

  logger.info({
    event: 'player_engulfed',
    predatorId,
    preyId,
    isBot: isBot(preyId),
    energyGained: energyGain.toFixed(1),
  });
}

/**
 * Check for contact predation (multi-cells draining energy from touching cells)
 * Drains energy over time - prey can escape if contact is broken
 */
function checkPredationCollisions(deltaTime: number) {
  const currentDrains = new Set<string>(); // Track prey being drained this tick

  for (const [predatorId, predator] of players) {
    // Only Stage 2+ can drain via contact
    if (predator.stage === EvolutionStage.SINGLE_CELL) continue;
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
        prey.energy -= damage;
        currentDrains.add(preyId);

        // Track which predator is draining this prey (for kill credit)
        activeDrains.set(preyId, predatorId);

        // Mark damage source for death tracking
        playerLastDamageSource.set(preyId, 'predation');

        // Record damage for drain aura system
        recordDamage(preyId, getConfig('CONTACT_DRAIN_RATE'), 'predation');

        // Only one predator can drain a prey at a time (first contact wins)
        break;
      }
    }
  }

  // Clear drains for prey that escaped contact this tick
  for (const [preyId, predatorId] of activeDrains) {
    if (!currentDrains.has(preyId)) {
      activeDrains.delete(preyId);
    }
  }
}

/**
 * Update pseudopod beams (projectile movement, collision, despawn)
 * Called every game tick
 */
function updatePseudopods(deltaTime: number, io: Server) {
  // Skip if using hitscan mode (beams are visual-only and auto-removed)
  if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') return;

  const toRemove: string[] = [];

  for (const [id, beam] of pseudopods) {
    // Move beam (projectile mode)
    const travelDist = Math.sqrt(beam.velocity.x * beam.velocity.x + beam.velocity.y * beam.velocity.y) * deltaTime;
    beam.position.x += beam.velocity.x * deltaTime;
    beam.position.y += beam.velocity.y * deltaTime;
    beam.distanceTraveled += travelDist;

    // Broadcast position update to clients
    io.emit('pseudopodMoved', {
      type: 'pseudopodMoved',
      pseudopodId: id,
      position: beam.position,
    } as PseudopodMovedMessage);

    // Check if beam exceeded max distance
    if (beam.distanceTraveled >= beam.maxDistance) {
      toRemove.push(id);
      continue;
    }

    // Check collision with players (multi-cells only)
    checkBeamCollision(beam);
    // Beam continues traveling even if it hits (can hit multiple targets)
  }

  // Remove beams that exceeded range
  for (const id of toRemove) {
    pseudopods.delete(id);
    pseudopodHits.delete(id); // Clean up hit tracking
    io.emit('pseudopodRetracted', { type: 'pseudopodRetracted', pseudopodId: id } as PseudopodRetractedMessage);
  }
}

/**
 * Get next evolution stage and required maxEnergy threshold
 */
function getNextEvolutionStage(currentStage: EvolutionStage): { stage: EvolutionStage; threshold: number } | null {
  switch (currentStage) {
    case EvolutionStage.SINGLE_CELL:
      return { stage: EvolutionStage.MULTI_CELL, threshold: getConfig('EVOLUTION_MULTI_CELL') };
    case EvolutionStage.MULTI_CELL:
      return { stage: EvolutionStage.CYBER_ORGANISM, threshold: getConfig('EVOLUTION_CYBER_ORGANISM') };
    case EvolutionStage.CYBER_ORGANISM:
      return { stage: EvolutionStage.HUMANOID, threshold: getConfig('EVOLUTION_HUMANOID') };
    case EvolutionStage.HUMANOID:
      return { stage: EvolutionStage.GODCELL, threshold: getConfig('EVOLUTION_GODCELL') };
    case EvolutionStage.GODCELL:
      return null; // Already at max stage
  }
}

/**
 * Check if player can evolve and trigger evolution if conditions met
 */
function checkEvolution(player: Player) {
  if (player.isEvolving) return; // Already evolving

  const nextEvolution = getNextEvolutionStage(player.stage);
  if (!nextEvolution) return; // Already at max stage

  // Check capacity gate (maxEnergy threshold)
  if (player.maxEnergy < nextEvolution.threshold) return;

  // Capacity threshold met - trigger evolution!
  player.isEvolving = true;

  // Broadcast evolution start
  const startMessage: PlayerEvolutionStartedMessage = {
    type: 'playerEvolutionStarted',
    playerId: player.id,
    currentStage: player.stage,
    targetStage: nextEvolution.stage,
    duration: getConfig('EVOLUTION_MOLTING_DURATION'),
  };
  io.emit('playerEvolutionStarted', startMessage);

  // Schedule evolution completion after molting duration
  setTimeout(() => {
    // Check if player still exists (they might have disconnected during molting)
    if (!players.has(player.id)) return;

    player.stage = nextEvolution.stage;
    player.isEvolving = false;

    // Update energy pool for new stage
    // Evolution grants the new stage's max energy pool (fully restored)
    const newMaxEnergy = getStageMaxEnergy(player.stage);
    player.maxEnergy = Math.max(player.maxEnergy, newMaxEnergy);
    player.energy = player.maxEnergy; // Evolution fully restores energy

    // Broadcast evolution event
    const evolveMessage: PlayerEvolvedMessage = {
      type: 'playerEvolved',
      playerId: player.id,
      newStage: player.stage,
      newMaxEnergy: player.maxEnergy,
    };
    io.emit('playerEvolved', evolveMessage);

    logPlayerEvolution(player.id, player.stage);
  }, getConfig('EVOLUTION_MOLTING_DURATION'));
}

/**
 * Handle player death - broadcast death event with cause
 * Bots auto-respawn, human players wait for manual respawn
 */
function handlePlayerDeath(player: Player, cause: DeathCause) {
  // Handle predation rewards before death (contact drain)
  if (cause === 'predation') {
    const predatorId = activeDrains.get(player.id);
    if (predatorId) {
      const predator = players.get(predatorId);
      if (predator) {
        // Calculate reward based on victim stage
        let maxEnergyGain = 0;
        if (player.stage === EvolutionStage.SINGLE_CELL) {
          // Killing single-cell: 30% of maxEnergy
          maxEnergyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN;
        } else {
          // Killing multi-cell: 80% of maxEnergy (huge reward)
          maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;
        }

        // Award maxEnergy increase to predator
        predator.maxEnergy += maxEnergyGain;
        predator.energy = Math.min(predator.maxEnergy, predator.energy); // Clamp current energy

        logger.info({
          event: 'predation_kill',
          predatorId,
          victimId: player.id,
          victimStage: player.stage,
          maxEnergyGained: maxEnergyGain.toFixed(1),
        });
      }
      // Clear drain tracking
      activeDrains.delete(player.id);
    }
  }

  // Handle beam kill rewards (pseudopod)
  if (cause === 'beam') {
    const shooterId = playerLastBeamShooter.get(player.id);
    if (shooterId) {
      const shooter = players.get(shooterId);
      if (shooter) {
        // Only multi-cells can be killed by beams, always award 80%
        const maxEnergyGain = player.maxEnergy * GAME_CONFIG.MULTICELL_KILL_ABSORPTION;

        // Award maxEnergy increase AND current energy to shooter
        shooter.maxEnergy += maxEnergyGain;
        const energyGain = player.maxEnergy * GAME_CONFIG.CONTACT_MAXENERGY_GAIN; // 30% of victim's maxEnergy
        shooter.energy = Math.min(shooter.maxEnergy, shooter.energy + energyGain);

        logger.info({
          event: 'beam_kill',
          shooterId,
          victimId: player.id,
          victimStage: player.stage,
          maxEnergyGained: maxEnergyGain.toFixed(1),
          energyGained: energyGain.toFixed(1),
        });
      }
      // Clear beam shooter tracking
      playerLastBeamShooter.delete(player.id);
    }
  }

  // Send final energy update showing 0 before death message
  const finalEnergyUpdate: EnergyUpdateMessage = {
    type: 'energyUpdate',
    playerId: player.id,
    energy: 0, // Ensure client sees energy at 0
  };
  io.emit('energyUpdate', finalEnergyUpdate);

  // Broadcast death event (for dilution effect)
  const deathMessage: PlayerDiedMessage = {
    type: 'playerDied',
    playerId: player.id,
    position: { ...player.position },
    color: player.color,
    cause: cause as 'starvation' | 'singularity' | 'swarm' | 'obstacle' | 'predation',
  };
  io.emit('playerDied', deathMessage);

  // Auto-respawn bots after delay
  if (isBot(player.id)) {
    handleBotDeath(player.id, io, players, playerInputDirections, playerVelocities);
  } else {
    logPlayerDeath(player.id, cause);
  }
}

/**
 * Respawn a dead player - reset to single-cell at random location
 */
function respawnPlayer(player: Player) {
  // Reset player to Stage 1 (single-cell)
  // Energy-only system: energy is the sole resource
  player.position = randomSpawnPosition();
  player.energy = GAME_CONFIG.SINGLE_CELL_ENERGY;
  player.maxEnergy = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
  player.stage = EvolutionStage.SINGLE_CELL;
  player.isEvolving = false;

  // Reset input direction and velocity (stop movement if player was holding input during death)
  const inputDirection = playerInputDirections.get(player.id);
  if (inputDirection) {
    inputDirection.x = 0;
    inputDirection.y = 0;
  }
  const velocity = playerVelocities.get(player.id);
  if (velocity) {
    velocity.x = 0;
    velocity.y = 0;
  }

  // Broadcast respawn event
  const respawnMessage: PlayerRespawnedMessage = {
    type: 'playerRespawned',
    player: { ...player },
  };
  io.emit('playerRespawned', respawnMessage);

  logPlayerRespawn(player.id);
}

/**
 * Update metabolism for all players
 * Energy-only system: handles passive energy decay
 * When energy hits 0, player dies (no separate starvation damage phase)
 * Gravity wells are physics-only (no proximity damage)
 */
function updateMetabolism(deltaTime: number) {
  for (const [playerId, player] of players) {
    // Skip dead players waiting for respawn (energy < 0 means death already processed)
    // Catch-all: if energy is exactly 0 but no death cause tracked (e.g., from movement/ability costs),
    // set 'starvation' as default cause so checkPlayerDeaths will process them
    if (player.energy < 0) {
      continue; // Already dead, waiting for respawn
    }
    if (player.energy === 0 && !playerLastDamageSource.has(playerId)) {
      playerLastDamageSource.set(playerId, 'starvation');
      continue;
    }
    if (player.energy === 0) {
      continue; // Death already tracked, will be processed by checkPlayerDeaths
    }

    // Skip metabolism during evolution molting (invulnerable)
    if (player.isEvolving) continue;

    // God mode players don't decay
    if (hasGodMode(playerId)) continue;

    // Energy decay (passive drain) - stage-specific metabolic efficiency
    // No damage resistance applies to passive decay
    const decayRate = getEnergyDecayRate(player.stage);
    player.energy -= decayRate * deltaTime;

    // Energy-only: when energy hits 0, mark for death
    if (player.energy <= 0) {
      player.energy = 0;
      playerLastDamageSource.set(playerId, 'starvation');
      // Record for drain aura (shows starvation state)
      recordDamage(playerId, decayRate, 'starvation');
    }

    // NOTE: Gravity well proximity damage removed
    // Gravity wells are physics-only: pull forces + singularity instant death
    // No gradual energy drain from being near obstacles

    // Check for evolution (only if still alive)
    if (player.energy > 0) {
      checkEvolution(player);
    }
  }
}

/**
 * Check all players for death (energy <= 0)
 * Energy-only system: 0 energy = instant death (dilution)
 * Uses tracked damage source to log specific death cause
 * Only processes deaths once (clears damage source after processing)
 */
function checkPlayerDeaths() {
  for (const [playerId, player] of players) {
    // Only process if:
    // 1. Energy is at or below 0
    // 2. We have a damage source tracked (meaning this is a fresh death, not already processed)
    if (player.energy <= 0 && playerLastDamageSource.has(playerId)) {
      const cause = playerLastDamageSource.get(playerId)!;

      handlePlayerDeath(player, cause);

      // Mark as "death processed" - sentinel value prevents catch-all from re-triggering
      // Respawn will set energy back to positive value
      player.energy = -1;

      // Clear damage source to prevent reprocessing same death
      playerLastDamageSource.delete(playerId);
    }
  }
}

// Energy update broadcast counter (reduce network spam)
let energyUpdateTicks = 0;
const ENERGY_UPDATE_INTERVAL = 10; // Broadcast every 10 ticks (~6 times/sec)

/**
 * Broadcast energy updates to clients (throttled)
 * Energy-only system: energy is the sole resource
 */
function broadcastEnergyUpdates() {
  energyUpdateTicks++;

  if (energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
    energyUpdateTicks = 0;

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
 * Helper function to record damage for this tick
 * Used by all damage sources to contribute to drain aura intensity
 */
function recordDamage(
  entityId: string,
  damageRate: number,
  source: DamageSource,
  proximityFactor?: number
) {
  if (!activeDamageThisTick.has(entityId)) {
    activeDamageThisTick.set(entityId, []);
  }
  activeDamageThisTick.get(entityId)!.push({ damageRate, source, proximityFactor });
}

/**
 * Broadcast drain state updates to clients
 * Sends comprehensive damage info for variable-intensity drain auras
 */
function broadcastDrainState() {
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

  for (const [playerId, damages] of activeDamageThisTick) {
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
  activeDamageThisTick.clear();
}

// Detection update broadcast counter (chemical sensing for multi-cells)
let detectionUpdateTicks = 0;
const DETECTION_UPDATE_INTERVAL = 15; // Every 15 ticks (~4 times/sec) - less frequent than energy

/**
 * Broadcast detected entities to multi-cell players (chemical sensing)
 * Multi-cells can "smell" nearby prey and nutrients from extended range
 */
function broadcastDetectionUpdates() {
  detectionUpdateTicks++;

  if (detectionUpdateTicks >= DETECTION_UPDATE_INTERVAL) {
    detectionUpdateTicks = 0;

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

/**
 * Check for nutrient collection collisions
 * Called each game tick to detect when players touch nutrients
 */
function checkNutrientCollisions() {
  for (const [playerId, player] of players) {
    // Skip dead players (waiting for manual respawn)
    if (player.energy <= 0) continue;

    // Skip if player is evolving (invulnerable during molting)
    if (player.isEvolving) continue;

    for (const [nutrientId, nutrient] of nutrients) {
      const dist = distance(player.position, nutrient.position);
      const playerRadius = getPlayerRadius(player.stage);
      const collisionRadius = playerRadius + GAME_CONFIG.NUTRIENT_SIZE;

      if (dist < collisionRadius) {
        // Collect nutrient - gain energy (capped at maxEnergy) + capacity increase
        // Both scale with proximity gradient (high-risk nutrients = faster evolution!)
        // Safety clamp to prevent negative energy gain if player.energy somehow drifts above maxEnergy
        const energyGain = Math.min(
          nutrient.value,
          Math.max(0, player.maxEnergy - player.energy)
        );
        player.energy += energyGain;
        player.maxEnergy += nutrient.capacityIncrease; // Scales with risk (10/20/30/50)

        // Safety clamp: ensure energy never exceeds maxEnergy
        player.energy = Math.min(player.energy, player.maxEnergy);

        // Remove nutrient from world
        nutrients.delete(nutrientId);

        // Broadcast collection event to all clients
        const collectMessage: NutrientCollectedMessage = {
          type: 'nutrientCollected',
          nutrientId,
          playerId,
          collectorEnergy: player.energy,
          collectorMaxEnergy: player.maxEnergy,
        };
        io.emit('nutrientCollected', collectMessage);

        // Schedule respawn after delay
        respawnNutrient(nutrientId);

        // Only collect one nutrient per tick per player
        break;
      }
    }
  }
}

// ============================================
// Socket.io Server Setup
// ============================================

const io = new Server(PORT, {
  cors: {
    origin: '*', // Allow all origins for development
  },
});

logServerStarted(PORT);

// Playground mode - empty world for testing (set by PLAYGROUND env var)
const isPlayground = process.env.PLAYGROUND === 'true';

if (isPlayground) {
  logger.info({ event: 'playground_mode', port: PORT });
} else {
  // Initialize game world (normal mode)
  // Pure Bridson's distribution - obstacles and swarms fill map naturally
  initializeObstacles();
  initializeNutrients();
  initializeBots(io, players, playerInputDirections, playerVelocities, randomSpawnPosition);
  initializeSwarms(io);
}

// Initialize dev handler with game context
initDevHandler({
  io,
  players,
  nutrients,
  obstacles,
  swarms: getSwarms(),
  playerInputDirections,
  playerVelocities,
  spawnNutrientAt,
  spawnSwarmAt,
  spawnBotAt: (position, stage) => spawnBotAt(io, players, playerInputDirections, playerVelocities, position, stage),
  removeBotPermanently: (botId) => removeBotPermanently(botId, io, players, playerInputDirections, playerVelocities),
  respawnPlayer,
  getStageEnergy,
  getPlayerRadius,
});

// ============================================
// Connection Handling
// ============================================

io.on('connection', (socket) => {
  logPlayerConnected(socket.id);

  // Create a new player
  // Energy-only system: energy is the sole resource (life + fuel)
  const newPlayer: Player = {
    id: socket.id,
    position: randomSpawnPosition(),
    color: randomColor(),
    energy: GAME_CONFIG.SINGLE_CELL_ENERGY,
    maxEnergy: GAME_CONFIG.SINGLE_CELL_MAX_ENERGY,
    stage: EvolutionStage.SINGLE_CELL,
    isEvolving: false,
  };

  // Add to game state
  players.set(socket.id, newPlayer);
  playerInputDirections.set(socket.id, { x: 0, y: 0 });
  playerVelocities.set(socket.id, { x: 0, y: 0 });

  // Send current game state to the new player
  // Filter out dead players (energy <= 0) from initial state
  const alivePlayers = new Map();
  for (const [id, player] of players) {
    if (player.energy > 0) {
      alivePlayers.set(id, player);
    }
  }

  const gameState: GameStateMessage = {
    type: 'gameState',
    players: Object.fromEntries(alivePlayers),
    nutrients: Object.fromEntries(nutrients),
    obstacles: Object.fromEntries(obstacles),
    swarms: getSwarmsRecord(),
  };
  socket.emit('gameState', gameState);

  // Notify all OTHER players that someone joined
  const joinMessage: PlayerJoinedMessage = {
    type: 'playerJoined',
    player: newPlayer,
  };
  socket.broadcast.emit('playerJoined', joinMessage);

  // ============================================
  // Player Movement Input
  // ============================================

  socket.on('playerMove', (message: PlayerMoveMessage) => {
    const inputDirection = playerInputDirections.get(socket.id);
    if (!inputDirection) return;

    // Store player's input direction (will be combined with gravity in game loop)
    // Direction values are -1, 0, or 1
    inputDirection.x = message.direction.x;
    inputDirection.y = message.direction.y;
  });

  // ============================================
  // Player Respawn Request
  // ============================================

  socket.on('playerRespawnRequest', (message: PlayerRespawnRequestMessage) => {
    const player = players.get(socket.id);
    if (!player) return;

    // Only respawn if player is dead (health <= 0)
    if (player.energy <= 0) {
      respawnPlayer(player);
    }
  });

  // ============================================
  // Pseudopod Beam Fire (Lightning Projectile)
  // ============================================

  socket.on('pseudopodFire', (message: PseudopodFireMessage) => {
    const player = players.get(socket.id);
    if (!player) return;

    // Validation: Only Stage 2+ can use pseudopod beams
    if (player.stage === EvolutionStage.SINGLE_CELL) return;
    if (player.energy <= 0) return; // Dead players can't attack
    if (player.isEvolving) return; // Can't attack while molting
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) return; // Can't attack while stunned
    if (player.energy < getConfig('PSEUDOPOD_ENERGY_COST')) return; // Need energy to fire

    // Cooldown check
    const lastUse = playerPseudopodCooldowns.get(socket.id) || 0;
    const now = Date.now();
    if (now - lastUse < getConfig('PSEUDOPOD_COOLDOWN')) return;

    // Calculate direction from player to target
    const dx = message.targetX - player.position.x;
    const dy = message.targetY - player.position.y;
    const targetDist = Math.sqrt(dx * dx + dy * dy);

    if (targetDist < 1) return; // Too close, invalid shot

    // Normalize direction
    const dirX = dx / targetDist;
    const dirY = dy / targetDist;

    // Calculate max range
    const playerRadius = getPlayerRadius(player.stage);
    const maxRange = playerRadius * GAME_CONFIG.PSEUDOPOD_RANGE;

    // Deduct energy cost
    player.energy -= getConfig('PSEUDOPOD_ENERGY_COST');

    if (GAME_CONFIG.PSEUDOPOD_MODE === 'hitscan') {
      // HITSCAN MODE: Instant raycast hit detection
      const actualDist = Math.min(targetDist, maxRange);
      const endX = player.position.x + dirX * actualDist;
      const endY = player.position.y + dirY * actualDist;

      const hitTargetId = checkBeamHitscan(player.position, { x: endX, y: endY }, socket.id);

      // Create visual-only beam (0.5s duration)
      const pseudopod: Pseudopod = {
        id: `beam-${socket.id}-${now}`,
        ownerId: socket.id,
        position: { x: player.position.x, y: player.position.y },
        velocity: { x: endX, y: endY }, // End position (reusing velocity field for visual)
        width: GAME_CONFIG.PSEUDOPOD_WIDTH,
        maxDistance: actualDist,
        distanceTraveled: 0,
        createdAt: now,
        color: player.color,
      };

      pseudopods.set(pseudopod.id, pseudopod);

      // Auto-remove beam after visual duration
      setTimeout(() => {
        pseudopods.delete(pseudopod.id);
        pseudopodHits.delete(pseudopod.id); // Clean up hit tracking
        io.emit('pseudopodRetracted', { type: 'pseudopodRetracted', pseudopodId: pseudopod.id } as PseudopodRetractedMessage);
      }, 500);

      io.emit('pseudopodSpawned', { type: 'pseudopodSpawned', pseudopod } as PseudopodSpawnedMessage);

      logger.info({
        event: 'pseudopod_fired',
        mode: 'hitscan',
        playerId: socket.id,
        targetId: hitTargetId || 'miss',
        range: actualDist.toFixed(0),
      });
    } else {
      // PROJECTILE MODE: Traveling beam that checks collision each tick
      const pseudopod: Pseudopod = {
        id: `beam-${socket.id}-${now}`,
        ownerId: socket.id,
        position: { x: player.position.x, y: player.position.y }, // Current position (will move)
        velocity: { x: dirX * getConfig('PSEUDOPOD_PROJECTILE_SPEED'), y: dirY * getConfig('PSEUDOPOD_PROJECTILE_SPEED') },
        width: GAME_CONFIG.PSEUDOPOD_WIDTH,
        maxDistance: maxRange,
        distanceTraveled: 0,
        createdAt: now,
        color: player.color,
      };

      pseudopods.set(pseudopod.id, pseudopod);
      io.emit('pseudopodSpawned', { type: 'pseudopodSpawned', pseudopod } as PseudopodSpawnedMessage);

      logger.info({
        event: 'pseudopod_fired',
        mode: 'projectile',
        playerId: socket.id,
        direction: { x: dirX.toFixed(2), y: dirY.toFixed(2) },
      });
    }

    playerPseudopodCooldowns.set(socket.id, now);
  });

  // ============================================
  // EMP Activation (Multi-cell AoE stun ability)
  // ============================================

  socket.on('empActivate', (message: EMPActivateMessage) => {
    const player = players.get(socket.id);
    if (!player) return;

    // Validation: Only Stage 2+ can use EMP
    if (player.stage === EvolutionStage.SINGLE_CELL) return;
    if (player.energy <= 0) return; // Dead players can't use abilities
    if (player.isEvolving) return; // Can't use abilities while molting
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) return; // Can't use while stunned
    if (player.energy < getConfig('EMP_ENERGY_COST')) return; // Insufficient energy

    // Cooldown check
    const lastUse = playerEMPCooldowns.get(socket.id) || 0;
    const now = Date.now();
    if (now - lastUse < getConfig('EMP_COOLDOWN')) return;

    // Apply energy cost
    player.energy -= getConfig('EMP_ENERGY_COST');

    // Find affected entities within range
    const affectedSwarmIds: string[] = [];
    const affectedPlayerIds: string[] = [];

    // Check swarms
    for (const [swarmId, swarm] of getSwarms()) {
      const dist = distance(player.position, swarm.position);
      if (dist <= getConfig('EMP_RANGE')) {
        swarm.disabledUntil = now + getConfig('EMP_DISABLE_DURATION');
        swarm.energy = GAME_CONFIG.SWARM_ENERGY;
        affectedSwarmIds.push(swarmId);
      }
    }

    // Check other players
    for (const [playerId, otherPlayer] of players) {
      if (playerId === socket.id) continue; // Don't affect self
      if (otherPlayer.energy <= 0) continue; // Dead players not affected

      const dist = distance(player.position, otherPlayer.position);
      if (dist <= getConfig('EMP_RANGE')) {
        otherPlayer.stunnedUntil = now + getConfig('EMP_DISABLE_DURATION');

        // Multi-cells also lose energy when hit (with resistance)
        if (otherPlayer.stage !== EvolutionStage.SINGLE_CELL) {
          applyDamageWithResistance(otherPlayer, GAME_CONFIG.EMP_MULTI_CELL_ENERGY_DRAIN);
        }

        affectedPlayerIds.push(playerId);
      }
    }

    // Update cooldown (track in both Map and player object)
    playerEMPCooldowns.set(socket.id, now);
    player.lastEMPTime = now; // Client reads this for HUD

    // Broadcast EMP activation to all clients
    io.emit('empActivated', {
      type: 'empActivated',
      playerId: socket.id,
      position: player.position,
      affectedSwarmIds,
      affectedPlayerIds,
    } as EMPActivatedMessage);

    logger.info({
      event: 'emp_activated',
      playerId: socket.id,
      swarmsHit: affectedSwarmIds.length,
      playersHit: affectedPlayerIds.length,
      energySpent: getConfig('EMP_ENERGY_COST'),
    });
  });

  // ============================================
  // Dev Command Handling (development mode only)
  // ============================================

  socket.on('devCommand', (message: DevCommandMessage) => {
    // Only allow dev commands in development mode
    if (process.env.NODE_ENV === 'production') {
      logger.warn({ event: 'dev_command_blocked', socketId: socket.id, reason: 'production_mode' });
      return;
    }
    handleDevCommand(socket, io, message.command);
  });

  // ============================================
  // Disconnection Handling
  // ============================================

  socket.on('disconnect', () => {
    logPlayerDisconnected(socket.id);

    // Remove from game state
    players.delete(socket.id);
    playerInputDirections.delete(socket.id);
    playerVelocities.delete(socket.id);

    // Notify other players
    const leftMessage: PlayerLeftMessage = {
      type: 'playerLeft',
      playerId: socket.id,
    };
    socket.broadcast.emit('playerLeft', leftMessage);
  });
});

// ============================================
// Gravity Physics
// ============================================

/**
 * Apply gravity forces from obstacles to all players
 * Uses inverse-square gravity: force increases exponentially near center
 * Gravity forces are added to existing velocity (creating momentum)
 */
function applyGravityForces(deltaTime: number) {
  for (const [playerId, player] of players) {
    if (player.energy <= 0 || player.isEvolving) continue;

    const velocity = playerVelocities.get(playerId);
    if (!velocity) continue;

    // Apply friction to create momentum/inertia (velocity decays over time)
    // Use exponential decay for smooth deceleration: v = v * friction^dt
    const frictionFactor = Math.pow(getConfig('MOVEMENT_FRICTION'), deltaTime);
    velocity.x *= frictionFactor;
    velocity.y *= frictionFactor;

    // Accumulate gravity forces into existing velocity (don't reset)
    for (const obstacle of obstacles.values()) {
      const dist = distance(player.position, obstacle.position);
      if (dist > obstacle.radius) continue; // Outside event horizon

      // Instant death at singularity core (energy-only: energy = 0)
      // God mode players survive singularities
      if (dist < getConfig('OBSTACLE_CORE_RADIUS') && !hasGodMode(playerId)) {
        logSingularityCrush(playerId, dist);
        player.energy = 0; // Instant energy depletion (will be processed by checkPlayerDeaths)
        playerLastDamageSource.set(playerId, 'singularity');
        continue;
      }

      // Inverse-square gravity: F = strength / dist²
      // Prevent divide-by-zero and extreme forces
      const distSq = Math.max(dist * dist, 100);

      // Scale gravity strength for pixels/second velocity units
      // obstacle.strength (0.03) needs massive scaling for pixel velocities
      const gravityStrength = obstacle.strength * 100000000; // Scale factor for pixels/second (10x more)
      const forceMagnitude = gravityStrength / distSq;

      // Direction FROM player TO obstacle (attraction)
      const dx = obstacle.position.x - player.position.x;
      const dy = obstacle.position.y - player.position.y;
      const dirLength = Math.sqrt(dx * dx + dy * dy);

      if (dirLength === 0) continue;

      const dirX = dx / dirLength;
      const dirY = dy / dirLength;

      // Accumulate gravitational acceleration (pixels/second²) into velocity
      // Multiply by deltaTime to get velocity change for this frame
      velocity.x += dirX * forceMagnitude * deltaTime;
      velocity.y += dirY * forceMagnitude * deltaTime;

      // DEBUG: Log gravity forces
      if (!isBot(playerId)) {
        logGravityDebug(playerId, dist, forceMagnitude, velocity);
      }
    }
  }

  // Apply gravity to entropy swarms with momentum (corrupted data, less mass)
  for (const swarm of getSwarms().values()) {
    // Apply friction to swarms (same momentum system as players)
    const swarmFrictionFactor = Math.pow(getConfig('MOVEMENT_FRICTION'), deltaTime);
    swarm.velocity.x *= swarmFrictionFactor;
    swarm.velocity.y *= swarmFrictionFactor;

    // Accumulate gravity forces into existing velocity
    for (const obstacle of obstacles.values()) {
      const dist = distance(swarm.position, obstacle.position);
      if (dist > obstacle.radius) continue; // Outside event horizon

      // Swarms can get destroyed by singularities too
      if (dist < getConfig('OBSTACLE_CORE_RADIUS')) {
        // For now, swarms just get pulled through - they're corrupted data, they might survive
        // Could add swarm death logic later
        continue;
      }

      // 80% gravity resistance compared to players (original value)
      // Corrupted data has less mass - now works with momentum system
      const distSq = Math.max(dist * dist, 100);
      const gravityStrength = obstacle.strength * 100000000;
      const forceMagnitude = (gravityStrength / distSq) * 0.2; // 20% gravity (80% resistance)

      // Direction FROM swarm TO obstacle (attraction)
      const dx = obstacle.position.x - swarm.position.x;
      const dy = obstacle.position.y - swarm.position.y;
      const dirLength = Math.sqrt(dx * dx + dy * dy);

      if (dirLength === 0) continue;

      const dirX = dx / dirLength;
      const dirY = dy / dirLength;

      // Accumulate gravitational acceleration into velocity (frame-rate independent)
      swarm.velocity.x += dirX * forceMagnitude * deltaTime;
      swarm.velocity.y += dirY * forceMagnitude * deltaTime;
    }
  }
}

/**
 * Attract nutrients toward obstacles and destroy them at center
 * Creates visual "feeding" effect for distortions
 */
function attractNutrientsToObstacles(deltaTime: number) {
  for (const [nutrientId, nutrient] of nutrients) {
    for (const obstacle of obstacles.values()) {
      const dist = distance(nutrient.position, obstacle.position);

      if (dist < obstacle.radius) {
        // Apply same inverse-square gravity as players
        const distSq = Math.max(dist * dist, 100);
        const forceMagnitude = obstacle.strength / distSq;

        const dx = obstacle.position.x - nutrient.position.x;
        const dy = obstacle.position.y - nutrient.position.y;
        const dirLength = Math.sqrt(dx * dx + dy * dy);

        if (dirLength > 0) {
          const dirX = dx / dirLength;
          const dirY = dy / dirLength;

          // Move nutrient toward obstacle
          nutrient.position.x += dirX * forceMagnitude * GAME_CONFIG.OBSTACLE_NUTRIENT_ATTRACTION_SPEED * deltaTime;
          nutrient.position.y += dirY * forceMagnitude * GAME_CONFIG.OBSTACLE_NUTRIENT_ATTRACTION_SPEED * deltaTime;

          // Broadcast nutrient movement
          const moveMessage: NutrientMovedMessage = {
            type: 'nutrientMoved',
            nutrientId,
            position: nutrient.position,
          };
          io.emit('nutrientMoved', moveMessage);
        }

        // Check if nutrient reached center (destroyed by distortion)
        if (dist < 20) {
          nutrients.delete(nutrientId);

          // Broadcast as "collected" by obstacle (special playerId)
          const collectMessage: NutrientCollectedMessage = {
            type: 'nutrientCollected',
            nutrientId,
            playerId: 'obstacle',
            collectorEnergy: 0,
            collectorMaxEnergy: 0,
          };
          io.emit('nutrientCollected', collectMessage);

          // Schedule respawn
          respawnNutrient(nutrientId);
          break;
        }
      }
    }
  }
}

// ============================================
// Game Loop (Server Tick)
// ============================================

/**
 * Main game loop - runs 60 times per second
 * Updates player positions based on their velocities
 */
setInterval(() => {
  // Check if game is paused (dev tool) - skip tick unless stepping
  if (!shouldRunTick()) return;

  const deltaTime = TICK_INTERVAL / 1000; // Convert to seconds

  // Update bot AI decisions with obstacle and swarm avoidance (before movement)
  updateBots(Date.now(), nutrients, obstacles, Array.from(getSwarms().values()), players);

  // Apply gravity forces from obstacles and friction (updates velocity with momentum)
  applyGravityForces(deltaTime);

  // Update swarm AI decisions - adds acceleration on top of gravity
  updateSwarms(Date.now(), players, obstacles, deltaTime);

  // Update entropy swarm positions
  updateSwarmPositions(deltaTime, io);

  // Process swarm respawns (maintain population after consumption)
  processSwarmRespawns(io);

  // Update pseudopods (extension, collision, retraction)
  updatePseudopods(deltaTime, io);

  // Check for contact predation (multi-cells draining energy from touching cells)
  checkPredationCollisions(deltaTime);

  // Check for swarm consumption (multi-cells eating disabled swarms)
  // Track which swarms are currently being consumed this tick
  const currentSwarmDrains = new Set<string>();

  for (const [playerId, player] of players) {
    if (player.stage === EvolutionStage.SINGLE_CELL) continue; // Only multi-cells can consume
    if (player.energy <= 0) continue; // Dead players can't consume

    for (const [swarmId, swarm] of getSwarms()) {
      // Only consume disabled swarms with health remaining
      if (!swarm.disabledUntil || Date.now() >= swarm.disabledUntil) continue;
      if (!swarm.energy || swarm.energy <= 0) continue;

      // Check if multi-cell is touching the swarm
      const dist = distance(player.position, swarm.position);
      const collisionDist = swarm.size + getPlayerRadius(player.stage);

      if (dist < collisionDist) {
        // Track that this swarm is being drained
        currentSwarmDrains.add(swarmId);

        // Gradual consumption - drain swarm health over time
        const damageDealt = GAME_CONFIG.SWARM_CONSUMPTION_RATE * deltaTime;
        swarm.energy -= damageDealt;

        if (swarm.energy <= 0) {
          // Swarm fully consumed - grant rewards
          player.energy = Math.min(player.maxEnergy, player.energy + GAME_CONFIG.SWARM_ENERGY_GAIN);
          player.maxEnergy += GAME_CONFIG.SWARM_MAX_ENERGY_GAIN;

          // Broadcast consumption event
          io.emit('swarmConsumed', {
            type: 'swarmConsumed',
            swarmId,
            consumerId: playerId,
          } as SwarmConsumedMessage);

          logger.info({
            event: 'swarm_consumed',
            consumerId: playerId,
            swarmId,
            energyGained: GAME_CONFIG.SWARM_ENERGY_GAIN,
            maxEnergyGained: GAME_CONFIG.SWARM_MAX_ENERGY_GAIN,
          });

          // Remove consumed swarm from game
          removeSwarm(swarmId);
        }
      }
    }
  }

  // Update active swarm drains tracking (clear swarms no longer being consumed)
  activeSwarmDrains.clear();
  currentSwarmDrains.forEach(id => activeSwarmDrains.add(id));

  // Check for swarm collisions BEFORE movement - get slowed players for this frame
  // Pass applyDamageWithResistance so swarm damage respects stage-based resistance
  const { damagedPlayerIds, slowedPlayerIds } = checkSwarmCollisions(players, deltaTime, recordDamage, applyDamageWithResistance);
  for (const playerId of damagedPlayerIds) {
    playerLastDamageSource.set(playerId, 'swarm');
  }

  // Update each player's position
  for (const [playerId, player] of players) {
    // Skip dead players (waiting for manual respawn)
    if (player.energy <= 0) continue;

    // Stunned players can't move (hit by EMP)
    if (player.stunnedUntil && Date.now() < player.stunnedUntil) {
      const velocity = playerVelocities.get(playerId);
      if (velocity) {
        velocity.x = 0;
        velocity.y = 0;
      }
      continue;
    }

    const inputDirection = playerInputDirections.get(playerId);
    const velocity = playerVelocities.get(playerId);
    if (!inputDirection || !velocity) continue;

    // Calculate input acceleration from player keys
    // Normalize diagonal input to maintain consistent acceleration
    const inputLength = Math.sqrt(inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y);
    const inputNormX = inputLength > 0 ? inputDirection.x / inputLength : 0;
    const inputNormY = inputLength > 0 ? inputDirection.y / inputLength : 0;

    // Add input as acceleration to existing velocity (creates momentum)
    // Use high acceleration value to make controls responsive while maintaining coast
    let acceleration = getConfig('PLAYER_SPEED') * 8; // 8x speed as acceleration for responsive controls

    // Multi-cells are slower (larger, less nimble)
    if (player.stage === EvolutionStage.MULTI_CELL) {
      acceleration *= 0.8; // 20% slower than single-cells
    }

    // Apply swarm slow debuff if player is in contact with a swarm
    if (slowedPlayerIds.has(playerId)) {
      acceleration *= getConfig('SWARM_SLOW_EFFECT'); // 20% slower when touched by swarm
    }

    // Apply contact drain slow debuff if being drained by a predator
    if (activeDrains.has(playerId)) {
      acceleration *= 0.5; // 50% slower when being drained
    }

    velocity.x += inputNormX * acceleration * deltaTime;
    velocity.y += inputNormY * acceleration * deltaTime;

    // Cap maximum velocity to prevent runaway speed from continuous input
    const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    let maxSpeed = getConfig('PLAYER_SPEED') * 1.2; // Allow 20% overspeed for gravity boost

    // Multi-cells have lower max speed (larger, less nimble)
    if (player.stage === EvolutionStage.MULTI_CELL) {
      maxSpeed *= 0.8; // 20% slower than single-cells
    }

    // Apply slow effect to max speed cap as well
    if (slowedPlayerIds.has(playerId)) {
      maxSpeed *= getConfig('SWARM_SLOW_EFFECT');
    }

    // Apply contact drain slow to max speed as well
    if (activeDrains.has(playerId)) {
      maxSpeed *= 0.5;
    }

    if (currentSpeed > maxSpeed) {
      const scale = maxSpeed / currentSpeed;
      velocity.x *= scale;
      velocity.y *= scale;
    }

    // Skip if no movement at all (velocity already includes gravity + input + momentum)
    if (velocity.x === 0 && velocity.y === 0) continue;

    // Calculate distance about to be traveled for energy cost
    const distanceMoved = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) * deltaTime;

    // Update position using accumulated velocity (frame-rate independent)
    player.position.x += velocity.x * deltaTime;
    player.position.y += velocity.y * deltaTime;

    // Deduct energy for movement (creates strategic choice: move vs conserve energy)
    if (player.energy > 0) {
      player.energy -= distanceMoved * getConfig('MOVEMENT_ENERGY_COST');
      player.energy = Math.max(0, player.energy); // Clamp to zero
    }

    // Keep player within world bounds (accounting for scaled cell radius)
    const playerRadius = getPlayerRadius(player.stage);
    player.position.x = Math.max(
      playerRadius,
      Math.min(GAME_CONFIG.WORLD_WIDTH - playerRadius, player.position.x)
    );
    player.position.y = Math.max(
      playerRadius,
      Math.min(GAME_CONFIG.WORLD_HEIGHT - playerRadius, player.position.y)
    );

    // Broadcast position update to all clients
    const moveMessage: PlayerMovedMessage = {
      type: 'playerMoved',
      playerId,
      position: player.position,
    };
    io.emit('playerMoved', moveMessage);
  }

  // Update metabolism (energy decay, starvation, death, evolution)
  updateMetabolism(deltaTime);

  // Check for nutrient collection
  checkNutrientCollisions();

  // Attract nutrients to obstacles (visual feeding effect)
  attractNutrientsToObstacles(deltaTime);

  // Universal death check - runs AFTER all damage sources (metabolism, obstacles, swarms, singularity)
  checkPlayerDeaths();

  // Broadcast energy/health updates (throttled)
  broadcastEnergyUpdates();

  // Broadcast detection updates for multi-cells (chemical sensing)
  broadcastDetectionUpdates();

  // Broadcast drain state for visual feedback
  broadcastDrainState();
}, TICK_INTERVAL);

// ============================================
// Periodic Logging
// ============================================

/**
 * Calculate aggregate statistics about the game state
 * Energy-only system: energy is the sole life resource
 */
function calculateAggregateStats() {
  const allPlayers = Array.from(players.values());
  const alivePlayers = allPlayers.filter(p => p.energy > 0);
  const deadPlayers = allPlayers.filter(p => p.energy <= 0);
  const bots = allPlayers.filter(p => isBot(p.id));
  const aliveBots = bots.filter(p => p.energy > 0);

  // Calculate averages for alive players only
  const avgEnergy = alivePlayers.length > 0
    ? alivePlayers.reduce((sum, p) => sum + p.energy, 0) / alivePlayers.length
    : 0;

  // Stage distribution
  const stageDistribution: Record<string, number> = {};
  for (const player of alivePlayers) {
    stageDistribution[player.stage] = (stageDistribution[player.stage] || 0) + 1;
  }

  return {
    totalPlayers: allPlayers.length,
    alivePlayers: alivePlayers.length,
    deadPlayers: deadPlayers.length,
    totalBots: bots.length,
    aliveBots: aliveBots.length,
    avgPlayerEnergy: avgEnergy,
    totalNutrients: nutrients.size,
    stageDistribution,
  };
}

/**
 * Create a complete game state snapshot
 * Energy-only system: energy is the sole life resource
 */
function createGameStateSnapshot() {
  return {
    timestamp: Date.now(),
    players: Array.from(players.values()).map(p => ({
      id: p.id,
      isBot: isBot(p.id),
      stage: p.stage,
      energy: p.energy,
      maxEnergy: p.maxEnergy,
      position: { x: p.position.x, y: p.position.y },
      alive: p.energy > 0,
    })),
    nutrients: Array.from(nutrients.values()).map(n => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      value: n.value,
    })),
    obstacles: Array.from(obstacles.values()).map(o => ({
      id: o.id,
      position: { x: o.position.x, y: o.position.y },
      radius: o.radius,
    })),
  };
}

// Log aggregate stats every 15 seconds
setInterval(() => {
  const stats = calculateAggregateStats();
  logAggregateStats(stats);
}, 15000);

// Log full game state snapshot every 60 seconds
setInterval(() => {
  const snapshot = createGameStateSnapshot();
  logGameStateSnapshot(snapshot);
}, 60000);
