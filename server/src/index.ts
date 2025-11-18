import { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Position,
  Nutrient,
  Obstacle,
  PlayerMoveMessage,
  PlayerRespawnRequestMessage,
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
  PlayerEvolvedMessage,
} from '@godcell/shared';
import { initializeBots, updateBots, isBot, handleBotDeath } from './bots';

// ============================================
// Server Configuration
// ============================================

const PORT = 3000;
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
 * Generate a random spawn position in the digital ocean
 */
function randomSpawnPosition(): Position {
  const padding = 100; // Keep cells away from edges

  return {
    x: Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2) + padding,
    y: Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2) + padding,
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
 * Spawn a nutrient at a random location
 * Nutrients near obstacles get 2x value (risk/reward mechanic)
 * Note: "Respawn" creates a NEW nutrient with a new ID, not reusing the old one
 */
function spawnNutrient(): Nutrient {
  const position = randomSpawnPosition();

  // Check if nutrient spawned near any obstacle
  let isHighValue = false;
  for (const obstacle of obstacles.values()) {
    if (distance(position, obstacle.position) < obstacle.radius) {
      isHighValue = true;
      break;
    }
  }

  const nutrient: Nutrient = {
    id: `nutrient-${nutrientIdCounter++}`,
    position,
    value: isHighValue
      ? GAME_CONFIG.NUTRIENT_ENERGY_VALUE * GAME_CONFIG.NUTRIENT_HIGH_VALUE_MULTIPLIER
      : GAME_CONFIG.NUTRIENT_ENERGY_VALUE,
    isHighValue,
  };

  nutrients.set(nutrient.id, nutrient);

  // Broadcast to all clients
  const spawnMessage: NutrientSpawnedMessage = {
    type: 'nutrientSpawned',
    nutrient,
  };
  io.emit('nutrientSpawned', spawnMessage);

  return nutrient;
}

/**
 * Schedule a nutrient to respawn after delay
 */
function respawnNutrient(nutrientId: string) {
  const timer = setTimeout(() => {
    spawnNutrient();
    nutrientRespawnTimers.delete(nutrientId);
  }, GAME_CONFIG.NUTRIENT_RESPAWN_TIME);

  nutrientRespawnTimers.set(nutrientId, timer);
}

/**
 * Initialize nutrients on server start
 */
function initializeNutrients() {
  for (let i = 0; i < GAME_CONFIG.NUTRIENT_COUNT; i++) {
    spawnNutrient();
  }
  console.log(`✨ Spawned ${GAME_CONFIG.NUTRIENT_COUNT} nutrients`);
}

/**
 * Initialize gravity obstacles with procedural generation
 * Ensures obstacles are spaced apart by OBSTACLE_MIN_SEPARATION
 */
function initializeObstacles() {
  const padding = GAME_CONFIG.OBSTACLE_BASE_RADIUS + 100;
  let obstacleIdCounter = 0;

  for (let i = 0; i < GAME_CONFIG.OBSTACLE_COUNT; i++) {
    let position: Position;
    let attempts = 0;
    const maxAttempts = 100;

    // Find a valid position with proper separation
    do {
      position = {
        x: Math.random() * (GAME_CONFIG.WORLD_WIDTH - padding * 2) + padding,
        y: Math.random() * (GAME_CONFIG.WORLD_HEIGHT - padding * 2) + padding,
      };
      attempts++;

      // Check if too close to any existing obstacle
      let tooClose = false;
      for (const existingObstacle of obstacles.values()) {
        const dist = distance(position, existingObstacle.position);
        if (dist < GAME_CONFIG.OBSTACLE_MIN_SEPARATION) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) break;
    } while (attempts < maxAttempts);

    // Create obstacle
    const obstacle: Obstacle = {
      id: `obstacle-${obstacleIdCounter++}`,
      position,
      radius: GAME_CONFIG.OBSTACLE_BASE_RADIUS,
      strength: GAME_CONFIG.OBSTACLE_GRAVITY_STRENGTH,
      damageRate: GAME_CONFIG.OBSTACLE_DAMAGE_RATE,
    };

    obstacles.set(obstacle.id, obstacle);
  }

  console.log(`⚫ Spawned ${obstacles.size} gravity distortions`);
}

/**
 * Get evolution stage stats based on current stage
 */
function getStageStats(stage: EvolutionStage): { maxHealth: number } {
  const baseHealth = GAME_CONFIG.SINGLE_CELL_MAX_HEALTH;

  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return { maxHealth: baseHealth };
    case EvolutionStage.MULTI_CELL:
      return { maxHealth: baseHealth * GAME_CONFIG.MULTI_CELL_HEALTH_MULTIPLIER };
    case EvolutionStage.CYBER_ORGANISM:
      return { maxHealth: baseHealth * GAME_CONFIG.CYBER_ORGANISM_HEALTH_MULTIPLIER };
    case EvolutionStage.HUMANOID:
      return { maxHealth: baseHealth * GAME_CONFIG.HUMANOID_HEALTH_MULTIPLIER };
    case EvolutionStage.GODCELL:
      return { maxHealth: baseHealth * GAME_CONFIG.GODCELL_HEALTH_MULTIPLIER };
  }
}

/**
 * Get next evolution stage and required maxEnergy threshold
 */
function getNextEvolutionStage(currentStage: EvolutionStage): { stage: EvolutionStage; threshold: number } | null {
  switch (currentStage) {
    case EvolutionStage.SINGLE_CELL:
      return { stage: EvolutionStage.MULTI_CELL, threshold: GAME_CONFIG.EVOLUTION_MULTI_CELL };
    case EvolutionStage.MULTI_CELL:
      return { stage: EvolutionStage.CYBER_ORGANISM, threshold: GAME_CONFIG.EVOLUTION_CYBER_ORGANISM };
    case EvolutionStage.CYBER_ORGANISM:
      return { stage: EvolutionStage.HUMANOID, threshold: GAME_CONFIG.EVOLUTION_HUMANOID };
    case EvolutionStage.HUMANOID:
      return { stage: EvolutionStage.GODCELL, threshold: GAME_CONFIG.EVOLUTION_GODCELL };
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

  // Check fuel gate (80% energy required)
  const fuelRequired = player.maxEnergy * GAME_CONFIG.EVOLUTION_FUEL_REQUIREMENT_PERCENT;
  if (player.energy < fuelRequired) return;

  // Both gates met - trigger evolution!
  player.isEvolving = true;

  // Consume energy (40% of maxEnergy)
  const energyCost = player.maxEnergy * GAME_CONFIG.EVOLUTION_ENERGY_COST_PERCENT;
  player.energy -= energyCost;

  // Schedule evolution completion after molting duration
  setTimeout(() => {
    // Check if player still exists (they might have disconnected during molting)
    if (!players.has(player.id)) return;

    player.stage = nextEvolution.stage;
    player.isEvolving = false;

    // Update stats for new stage
    const newStats = getStageStats(player.stage);
    player.maxHealth = newStats.maxHealth;
    player.health = player.maxHealth; // Evolution fully heals

    // Broadcast evolution event
    const evolveMessage: PlayerEvolvedMessage = {
      type: 'playerEvolved',
      playerId: player.id,
      newStage: player.stage,
      newMaxEnergy: player.maxEnergy,
      newMaxHealth: player.maxHealth,
    };
    io.emit('playerEvolved', evolveMessage);

    console.log(`🧬 Player ${player.id} evolved to ${player.stage}`);
  }, GAME_CONFIG.EVOLUTION_MOLTING_DURATION);
}

/**
 * Handle player death - broadcast death event
 * Bots auto-respawn, human players wait for manual respawn
 */
function handlePlayerDeath(player: Player) {
  // Broadcast death event (for dilution effect)
  const deathMessage: PlayerDiedMessage = {
    type: 'playerDied',
    playerId: player.id,
    position: { ...player.position },
    color: player.color,
  };
  io.emit('playerDied', deathMessage);

  // Auto-respawn bots after delay
  if (isBot(player.id)) {
    handleBotDeath(player.id, io, players);
  } else {
    console.log(`💀 Player ${player.id} died (waiting for manual respawn)`);
  }
}

/**
 * Respawn a dead player - reset to single-cell at random location
 */
function respawnPlayer(player: Player) {
  // Reset player to single-cell at random spawn
  player.position = randomSpawnPosition();
  player.health = GAME_CONFIG.SINGLE_CELL_HEALTH;
  player.maxHealth = GAME_CONFIG.SINGLE_CELL_MAX_HEALTH;
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

  console.log(`🔄 Player ${player.id} respawned as single-cell`);
}

/**
 * Update metabolism for all players
 * Handles energy decay, starvation damage, death, and evolution checks
 */
function updateMetabolism(deltaTime: number) {
  for (const [playerId, player] of players) {
    // Skip dead players (waiting for manual respawn)
    if (player.health <= 0) continue;

    // Skip metabolism during evolution molting (invulnerable)
    if (player.isEvolving) continue;

    // Energy decay (passive drain)
    player.energy -= GAME_CONFIG.ENERGY_DECAY_RATE * deltaTime;

    // Starvation damage when energy depleted
    if (player.energy <= 0) {
      player.energy = 0;
      player.health -= GAME_CONFIG.STARVATION_DAMAGE_RATE * deltaTime;
    }

    // Obstacle damage (escalates exponentially near center)
    for (const obstacle of obstacles.values()) {
      const dist = distance(player.position, obstacle.position);
      if (dist < obstacle.radius) {
        // Damage scales with proximity: (1 - dist/radius)²
        // 0% damage at edge, 100% damage at center
        const normalizedDist = dist / obstacle.radius;
        const damageScale = Math.pow(1 - normalizedDist, 2);

        player.health -= obstacle.damageRate * damageScale * deltaTime;
        break; // Only one obstacle damages at a time
      }
    }

    // Death check
    if (player.health <= 0) {
      player.health = 0; // Clamp to prevent negative health
      handlePlayerDeath(player);
      continue; // Skip evolution check after death
    }

    // Evolution check
    checkEvolution(player);
  }
}

// Energy update broadcast counter (reduce network spam)
let energyUpdateTicks = 0;
const ENERGY_UPDATE_INTERVAL = 10; // Broadcast every 10 ticks (~6 times/sec)

/**
 * Broadcast energy/health updates to clients (throttled)
 */
function broadcastEnergyUpdates() {
  energyUpdateTicks++;

  if (energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
    energyUpdateTicks = 0;

    for (const [playerId, player] of players) {
      // Skip dead players (no need to broadcast their energy)
      if (player.health <= 0) continue;

      const updateMessage: EnergyUpdateMessage = {
        type: 'energyUpdate',
        playerId,
        energy: player.energy,
        health: player.health,
      };
      io.emit('energyUpdate', updateMessage);
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
    if (player.health <= 0) continue;

    // Skip if player is evolving (invulnerable during molting)
    if (player.isEvolving) continue;

    for (const [nutrientId, nutrient] of nutrients) {
      const dist = distance(player.position, nutrient.position);
      const collisionRadius = GAME_CONFIG.PLAYER_SIZE + GAME_CONFIG.NUTRIENT_SIZE;

      if (dist < collisionRadius) {
        // Collect nutrient - gain energy (capped at maxEnergy) + capacity increase
        // Safety clamp to prevent negative energy gain if player.energy somehow drifts above maxEnergy
        const energyGain = Math.min(
          nutrient.value,
          Math.max(0, player.maxEnergy - player.energy)
        );
        player.energy += energyGain;
        player.maxEnergy += GAME_CONFIG.NUTRIENT_CAPACITY_INCREASE;

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

console.log(`🎮 Game server running on port ${PORT}`);

// Initialize game world
initializeObstacles();
initializeNutrients();
initializeBots(io, players, playerInputDirections, playerVelocities);

// ============================================
// Connection Handling
// ============================================

io.on('connection', (socket) => {
  console.log(`✅ Player connected: ${socket.id}`);

  // Create a new player
  const newPlayer: Player = {
    id: socket.id,
    position: randomSpawnPosition(),
    color: randomColor(),
    health: GAME_CONFIG.SINGLE_CELL_HEALTH,
    maxHealth: GAME_CONFIG.SINGLE_CELL_MAX_HEALTH,
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
  // Filter out dead players (health <= 0) from initial state
  const alivePlayers = new Map();
  for (const [id, player] of players) {
    if (player.health > 0) {
      alivePlayers.set(id, player);
    }
  }

  const gameState: GameStateMessage = {
    type: 'gameState',
    players: Object.fromEntries(alivePlayers),
    nutrients: Object.fromEntries(nutrients),
    obstacles: Object.fromEntries(obstacles),
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
    if (player.health <= 0) {
      respawnPlayer(player);
    }
  });

  // ============================================
  // Disconnection Handling
  // ============================================

  socket.on('disconnect', () => {
    console.log(`❌ Player disconnected: ${socket.id}`);

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
 * Velocity represents gravity offset in pixels/second
 */
function applyGravityForces() {
  for (const [playerId, player] of players) {
    if (player.health <= 0 || player.isEvolving) continue;

    const velocity = playerVelocities.get(playerId);
    if (!velocity) continue;

    // Reset velocity to zero (will accumulate gravity this frame)
    velocity.x = 0;
    velocity.y = 0;

    for (const obstacle of obstacles.values()) {
      const dist = distance(player.position, obstacle.position);
      if (dist > obstacle.radius) continue; // Outside event horizon

      // Instant death at singularity core
      if (dist < GAME_CONFIG.OBSTACLE_CORE_RADIUS) {
        console.log(`💀 Player ${playerId} crushed by singularity at dist ${dist.toFixed(1)}px`);
        player.health = 0; // Set health to zero
        handlePlayerDeath(player); // Trigger death event and broadcast
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

      // Accumulate gravitational velocity offset (pixels/second)
      velocity.x += dirX * forceMagnitude;
      velocity.y += dirY * forceMagnitude;

      // DEBUG: Log gravity forces
      if (!isBot(playerId)) {
        console.log(`🌀 Player at dist ${dist.toFixed(0)}px: force=${forceMagnitude.toFixed(2)} px/s, vel=(${velocity.x.toFixed(1)}, ${velocity.y.toFixed(1)})`);
      }
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
  const deltaTime = TICK_INTERVAL / 1000; // Convert to seconds

  // Update bot AI decisions (before movement)
  updateBots(Date.now(), nutrients);

  // Apply gravity forces from obstacles (before movement)
  applyGravityForces();

  // Update each player's position
  for (const [playerId, player] of players) {
    // Skip dead players (waiting for manual respawn)
    if (player.health <= 0) continue;

    const inputDirection = playerInputDirections.get(playerId);
    const velocity = playerVelocities.get(playerId);
    if (!inputDirection || !velocity) continue;

    // Calculate desired velocity from player input
    // Normalize diagonal input to maintain consistent speed
    const inputLength = Math.sqrt(inputDirection.x * inputDirection.x + inputDirection.y * inputDirection.y);
    const inputNormX = inputLength > 0 ? inputDirection.x / inputLength : 0;
    const inputNormY = inputLength > 0 ? inputDirection.y / inputLength : 0;

    // Desired velocity from input (pixels/second)
    const desiredVelX = inputNormX * GAME_CONFIG.PLAYER_SPEED;
    const desiredVelY = inputNormY * GAME_CONFIG.PLAYER_SPEED;

    // Actual velocity = desired velocity + gravity offset
    // Gravity forces were added to velocity in applyGravityForces()
    const actualVelX = desiredVelX + velocity.x;
    const actualVelY = desiredVelY + velocity.y;

    // Skip if no movement at all
    if (actualVelX === 0 && actualVelY === 0) continue;

    // Update position (frame-rate independent)
    player.position.x += actualVelX * deltaTime;
    player.position.y += actualVelY * deltaTime;

    // Keep player within world bounds (accounting for cell radius)
    player.position.x = Math.max(
      GAME_CONFIG.PLAYER_SIZE,
      Math.min(GAME_CONFIG.WORLD_WIDTH - GAME_CONFIG.PLAYER_SIZE, player.position.x)
    );
    player.position.y = Math.max(
      GAME_CONFIG.PLAYER_SIZE,
      Math.min(GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.PLAYER_SIZE, player.position.y)
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

  // Broadcast energy/health updates (throttled)
  broadcastEnergyUpdates();
}, TICK_INTERVAL);
