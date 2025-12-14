# Energy-Only System Specification

**Version:** 1.1
**Date:** 2025-11-24
**Status:** Design / Pre-Implementation

### Changelog

- **v1.1 (2025-11-24):** Updated to reflect drain aura system, continuous predation drain, pseudopod beam damage, gravity damage clarification

---

## Executive Summary

Refactor GODCELL from a dual-resource system (health + energy) to a unified **energy-only** system. All entities (players, swarms) use energy as their sole life resource. All threats drain energy directly. Death occurs instantly at 0 energy.

**Thematic Rationale:** These are information entities, not biological organisms. Energy represents **information coherence**. All threats destabilize coherence (drain energy). Running out of energy = dilution/death.

---

## Design Principles

1. **One Resource:** Energy is everything - fuel, life, survival
2. **Instant Death:** 0 energy = immediate dilution (no warning phase)
3. **Unified Threat Model:** All damage drains energy (swarms, gravity, starvation, predation, EMP)
4. **Evolution = Resilience:** Higher stages have:
   - Bigger energy pools
   - Damage resistance (structural stability)
   - Better metabolic efficiency (already implemented)
5. **Visual Feedback Only:** No health bars, only sprite glow/pulse/particle effects

---

## Current System (To Be Replaced)

### Player Resources

- **Health:** 100-500 (stage-dependent)
- **Energy:** 100-2000 (stage-dependent)
- **Death:** Health ≤ 0

### Damage Sources

- **Swarms:** 60 health damage/s (contact)
- **Gravity:** Physics force only (damage tracking disabled in commit 9a43c14)
- **Starvation:** 5 health damage/s (when energy = 0)
- **Predation:** 150 health damage/s (multi-cell contact drain)
- **Pseudopod Beams:** 100 health damage/s (projectile hits)
- **Singularity:** Instant health = 0

### Swarms

- Have `energy?: number` field (set when disabled by EMP)
- Position/velocity/state tracking
- `disabledUntil` timestamp for EMP paralysis

### Drain Aura System (Existing)

The codebase has a sophisticated damage visualization system:

- Server tracks `activeDamageThisTick` per entity
- `recordDamage(entityId, damageRate, source, proximityFactor?)` aggregates damage
- Broadcasts `PlayerDrainStateMessage` with `damageInfo: { totalDamageRate, primarySource, proximityFactor }`
- Client renders dual-sphere red auras with intensity mapped to DPS (0-150+ scale)
- Damage sources tracked: `'predation'`, `'swarm'`, `'beam'`, `'starvation'`

---

## New System (Energy-Only)

### Player Resources

**Single Resource: Energy**

- Stage 1: 200 energy (combines old 100 health + 100 energy)
- Stage 2: 400 energy (combines old 150 health + 250 energy)
- Stage 3: 1000 energy (combines old 200 health + 800 energy)
- Stage 4: 2000 energy (combines old 300 health + 1700 energy)
- Stage 5: 3000+ energy (TBD)

**Death Condition:**

- `player.energy <= 0` → instant dilution

### Damage Sources (All Drain Energy)

#### 1. Swarms

- **Contact damage:** 60 energy/s (unchanged rate, but drains energy not health)
- **Slow effect:** 0.6 speed multiplier (unchanged)

#### 2. Gravity Wells

- **Physics force:** Pulls entities toward center (unchanged)
- **Proximity drain:** DISABLED (was 10/s scaled by distance²) - decision: keep disabled for now
- **Event horizon:** 180px radius, inescapable pull
- **Singularity core:** 60px radius, instant energy = 0 (instant death)

> **Design note:** Gravity wells are physics obstacles, not damage sources. The threat is being pulled into the singularity, not gradual health drain. This makes them feel more like black holes.

#### 3. Starvation (Passive Decay)

- **Passive decay:** Stage-dependent rates (unchanged)
  - Stage 1: 2.66 energy/s
  - Stage 2: 2.1 energy/s
  - Stage 3: 2.8 energy/s
  - Stage 4: 3.3 energy/s
  - Stage 5: 0 energy/s
- **No separate starvation damage phase** - you just run out of energy and die

#### 4. Predation (Continuous Drain)

- **Contact drain:** 150 energy/s (multi-cell touching single-cell)
- **Energy gain for predator:** Transferred from prey as they drain
- **Death:** Prey dies when energy reaches 0 (not instant)

> **Design note:** Changed from instant-death to continuous drain. This gives prey a brief window to escape and makes predation feel more like "absorption" than deletion.

#### 5. Pseudopod Beams (NEW)

- **Projectile damage:** 100 energy/s on hit
- **Projectile speed:** 3600 px/s
- **Collision width:** 20px
- **Fired by:** Stage 2+ multi-cells

#### 6. EMP (Updated)

- **Multi-cells:** 1-2s stun + 80 energy drain
- **Single-cells:** 3s stun + 40 energy drain (NEW)
- **Swarms:** 3s paralyze (unchanged)

### Damage Resistance (NEW)

Higher evolution stages have **structural stability** - they resist energy drain from external threats (not passive decay).

**Resistance Formula:**

```
actualDamage = baseDamage * (1 - damageResistance)
```

**Resistance Values:**

- Stage 1: 0% resistance (full damage)
- Stage 2: 25% resistance (takes 75% damage)
- Stage 3: 40% resistance (takes 60% damage)
- Stage 4: 50% resistance (takes 50% damage)
- Stage 5: 60% resistance (takes 40% damage)

**Applies To:**

- Swarm contact damage
- Gravity well damage
- EMP energy drain (from other players)

**Does NOT Apply To:**

- Passive energy decay (metabolism)
- Singularity instant-death
- Predation instant-death

**Example:**

- Stage 1 player hit by swarm: 60 energy/s × (1 - 0) = **60 energy/s**
- Stage 2 player hit by swarm: 60 energy/s × (1 - 0.25) = **45 energy/s**
- Stage 3 player hit by swarm: 60 energy/s × (1 - 0.40) = **36 energy/s**

---

## Swarm Energy Pools (Existing - Minor Update)

Swarms already have an `energy` field. This refactor makes it consistent.

**Properties:**

- **Initial energy:** 100 (set when disabled by EMP)
- **Consumption:** Players drain 50 energy/s during contact with disabled swarm
- **Death:** Swarm energy ≤ 0 → swarm destroyed (dilution effect)

**EMP Interaction:**

- EMP disables swarm → sets `swarm.energy = 100` + `swarm.disabledUntil = now + 3000ms`
- Player makes contact during disabled window → drains swarm energy
- Swarm reaches 0 energy → consumed (player gains 150 energy + 50 maxEnergy)

**Implementation Note:**

- `EntropySwarm.energy` field already exists
- Just ensure it's consistently used (not `currentHealth` anywhere)

---

## Configuration Changes

### GAME_CONFIG Updates (shared/index.ts)

**Remove:**

```typescript
// Health constants (DELETE)
SINGLE_CELL_HEALTH: 100,
SINGLE_CELL_MAX_HEALTH: 100,
MULTI_CELL_HEALTH_MULTIPLIER: 1.5,
CYBER_ORGANISM_HEALTH_MULTIPLIER: 2,
HUMANOID_HEALTH_MULTIPLIER: 3,
GODCELL_HEALTH_MULTIPLIER: 5,

// Starvation damage (DELETE - no longer needed)
STARVATION_DAMAGE_RATE: 5,
```

**Modify:**

```typescript
// Energy pools (UPDATED - combine health + energy)
SINGLE_CELL_ENERGY: 200,           // Was 100, now 200 (100 health + 100 energy)
SINGLE_CELL_MAX_ENERGY: 200,       // Was 100, now 200

// Stage-specific energy pools (NEW)
MULTI_CELL_ENERGY: 400,            // 150 health + 250 energy
MULTI_CELL_MAX_ENERGY: 400,
CYBER_ORGANISM_ENERGY: 1000,       // 200 health + 800 energy
CYBER_ORGANISM_MAX_ENERGY: 1000,
HUMANOID_ENERGY: 2000,             // 300 health + 1700 energy
HUMANOID_MAX_ENERGY: 2000,
GODCELL_ENERGY: 3000,              // TBD
GODCELL_MAX_ENERGY: 3000,          // TBD
```

**Add:**

```typescript
// Damage resistance (NEW - structural stability at higher stages)
SINGLE_CELL_DAMAGE_RESISTANCE: 0,      // 0% (takes full damage)
MULTI_CELL_DAMAGE_RESISTANCE: 0.25,    // 25% (takes 75% damage)
CYBER_ORGANISM_DAMAGE_RESISTANCE: 0.40, // 40% (takes 60% damage)
HUMANOID_DAMAGE_RESISTANCE: 0.50,       // 50% (takes 50% damage)
GODCELL_DAMAGE_RESISTANCE: 0.60,        // 60% (takes 40% damage)

// EMP single-cell drain (NEW)
EMP_SINGLE_CELL_ENERGY_DRAIN: 40,      // Energy drained from hit single-cells (50% of multi-cell drain)

// Swarm energy (already exists)
SWARM_ENERGY: 100,                      // Swarm energy pool (set when disabled by EMP)

// Predation drain rate (NEW - makes predation continuous)
PREDATION_DRAIN_RATE: 150,              // Energy drained per second during predation contact

// Pseudopod beam damage (already exists)
PSEUDOPOD_DAMAGE_RATE: 100,             // Energy drained per second on beam hit
```

**Rename:**

```typescript
// Damage rates (SEMANTIC CHANGE - now drain energy, not health)
SWARM_DAMAGE_RATE: 60,            // Energy drain per second on contact (was health damage)
OBSTACLE_DAMAGE_RATE: 10,         // Energy drain per second at center (was health damage)
```

### Evolution Thresholds (Unchanged)

Evolution still gates on maxEnergy:

- Stage 1→2: 300 maxEnergy
- Stage 2→3: 800 maxEnergy
- Stage 3→4: 1000 maxEnergy
- Stage 4→5: 2000 maxEnergy

---

## Drain Aura Integration (Leverage Existing System)

The codebase already has a drain aura visualization system. In the energy-only world, "damage" = "energy drain", so this system works naturally.

### Server-Side Changes

**Update `recordDamage()` to apply resistance:**

```typescript
function recordDamage(
  entityId: string,
  baseDamageRate: number,
  source: DamageSource,
  proximityFactor?: number
): void {
  const player = players.get(entityId);
  if (!player) return;

  // Apply damage resistance (NEW)
  const resistance = getDamageResistance(player.stage);
  const actualDamageRate = baseDamageRate * (1 - resistance);

  // Track for aura visualization (uses actual rate after resistance)
  const current = activeDamageThisTick.get(entityId) || {
    totalDamageRate: 0,
    sources: new Map(),
  };
  current.totalDamageRate += actualDamageRate;
  current.sources.set(source, (current.sources.get(source) || 0) + actualDamageRate);
  activeDamageThisTick.set(entityId, current);
}
```

**Damage sources remain the same:**

- `'predation'` - multi-cell contact drain (150 → ~112 after Stage 2 resistance)
- `'swarm'` - entropy swarm contact (60 → ~45 after Stage 2 resistance)
- `'beam'` - pseudopod projectile hits (100 → ~75 after Stage 2 resistance)
- `'starvation'` - passive decay (NO resistance applied)

### Client-Side Changes

**Aura intensity calculation (unchanged):**

```typescript
function calculateAuraIntensity(totalDamageRate: number): number {
  // Maps DPS to 0-1 intensity
  // 0-30 DPS: 0.0-0.3
  // 30-80 DPS: 0.3-0.6
  // 80-150 DPS: 0.6-0.9
  // 150+ DPS: 0.9-1.0
  // ...existing calculation
}
```

**Semantic change only:**

- "Damage aura" now means "energy drain aura"
- Visual feedback shows energy being drained, not health
- No code changes needed on client (just interpretation)

### Visual Feedback Enhancement (Optional)

Consider adding energy-specific visuals:

- **Low energy warning:** Sprite dims/flickers when below 25%
- **Critical energy:** Pulsing red outline when below 10%
- **Drain direction:** Particle trails flowing toward attacker/obstacle

---

## Type Changes

### shared/index.ts

**Player Interface:**

```typescript
export interface Player {
  id: string;
  position: Position;
  color: string;

  // REMOVE health fields
  // health: number;        // DELETE
  // maxHealth: number;     // DELETE

  // Energy (UNCHANGED - still the core resource)
  energy: number;
  maxEnergy: number;

  // Evolution (UNCHANGED)
  stage: EvolutionStage;
  isEvolving: boolean;

  // EMP Ability (UNCHANGED)
  lastEMPTime?: number;
  stunnedUntil?: number;
}
```

**EntropySwarm Interface:**

```typescript
export interface EntropySwarm {
  id: string;
  position: Position;
  velocity: { x: number; y: number };
  size: number;
  state: 'patrol' | 'chase';
  targetPlayerId?: string;
  patrolTarget?: Position;
  disabledUntil?: number;

  // RENAME from currentHealth to energy
  energy?: number; // Energy pool (set to SWARM_ENERGY when disabled by EMP)
}
```

**EnergyUpdateMessage:**

```typescript
export interface EnergyUpdateMessage {
  type: 'energyUpdate';
  playerId: string;
  energy: number;
  // REMOVE health field
  // health: number;  // DELETE
}
```

---

## Implementation Changes

### Server Changes (server/src/index.ts)

#### 1. Player Initialization (createPlayer function)

```typescript
function createPlayer(id: string, position: Position): Player {
  return {
    id,
    position,
    color: randomColor(),

    // REMOVE health initialization
    // health: GAME_CONFIG.SINGLE_CELL_HEALTH,       // DELETE
    // maxHealth: GAME_CONFIG.SINGLE_CELL_MAX_HEALTH, // DELETE

    // Energy initialization (UPDATED)
    energy: GAME_CONFIG.SINGLE_CELL_ENERGY, // Now 200
    maxEnergy: GAME_CONFIG.SINGLE_CELL_MAX_ENERGY, // Now 200

    stage: EvolutionStage.SINGLE_CELL,
    isEvolving: false,
  };
}
```

#### 2. Damage Resistance Helper (NEW)

```typescript
/**
 * Get damage resistance for a given evolution stage
 * Higher stages have more stable information structures
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
    default:
      return 0;
  }
}

/**
 * Apply damage to player with resistance factored in
 * Returns actual damage dealt
 */
function applyDamage(player: Player, baseDamage: number): number {
  const resistance = getDamageResistance(player.stage);
  const actualDamage = baseDamage * (1 - resistance);
  player.energy -= actualDamage;
  return actualDamage;
}
```

#### 3. Update Metabolism (updateMetabolism function)

```typescript
function updateMetabolism(deltaTime: number) {
  for (const [playerId, player] of players) {
    // Skip dead players (energy <= 0)
    if (player.energy <= 0) continue;

    // Skip during evolution molting
    if (player.isEvolving) continue;

    // Passive energy decay (no resistance - this is metabolism)
    const decayRate = getEnergyDecayRate(player.stage);
    player.energy -= decayRate * deltaTime;

    // REMOVE starvation damage logic - death happens at 0 energy
    // if (player.energy <= 0) {
    //   player.energy = 0;
    //   const damage = GAME_CONFIG.STARVATION_DAMAGE_RATE * deltaTime;
    //   player.health -= damage;
    //   playerLastDamageSource.set(playerId, 'starvation');
    // }

    // If energy hit 0, mark as starved
    if (player.energy <= 0) {
      player.energy = 0;
      playerLastDamageSource.set(playerId, 'starvation');
    }

    // NOTE: Gravity well proximity damage is DISABLED
    // Gravity wells only apply physics forces + singularity instant death
    // See applyGravityForces() for singularity handling

    // Check for evolution (only if still alive)
    if (player.energy > 0) {
      checkEvolution(player);
    }
  }
}
```

#### 4. Update Death Check (checkPlayerDeaths function)

```typescript
function checkPlayerDeaths() {
  for (const [playerId, player] of players) {
    // Death condition: energy <= 0 AND we have a damage source
    if (player.energy <= 0 && playerLastDamageSource.has(playerId)) {
      const cause = playerLastDamageSource.get(playerId)!;

      player.energy = 0; // Clamp
      handlePlayerDeath(player, cause);

      playerLastDamageSource.delete(playerId);
    }
  }
}
```

#### 5. Update Gravity Physics (applyGravityForces function)

Gravity wells are physics-only obstacles. No proximity energy drain - just pull forces and singularity instant death.

```typescript
function applyGravityForces(deltaTime: number) {
  for (const [playerId, player] of players) {
    if (player.energy <= 0 || player.isEvolving) continue; // Check energy, not health

    const velocity = playerVelocities.get(playerId);
    if (!velocity) continue;

    // ... friction code unchanged ...

    for (const obstacle of obstacles.values()) {
      const dist = distance(player.position, obstacle.position);
      if (dist > obstacle.radius) continue;

      // Singularity core = instant death (60px radius)
      if (dist < GAME_CONFIG.OBSTACLE_CORE_RADIUS) {
        logSingularityCrush(playerId, dist);
        player.energy = 0; // Instant energy depletion
        playerLastDamageSource.set(playerId, 'singularity');
        continue;
      }

      // Event horizon (180px) - inescapable pull but no damage
      // Just apply gravity force, no energy drain
      // ... gravity force calculation unchanged ...
    }
  }
}
```

> **Design note:** Gravity wells don't drain energy. They're physics traps - the threat is being pulled into the singularity, not gradual energy loss. This keeps them feeling like black holes.

#### 6. Update Predation (Continuous Drain Model)

Predation is now continuous drain (150 energy/s), not instant death. The existing `handlePredation()` function already works this way - just change health → energy.

```typescript
function handlePredation(predatorId: string, preyId: string, deltaTime: number) {
  const predator = players.get(predatorId);
  const prey = players.get(preyId);

  if (!predator || !prey) return;
  if (prey.energy <= 0) return; // Already dead

  // Continuous drain (no resistance - predation bypasses it)
  const drainRate = GAME_CONFIG.PREDATION_DRAIN_RATE; // 150 energy/s
  const drainAmount = drainRate * deltaTime;

  // Drain prey, feed predator
  const actualDrain = Math.min(prey.energy, drainAmount);
  prey.energy -= actualDrain;
  predator.energy = Math.min(predator.maxEnergy, predator.energy + actualDrain);

  // Track for death cause and drain aura
  playerLastDamageSource.set(preyId, 'predation');
  recordDamage(preyId, drainRate, 'predation');

  // Prey dies when energy reaches 0
  if (prey.energy <= 0) {
    prey.energy = 0;
    // Death handled by checkPlayerDeaths()
  }
}
```

> **Note:** Predation drain does NOT apply damage resistance. Being engulfed is inescapable - the only defense is to not get caught.

#### 7. Update EMP Handler (socket.on('empActivate'))

```typescript
socket.on('empActivate', (message: EMPActivateMessage) => {
  const player = players.get(socket.id);
  if (!player) return;

  // Validations
  if (player.stage === EvolutionStage.SINGLE_CELL) return;
  if (player.energy <= 0) return; // CHANGED from player.health <= 0
  if (player.isEvolving) return;
  if (player.stunnedUntil && Date.now() < player.stunnedUntil) return;
  if (player.energy < GAME_CONFIG.EMP_ENERGY_COST) return;

  // ... cooldown check unchanged ...

  // Apply energy cost
  player.energy -= GAME_CONFIG.EMP_ENERGY_COST;

  // Find affected entities
  const affectedSwarmIds: string[] = [];
  const affectedPlayerIds: string[] = [];

  // Check swarms (UPDATED - set energy instead of currentHealth)
  for (const [swarmId, swarm] of getSwarms()) {
    const dist = distance(player.position, swarm.position);
    if (dist <= GAME_CONFIG.EMP_RANGE) {
      swarm.disabledUntil = now + GAME_CONFIG.EMP_DISABLE_DURATION;
      swarm.energy = GAME_CONFIG.SWARM_ENERGY; // CHANGED from swarm.currentHealth
      affectedSwarmIds.push(swarmId);
    }
  }

  // Check other players (UPDATED - drain single-cells too)
  for (const [playerId, otherPlayer] of players) {
    if (playerId === socket.id) continue;
    if (otherPlayer.energy <= 0) continue; // CHANGED from health check

    const dist = distance(player.position, otherPlayer.position);
    if (dist <= GAME_CONFIG.EMP_RANGE) {
      // Stun duration based on stage
      if (otherPlayer.stage === EvolutionStage.SINGLE_CELL) {
        otherPlayer.stunnedUntil = now + GAME_CONFIG.EMP_DISABLE_DURATION; // 3s
        // Drain energy from single-cells (NEW)
        const baseDrain = GAME_CONFIG.EMP_SINGLE_CELL_ENERGY_DRAIN;
        applyDamage(otherPlayer, baseDrain); // Apply with resistance
      } else {
        // Multi-cells: shorter stun + energy drain
        otherPlayer.stunnedUntil = now + 1500; // 1.5s stun (NEW - was 3s)
        const baseDrain = GAME_CONFIG.EMP_MULTI_CELL_ENERGY_DRAIN;
        applyDamage(otherPlayer, baseDrain); // Apply with resistance
      }

      affectedPlayerIds.push(playerId);
    }
  }

  // ... broadcast unchanged ...
});
```

#### 8. Update Respawn (respawnPlayer function)

```typescript
function respawnPlayer(player: Player) {
  player.position = randomSpawnPosition();
  player.stage = EvolutionStage.SINGLE_CELL;
  player.isEvolving = false;

  // Reset energy (CHANGED from health)
  player.energy = GAME_CONFIG.SINGLE_CELL_ENERGY; // Now 200
  player.maxEnergy = GAME_CONFIG.SINGLE_CELL_MAX_ENERGY; // Now 200

  // ... rest unchanged ...
}
```

#### 9. Update Evolution (handleEvolutionComplete function)

```typescript
function handleEvolutionComplete(player: Player, targetStage: EvolutionStage) {
  player.stage = targetStage;
  player.isEvolving = false;

  // Get new energy pools (UPDATED)
  const newMaxEnergy = getStageMaxEnergy(targetStage);
  const newEnergy = getStageEnergy(targetStage);

  // Evolution fully restores energy
  player.maxEnergy = Math.max(player.maxEnergy, newMaxEnergy);
  player.energy = player.maxEnergy; // Full restore (CHANGED from player.health = player.maxHealth)

  // ... broadcast unchanged ...
}

// NEW helper functions
function getStageEnergy(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return GAME_CONFIG.SINGLE_CELL_ENERGY;
    case EvolutionStage.MULTI_CELL:
      return GAME_CONFIG.MULTI_CELL_ENERGY;
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.CYBER_ORGANISM_ENERGY;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.HUMANOID_ENERGY;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.GODCELL_ENERGY;
  }
}

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
```

#### 10. Update Energy Broadcasts (broadcastEnergyUpdates function)

```typescript
function broadcastEnergyUpdates() {
  energyUpdateTicks++;

  if (energyUpdateTicks >= ENERGY_UPDATE_INTERVAL) {
    energyUpdateTicks = 0;

    for (const [playerId, player] of players) {
      if (player.energy <= 0) continue; // CHANGED from health check

      const updateMessage: EnergyUpdateMessage = {
        type: 'energyUpdate',
        playerId,
        energy: player.energy,
        // REMOVE health field
      };
      io.emit('energyUpdate', updateMessage);
    }
  }
}
```

#### 11. Update All Health Checks

Replace all instances of:

- `player.health <= 0` → `player.energy <= 0`
- `player.health > 0` → `player.energy > 0`
- `player.health = 0` → `player.energy = 0`
- `swarm.currentHealth` → `swarm.energy`

### Swarm Changes (server/src/swarms.ts)

#### 1. Update Swarm Collision Damage

```typescript
function checkSwarmCollisions(players: Map<string, Player>, deltaTime: number): void {
  for (const swarm of swarms.values()) {
    // ... existing logic ...

    for (const [playerId, player] of players) {
      if (player.energy <= 0 || player.isEvolving) continue; // CHANGED from health check

      const dist = distance(swarm.position, player.position);
      const collisionDist = swarm.size + getPlayerRadius(player.stage);

      if (dist < collisionDist) {
        // Apply damage with resistance
        const baseDamage = GAME_CONFIG.SWARM_DAMAGE_RATE * deltaTime;
        applyDamage(player, baseDamage); // NEW - use resistance helper

        playerLastDamageSource.set(playerId, 'swarm');
      }
    }
  }
}
```

#### 2. Update Swarm Consumption (NEW function to add)

```typescript
/**
 * Handle swarm consumption by multi-cells
 * Called when player contacts a disabled swarm
 */
export function consumeSwarm(
  swarmId: string,
  consumerId: string,
  players: Map<string, Player>,
  deltaTime: number
): boolean {
  const swarm = swarms.get(swarmId);
  const consumer = players.get(consumerId);

  if (!swarm || !consumer) return false;
  if (!swarm.energy) return false; // Not disabled
  if (swarm.disabledUntil && Date.now() > swarm.disabledUntil) return false; // No longer disabled

  // Drain swarm energy
  swarm.energy -= GAME_CONFIG.SWARM_CONSUMPTION_RATE * deltaTime;

  // Swarm fully consumed
  if (swarm.energy <= 0) {
    // Reward consumer
    consumer.energy = Math.min(consumer.maxEnergy, consumer.energy + GAME_CONFIG.SWARM_ENERGY_GAIN);
    consumer.maxEnergy += GAME_CONFIG.SWARM_MAX_ENERGY_GAIN;

    // Destroy swarm
    swarms.delete(swarmId);
    return true; // Swarm consumed
  }

  return false; // Still consuming
}
```

### Client Changes

#### 1. Remove Health UI (client/src/render/hud/HUDOverlay.ts)

- Already no health bars in HUD (confirmed by reading the code)
- Countdown timer shows time-until-starvation (based on energy)
- No changes needed to HUD

#### 2. Update Visual Feedback (client/src/render/three/ThreeRenderer.ts)

**Energy-based sprite glow:**

```typescript
// In player sprite update loop
const energyPercent = player.energy / player.maxEnergy;

// Glow intensity based on energy level
if (energyPercent > 0.5) {
  sprite.material.opacity = 1.0; // Full brightness
} else if (energyPercent > 0.25) {
  sprite.material.opacity = 0.5 + (energyPercent - 0.25) * 2; // Fade
} else {
  sprite.material.opacity = 0.5 + energyPercent; // Dim, pulsing
}

// Color shift when low (optional)
if (energyPercent < 0.3) {
  // Desaturate color or add red tint
}
```

**Particle drain effects:**

- Swarm contact: particles flow from player to swarm
- Gravity well: particles pulled toward obstacle
- EMP hit: burst of particles away from epicenter

#### 3. Update GameState (client/src/core/state/GameState.ts)

Remove health tracking:

```typescript
// In updatePlayer or handleEnergyUpdate
player.energy = message.energy;
// DELETE: player.health = message.health;
```

---

## Testing Plan

### Unit Tests (To Add/Update)

1. **Damage Resistance:**
   - Stage 1 takes full damage ✓
   - Stage 2 takes 75% damage ✓
   - Stage 3 takes 60% damage ✓
   - Resistance doesn't apply to passive decay ✓

2. **Energy Pools:**
   - Stage 1 spawns with 200 energy ✓
   - Evolution increases energy pool ✓
   - Death occurs at 0 energy ✓

3. **Swarm Energy:**
   - EMP sets swarm.energy = 100 ✓
   - Consumption drains swarm energy ✓
   - Swarm dies at 0 energy ✓

4. **EMP Energy Drain:**
   - Multi-cells lose 80 energy (after resistance) ✓
   - Single-cells lose 40 energy (after resistance) ✓
   - Swarms paralyzed for 3s ✓

### Integration Tests

1. **Stage 1 Survival:**
   - Spawn with 200 energy
   - Collect nutrients to gain energy
   - Swarm contact drains 60/s
   - Die at 0 energy (no starvation damage phase)

2. **Stage 2 Resilience:**
   - 400 energy pool
   - Swarm damage reduced to 45/s (25% resistance)
   - Can escape gravity wells more easily (larger pool)
   - EMP costs 80, drains 60 from other multi-cells (after resistance)

3. **Swarm Hunting:**
   - Fire EMP → swarm disabled, energy = 100
   - Contact swarm → drain 50/s
   - 2 seconds → swarm consumed
   - Gain 150 energy + 50 maxEnergy

### Manual Playtesting

1. **Feel Check:**
   - Does Stage 1 feel fragile? (200 energy runs out fast)
   - Does Stage 2 feel tankier? (400 energy + resistance)
   - Is PvP scary? (every hit matters)

2. **Visual Feedback:**
   - Can you tell when you're low on energy? (sprite dimming)
   - Do you see what's draining you? (particle effects)

3. **Pacing:**
   - Is death too sudden? (instant at 0)
   - Is survival time appropriate per stage?

---

## Migration Path

1. **Update shared types** (Player, EntropySwarm, GAME_CONFIG)
2. **Update server logic** (damage, death checks, EMP, swarms)
3. **Update client rendering** (remove health UI, enhance energy visuals)
4. **Update bots** (health → energy checks)
5. **Test each stage individually**
6. **Playtest and tune resistance/pool values**

---

## Open Questions / Tuning Needed

### Decided (v1.1)

- ✅ **Gravity wells:** Physics-only, no proximity damage. Singularity = instant death.
- ✅ **Predation:** Continuous drain (150/s), not instant death. Gives prey escape window.
- ✅ **Drain aura system:** Reuse existing system - semantic change from "health damage" to "energy drain"
- ✅ **Visual feedback:** Drain auras show energy loss; energy gain cue tracked in separate bead

### Still Open

1. **Energy pool values:** Are 200/400/1000/2000 the right survivability levels?
2. **Damage resistance:** Are 0%/25%/40%/50%/60% the right progression?
3. **EMP single-cell drain:** Is 40 energy the right amount? (Currently 20% of Stage 1 pool)
4. **Swarm energy:** Should swarms have passive decay or just drain from consumption?
5. **Predation resistance:** Should predation bypass damage resistance entirely? (Currently: yes)

---

## Summary of Benefits

✅ **Thematic coherence:** Energy = information coherence (perfect fit for digital organisms)
✅ **Simplicity:** One resource, one mental model
✅ **Brutality:** Every hit matters, PvP is high-stakes
✅ **Evolution feels meaningful:** Bigger pools + resistance + efficiency
✅ **Cleaner UI:** No health bars, just visual cues
✅ **Unified threat design:** Everything attacks coherence (energy)

---

**End of Specification**
