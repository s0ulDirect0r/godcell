import { GAME_CONFIG } from '@godcell/shared';
import type { EntropySwarm, Position, Player, SwarmSpawnedMessage, Obstacle } from '@godcell/shared';
import type { Server } from 'socket.io';

// ============================================
// Entropy Swarm System - Virus enemies that hunt players
// ============================================

// All entropy swarms currently in the game
const swarms: Map<string, EntropySwarm> = new Map();

// Counter for generating unique swarm IDs
let swarmIdCounter = 0;

// ============================================
// Helper Functions
// ============================================

function randomSpawnPosition(): Position {
  const padding = 300; // Keep swarms away from edges
  return {
    x: Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2) + padding,
    y: Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2) + padding,
  };
}

function distance(p1: Position, p2: Position): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Generate a random patrol target within radius of spawn point
 */
function generatePatrolTarget(spawnPos: Position): Position {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * GAME_CONFIG.SWARM_PATROL_RADIUS;
  return {
    x: spawnPos.x + Math.cos(angle) * radius,
    y: spawnPos.y + Math.sin(angle) * radius,
  };
}

// ============================================
// Swarm Spawning
// ============================================

/**
 * Spawn a single entropy swarm at a random location
 */
function spawnSwarm(io: Server): EntropySwarm {
  const spawnPos = randomSpawnPosition();

  const swarm: EntropySwarm = {
    id: `swarm-${swarmIdCounter++}`,
    position: spawnPos,
    velocity: { x: 0, y: 0 },
    size: GAME_CONFIG.SWARM_SIZE,
    state: 'patrol',
    patrolTarget: generatePatrolTarget(spawnPos),
  };

  swarms.set(swarm.id, swarm);

  // Broadcast swarm spawn to all clients
  const spawnMessage: SwarmSpawnedMessage = {
    type: 'swarmSpawned',
    swarm: { ...swarm },
  };
  io.emit('swarmSpawned', spawnMessage);

  return swarm;
}

/**
 * Initialize all entropy swarms at server start
 */
export function initializeSwarms(io: Server) {
  for (let i = 0; i < GAME_CONFIG.SWARM_COUNT; i++) {
    spawnSwarm(io);
  }
}

// ============================================
// AI Behavior
// ============================================

/**
 * Find the nearest alive player within detection radius
 */
function findNearestPlayer(swarm: EntropySwarm, players: Map<string, Player>): Player | null {
  let nearestPlayer: Player | null = null;
  let nearestDist = GAME_CONFIG.SWARM_DETECTION_RADIUS;

  for (const player of players.values()) {
    // Skip dead players and evolving players
    if (player.health <= 0 || player.isEvolving) continue;

    const dist = distance(swarm.position, player.position);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestPlayer = player;
    }
  }

  return nearestPlayer;
}

/**
 * Calculate avoidance force to steer away from dangerous obstacle cores
 * Returns a velocity adjustment to apply
 */
function calculateObstacleAvoidance(swarm: EntropySwarm, obstacles: Map<string, Obstacle>): { x: number; y: number } {
  let avoidanceX = 0;
  let avoidanceY = 0;

  // Swarms start avoiding at 2x the core radius (give them more warning)
  const avoidanceRadius = GAME_CONFIG.OBSTACLE_CORE_RADIUS * 2;

  for (const obstacle of obstacles.values()) {
    const dist = distance(swarm.position, obstacle.position);

    // If within avoidance radius, apply repulsion force
    if (dist < avoidanceRadius) {
      // Direction away from obstacle
      const dx = swarm.position.x - obstacle.position.x;
      const dy = swarm.position.y - obstacle.position.y;
      const distSq = Math.max(dist * dist, 1); // Prevent division by zero

      // Stronger avoidance the closer we get (inverse square)
      // Treat as acceleration for consistency with movement system
      const accelerationMagnitude = (avoidanceRadius * avoidanceRadius) / distSq * GAME_CONFIG.SWARM_SPEED * 16;

      avoidanceX += (dx / dist) * accelerationMagnitude;
      avoidanceY += (dy / dist) * accelerationMagnitude;
    }
  }

  return { x: avoidanceX, y: avoidanceY };
}

/**
 * Calculate repulsion force to prevent swarms from overlapping each other
 * Swarms take up physical space and push each other away
 * Returns a velocity adjustment to apply
 */
function calculateSwarmRepulsion(swarm: EntropySwarm, allSwarms: Map<string, EntropySwarm>): { x: number; y: number } {
  let repulsionX = 0;
  let repulsionY = 0;

  // Swarms repel when their spheres would overlap (2x swarm size = touching)
  const repulsionRadius = GAME_CONFIG.SWARM_SIZE * 2.2; // Slight buffer for smoother spacing

  for (const otherSwarm of allSwarms.values()) {
    // Skip self
    if (otherSwarm.id === swarm.id) continue;

    const dist = distance(swarm.position, otherSwarm.position);

    // If swarms are too close, apply repulsion force
    if (dist < repulsionRadius) {
      // Direction away from other swarm
      const dx = swarm.position.x - otherSwarm.position.x;
      const dy = swarm.position.y - otherSwarm.position.y;
      const distSq = Math.max(dist * dist, 1); // Prevent division by zero

      // Stronger repulsion the closer they get (inverse square)
      // Use moderate force - swarms should spread out but not violently
      const accelerationMagnitude = (repulsionRadius * repulsionRadius) / distSq * GAME_CONFIG.SWARM_SPEED * 8;

      repulsionX += (dx / dist) * accelerationMagnitude;
      repulsionY += (dy / dist) * accelerationMagnitude;
    }
  }

  return { x: repulsionX, y: repulsionY };
}

/**
 * Update swarm AI decision-making with acceleration-based movement
 */
export function updateSwarms(
  currentTime: number,
  players: Map<string, Player>,
  obstacles: Map<string, Obstacle>,
  deltaTime: number
) {
  for (const swarm of swarms.values()) {
    // Check for nearby players
    const nearestPlayer = findNearestPlayer(swarm, players);

    if (nearestPlayer) {
      // CHASE: Player detected within range
      if (swarm.state !== 'chase' || swarm.targetPlayerId !== nearestPlayer.id) {
        swarm.state = 'chase';
        swarm.targetPlayerId = nearestPlayer.id;
        swarm.patrolTarget = undefined;
      }

      // Calculate direction toward player and add to existing velocity (gravity)
      const dx = nearestPlayer.position.x - swarm.position.x;
      const dy = nearestPlayer.position.y - swarm.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        // Add AI movement as acceleration (like player input)
        // Use higher multiplier for responsive movement with momentum
        const acceleration = GAME_CONFIG.SWARM_SPEED * 8;
        swarm.velocity.x += (dx / dist) * acceleration * deltaTime;
        swarm.velocity.y += (dy / dist) * acceleration * deltaTime;
      }
    } else {
      // PATROL: No players nearby, wander around
      if (swarm.state !== 'patrol') {
        swarm.state = 'patrol';
        swarm.targetPlayerId = undefined;
        swarm.patrolTarget = generatePatrolTarget(swarm.position);
      }

      // Check if reached patrol target or need new one
      if (swarm.patrolTarget) {
        const distToTarget = distance(swarm.position, swarm.patrolTarget);

        if (distToTarget < 50) {
          // Reached target, pick new one
          swarm.patrolTarget = generatePatrolTarget(swarm.position);
        }

        // Move toward patrol target and add to existing velocity (gravity)
        const dx = swarm.patrolTarget.x - swarm.position.x;
        const dy = swarm.patrolTarget.y - swarm.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          // Slower acceleration while patrolling (60% of chase speed)
          const patrolAcceleration = GAME_CONFIG.SWARM_SPEED * 8 * 0.6;
          swarm.velocity.x += (dx / dist) * patrolAcceleration * deltaTime;
          swarm.velocity.y += (dy / dist) * patrolAcceleration * deltaTime;
        }
      }
    }

    // Apply obstacle avoidance acceleration (high priority)
    const avoidance = calculateObstacleAvoidance(swarm, obstacles);
    swarm.velocity.x += avoidance.x * deltaTime;
    swarm.velocity.y += avoidance.y * deltaTime;

    // Apply swarm-swarm repulsion (prevent overlap)
    const repulsion = calculateSwarmRepulsion(swarm, swarms);
    swarm.velocity.x += repulsion.x * deltaTime;
    swarm.velocity.y += repulsion.y * deltaTime;

    // Clamp to max speed (like players, allow slight overspeed for gravity)
    const velocityMagnitude = Math.sqrt(swarm.velocity.x * swarm.velocity.x + swarm.velocity.y * swarm.velocity.y);
    const maxSpeed = GAME_CONFIG.SWARM_SPEED * 1.2; // 20% overspeed allowance
    if (velocityMagnitude > maxSpeed) {
      swarm.velocity.x = (swarm.velocity.x / velocityMagnitude) * maxSpeed;
      swarm.velocity.y = (swarm.velocity.y / velocityMagnitude) * maxSpeed;
    }
  }
}

/**
 * Update swarm positions based on velocity (called every tick)
 */
export function updateSwarmPositions(deltaTime: number, io: Server) {
  for (const swarm of swarms.values()) {
    // Update position based on velocity (like players)
    swarm.position.x += swarm.velocity.x * deltaTime;
    swarm.position.y += swarm.velocity.y * deltaTime;

    // Keep swarms within world bounds
    const padding = GAME_CONFIG.SWARM_SIZE;
    swarm.position.x = Math.max(padding, Math.min(GAME_CONFIG.WORLD_WIDTH - padding, swarm.position.x));
    swarm.position.y = Math.max(padding, Math.min(GAME_CONFIG.WORLD_HEIGHT - padding, swarm.position.y));

    // Broadcast position update
    io.emit('swarmMoved', {
      type: 'swarmMoved',
      swarmId: swarm.id,
      position: swarm.position,
      state: swarm.state,
    });
  }
}

/**
 * Check for collisions between swarms and players, deal damage and apply slow
 * Death is handled by universal death check after all damage sources
 * Returns object with damaged player IDs (for cause tracking) and slowed player IDs
 */
export function checkSwarmCollisions(
  players: Map<string, Player>,
  deltaTime: number
): { damagedPlayerIds: Set<string>; slowedPlayerIds: Set<string> } {
  const damagedPlayerIds = new Set<string>();
  const slowedPlayerIds = new Set<string>();

  for (const swarm of swarms.values()) {
    for (const player of players.values()) {
      // Skip dead/evolving players
      if (player.health <= 0 || player.isEvolving) continue;

      // Check collision (circle-circle)
      const dist = distance(swarm.position, player.position);
      const collisionDist = swarm.size + GAME_CONFIG.PLAYER_SIZE;

      if (dist < collisionDist) {
        // Deal damage over time (death handled by checkPlayerDeaths)
        const damage = GAME_CONFIG.SWARM_DAMAGE_RATE * deltaTime;
        player.health -= damage;
        damagedPlayerIds.add(player.id);

        // Apply movement slow debuff
        slowedPlayerIds.add(player.id);
      }
    }
  }

  return { damagedPlayerIds, slowedPlayerIds };
}

/**
 * Get all swarms as a record for initial state broadcast
 */
export function getSwarmsRecord(): Record<string, EntropySwarm> {
  const record: Record<string, EntropySwarm> = {};
  for (const [id, swarm] of swarms.entries()) {
    record[id] = { ...swarm };
  }
  return record;
}

/**
 * Check if an ID belongs to a swarm
 */
export function isSwarm(id: string): boolean {
  return id.startsWith('swarm-');
}

/**
 * Get swarms map for gravity force application
 */
export function getSwarms(): Map<string, EntropySwarm> {
  return swarms;
}
