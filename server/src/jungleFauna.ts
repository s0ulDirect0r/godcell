// ============================================
// Jungle Fauna Spawning
// Handles Stage 3+ entity spawning: DataFruits, CyberBugs, JungleCreatures
// ============================================

import { GAME_CONFIG } from '@godcell/shared';
import type { Server } from 'socket.io';
import {
  type World,
  createDataFruitOnGround,
  createCyberBug,
  createJungleCreature,
  forEachTree,
  forEachCyberBug,
  destroyEntity,
  getStringIdByEntity,
} from './ecs';
import { logger } from './logger';
import { poissonDiscSampling } from './helpers';

// ============================================
// ID Counters
// ============================================

let dataFruitIdCounter = 0;
let cyberBugIdCounter = 0;
let jungleCreatureIdCounter = 0;
let cyberBugSwarmIdCounter = 0;

// ============================================
// Respawn Queues
// ============================================

// Track swarms that need respawning (all bugs in swarm killed)
const swarmRespawnQueue: Array<{
  respawnTime: number;
  homePosition: { x: number; y: number };
  swarmSize: number;
}> = [];

// Track individual creatures that need respawning
const creatureRespawnQueue: Array<{
  respawnTime: number;
  variant: 'grazer' | 'stalker' | 'ambusher';
  homePosition: { x: number; y: number };
}> = [];

// Track last fruit spawn time per tree (keyed by tree entity ID)
const treeLastFruitSpawn = new Map<number, number>();

// ============================================
// DataFruit Spawning
// ============================================

/**
 * Spawn initial DataFruits near trees
 * Simple: spawn on ground, ready to collect, despawn after timeout
 */
export function initializeDataFruits(world: World, io: Server): void {
  let fruitCount = 0;
  const now = Date.now();

  forEachTree(world, (treeEntity, _treeId, treePos, treeComp) => {
    // Track spawn time for this tree (stagger initial cooldowns)
    const staggerOffset = Math.random() * GAME_CONFIG.DATAFRUIT_TREE_SPAWN_INTERVAL;
    treeLastFruitSpawn.set(treeEntity, now - staggerOffset);

    // 30% of trees get 1 fruit (70% reduction from original 1-2 per tree)
    if (Math.random() > 0.3) return;
    const numFruits = 1;

    for (let i = 0; i < numFruits; i++) {
      const fruitId = `fruit-${dataFruitIdCounter++}`;

      // Random offset from tree (2.25x tree radius = 50% further than before)
      const offsetAngle = Math.random() * Math.PI * 2;
      const offsetDist = treeComp.radius + Math.random() * treeComp.radius * 1.25;
      const fruitPos = {
        x: treePos.x + Math.cos(offsetAngle) * offsetDist,
        y: treePos.y + Math.sin(offsetAngle) * offsetDist,
      };

      createDataFruitOnGround(world, fruitId, fruitPos);
      fruitCount++;
    }
  });

  logger.info({
    event: 'system_fruits_spawned',
    count: fruitCount,
  });
}

/**
 * Spawn a single fruit near a tree and broadcast to clients
 */
function spawnFruitNearTree(
  world: World,
  io: Server,
  treeEntity: number,
  treePos: { x: number; y: number },
  treeRadius: number
): void {
  const fruitId = `fruit-${dataFruitIdCounter++}`;

  // Random offset from tree
  const offsetAngle = Math.random() * Math.PI * 2;
  const offsetDist = treeRadius + Math.random() * treeRadius * 1.25;
  const fruitPos = {
    x: treePos.x + Math.cos(offsetAngle) * offsetDist,
    y: treePos.y + Math.sin(offsetAngle) * offsetDist,
  };

  createDataFruitOnGround(world, fruitId, fruitPos);

  // Broadcast spawn to clients
  io.emit('dataFruitSpawned', {
    type: 'dataFruitSpawned',
    dataFruit: {
      id: fruitId,
      position: fruitPos,
      treeEntityId: 0,  // Already on ground
      value: GAME_CONFIG.DATAFRUIT_VALUE,
      capacityIncrease: GAME_CONFIG.DATAFRUIT_CAPACITY,
      ripeness: 1.0,
      fallenAt: Date.now(),
    },
  });

  // Update last spawn time for this tree
  treeLastFruitSpawn.set(treeEntity, Date.now());

  logger.debug({
    event: 'fruit_respawn',
    fruitId,
    treeEntity,
    position: fruitPos,
  });
}

/**
 * Process fruit respawns - each tree spawns a fruit after cooldown
 */
export function processDataFruitRespawns(world: World, io: Server): void {
  const now = Date.now();
  const interval = GAME_CONFIG.DATAFRUIT_TREE_SPAWN_INTERVAL;

  forEachTree(world, (treeEntity, _treeId, treePos, treeComp) => {
    const lastSpawn = treeLastFruitSpawn.get(treeEntity) ?? 0;

    if (now - lastSpawn >= interval) {
      spawnFruitNearTree(world, io, treeEntity, treePos, treeComp.radius);
    }
  });
}

// ============================================
// CyberBug Spawning
// ============================================

/**
 * Generate random position in the jungle (avoiding soup region)
 */
function randomJunglePosition(): { x: number; y: number } {
  const padding = 500; // Stay away from edges

  // Soup region to avoid
  const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X - 200;
  const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH + 200;
  const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y - 200;
  const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT + 200;

  let x: number;
  let y: number;
  let attempts = 0;

  do {
    x = padding + Math.random() * (GAME_CONFIG.JUNGLE_WIDTH - 2 * padding);
    y = padding + Math.random() * (GAME_CONFIG.JUNGLE_HEIGHT - 2 * padding);
    attempts++;

    // Check if in soup region
    const inSoup = x > soupMinX && x < soupMaxX && y > soupMinY && y < soupMaxY;
    if (!inSoup) break;
  } while (attempts < 50);

  return { x, y };
}

/**
 * Spawn a swarm of CyberBugs at a position
 */
function spawnCyberBugSwarm(
  world: World,
  io: Server,
  homePosition: { x: number; y: number },
  swarmId: string,
  swarmSize: number
): void {
  for (let i = 0; i < swarmSize; i++) {
    const bugId = `bug-${cyberBugIdCounter++}`;

    // Scatter bugs around home position
    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = Math.random() * 50;
    const bugPos = {
      x: homePosition.x + Math.cos(offsetAngle) * offsetDist,
      y: homePosition.y + Math.sin(offsetAngle) * offsetDist,
    };

    createCyberBug(
      world,
      bugId,
      swarmId,       // swarmId
      bugPos,        // position
      homePosition,  // homePosition
      GAME_CONFIG.CYBERBUG_VALUE,
      GAME_CONFIG.CYBERBUG_CAPACITY
    );
  }
}

/**
 * Initialize all CyberBug swarms in the jungle
 */
export function initializeCyberBugs(world: World, io: Server): void {
  let totalBugs = 0;

  for (let i = 0; i < GAME_CONFIG.CYBERBUG_SWARM_COUNT; i++) {
    const swarmId = `swarm-${cyberBugSwarmIdCounter++}`;
    const homePosition = randomJunglePosition();

    // Random swarm size
    const swarmSize = GAME_CONFIG.CYBERBUG_SWARM_SIZE_MIN +
      Math.floor(Math.random() * (GAME_CONFIG.CYBERBUG_SWARM_SIZE_MAX - GAME_CONFIG.CYBERBUG_SWARM_SIZE_MIN + 1));

    spawnCyberBugSwarm(world, io, homePosition, swarmId, swarmSize);
    totalBugs += swarmSize;
  }

  logger.info({
    event: 'cyber_bugs_spawned',
    swarmCount: GAME_CONFIG.CYBERBUG_SWARM_COUNT,
    totalBugs,
  });
}

/**
 * Check if a swarm is completely dead and schedule respawn
 */
export function scheduleSwarmRespawn(
  world: World,
  swarmId: string,
  homePosition: { x: number; y: number }
): void {
  // Count remaining bugs in this swarm
  let bugsRemaining = 0;
  forEachCyberBug(world, (_entity, _bugId, _pos, bugComp) => {
    if (bugComp.swarmId === swarmId) {
      bugsRemaining++;
    }
  });

  // If no bugs left, schedule respawn
  if (bugsRemaining === 0) {
    const swarmSize = GAME_CONFIG.CYBERBUG_SWARM_SIZE_MIN +
      Math.floor(Math.random() * (GAME_CONFIG.CYBERBUG_SWARM_SIZE_MAX - GAME_CONFIG.CYBERBUG_SWARM_SIZE_MIN + 1));

    swarmRespawnQueue.push({
      respawnTime: Date.now() + GAME_CONFIG.CYBERBUG_SWARM_RESPAWN_DELAY,
      homePosition,
      swarmSize,
    });

    logger.info({
      event: 'swarm_respawn_scheduled',
      swarmId,
      respawnIn: GAME_CONFIG.CYBERBUG_SWARM_RESPAWN_DELAY,
    });
  }
}

/**
 * Process pending swarm respawns
 */
export function processCyberBugRespawns(world: World, io: Server): void {
  const now = Date.now();

  while (swarmRespawnQueue.length > 0 && swarmRespawnQueue[0].respawnTime <= now) {
    const respawn = swarmRespawnQueue.shift()!;
    const swarmId = `swarm-${cyberBugSwarmIdCounter++}`;

    spawnCyberBugSwarm(world, io, respawn.homePosition, swarmId, respawn.swarmSize);

    // Emit spawn event for each bug
    // Note: Client will receive individual bug snapshots via game state

    logger.info({
      event: 'swarm_respawned',
      swarmId,
      size: respawn.swarmSize,
    });
  }
}

// ============================================
// JungleCreature Spawning
// ============================================

/**
 * Initialize all JungleCreatures in the jungle
 */
export function initializeJungleCreatures(world: World, io: Server): void {
  // Distribute creature variants: 50% grazers, 30% stalkers, 20% ambushers
  const creatureCount = GAME_CONFIG.JUNGLE_CREATURE_COUNT;
  const grazerCount = Math.floor(creatureCount * 0.5);
  const stalkerCount = Math.floor(creatureCount * 0.3);
  const ambusherCount = creatureCount - grazerCount - stalkerCount;

  const variants: Array<'grazer' | 'stalker' | 'ambusher'> = [
    ...Array(grazerCount).fill('grazer'),
    ...Array(stalkerCount).fill('stalker'),
    ...Array(ambusherCount).fill('ambusher'),
  ];

  // Shuffle variants for random distribution
  for (let i = variants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [variants[i], variants[j]] = [variants[j], variants[i]];
  }

  // Spawn creatures
  for (const variant of variants) {
    const creatureId = `creature-${jungleCreatureIdCounter++}`;
    const homePosition = randomJunglePosition();

    createJungleCreature(
      world,
      creatureId,
      variant,       // variant
      homePosition,  // position
      homePosition,  // homePosition
      GAME_CONFIG.JUNGLE_CREATURE_VALUE,
      GAME_CONFIG.JUNGLE_CREATURE_CAPACITY
    );
  }

  logger.info({
    event: 'jungle_creatures_spawned',
    count: creatureCount,
    distribution: { grazers: grazerCount, stalkers: stalkerCount, ambushers: ambusherCount },
  });
}

/**
 * Schedule a creature respawn after death
 */
export function scheduleCreatureRespawn(
  homePosition: { x: number; y: number },
  variant: 'grazer' | 'stalker' | 'ambusher'
): void {
  creatureRespawnQueue.push({
    respawnTime: Date.now() + GAME_CONFIG.JUNGLE_CREATURE_RESPAWN_DELAY,
    variant,
    homePosition,
  });

  logger.info({
    event: 'creature_respawn_scheduled',
    variant,
    respawnIn: GAME_CONFIG.JUNGLE_CREATURE_RESPAWN_DELAY,
  });
}

/**
 * Process pending creature respawns
 */
export function processCreatureRespawns(world: World, io: Server): void {
  const now = Date.now();

  while (creatureRespawnQueue.length > 0 && creatureRespawnQueue[0].respawnTime <= now) {
    const respawn = creatureRespawnQueue.shift()!;
    const creatureId = `creature-${jungleCreatureIdCounter++}`;

    createJungleCreature(
      world,
      creatureId,
      respawn.variant,       // variant
      respawn.homePosition,  // position
      respawn.homePosition,  // homePosition
      GAME_CONFIG.JUNGLE_CREATURE_VALUE,
      GAME_CONFIG.JUNGLE_CREATURE_CAPACITY
    );

    logger.info({
      event: 'creature_respawned',
      creatureId,
      variant: respawn.variant,
    });
  }
}

// ============================================
// Combined Respawn Processing
// ============================================

/**
 * Process all jungle fauna respawns (call every tick)
 */
export function processJungleFaunaRespawns(world: World, io: Server): void {
  processDataFruitRespawns(world, io);
  processCyberBugRespawns(world, io);
  processCreatureRespawns(world, io);
}

/**
 * Initialize all jungle fauna at server start
 */
export function initializeJungleFauna(world: World, io: Server): void {
  initializeDataFruits(world, io);
  initializeCyberBugs(world, io);
  initializeJungleCreatures(world, io);

  logger.info({
    event: 'jungle_fauna_initialized',
  });
}
