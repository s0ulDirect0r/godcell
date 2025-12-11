# GOTCHAS.md

Tribal knowledge, quirks, and things that aren't obvious from reading the code.

---

## ECS Patterns

### Use helper functions for entity lookups

Don't manually iterate to find players by socket ID:

```typescript
// Bad
let playerEntity: EntityId | undefined;
world.forEachWithTag(Tags.Player, (e) => {
  if (world.getComponent(e, Components.Player)?.socketId === socketId) {
    playerEntity = e;
  }
});

// Good
const playerEntity = getEntityBySocketId(socketId);
```

The lookup tables (`socketToEntity`, `entityToSocket`, etc.) are maintained by the factories and are O(1).

### Transient tags must be cleared

Tags like `SlowedThisTick` and `DamagedThisTick` are set during system processing and must be cleared at the end of the tick. If you add a new transient tag, make sure to clear it:

```typescript
world.clearTagFromAll(Tags.YourNewTag);
```

Currently this happens in the main game loop after all systems run.

### Component data is mutable

When you `getComponent()`, you get the actual object, not a copy. Mutations affect the world immediately:

```typescript
const energy = world.getComponent(entity, Components.Energy);
energy.current -= 10; // This immediately changes the entity's energy
```

This is intentional for performance, but be aware of it when debugging.

---

## Server Systems

### System execution order matters

Systems run in priority order (see `SystemPriority` in `server/src/ecs/systems/types.ts`). Key dependencies:

1. **SwarmCollision** sets `SlowedThisTick` tag → **Movement** reads it
2. **Predation** sets `DrainTarget` component → **Movement** applies drain slowdown
3. **Death** must run after **Metabolism** (energy decay can trigger death)
4. **Network** must run last (broadcasts final state)

If you add a system that sets state another system reads, check the priorities.

### Bot AI runs before everything else

`BotAISystem` (priority 100) sets bot `InputComponent` before movement processing. This means bots make decisions based on *last tick's* state, same as human players.

---

## Client Rendering

### Render systems query World directly

After the ECS refactor, render systems don't get state passed to them — they query `world` in their `update()` method. If you're adding a new render system:

```typescript
update(world: World, dt: number) {
  world.forEachWithTag(Tags.YourEntity, (entity) => {
    const pos = world.getComponent(entity, Components.Position);
    // Update/create Three.js objects
  });
}
```

### Interpolation is client-side

The server sends position updates at 60fps. The client stores these in `InterpolationTargetComponent` and smoothly interpolates toward them. If entities appear to "jump", check:

1. Is `InterpolationTargetComponent` being updated on network messages?
2. Is the render system reading from `Position` (current) vs `InterpolationTarget` (target)?

### Mesh cleanup on entity removal

When an entity is removed from the world, render systems must clean up their Three.js objects. Each render system maintains a `Map<string, THREE.Object3D>` — make sure to:

1. Remove the mesh from the scene
2. Delete from the map
3. Dispose geometry/materials if needed

---

## Networking

### Socket ID vs Entity ID vs String ID

Three different ID systems:

| ID Type | Format | Used For |
|---------|--------|----------|
| `EntityId` | number (1, 2, 3...) | ECS internal |
| `socketId` | string (Socket.io ID) | Players (network identity) |
| `stringId` | string ("nutrient_5", "swarm_3") | Non-player entities (network messages) |

Use the lookup functions in `server/src/ecs/factories.ts` to convert between them.

### Client receives full state on join

When a player connects, they get a `gameState` message with all current entities. After that, they receive delta updates (`playerMoved`, `nutrientCollected`, etc.). If state seems wrong on join, check the initial `gameState` handler.

---

## Debugging Spatial Issues (3D Visualization)

When hitboxes, attack arcs, or positions seem wrong, add **debug markers** to visualize what the code thinks vs what you see:

```typescript
// In a render system, add a debug toggle:
private debugMode = false;
private debugMarkers: Map<string, THREE.Group> = new Map();

toggleDebug(): boolean {
  this.debugMode = !this.debugMode;
  if (!this.debugMode) { /* clean up markers */ }
  return this.debugMode;
}

// Create colored spheres/lines to show key positions:
// - Blue sphere: body center (where server tracks entity)
// - Red sphere: head/attack origin
// - Yellow line: attack arc/hitbox boundary
// - Green line: direction/heading vector
```

Expose via `window` for console access:
```typescript
// In main.ts
(window as any).debugSerpent = () => renderer.toggleSerpentDebug();
```

**Pattern discovered debugging serpent attacks:** The visual mesh had head at offset 768, but attack code used offset 80. Debug markers made this immediately obvious — red "head" sphere was at body center, not at the visible head.

**When to use:** Any time a spatial relationship (hitbox, range, offset, rotation) doesn't match what you expect visually.

---

## Common Bugs

### "Entity has no Position component"

Usually means you're querying an entity that was just destroyed. The entity ID might still be in a list from earlier in the tick. Always check `world.hasEntity(entity)` or `world.hasComponent(entity, Components.Position)` if there's any chance the entity could have been removed.

### Player spawns at (0, 0)

The spawn position calculation failed or returned undefined. Check `helpers/spawning.ts` and ensure the spawn function is returning valid coordinates.

### Swarm stuck in place

Check `disabledUntil` — swarms freeze when EMP'd. Also check `state` — if stuck in `chase` with no valid `targetPlayerId`, the swarm won't move.

### Pseudopod doesn't hit anything

`hitEntities` Set prevents double-hits. If testing, make sure you're not reusing a pseudopod entity. Also check `maxDistance` — beams despawn when they've traveled too far.

---

## Performance Notes

### `forEachWithTag` vs `query`

- `forEachWithTag` — O(n) where n = entities with that tag. Use for type-based iteration (all players, all swarms).
- `query` — O(n) where n = entities with ALL specified components. Use for capability-based iteration (all things that move).

Both avoid allocating arrays if you pass a callback. The array-returning versions (`getEntitiesWithTag`, `query`) allocate on every call.

### Don't create objects in hot loops

The game runs at 60fps. Avoid allocating objects inside system `update()` methods:

```typescript
// Bad - allocates every frame
const offset = { x: 10, y: 10 };

// Good - reuse or use primitives
const offsetX = 10;
const offsetY = 10;
```

---

*Add to this file when you discover something non-obvious!*
