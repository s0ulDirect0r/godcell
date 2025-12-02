// ============================================
// Jungle Fauna Spawning
// Handles Stage 3+ entity spawning: DataFruits, CyberBugs, JungleCreatures
// ============================================

import { GAME_CONFIG } from '@godcell/shared';
import type { Server } from 'socket.io';
import {
  type World,
  createDataFruit,
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

// ============================================
// DataFruit Spawning
// ============================================

/**
 * Spawn initial DataFruits on all trees
 * Each tree gets 1-2 fruits at varying ripeness
 */
export function initializeDataFruits(world: World, io: Server): void {
  let fruitCount = 0;

  forEachTree(world, (treeEntity, _treeId, treePos, treeComp) => {
    // Each tree gets 1-2 fruits
    const numFruits = 1 + Math.floor(Math.random() * 2);

    for (let i = 0; i < numFruits; i++) {
      const fruitId = `fruit-${dataFruitIdCounter++}`;

      // Random offset from tree center
      const offsetAngle = Math.random() * Math.PI * 2;
      const offsetDist = Math.random() * GAME_CONFIG.DATAFRUIT_SPAWN_OFFSET;
      const fruitPos = {
        x: treePos.x + Math.cos(offsetAngle) * offsetDist,
        y: treePos.y + Math.sin(offsetAngle) * offsetDist,
      };

      // Spawn fully ripe (ripening disabled for now)
      const ripeness = 1.0;

      createDataFruit(
        world,
        fruitId,
        treeEntity, // treeEntityId
        fruitPos,   // position
        GAME_CONFIG.DATAFRUIT_VALUE,
        GAME_CONFIG.DATAFRUIT_CAPACITY,
        ripeness
      );

      fruitCount++;
    }
  });

  logger.info({
    event: 'data_fruits_spawned',
    count: fruitCount,
  });
}

/**
 * Spawn a single fruit on a specific tree
 * Used for respawning after collection
 */
export function spawnFruitOnTree(
  world: World,
  io: Server,
  treeEntity: number,
  treePos: { x: number; y: number }
): void {
  const fruitId = `fruit-${dataFruitIdCounter++}`;

  // Random offset from tree center
  const offsetAngle = Math.random() * Math.PI * 2;
  const offsetDist = Math.random() * GAME_CONFIG.DATAFRUIT_SPAWN_OFFSET;
  const fruitPos = {
    x: treePos.x + Math.cos(offsetAngle) * offsetDist,
    y: treePos.y + Math.sin(offsetAngle) * offsetDist,
  };

  createDataFruit(
    world,
    fruitId,
    treeEntity, // treeEntityId
    fruitPos,   // position
    GAME_CONFIG.DATAFRUIT_VALUE,
    GAME_CONFIG.DATAFRUIT_CAPACITY,
    0 // Start unripe
  );

  io.emit('dataFruitSpawned', {
    type: 'dataFruitSpawned',
    fruitId,
    position: fruitPos,
    treeEntityId: treeEntity,
    ripeness: 0,
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
