import { GAME_CONFIG, distanceForMode, isSphereMode, getRandomSpherePosition, projectToSphere, makeTangent, tangentToward, type Vec3 } from '#shared';
import type { EntropySwarm, Position, SwarmSpawnedMessage } from '#shared';
import type { Server } from 'socket.io';
import { getConfig } from './dev';
import { isSoupStage } from './helpers/stages';
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
  type StageComponent,
} from './ecs';

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
 * - Sphere mode: Random positions on sphere surface
 * - Flat mode: Rejection sampling in soup region
 */
function generateSwarmPositions(count: number): Position[] {
  const MIN_SWARM_SEPARATION = 600;
  const maxAttempts = 100;
  const positions: Position[] = [];

  if (isSphereMode()) {
    // Sphere mode: random positions on sphere surface with minimum separation
    for (let i = 0; i < count; i++) {
      let placed = false;
      let attempts = 0;

      while (!placed && attempts < maxAttempts) {
        const candidate = getRandomSpherePosition(GAME_CONFIG.SPHERE_RADIUS);

        let tooClose = false;
        for (const existing of positions) {
          if (distanceForMode(candidate, existing) < MIN_SWARM_SEPARATION) {
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

      if (!placed) {
        positions.push(getRandomSpherePosition(GAME_CONFIG.SPHERE_RADIUS));
      }
    }
    return positions;
  }

  // Flat world: spawn in soup region
  const padding = 300;
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

      let tooClose = false;
      for (const existing of positions) {
        if (distanceForMode(candidate, existing) < MIN_SWARM_SEPARATION) {
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

    if (!placed) {
      positions.push({
        x: Math.random() * (soupMaxX - soupMinX) + soupMinX,
        y: Math.random() * (soupMaxY - soupMinY) + soupMinY,
      });
    }
  }

  return positions;
}

/**
 * Generate a random patrol target within radius of spawn point
 * - Sphere mode: Random point on sphere within angular distance
 * - Flat mode: Random point in 2D circle
 */
function generatePatrolTarget(spawnPos: Position): Position {
  if (isSphereMode()) {
    // Generate random direction on tangent plane, then project to sphere
    const sphereRadius = GAME_CONFIG.SPHERE_RADIUS;
    const patrolDist = Math.random() * GAME_CONFIG.SWARM_PATROL_RADIUS;
    const angle = Math.random() * Math.PI * 2;

    // Get tangent basis vectors at spawn position
    const pos: Vec3 = { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z ?? 0 };
    const normal = {
      x: pos.x / sphereRadius,
      y: pos.y / sphereRadius,
      z: pos.z / sphereRadius
    };

    // Create arbitrary tangent vectors
    let tangent1: Vec3;
    if (Math.abs(normal.y) < 0.9) {
      // Cross with world up
      tangent1 = {
        x: normal.z,
        y: 0,
        z: -normal.x
      };
    } else {
      // Cross with world right
      tangent1 = {
        x: 0,
        y: -normal.z,
        z: normal.y
      };
    }
    const t1Len = Math.sqrt(tangent1.x * tangent1.x + tangent1.y * tangent1.y + tangent1.z * tangent1.z);
    tangent1 = { x: tangent1.x / t1Len, y: tangent1.y / t1Len, z: tangent1.z / t1Len };

    // Second tangent is cross of normal and tangent1
    const tangent2: Vec3 = {
      x: normal.y * tangent1.z - normal.z * tangent1.y,
      y: normal.z * tangent1.x - normal.x * tangent1.z,
      z: normal.x * tangent1.y - normal.y * tangent1.x,
    };

    // Move in random direction on tangent plane
    const dx = Math.cos(angle) * patrolDist;
    const dy = Math.sin(angle) * patrolDist;
    const newPos: Vec3 = {
      x: pos.x + tangent1.x * dx + tangent2.x * dy,
      y: pos.y + tangent1.y * dx + tangent2.y * dy,
      z: pos.z + tangent1.z * dx + tangent2.z * dy,
    };

    // Project back to sphere
    const projected = projectToSphere(newPos, sphereRadius);
    return { x: projected.x, y: projected.y, z: projected.z };
  }

  // Flat mode: simple 2D circle
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
): { id: string; entityId: EntityId; position: { x: number; y: number; z: number } } | null {
  let nearestPlayer: { id: string; entityId: EntityId; position: { x: number; y: number; z: number } } | null =
    null;
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

    const playerPosition = { x: posComp.x, y: posComp.y, z: posComp.z ?? 0 };
    const dist = distanceForMode(swarmPosition, playerPosition);
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
 * Returns a velocity adjustment to apply (3D for sphere mode)
 */
function calculateObstacleAvoidance(
  swarmPosition: Position,
  world: World
): { x: number; y: number; z: number } {
  let avoidanceX = 0;
  let avoidanceY = 0;
  let avoidanceZ = 0;
  const sphereMode = isSphereMode();

  // Swarms start avoiding at 2x the core radius (give them more warning)
  const avoidanceRadius = getConfig('OBSTACLE_CORE_RADIUS') * 2;

  // Query obstacles from ECS
  const obstacles = getAllObstacleSnapshots(world);

  for (const obstacle of obstacles) {
    const obstaclePos = { x: obstacle.position.x, y: obstacle.position.y, z: obstacle.position.z ?? 0 };
    const dist = distanceForMode(swarmPosition, obstaclePos);

    // If within avoidance radius, apply repulsion force
    if (dist < avoidanceRadius) {
      const distSq = Math.max(dist * dist, 1); // Prevent division by zero

      // Stronger avoidance the closer we get (inverse square)
      const accelerationMagnitude =
        ((avoidanceRadius * avoidanceRadius) / distSq) * getConfig('SWARM_SPEED') * 16;

      if (sphereMode) {
        // Sphere mode: use tangent direction AWAY from obstacle
        const swarmPos3D: Vec3 = { x: swarmPosition.x, y: swarmPosition.y, z: swarmPosition.z ?? 0 };
        const awayDir = tangentToward(swarmPos3D, obstaclePos);
        // Negate to move AWAY from obstacle
        avoidanceX -= awayDir.x * accelerationMagnitude;
        avoidanceY -= awayDir.y * accelerationMagnitude;
        avoidanceZ -= awayDir.z * accelerationMagnitude;
      } else {
        // Flat mode: 2D direction away from obstacle
        const dx = swarmPosition.x - obstacle.position.x;
        const dy = swarmPosition.y - obstacle.position.y;
        avoidanceX += (dx / dist) * accelerationMagnitude;
        avoidanceY += (dy / dist) * accelerationMagnitude;
      }
    }
  }

  return { x: avoidanceX, y: avoidanceY, z: avoidanceZ };
}

/**
 * Calculate repulsion force to prevent swarms from overlapping each other
 * Swarms take up physical space and push each other away
 * Uses ECS to query other swarm positions
 * Returns a velocity adjustment to apply (3D for sphere mode)
 */
function calculateSwarmRepulsion(
  swarmId: string,
  swarmPosition: Position,
  world: World
): { x: number; y: number; z: number } {
  let repulsionX = 0;
  let repulsionY = 0;
  let repulsionZ = 0;
  const sphereMode = isSphereMode();

  // Swarms repel when their spheres would overlap (2x swarm size = touching)
  const repulsionRadius = GAME_CONFIG.SWARM_SIZE * 2.2; // Slight buffer for smoother spacing

  // Query all swarms from ECS
  forEachSwarm(world, (_entity, otherId, otherPos) => {
    // Skip self
    if (otherId === swarmId) return;

    const otherPosition = { x: otherPos.x, y: otherPos.y, z: otherPos.z ?? 0 };
    const dist = distanceForMode(swarmPosition, otherPosition);

    // If swarms are too close, apply repulsion force
    if (dist < repulsionRadius) {
      const distSq = Math.max(dist * dist, 1); // Prevent division by zero

      // Stronger repulsion the closer they get (inverse square)
      const accelerationMagnitude =
        ((repulsionRadius * repulsionRadius) / distSq) * getConfig('SWARM_SPEED') * 8;

      if (sphereMode) {
        // Sphere mode: use tangent direction AWAY from other swarm
        const swarmPos3D: Vec3 = { x: swarmPosition.x, y: swarmPosition.y, z: swarmPosition.z ?? 0 };
        const awayDir = tangentToward(swarmPos3D, otherPosition);
        // Negate to move AWAY from other swarm
        repulsionX -= awayDir.x * accelerationMagnitude;
        repulsionY -= awayDir.y * accelerationMagnitude;
        repulsionZ -= awayDir.z * accelerationMagnitude;
      } else {
        // Flat mode: 2D direction away from other swarm
        const dx = swarmPosition.x - otherPosition.x;
        const dy = swarmPosition.y - otherPosition.y;
        repulsionX += (dx / dist) * accelerationMagnitude;
        repulsionY += (dy / dist) * accelerationMagnitude;
      }
    }
  });

  return { x: repulsionX, y: repulsionY, z: repulsionZ };
}

/**
 * Update swarm AI decision-making with acceleration-based movement
 * Iterates ECS swarm entities and mutates their components directly.
 */
export function updateSwarms(currentTime: number, world: World, deltaTime: number) {
  const now = Date.now();
  const sphereMode = isSphereMode();

  // Iterate all swarms via ECS
  forEachSwarm(world, (entity, swarmId, posComp, velComp, swarmComp, energyComp) => {
    // Skip disabled swarms (hit by EMP)
    if (swarmComp.disabledUntil && now < swarmComp.disabledUntil) {
      velComp.x = 0; // Zero velocity while disabled
      velComp.y = 0;
      if (sphereMode) velComp.z = 0;
      return;
    }

    const swarmPosition = { x: posComp.x, y: posComp.y, z: posComp.z ?? 0 };

    // Fat swarms are slightly faster - very gentle scaling
    // At 500 energy = 1.1x speed (10% faster), at 100 = 1x
    const MAX_SPEED_BONUS = 0.1; // 10% faster at max energy
    const MAX_ENERGY = 500;
    const energyRatio = Math.min(energyComp.current / MAX_ENERGY, 1); // 0-1 range, capped at 500
    const energySpeedScale = 1 + energyRatio * MAX_SPEED_BONUS;

    // Check for nearby players
    const nearestPlayer = findNearestPlayer(swarmPosition, world);

    if (nearestPlayer) {
      // CHASE: Player detected within range
      if (swarmComp.state !== 'chase' || swarmComp.targetPlayerId !== nearestPlayer.id) {
        swarmComp.state = 'chase';
        swarmComp.targetPlayerId = nearestPlayer.id;
        swarmComp.patrolTarget = undefined;
      }

      // Calculate direction toward player
      const acceleration = getConfig('SWARM_SPEED') * 8 * energySpeedScale;

      if (sphereMode) {
        // Sphere mode: use tangent direction toward player
        const chaseDir = tangentToward(swarmPosition as Vec3, nearestPlayer.position as Vec3);
        velComp.x += chaseDir.x * acceleration * deltaTime;
        velComp.y += chaseDir.y * acceleration * deltaTime;
        velComp.z = (velComp.z ?? 0) + chaseDir.z * acceleration * deltaTime;
      } else {
        // Flat mode: 2D direction
        const dx = nearestPlayer.position.x - swarmPosition.x;
        const dy = nearestPlayer.position.y - swarmPosition.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          velComp.x += (dx / dist) * acceleration * deltaTime;
          velComp.y += (dy / dist) * acceleration * deltaTime;
        }
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
        const distToTarget = distanceForMode(swarmPosition, swarmComp.patrolTarget);

        if (distToTarget < 50) {
          // Reached target, pick new one
          swarmComp.patrolTarget = generatePatrolTarget(swarmComp.homePosition);
        }

        // Move toward patrol target
        const patrolAcceleration = getConfig('SWARM_SPEED') * 8 * 0.6 * energySpeedScale;

        if (sphereMode) {
          // Sphere mode: use tangent direction toward target
          const patrolTarget3D = { x: swarmComp.patrolTarget.x, y: swarmComp.patrolTarget.y, z: swarmComp.patrolTarget.z ?? 0 };
          const patrolDir = tangentToward(swarmPosition as Vec3, patrolTarget3D);
          velComp.x += patrolDir.x * patrolAcceleration * deltaTime;
          velComp.y += patrolDir.y * patrolAcceleration * deltaTime;
          velComp.z = (velComp.z ?? 0) + patrolDir.z * patrolAcceleration * deltaTime;
        } else {
          // Flat mode: 2D direction
          const dx = swarmComp.patrolTarget.x - swarmPosition.x;
          const dy = swarmComp.patrolTarget.y - swarmPosition.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            velComp.x += (dx / dist) * patrolAcceleration * deltaTime;
            velComp.y += (dy / dist) * patrolAcceleration * deltaTime;
          }
        }
      }
    }

    // Apply obstacle avoidance acceleration (high priority)
    const avoidance = calculateObstacleAvoidance(swarmPosition, world);
    velComp.x += avoidance.x * deltaTime;
    velComp.y += avoidance.y * deltaTime;
    if (sphereMode) velComp.z = (velComp.z ?? 0) + avoidance.z * deltaTime;

    // Apply swarm-swarm repulsion (prevent overlap)
    const repulsion = calculateSwarmRepulsion(swarmId, swarmPosition, world);
    velComp.x += repulsion.x * deltaTime;
    velComp.y += repulsion.y * deltaTime;
    if (sphereMode) velComp.z = (velComp.z ?? 0) + repulsion.z * deltaTime;

    // Clamp to max speed - scales with energy so fat swarms are faster
    const vz = velComp.z ?? 0;
    const velocityMagnitude = sphereMode
      ? Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y + vz * vz)
      : Math.sqrt(velComp.x * velComp.x + velComp.y * velComp.y);
    const maxSpeed = getConfig('SWARM_SPEED') * 1.2 * energySpeedScale;
    if (velocityMagnitude > maxSpeed) {
      const scale = maxSpeed / velocityMagnitude;
      velComp.x *= scale;
      velComp.y *= scale;
      if (sphereMode) velComp.z = vz * scale;
    }
  });
}

/**
 * Update swarm positions based on velocity (called every tick)
 * - Sphere mode: Project to sphere surface, keep velocity tangent
 * - Flat mode: Clamp to soup region bounds
 */
export function updateSwarmPositions(world: World, deltaTime: number, _io: Server) {
  if (isSphereMode()) {
    const sphereRadius = GAME_CONFIG.SPHERE_RADIUS;

    forEachSwarm(world, (_entity, _swarmId, posComp, velComp, _swarmComp, _energyComp) => {
      // Keep velocity tangent to sphere
      const pos = { x: posComp.x, y: posComp.y, z: posComp.z ?? 0 };
      const vel = { x: velComp.x, y: velComp.y, z: velComp.z ?? 0 };
      const tangentVel = makeTangent(pos, vel);
      velComp.x = tangentVel.x;
      velComp.y = tangentVel.y;
      velComp.z = tangentVel.z;

      // Update position
      posComp.x += velComp.x * deltaTime;
      posComp.y += velComp.y * deltaTime;
      posComp.z = (posComp.z ?? 0) + (velComp.z ?? 0) * deltaTime;

      // Project back to sphere surface
      const projected = projectToSphere({ x: posComp.x, y: posComp.y, z: posComp.z ?? 0 }, sphereRadius);
      posComp.x = projected.x;
      posComp.y = projected.y;
      posComp.z = projected.z;
    });
    return;
  }

  // Flat world: clamp to soup region bounds
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT;

  forEachSwarm(world, (_entity, _swarmId, posComp, velComp, _swarmComp, _energyComp) => {
    posComp.x += velComp.x * deltaTime;
    posComp.y += velComp.y * deltaTime;

    const padding = GAME_CONFIG.SWARM_SIZE;
    posComp.x = Math.max(soupMinX + padding, Math.min(soupMaxX - padding, posComp.x));
    posComp.y = Math.max(soupMinY + padding, Math.min(soupMaxY - padding, posComp.y));
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
