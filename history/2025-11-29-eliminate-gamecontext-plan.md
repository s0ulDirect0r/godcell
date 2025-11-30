# Plan: Eliminate GameContext (godcell-xf13)

**Goal:** Make the comment in GameContext.ts true: "Eventually, systems will only need the ECS World."

**Target State:** Systems receive only `{ world: World, io: Server, deltaTime: number }` - no helper functions, no legacy function wrappers, no cross-system communication hacks.

---

## Current State Analysis

### What each system currently pulls from ctx:

| System | Core (keep) | Helpers (Phase A) | tickData (Phase B) | Legacy Functions (Phase C) |
|--------|-------------|-------------------|--------------------|-----------------------------|
| BotAISystem | world | - | - | updateBots, abilitySystem |
| SwarmAISystem | world, io, deltaTime | - | - | updateSwarms, updateSwarmPositions, processSwarmRespawns |
| SwarmCollisionSystem | world, io, deltaTime | getPlayerRadius, distance | tickData (writes) | checkSwarmCollisions, removeSwarm, recordDamage |
| MovementSystem | world, io, deltaTime | getPlayerRadius, getWorldBoundsForStage | tickData (reads) | - |
| GravitySystem | world, deltaTime | - | - | - |
| PredationSystem | world, io | - | - | - |
| PseudopodSystem | world, io, deltaTime | - | - | - |
| DeathSystem | world, io | - | - | - |
| MetabolismSystem | world, io, deltaTime | getEnergyDecayRate | - | recordDamage, isBot |
| NutrientCollisionSystem | world, io | - | - | respawnNutrient |
| NutrientAttractionSystem | world, io, deltaTime | - | - | respawnNutrient |
| NetworkBroadcastSystem | world, io | - | - | - |

### Already importing directly (good examples):
- **PredationSystem**: imports `distance`, `getPlayerRadius` from `../../helpers`, `isBot` from `../../bots`
- **GravitySystem**: imports `distance` from `../../helpers`

---

## Phase A: Direct Imports for Helper Functions

**Effort:** Low (mechanical)
**Risk:** Low
**Files to change:** 3 systems + GameContext.ts

Replace ctx helper function references with direct imports.

### A1. MovementSystem
```typescript
// Remove from destructuring:
// getPlayerRadius, getWorldBoundsForStage

// Add imports:
import { getPlayerRadius, getWorldBoundsForStage } from '../../helpers';
```

### A2. SwarmCollisionSystem
```typescript
// Remove from destructuring:
// getPlayerRadius, distance

// Add imports:
import { distance, getPlayerRadius } from '../../helpers';
```

### A3. MetabolismSystem
```typescript
// Remove from destructuring:
// getEnergyDecayRate, isBot

// Add imports:
import { getEnergyDecayRate } from '../../stage';
import { isBot } from '../../bots';
```

### A4. Update GameContext interface
Remove from interface:
- `distance`
- `getPlayerRadius`
- `getWorldBoundsForStage`
- `getEnergyDecayRate`
- `getDamageResistance`
- `getStageMaxEnergy`
- `isSoupStage`
- `isJungleStage`
- `isBot`
- `applyDamageWithResistance`

---

## Phase B: Replace tickData with ECS Tags

**Effort:** Medium
**Risk:** Medium (behavioral change in cross-system communication)

tickData is used for SwarmCollisionSystem → MovementSystem communication:
- SwarmCollisionSystem sets `damagedPlayerIds` and `slowedPlayerIds`
- MovementSystem reads `slowedPlayerIds` to apply speed reduction

### B1. Add transient tags to shared/ecs
```typescript
// In shared/ecs/types.ts or components.ts
export const Tags = {
  // ... existing tags
  SlowedThisTick: 'SlowedThisTick',
  DamagedThisTick: 'DamagedThisTick',
};
```

### B2. SwarmCollisionSystem: Add tags instead of writing to tickData
```typescript
// Instead of:
tickData.damagedPlayerIds = damagedPlayerIds;
tickData.slowedPlayerIds = slowedPlayerIds;

// Do:
for (const playerId of damagedPlayerIds) {
  const entity = getEntityBySocketId(playerId);
  if (entity !== undefined) world.addTag(entity, Tags.DamagedThisTick);
}
for (const playerId of slowedPlayerIds) {
  const entity = getEntityBySocketId(playerId);
  if (entity !== undefined) world.addTag(entity, Tags.SlowedThisTick);
}
```

### B3. MovementSystem: Read from tags instead of tickData
```typescript
// Instead of:
const slowedPlayerIds = tickData.slowedPlayerIds;
const isSlowed = slowedPlayerIds.has(playerId);

// Do:
const isSlowed = world.hasTag(entity, Tags.SlowedThisTick);
```

### B4. Clear tags at tick end (or start of next tick)
Add to SystemRunner or game loop:
```typescript
// After all systems run:
world.clearAllWithTag(Tags.SlowedThisTick);
world.clearAllWithTag(Tags.DamagedThisTick);
```

Note: World may need a `clearAllWithTag` helper or we iterate and remove.

### B5. Remove tickData from GameContext
```typescript
// Remove:
tickData: {
  damagedPlayerIds: Set<string>;
  slowedPlayerIds: Set<string>;
};
```

---

## Phase C: Refactor Legacy Functions into ECS Systems

**Effort:** High
**Risk:** High (complex AI logic, many edge cases)

This is where the real work lives. These functions are monolithic and contain complex logic.

### C1. recordDamage → Direct ECS writes

Currently: `recordDamage(entityId, damageRate, source, proximityFactor?)`

This just writes to `DamageTrackingComponent.activeDamage[]`. Systems can do this directly:

```typescript
// Instead of ctx.recordDamage(playerId, rate, source)
const damageTracking = getDamageTrackingBySocketId(world, playerId);
if (damageTracking) {
  damageTracking.activeDamage.push({ damageRate: rate, source });
}
```

**Systems using recordDamage:**
- SwarmCollisionSystem (via checkSwarmCollisions)
- MetabolismSystem (for starvation)

### C2. respawnNutrient → NutrientSystem or inline

Currently wraps nutrient respawn logic. Options:
1. Create a NutrientLifecycleSystem that handles spawning/respawning
2. Inline the logic into NutrientCollisionSystem and NutrientAttractionSystem
3. Keep as a utility function but import directly, not through ctx

Recommend option 3 for now: move to a nutrients utility module, import directly.

### C3. removeSwarm → Direct ECS destruction

Currently wraps `destroyEntity`. Systems can call `destroyEntity` directly:
```typescript
import { destroyEntity } from '../factories';
destroyEntity(world, swarmEntity);
```

### C4. checkSwarmCollisions → Inline into SwarmCollisionSystem

This is the big one. The function in swarms.ts handles:
- Iterating swarms and players
- Distance checks
- Damage application with resistance
- Slow effect determination
- Hit flash events

All this logic should move INTO SwarmCollisionSystem. The system already exists and delegates to this function - just inline it.

**Steps:**
1. Copy logic from `checkSwarmCollisions` in swarms.ts
2. Paste into SwarmCollisionSystem.update()
3. Replace function calls with direct ECS operations
4. Remove the wrapper function from swarms.ts
5. Remove from GameContext

### C5. updateSwarms, updateSwarmPositions, processSwarmRespawns → SwarmAISystem

SwarmAISystem currently just calls these three functions. The logic should be:
1. **updateSwarms**: AI decision making (patrol/chase state) - already mostly ECS-native
2. **updateSwarmPositions**: Apply velocities, handle movement - should be in MovementSystem or merged
3. **processSwarmRespawns**: Check respawn timers, spawn new swarms

**Steps:**
1. Inline `updateSwarms` logic into SwarmAISystem (most of it is already ECS-based)
2. Move swarm position updates to MovementSystem (or keep separate SwarmMovementSystem)
3. Create SwarmSpawnSystem or inline respawn logic
4. Remove wrapper functions from swarms.ts
5. Remove from GameContext

### C6. updateBots → BotAISystem

BotAISystem currently just calls `updateBots(timestamp, world, swarms, abilitySystem)`.

The bots.ts `updateBots` function handles:
- Bot steering/movement decisions
- Ability usage (EMP, pseudopod)
- Target selection
- Obstacle avoidance

This is complex AI code. Options:
1. Inline all logic into BotAISystem
2. Keep bots.ts as a utility module, but have BotAISystem call specific functions directly (not through ctx)

Recommend option 2 initially: break `updateBots` into smaller functions that BotAISystem calls directly.

### C7. abilitySystem → Direct import or dependency injection

Currently passed through ctx. Options:
1. Import AbilitySystem singleton directly
2. Systems that need abilities create/receive their own reference
3. Move ability logic into ECS systems (AbilitySystem becomes multiple systems)

Recommend option 1 for now: make AbilitySystem a module-level singleton that systems import.

---

## Final State

After all phases, GameContext becomes:

```typescript
export interface SystemContext {
  world: World;
  io: Server;
  deltaTime: number;
}
```

Or we eliminate the interface entirely and systems take these as constructor args or method params.

---

## Execution Order

1. **Phase A** (PR 1) - Direct imports for helpers
   - Low risk, immediate cleanup
   - ~1 hour

2. **Phase B** (PR 2) - tickData → ECS tags
   - Medium risk, need to test slow effect behavior
   - ~2 hours

3. **Phase C1-C3** (PR 3) - Simple legacy function removal
   - recordDamage, respawnNutrient, removeSwarm
   - Low-medium risk
   - ~1-2 hours

4. **Phase C4** (PR 4) - Inline checkSwarmCollisions
   - Medium risk, collision logic is important
   - ~2-3 hours

5. **Phase C5** (PR 5) - Refactor swarm functions
   - Medium-high risk, AI behavior
   - ~3-4 hours

6. **Phase C6** (PR 6) - Refactor bot functions
   - Medium-high risk, complex AI
   - ~3-4 hours

7. **Phase C7** (PR 7) - abilitySystem handling
   - Low risk once other systems done
   - ~1 hour

8. **Cleanup** (PR 8) - Remove GameContext, rename to SystemContext
   - Low risk, mostly type changes
   - ~30 min

---

## Success Criteria

- [ ] No system imports GameContext (renamed to SystemContext)
- [ ] SystemContext only contains: world, io, deltaTime
- [ ] All helper functions imported directly from source modules
- [ ] No legacy wrapper functions in GameContext
- [ ] tickData eliminated, using ECS tags for cross-system communication
- [ ] Build passes, all existing behavior preserved

---

## Key Insights / Gotchas

Lessons learned during the ECS migration that apply to this work:

### 1. EntityId vs SocketId Convention

Player references throughout the codebase use **socket IDs (strings)**, not EntityIds (numbers). This was established when fixing `SwarmComponent.targetPlayerId` - it should be `string` to match the network-facing `EntropySwarm` interface and all our helper functions (`getPositionBySocketId`, etc.).

**Rule:** When storing "which player" in a component, use socket ID (string), not EntityId (number).

### 2. Iteration Safety Pattern

When iterating ECS components via `forEachX` and potentially modifying (removing components/entities), **collect IDs first, then modify after iteration**. JavaScript Map iteration behaves unpredictably when modified during iteration.

```typescript
// BAD - modifying during iteration
forEachDrainTarget(world, (preyId) => {
  if (shouldClear) clearDrainTarget(world, preyId); // Modifies underlying Map!
});

// GOOD - collect then modify
const toClear: string[] = [];
forEachDrainTarget(world, (preyId) => {
  if (shouldClear) toClear.push(preyId);
});
for (const preyId of toClear) {
  clearDrainTarget(world, preyId);
}
```

### 3. DeathCause vs DamageSource Types

These are **separate types** with different values:

- `DeathCause`: `'starvation' | 'singularity' | 'swarm' | 'obstacle' | 'predation' | 'beam'`
- `DamageSource`: `'predation' | 'swarm' | 'beam' | 'gravity' | 'starvation'`

`DamageTrackingComponent.lastDamageSource` uses **DeathCause** (for death logging).
`DamageTrackingComponent.activeDamage[].source` uses **DamageSource** (for drain aura visuals).

Don't confuse them - 'singularity' is a DeathCause, 'gravity' is a DamageSource.

### 4. Components Must Be Initialized at Entity Creation

If a system expects a component to exist (even with default/empty values), it must be added during `createPlayer()` / `createBot()` / etc.

**Bug we fixed:** EMP stun didn't work because `StunnedComponent` wasn't added during player creation. `getStunnedBySocketId()` returned `undefined`, so the stun check `if (otherStunned)` always failed.

**Rule:** When adding new component reads to systems, verify the component is initialized at entity creation.
