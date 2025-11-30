# ECS Render Systems Refactor Plan

**Date:** 2025-11-30
**Status:** Approved, not yet started
**Branch:** Create new branch from main for this work

---

## Critical Context for Future Instances

### Why This Refactor Exists

1. **ThreeRenderer.ts is 2,572 lines** — too large for context windows, hard to reason about
2. **A previous refactor attempt proposed the wrong axis** — splitting by entity type (`PlayerMeshManager`, `SwarmManager`) which duplicates what ECS already does
3. **The correct axis is rendering concern** — Camera, Effects, Auras, Environment, EntitySync
4. **GameState is a bridge class that can be eliminated** — systems should query ECS World directly

### Key Decisions Made

1. **Naming convention:**
   - `*System` for ECS render systems (matches server convention)
   - `*Mesh` for mesh factory helpers (e.g., `SingleCellMesh.ts`)

2. **Architecture pattern: "Systems orchestrate; helpers implement"**
   - `CameraSystem` owns all camera logic (merges `CameraEffects.ts`)
   - `EnvironmentSystem` switches backgrounds, uses `JungleBackground` as a helper
   - Helpers handle complex implementation; systems handle orchestration

3. **GameState elimination:**
   - SocketManager writes directly to ECS World
   - New components: `InterpolationTarget`, `DamageInfo`, `LocalPlayer` tag
   - `myPlayerId` becomes a SocketManager property

4. **Extraction order matters** — Phase 0 (GameState elimination) must happen first as it's foundational

### What NOT To Do

- Don't split by entity type (PlayerManager, SwarmManager) — that duplicates ECS
- Don't keep GameState as a bridge — eliminate it entirely
- Don't merge JungleBackground into EnvironmentSystem — keep it as a helper (it's complex procedural generation)

---

## The Plan

### Overview

Refactor the 2,572-line `ThreeRenderer` into ECS-style render systems that mirror the server's architecture. Also eliminate `GameState` — systems query the ECS World directly.

### Target Architecture

```
client/src/
├── core/
│   ├── net/
│   │   └── SocketManager.ts  # Writes directly to World (no GameState)
│   ├── input/
│   │   └── InputManager.ts   # Unchanged
│   └── events/
│       └── EventBus.ts       # Unchanged
├── ecs/
│   └── ...                   # World, components, factories
└── render/
    ├── ThreeRenderer.ts      # Thin orchestrator (~300 lines)
    ├── systems/
    │   ├── CameraSystem.ts
    │   ├── PlayerRenderSystem.ts
    │   ├── NutrientRenderSystem.ts
    │   ├── ObstacleRenderSystem.ts
    │   ├── SwarmRenderSystem.ts
    │   ├── PseudopodRenderSystem.ts
    │   ├── EffectsSystem.ts
    │   ├── AuraSystem.ts
    │   ├── TrailSystem.ts
    │   └── EnvironmentSystem.ts
    ├── meshes/               # Renamed from mixed locations
    │   ├── SingleCellMesh.ts
    │   ├── MultiCellMesh.ts
    │   ├── CyberOrganismMesh.ts
    │   ├── HumanoidMesh.ts
    │   ├── NutrientMesh.ts
    │   ├── ObstacleMesh.ts
    │   ├── SwarmMesh.ts
    │   └── PseudopodMesh.ts
    ├── effects/
    │   ├── ParticleEffects.ts
    │   ├── TrailEffect.ts
    │   └── AuraEffect.ts
    └── postprocessing/
        └── composer.ts
```

### Key Changes

#### 1. Eliminate GameState

**Before:** `SocketManager → GameState → ThreeRenderer`
**After:** `SocketManager → World ← RenderSystems`

- SocketManager writes directly to ECS World (using factories in `client/src/ecs/`)
- Render systems query World directly
- `myPlayerId` moves to a simple module or SocketManager property
- Interpolation targets become ECS components (e.g., `InterpolationTarget`)
- Damage info becomes ECS components (e.g., `DamageInfo`)

#### 2. Rename Mesh Helpers

| Old Name | New Name |
|----------|----------|
| `SingleCellRenderer.ts` | `meshes/SingleCellMesh.ts` |
| `MultiCellRenderer.ts` | `meshes/MultiCellMesh.ts` |
| `CyberOrganismRenderer.ts` | `meshes/CyberOrganismMesh.ts` |
| `HumanoidRenderer.ts` | `meshes/HumanoidMesh.ts` |

Each exports a function like `createSingleCellMesh(): THREE.Group`

### System Interface

Each render system follows a consistent pattern:

```typescript
interface RenderSystem {
  // Called once on init
  init(scene: THREE.Scene, resources: RenderResources): void;

  // Called every frame
  update(world: World, dt: number): void;

  // Called on cleanup
  dispose(): void;
}

interface RenderResources {
  scene: THREE.Scene;
  camera: THREE.Camera;
  eventBus: EventBus;
  // Shared resources systems might need
}
```

### ThreeRenderer (Orchestrator)

After refactor, ThreeRenderer becomes:

```typescript
class ThreeRenderer {
  private systems: RenderSystem[] = [];

  constructor(world: World, eventBus: EventBus) {
    // Create Three.js core: scene, cameras, composer
    // Register all systems
    this.systems = [
      new CameraSystem(),
      new EnvironmentSystem(),
      new PlayerRenderSystem(),
      new NutrientRenderSystem(),
      new ObstacleRenderSystem(),
      new SwarmRenderSystem(),
      new PseudopodRenderSystem(),
      new TrailSystem(),
      new AuraSystem(),
      new EffectsSystem(),
    ];
    // Init all systems with shared resources
    for (const system of this.systems) {
      system.init(this.scene, { scene: this.scene, camera: this.camera, eventBus });
    }
  }

  render(world: World, dt: number) {
    // Run all systems - they query world directly
    for (const system of this.systems) {
      system.update(world, dt);
    }
    // Render scene
    this.composer.render();
  }
}
```

### Extraction Order

#### Phase 0: Eliminate GameState & Rename Mesh Helpers
**This is foundational work before extracting systems.**

1. **Add client-side ECS components** for render-specific state:
   - `InterpolationTarget` component (replaces `playerTargets` Map)
   - `DamageInfo` component (replaces `playerDamageInfo` Map)
   - `LocalPlayer` tag (replaces `myPlayerId`)

2. **Update SocketManager** to write directly to World:
   - Replace `gameState.upsertPlayer()` → `upsertPlayer(world, ...)`
   - Replace `gameState.updatePlayerTarget()` → `setComponent(entity, Components.InterpolationTarget, ...)`
   - Keep SocketManager holding `myPlayerId` as a property

3. **Rename mesh helpers** to `*Mesh.ts`:
   - Move to `render/meshes/` folder
   - Update imports throughout

4. **Update main.ts**:
   - Create World directly (no GameState)
   - Pass World to ThreeRenderer and SocketManager
   - Delete `GameState.ts`

#### Phase 1: CameraSystem
- **Current code**: ~200 lines across camera logic in ThreeRenderer
- **Owns**: orthographicCamera, perspectiveCamera, activeCamera, cameraShake state
- **Queries**: Local player entity (by `LocalPlayer` tag)
- **Why first**: Most independent, no mesh management

#### Phase 2: EnvironmentSystem
- **Current code**: ~200 lines (soup/jungle backgrounds, firstPersonGround)
- **Owns**: soupBackgroundGroup, jungleBackgroundGroup, JungleBackground instance
- **Queries**: Current stage (to switch soup ↔ jungle)
- **Why second**: Self-contained, no entity dependencies

#### Phase 3: EffectsSystem
- **Current code**: ~150 lines + ParticleEffects.ts integration
- **Owns**: Animation arrays (deathBursts, evolutionAnimations, empPulses, etc.)
- **Listens to**: EventBus for death, evolution, EMP events
- **Why third**: Event-driven, doesn't query entities directly

#### Phase 4: AuraSystem
- **Current code**: ~150 lines (drain/gain auras)
- **Owns**: drainAuraMeshes, gainAuraMeshes maps
- **Queries**: Entities with `DamageInfo` component
- **Why fourth**: Simple query pattern, isolated visual concern

#### Phase 5: TrailSystem
- **Current code**: ~70 lines
- **Owns**: TrailRenderer instances per player
- **Queries**: Player positions and velocities
- **Why fifth**: Small, can be done quickly

#### Phase 6: Entity Render Systems (one at a time)
Extract in order:
1. **NutrientRenderSystem** - Simplest entities
2. **ObstacleRenderSystem** - Static entities with effects
3. **SwarmRenderSystem** - Moving entities with state
4. **PseudopodRenderSystem** - Projectile entities
5. **PlayerRenderSystem** - Most complex (stages, animations, interpolation)

Each system:
- Owns a `Map<string, THREE.Object3D>` for its entity type
- Queries world for entities with relevant components
- Creates meshes for new entities, updates existing, removes stale

### Critical Files to Modify

| File | Changes |
|------|---------|
| `client/src/core/state/GameState.ts` | **DELETE** after Phase 0 |
| `client/src/core/net/SocketManager.ts` | Write to World directly |
| `client/src/main.ts` | Create World, pass to renderer/socket |
| `client/src/ecs/components.ts` | Add `InterpolationTarget`, `DamageInfo`, `LocalPlayer` tag |
| `client/src/render/three/ThreeRenderer.ts` | Extract code, become orchestrator |
| `client/src/render/systems/*.ts` | New files for each system |
| `client/src/render/meshes/*.ts` | Renamed from `*Renderer.ts` |

### Migration Strategy

1. **Phase 0 first** - Eliminate GameState, rename mesh helpers (foundational)
2. **Create system infrastructure** - Define RenderSystem interface, add systems array
3. **Extract one system at a time** - Move code, verify game still works
4. **Each extraction is a commit** - Easy to bisect if issues arise
5. **Test after each extraction** - Visual regression check

### Success Criteria

- [ ] GameState.ts deleted
- [ ] ThreeRenderer < 400 lines (down from 2,572)
- [ ] All render state queries ECS World directly
- [ ] Each system is independently testable
- [ ] No visual regressions
- [ ] Game runs at same FPS
- [ ] Adding new entity type = add new RenderSystem (clear pattern)

### Existing Code to Rename/Move

| Current | New Location |
|---------|--------------|
| `SingleCellRenderer.ts` | `render/meshes/SingleCellMesh.ts` |
| `MultiCellRenderer.ts` | `render/meshes/MultiCellMesh.ts` |
| `CyberOrganismRenderer.ts` | `render/meshes/CyberOrganismMesh.ts` |
| `HumanoidRenderer.ts` | `render/meshes/HumanoidMesh.ts` |
| `ParticleEffects.ts` | `render/effects/ParticleEffects.ts` |
| `DrainAuraRenderer.ts` | `render/effects/AuraEffect.ts` |
| `TrailRenderer.ts` | `render/effects/TrailEffect.ts` |
| `CameraEffects.ts` | **Merge into CameraSystem** |
| `JungleBackground.ts` | Keep as helper, used by EnvironmentSystem |
| `postprocessing/` | Keep as-is |

### Architecture Pattern

**Systems orchestrate; helpers implement.**

- `CameraSystem` — owns all camera logic (merges CameraEffects)
- `EnvironmentSystem` — switches backgrounds, calls helpers
  - Uses `JungleBackground` (procedural generation helper)
  - Uses soup background logic (inline or separate helper)
  - Future: Stage 5 cosmic background = add another helper

### Notes

- Mirrors the server's ECS systems architecture
- Naming: `*System` for render systems, `*Mesh` for mesh factories
- Each system owns its Three.js objects and syncs them to ECS state
- EventBus passed to systems that need event-driven behavior
- SocketManager and main.ts change significantly in Phase 0
