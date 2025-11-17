import { Server } from 'socket.io';
import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import type {
  Player,
  Position,
  Nutrient,
  PlayerMoveMessage,
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
  PlayerRespawnedMessage,
  PlayerEvolvedMessage,
} from '@godcell/shared';

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

// Player velocities (for server-side movement simulation)
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
 */
function spawnNutrient(): Nutrient {
  const nutrient: Nutrient = {
    id: `nutrient-${nutrientIdCounter++}`,
    position: randomSpawnPosition(),
    value: GAME_CONFIG.NUTRIENT_ENERGY_VALUE,
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
 * Handle player death - respawn at random location with reset stats
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

  // Reset player to single-cell at random spawn
  player.position = randomSpawnPosition();
  player.health = GAME_CONFIG.SINGLE_CELL_HEALTH;
  player.maxHealth = GAME_CONFIG.SINGLE_CELL_MAX_HEALTH;
  player.energy = GAME_CONFIG.SINGLE_CELL_ENERGY;
  player.maxEnergy = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
  player.stage = EvolutionStage.SINGLE_CELL;
  player.isEvolving = false;

  // Broadcast respawn event
  const respawnMessage: PlayerRespawnedMessage = {
    type: 'playerRespawned',
    player: { ...player },
  };
  io.emit('playerRespawned', respawnMessage);

  console.log(`💀 Player ${player.id} died and respawned (PERMANENT LOSS)`);
}

/**
 * Update metabolism for all players
 * Handles energy decay, starvation damage, death, and evolution checks
 */
function updateMetabolism(deltaTime: number) {
  for (const [playerId, player] of players) {
    // Skip metabolism during evolution molting (invulnerable)
    if (player.isEvolving) continue;

    // Energy decay (passive drain)
    player.energy -= GAME_CONFIG.ENERGY_DECAY_RATE * deltaTime;

    // Starvation damage when energy depleted
    if (player.energy <= 0) {
      player.energy = 0;
      player.health -= GAME_CONFIG.STARVATION_DAMAGE_RATE * deltaTime;
    }

    // Death check
    if (player.health <= 0) {
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
    // Skip if player is evolving (invulnerable during molting)
    if (player.isEvolving) continue;

    for (const [nutrientId, nutrient] of nutrients) {
      const dist = distance(player.position, nutrient.position);
      const collisionRadius = GAME_CONFIG.PLAYER_SIZE + GAME_CONFIG.NUTRIENT_SIZE;

      if (dist < collisionRadius) {
        // Collect nutrient - gain energy (capped at maxEnergy) + capacity increase
        const energyGain = Math.min(
          nutrient.value,
          player.maxEnergy - player.energy
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
initializeNutrients();

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
  playerVelocities.set(socket.id, { x: 0, y: 0 });

  // Send current game state to the new player
  const gameState: GameStateMessage = {
    type: 'gameState',
    players: Object.fromEntries(players),
    nutrients: Object.fromEntries(nutrients),
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
    const velocity = playerVelocities.get(socket.id);
    if (!velocity) return;

    // Update player's velocity based on input
    // Direction values are -1, 0, or 1
    velocity.x = message.direction.x;
    velocity.y = message.direction.y;
  });

  // ============================================
  // Disconnection Handling
  // ============================================

  socket.on('disconnect', () => {
    console.log(`❌ Player disconnected: ${socket.id}`);

    // Remove from game state
    players.delete(socket.id);
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
// Game Loop (Server Tick)
// ============================================

/**
 * Main game loop - runs 60 times per second
 * Updates player positions based on their velocities
 */
setInterval(() => {
  const deltaTime = TICK_INTERVAL / 1000; // Convert to seconds

  // Update each player's position
  for (const [playerId, player] of players) {
    const velocity = playerVelocities.get(playerId);
    if (!velocity) continue;

    // Skip if player isn't moving
    if (velocity.x === 0 && velocity.y === 0) continue;

    // Normalize diagonal movement (same as Bevy version)
    const length = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
    const normalizedX = length > 0 ? velocity.x / length : 0;
    const normalizedY = length > 0 ? velocity.y / length : 0;

    // Update position (frame-rate independent)
    player.position.x += normalizedX * GAME_CONFIG.PLAYER_SPEED * deltaTime;
    player.position.y += normalizedY * GAME_CONFIG.PLAYER_SPEED * deltaTime;

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

  // Broadcast energy/health updates (throttled)
  broadcastEnergyUpdates();
}, TICK_INTERVAL);
