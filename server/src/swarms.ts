import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type { EntropySwarm, Position, SwarmSpawnedMessage } from '@godcell/shared';
import type { Server } from 'socket.io';
import { getConfig } from './dev';
import {
  createSwarm,
  destroyEntity,
  forEachPlayer,
  forEachSwarm,
  getAllObstacleSnapshots,
  getSwarmComponents,
  buildSwarmsRecord,
  Components,
  type World,
  type EntityId,
  type EnergyComponent,
  type PositionComponent,
  type VelocityComponent,
  type StageComponent,
  type SwarmComponent,
} from './ecs';

// ============================================
// Stage Helpers (soup vs jungle)
// ============================================

/**
 * Check if player is in soup stage (Stage 1-2)
 * Soup entities only interact with soup-stage players
 */
function isSoupStage(stage: EvolutionStage): boolean {
  return stage === EvolutionStage.SINGLE_CELL || stage === EvolutionStage.MULTI_CELL;
}

// ============================================
// Entropy Swarm System - Virus enemies that hunt players
// ============================================
// ECS is the sole source of truth for swarm state.
// This module handles spawning, AI decisions, and respawn scheduling.
// ============================================

// Counter for generating unique swarm IDs
let swarmIdCounter = 0;

// Swarm respawn queue (tracks consumed swarms scheduled for respawn)
const swarmRespawnQueue: Array<{ respawnTime: number }> = [];

// Respawn delay in milliseconds
const SWARM_RESPAWN_DELAY = 30000; // 30 seconds

// ============================================
// Helper Functions
// ============================================

/**
 * Generate swarm positions with minimum separation for structured distribution
 * Uses rejection sampling to ensure swarms are evenly spread across the soup region
 * Swarms are soup entities - they spawn and live in the soup area
 */
function generateSwarmPositions(count: number): Position[] {
  const padding = 300; // Keep swarms away from edges
  const MIN_SWARM_SEPARATION = 600; // Minimum distance between swarms
  const maxAttempts = 100;
  const positions: Position[] = [];

  // Swarms spawn in soup region (using SOUP_ORIGIN offset)
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X + padding;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH - padding;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y + padding;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT - padding;

  for (let i = 0; i < count; i++) {
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < maxAttempts) {
      const candidate = {
        x: Math.random() * (soupMaxX - soupMinX) + soupMinX,
        y: Math.random() * (soupMaxY - soupMinY) + soupMinY,
      };

      // Check distance from all existing swarm positions
      let tooClose = false;
      for (const existing of positions) {
        if (distance(candidate, existing) < MIN_SWARM_SEPARATION) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        positions.push(candidate);
        placed = true;
      }

      attempts++;
    }

    // If we can't find a valid spot, place anyway (better than no swarm)
    if (!placed) {
      positions.push({
        x: Math.random() * (soupMaxX - soupMinX) + soupMinX,
        y: Math.random() * (soupMaxY - soupMinY) + soupMinY,
      });
    }
  }

  return positions;
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
 * Initialize all entropy swarms at server start
 * Uses structured distribution with 600px minimum separation
 * Creates swarms directly in ECS (source of truth)
 */
export function initializeSwarms(world: World, io: Server) {
  // Generate all swarm positions at once with minimum separation
  const positions = generateSwarmPositions(GAME_CONFIG.SWARM_COUNT);

  // Create swarms at generated positions (ECS is sole source of truth)
  for (const position of positions) {
    const swarmId = `swarm-${swarmIdCounter++}`;
    const patrolTarget = generatePatrolTarget(position);

    // Create in ECS
    createSwarm(
      world,
      swarmId,
      position,
      GAME_CONFIG.SWARM_SIZE,
      GAME_CONFIG.SWARM_ENERGY,
      patrolTarget
    );

    // Build EntropySwarm for network broadcast
    const swarm: EntropySwarm = {
      id: swarmId,
      position,
      velocity: { x: 0, y: 0 },
      size: GAME_CONFIG.SWARM_SIZE,
      state: 'patrol',
      patrolTarget,
      energy: GAME_CONFIG.SWARM_ENERGY,
    };

    // Broadcast swarm spawn to all clients
    const spawnMessage: SwarmSpawnedMessage = {
      type: 'swarmSpawned',
      swarm,
    };
    io.emit('swarmSpawned', spawnMessage);
  }
}

// ============================================
// AI Behavior
// ============================================

/**
 * Find the nearest alive player within detection radius
 * Swarms only target soup-stage players (Stage 1-2)
 * Returns player info needed for chasing (id, entityId, and position)
 */
function findNearestPlayer(
  swarmPosition: Position,
  world: World
): { id: string; entityId: EntityId; position: { x: number; y: number } } | null {
  let nearestPlayer: { id: string; entityId: EntityId; position: { x: number; y: number } } | null = null;
  let nearestDist = getConfig('SWARM_DETECTION_RADIUS');

  forEachPlayer(world, (entity, playerId) => {
    const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
    const posComp = world.getComponent<PositionComponent>(entity, Components.Position);
    const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
    if (!energyComp || !posComp || !stageComp) return;

    // Skip dead players and evolving players
    if (energyComp.current <= 0 || stageComp.isEvolving) return;

    // Swarms only chase soup-stage players (Stage 1-2)
    if (!isSoupStage(stageComp.stage)) return;

    const playerPosition = { x: posComp.x, y: posComp.y };
    const dist = distance(swarmPosition, playerPosition);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestPlayer = { id: playerId, entityId: entity, position: playerPosition };
    }
  });

  return nearestPlayer;
}

/**
 * Calculate avoidance force to steer away from dangerous obstacle cores
 * Uses ECS to query obstacle positions
 * Returns a velocity adjustment to apply
 */
function calculateObstacleAvoidance(swarmPosition: Position, world: World): { x: number; y: number } {
  let avoidanceX = 0;
  let avoidanceY = 0;

  // Swarms start avoiding at 2x the core radius (give them more warning)
  const avoidanceRadius = getConfig('OBSTACLE_CORE_RADIUS') * 2;

  // Query obstacles from ECS
  const obstacles = getAllObstacleSnapshots(world);

  for (const obstacle of obstacles) {
    const dist = distance(swarmPosition, obstacle.position);

    // If within avoidance radius, apply repulsion force
    if (dist < avoidanceRadius) {
      // Direction away from obstacle
      const dx = swarmPosition.x - obstacle.position.x;
      const dy = swarmPosition.y - obstacle.position.y;
      const distSq = Math.max(dist * dist, 1); // Prevent division by zero

      // Stronger avoidance the closer we get (inverse square)
      // Treat as acceleration for consistency with movement system
      const accelerationMagnitude = (avoidanceRadius * avoidanceRadius) / distSq * getConfig('SWARM_SPEED') * 16;

      avoidanceX += (dx / dist) * accelerationMagnitude;
      avoidanceY += (dy / dist) * accelerationMagnitude;
    }
  }

  return { x: avoidanceX, y: avoidanceY };
}

/**
 * Calculate repulsion force to prevent swarms from overlapping each other
 * Swarms take up physical space and push each other away
 * Uses ECS to query other swarm positions
 * Returns a velocity adjustment to apply
 */
function calculateSwarmRepulsion(
  swarmId: string,
  swarmPosition: Position,
  world: World
): { x: number; y: number } {
  let repulsionX = 0;
  let repulsionY = 0;

  // Swarms repel when their spheres would overlap (2x swarm size = touching)
  const repulsionRadius = GAME_CONFIG.SWARM_SIZE * 2.2; // Slight buffer for smoother spacing

  // Query all swarms from ECS
  forEachSwarm(world, (_entity, otherId, otherPos) => {
    // Skip self
    if (otherId === swarmId) return;

    const otherPosition = { x: otherPos.x, y: otherPos.y };
    const dist = distance(swarmPosition, otherPosition);

    // If swarms are too close, apply repulsion force
    if (dist < repulsionRadius) {
      // Direction away from other swarm
      const dx = swarmPosition.x - otherPosition.x;
      const dy = swarmPosition.y - otherPosition.y;
      const distSq = Math.max(dist * dist, 1); // Prevent division by zero

      // Stronger repulsion the closer they get (inverse square)
      // Use moderate force - swarms should spread out but not violently
      const accelerationMagnitude = (repulsionRadius * repulsionRadius) / distSq * getConfig('SWARM_SPEED') * 8;

      repulsionX += (dx / dist) * accelerationMagnitude;
      repulsionY += (dy / dist) * accelerationMagnitude;
    }
  });

  return { x: repulsionX, y: repulsionY };
}

/**
 * Update swarm AI decision-making with acceleration-based movement
 * Iterates ECS swarm entities and mutates their components directly.
 */
export function updateSwarms(
  currentTime: number,
  world: World,
  deltaTime: number
) {
  const now = Date.now();

  // Iterate all swarms via ECS
  forEachSwarm(world, (entity, swarmId, posComp, velComp, swarmComp, energyComp) => {
    // Skip disabled swarms (hit by EMP)
    if (swarmComp.disabledUntil && now < swarmComp.disabledUntil) {
      velComp.x = 0; // Zero velocity while disabled
      velComp.y = 0;
      return;
    }

    const swarmPosition = { x: posComp.x, y: posComp.y };

    // Check for nearby players
    const nearestPlayer = findNearestPlayer(swarmPosition, world);

    if (nearestPlayer) {
      // CHASE: Player detected within range
      if (swarmComp.state !== 'chase' || swarmComp.targetPlayerId !== nearestPlayer.id) {
        swarmComp.state = 'chase';
        swarmComp.targetPlayerId = nearestPlayer.id;
        swarmComp.patrolTarget = undefined;
      }

      // Calculate direction toward player and add to existing velocity (gravity)
      const dx = nearestPlayer.position.x - swarmPosition.x;
      const dy = nearestPlayer.position.y - swarmPosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        // Add AI movement as acceleration (like player input)
        // Use higher multiplier for responsive movement with momentum
        const acceleration = getConfig('SWARM_SPEED') * 8;
        velComp.x += (dx / dist) * acceleration * deltaTime;
        velComp.y += (dy / dist) * acceleration * deltaTime;
      }
    } else {
      // PATROL: No players nearby, wander around
      if (swarmComp.state !== 'patrol') {
        swarmComp.state = 'patrol';
        swarmComp.targetPlayerId = undefined;
        swarmComp.patrolTarget = generatePatrolTarget(swarmComp.homePosition);
      }

      // Check if reached patrol target or need new one
      if (swarmComp.patrolTarget) {
        const distToTarget = distance(swarmPosition, swarmComp.patrolTarget);

        if (distToTarget < 50) {
          // Reached target, pick new one
          swarmComp.patrolTarget = generatePatrolTarget(swarmComp.homePosition);
        }

        // Move toward patrol target and add to existing velocity (gravity)
        const dx = swarmComp.patrolTarget.x - swarmPosition.x;
        const dy = swarmComp.patrolTarget.y - swarmPosition.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          // Slower acceleration while patrolling (60% of chase speed)
          const patrolAcceleration = getConfig('SWARM_SPEED') * 8 * 0.6;
          velComp.x += (dx / dist) * patrolAcceleration * deltaTime;
          velComp.y += (dy / dist) * patrolAcceleration * deltaTime;
        }
      }
    }

    // Apply obstacle avoidance acceleration (high priority)
    const avoidance = calculateObstacleAvoidance(swarmPosition, world);
    velComp.x += avoidance.x * deltaTime;
    velComp.y += avoidance.y * deltaTime;

    // Apply swarm-swarm repulsion (prevent overlap)
    const repulsion = calculateSwarmRepulsion(swarmId, swarmPosition, world);
    velComp.x += repulsion.x * deltaTime;
    velComp.y += repulsion.y * deltaTime;

    // Clamp to max speed (like players, allow slight overspeed for gravity)
    const velocityMagnitude = Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y);
    const maxSpeed = getConfig('SWARM_SPEED') * 1.2; // 20% overspeed allowance
    if (velocityMagnitude > maxSpeed) {
      velComp.x = (velComp.x / velocityMagnitude) * maxSpeed;
      velComp.y = (velComp.y / velocityMagnitude) * maxSpeed;
    }
  });
}

/**
 * Update swarm positions based on velocity (called every tick)
 * Swarms are clamped to soup region bounds
 * Iterates ECS swarm entities directly.
 */
export function updateSwarmPositions(world: World, deltaTime: number, io: Server) {
  // Swarms live in the soup region
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT;

  forEachSwarm(world, (entity, swarmId, posComp, velComp, swarmComp) => {
    // Update position based on velocity (like players)
    posComp.x += velComp.x * deltaTime;
    posComp.y += velComp.y * deltaTime;

    // Keep swarms within soup bounds
    const padding = GAME_CONFIG.SWARM_SIZE;
    posComp.x = Math.max(soupMinX + padding, Math.min(soupMaxX - padding, posComp.x));
    posComp.y = Math.max(soupMinY + padding, Math.min(soupMaxY - padding, posComp.y));

    // Broadcast position update (including disabled state)
    io.emit('swarmMoved', {
      type: 'swarmMoved',
      swarmId,
      position: { x: posComp.x, y: posComp.y },
      state: swarmComp.state,
      disabledUntil: swarmComp.disabledUntil, // Include EMP stun state
    });
  });
}

// NOTE: checkSwarmCollisions has been inlined into SwarmCollisionSystem
// The collision detection logic now lives directly in the ECS system at:
// server/src/ecs/systems/SwarmCollisionSystem.ts

/**
 * Get all swarms as a record for initial state broadcast.
 * Delegates to buildSwarmsRecord from ECS.
 * @deprecated Use buildSwarmsRecord(world) directly for better type safety.
 */
export { buildSwarmsRecord as getSwarmsRecord };

/**
 * Check if an ID belongs to a swarm
 */
export function isSwarm(id: string): boolean {
  return id.startsWith('swarm-');
}

/**
 * Remove a swarm from the game (consumed by player) and schedule respawn
 * Removes from ECS (source of truth).
 */
export function removeSwarm(world: World, swarmId: string): void {
  // Get entity from ECS lookup
  const components = getSwarmComponents(world, swarmId);
  if (components) {
    destroyEntity(world, components.entity);
  }

  // Schedule respawn to maintain swarm population
  swarmRespawnQueue.push({
    respawnTime: Date.now() + SWARM_RESPAWN_DELAY,
  });
}

/**
 * Spawn a swarm at a specific position (dev tool)
 * Creates directly in ECS (source of truth).
 */
export function spawnSwarmAt(world: World, io: Server, position: Position): EntropySwarm {
  const swarmId = `swarm-${swarmIdCounter++}`;
  const patrolTarget = generatePatrolTarget(position);

  // Create in ECS (source of truth)
  createSwarm(
    world,
    swarmId,
    position,
    GAME_CONFIG.SWARM_SIZE,
    GAME_CONFIG.SWARM_ENERGY,
    patrolTarget
  );

  // Build EntropySwarm for network broadcast
  const swarm: EntropySwarm = {
    id: swarmId,
    position: { ...position },
    velocity: { x: 0, y: 0 },
    size: GAME_CONFIG.SWARM_SIZE,
    state: 'patrol',
    patrolTarget,
    energy: GAME_CONFIG.SWARM_ENERGY,
  };

  // Broadcast to all clients for immediate visibility
  const spawnMessage: SwarmSpawnedMessage = {
    type: 'swarmSpawned',
    swarm,
  };
  io.emit('swarmSpawned', spawnMessage);

  return swarm;
}

/**
 * Process swarm respawn queue and spawn new swarms when timers expire
 * Call this every game tick
 */
export function processSwarmRespawns(world: World, io: Server): void {
  const now = Date.now();

  // Process all swarms ready to respawn
  while (swarmRespawnQueue.length > 0 && swarmRespawnQueue[0].respawnTime <= now) {
    swarmRespawnQueue.shift(); // Remove from queue

    // Generate new spawn position (random, with spacing from existing swarms)
    const newPosition = generateSwarmPositions(1)[0];
    const swarmId = `swarm-${swarmIdCounter++}`;
    const patrolTarget = generatePatrolTarget(newPosition);

    // Create in ECS (source of truth)
    createSwarm(
      world,
      swarmId,
      newPosition,
      GAME_CONFIG.SWARM_SIZE,
      GAME_CONFIG.SWARM_ENERGY,
      patrolTarget
    );

    // Build EntropySwarm for network broadcast
    const swarm: EntropySwarm = {
      id: swarmId,
      position: { ...newPosition },
      velocity: { x: 0, y: 0 },
      size: GAME_CONFIG.SWARM_SIZE,
      state: 'patrol',
      patrolTarget,
      energy: GAME_CONFIG.SWARM_ENERGY,
    };

    // Broadcast respawn to all clients
    const spawnMessage: SwarmSpawnedMessage = {
      type: 'swarmSpawned',
      swarm,
    };
    io.emit('swarmSpawned', spawnMessage);
  }
}
