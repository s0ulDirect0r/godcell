# ECS Systems Refactor Plan

---

## STATUS (as of 2025-11-29)

**Branch**: `feature/ecs-systems-refactor`
**PR**: #61 (open, against main)
**Progress**: index.ts 2537 → 872 lines (target was 500)

### Completed
- ✅ Phase 1: Extract helpers/, obstacle ECS queries
- ✅ Phase 2: Migrate 8 systems (MetabolismSystem, DeathSystem, PredationSystem, PseudopodSystem, GravitySystem, NutrientCollisionSystem, NutrientAttractionSystem, NetworkBroadcastSystem)
- ✅ Phase 3: Extract nutrients.ts module
- ✅ Phase 4a: handlePlayerDeath inlined into DeathSystem
- ✅ Phase 4b: Convert systems to forEachPlayer ECS iteration (GravitySystem, PredationSystem, PseudopodSystem, NetworkBroadcastSystem)
- ✅ Phase 4c: Convert external functions to ECS queries (bots.ts, swarms.ts)
  - `updateBots()` now takes `world: World`
  - `updateSwarms()` already uses `world: World`
  - `checkSwarmCollisions()` already uses `world: World`
  - `handleBotDeath()` never needed `players` Map

### Remaining (tracked in beads)
- ❌ Phase 4d: Remove `syncPlayersFromECS()` bridge → **`godcell-4bp`**
  - abilities.ts: 4 usages need ECS conversion
  - dev.ts: 4 remaining usages need ECS conversion
  - index.ts: checkBeamHitscan + state sync usages
- ❌ Phase 5: Eliminate legacy Maps entirely (tracked in Epic `godcell-shh`)

### Beads Issues
- **Epic `godcell-shh`**: "Complete ECS migration - eliminate legacy state"
- **`godcell-4bp`**: Remove syncPlayersFromECS bridge (Phase 4d)
- **`godcell-5nc`**: Replace activeDrains Map with ECS component
- **`godcell-j5p`**: Replace pseudopods/pseudopodHits Maps with ECS components
- **`godcell-t2t`**: Bug - client interpolation seems off after migration

### Key Insight
Systems now iterate ECS directly with `forEachPlayer(world, ...)`. The blocking issue for removing `players` Map is external functions in `bots.ts` and `swarms.ts` that still expect the Map as a parameter. Next step: convert these functions to take `world: World` and use ECS queries internally.

### Key Files
- `server/src/ecs/systems/GameContext.ts` - the bridge interface
- `server/src/helpers/` - extracted pure utilities
- `server/src/nutrients.ts` - extracted nutrient lifecycle

---

## Goal
Move all game logic from `server/src/index.ts` into ECS systems, reducing index.ts from ~2500 lines to ~500 lines of pure orchestration.

## Original State (before this work)
- index.ts contains ~45 functions with all game logic
- ECS systems are thin wrappers that delegate to index.ts functions
- MovementSystem and SwarmCollisionSystem show the target pattern (direct ECS operations)

## Target State
- index.ts: Server setup, connection handling, game loop orchestration only
- ECS systems: All game logic, reading/writing ECS components directly
- Helper modules: Pure utility functions (math, stage lookups)

## Decisions
- **Commit style**: Per-phase commits (not per-system)
- **File structure**: `server/src/helpers/` directory for utility modules

---

## Phase 1: Extract Pure Utilities + Obstacle ECS Migration

Create helper modules and eliminate `obstacles` Map by querying ECS directly.

### 1a. `server/src/helpers/math.ts` ✓
Move from index.ts:
- `distance()`
- `rayCircleIntersection()`
- `lineCircleIntersection()`
- `poissonDiscSampling()`

### 1b. `server/src/helpers/stages.ts` ✓
Move from index.ts:
- `getStageMaxEnergy()`
- `getDamageResistance()`
- `getEnergyDecayRate()`
- `getPlayerRadius()`
- `getWorldBoundsForStage()`
- `isSoupStage()`
- `isJungleStage()`
- `getStageEnergy()`
- `getNextEvolutionStage()`

### 1c. `server/src/helpers/spawning.ts`
Move from index.ts:
- `randomColor()` - pure, no dependencies
- `randomSpawnPosition(world)` - queries ECS for obstacles
- `isNutrientSpawnSafe(position, world)` - queries ECS for obstacles
- `calculateNutrientValueMultiplier(position, world)` - queries ECS for obstacles

**Key change**: Spawning helpers take `world: World` and query ECS directly.
No more passing `Map<string, Obstacle>` around.

### 1d. Obstacle ECS Query Helpers
Add to `server/src/ecs/factories.ts`:
- `forEachObstacle(world, callback)` - iterate all obstacles
- `getObstaclePositions(world)` - get all obstacle positions for spawn checks

This mirrors the player helpers pattern (`forEachPlayer`, etc.)

### 1e. Remove `obstacles` Map
Update index.ts:
- Keep `obstacles` Map only for initialization (legacy clients need the data)
- All game logic reads from ECS via helpers
- bots.ts uses ECS queries instead of stored Map reference

**Commit: "Extract pure utilities to helpers/, obstacles use ECS"**

---

## Phase 2: Migrate Systems (In Dependency Order)

Systems are migrated in priority order to maintain working game at each step.

### 2a. MetabolismSystem (Priority 600)
Move into system:
- `updateMetabolism()` logic (~50 lines)
- `checkEvolution()` logic (~70 lines)

Dependencies: ECS components (Energy, Stage), stage helpers, io for broadcasts

### 2b. DeathSystem (Priority 700)
Move into system:
- `checkPlayerDeaths()` logic (~20 lines)
- `handlePlayerDeath()` logic (~90 lines)
- `respawnPlayer()` logic (~50 lines)

Dependencies: ECS components, playerLastDamageSource, playerLastBeamShooter, activeDrains, io

### 2c. PredationSystem (Priority 400)
Move into system:
- `checkPredationCollisions()` logic (~65 lines)
- `engulfPrey()` logic (~45 lines)

Dependencies: ECS components, players cache (for collision), activeDrains, io

### 2d. PseudopodSystem (Priority 300)
Move into system:
- `updatePseudopods()` logic (~45 lines)
- `checkBeamCollision()` logic (~125 lines)
- `checkBeamHitscan()` logic (~45 lines)

Dependencies: ECS components, pseudopods, pseudopodHits, players cache, io

### 2e. GravitySystem (Priority 200)
Move into system:
- `applyGravityForces()` logic (~110 lines)

Dependencies: players cache, playerVelocities, obstacles, ECS position components

### 2f. NutrientCollisionSystem (Priority 610)
Move into system:
- `checkNutrientCollisions()` logic (~65 lines)

Dependencies: ECS components, nutrients, io

### 2g. NutrientAttractionSystem (Priority 620)
Move into system:
- `attractNutrientsToObstacles()` logic (~60 lines)

Dependencies: nutrients, obstacles

### 2h. NetworkBroadcastSystem (Priority 900)
Move into system:
- `broadcastEnergyUpdates()` logic (~20 lines)
- `broadcastDrainState()` logic (~60 lines)
- `broadcastDetectionUpdates()` logic (~65 lines)

Dependencies: ECS components, various tracking Maps, io

**Commit: "Move game logic into ECS systems"**

---

## Phase 3: Consolidate Nutrient Management

Create dedicated nutrient system for spawn/respawn:

### 3a. `NutrientSpawnSystem` (new, or extend NutrientCollisionSystem)
Move into system:
- `spawnNutrient()` logic
- `spawnNutrientAt()` logic
- `respawnNutrient()` logic
- `initializeNutrients()` logic

Move `nutrients` and `nutrientRespawnTimers` Maps into system-owned state.

**Commit: "Consolidate nutrient management into NutrientSpawnSystem"**

---

## Phase 4: Cleanup

### 4a. Shrink GameContext
- Remove function references that are now in systems
- Keep only: world, io, deltaTime, tickData, shared state Maps

### 4b. Remove syncPlayersFromECS()
- Once all systems read ECS directly, this bridge is unnecessary
- Remove the `players` cache Map

### 4c. Final index.ts structure (~500 lines)
- Imports
- Server configuration
- Module-level state Maps (until Phase 5)
- initializeNutrients(), initializeObstacles()
- Socket.io setup
- Connection handlers (join, disconnect, input events)
- Game loop (runs SystemRunner)
- Periodic logging

**Commit: "Cleanup: shrink GameContext, remove legacy bridges"**

---

## Phase 5: ELIMINATE LEGACY STATE (Players, Nutrients, etc.)

The `players` Map, `nutrients` Map, and associated types are legacy bridges that should be removed entirely.
Systems should operate purely on ECS components.

### 5a. Remove `players` Map iteration
- All systems must use `forEachPlayer(world, ...)` not `for (const [id, player] of players)`
- ECS iteration is the source of truth

### 5b. Remove `Player` type from system interfaces
- `handlePlayerDeath(player, cause)` → `handlePlayerDeath(playerId, cause)`
- Systems access components directly, not through Player wrapper
- Keep `getPlayerBySocketId()` only for network serialization (client state sync)

### 5c. Remove `players` Map from GameContext
- Systems don't need Map access once they iterate ECS
- Keeps network broadcast code simpler (can use ECS serialization helpers)

### 5d. Audit all `Player` type usage
- Search for `Player` type in systems
- Each usage should be replaced with direct component access
- `player.energy` → `energyComp.current`
- `player.stage` → `stageComp.stage`
- `player.position` → `posComp.x, posComp.y`

**Commit: "Eliminate legacy Player system - ECS is sole source of truth"**

---

## Migration Pattern (per system)

```typescript
// BEFORE: Thin wrapper
export class MetabolismSystem implements System {
  update(ctx: GameContext): void {
    ctx.updateMetabolism(ctx.deltaTime);  // Delegates to index.ts
  }
}

// AFTER: Full logic
export class MetabolismSystem implements System {
  update(ctx: GameContext): void {
    const { world, deltaTime, io } = ctx;

    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getSocketIdByEntity(entity);
      if (!playerId) return;

      const energyComp = world.getComponent<EnergyComponent>(entity, Components.Energy);
      const stageComp = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!energyComp || !stageComp) return;

      // Decay energy
      const decayRate = getEnergyDecayRate(stageComp.stage);
      energyComp.current -= decayRate * deltaTime;

      // Check evolution
      // ... (inline checkEvolution logic)
    });
  }
}
```

---

## Files Modified

| File | Change |
|------|--------|
| `server/src/index.ts` | Remove migrated functions, shrink to orchestration |
| `server/src/helpers/index.ts` | New - barrel exports |
| `server/src/helpers/physics.ts` | New - math utilities |
| `server/src/helpers/stages.ts` | New - stage config lookups |
| `server/src/helpers/spawning.ts` | New - spawn utilities |
| `server/src/ecs/systems/MetabolismSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/DeathSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/PredationSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/PseudopodSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/GravitySystem.ts` | Expand with full logic |
| `server/src/ecs/systems/NutrientCollisionSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/NutrientAttractionSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/NetworkBroadcastSystem.ts` | Expand with full logic |
| `server/src/ecs/systems/GameContext.ts` | Shrink as functions move out |

---

## Verification After Each Migration

1. `npm run build` passes
2. Game runs without errors
3. The specific system's behavior works (manual test)
4. Commit the change

---

## Estimated Scope

- Phase 1: ~200 lines moved to helpers
- Phase 2: ~700 lines moved to systems
- Phase 3: ~150 lines moved to nutrient system
- Phase 4: ~100 lines removed (cleanup)

Final index.ts: ~500-600 lines (down from 2537)
