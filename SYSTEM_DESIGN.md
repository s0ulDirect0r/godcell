# SYSTEM_DESIGN.md

Technical architecture documentation for the GODCELL game. Last updated: Dec 12, 2025.

---

## Overview

GODCELL is a real-time multiplayer evolution game built on an **Entity-Component-System (ECS)** architecture. The server is authoritative, running gameplay systems at 60fps. The client receives state updates, interpolates positions, and renders using Three.js.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GODCELL Architecture                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐         Socket.io          ┌─────────────────────┐    │
│  │   SERVER    │◄────────────────────────►  │      CLIENT         │    │
│  │             │                             │                     │    │
│  │  ECS World  │   GameStateMessage          │  ECS World          │    │
│  │  (60fps)    │ ─────────────────────────►  │  (render state)     │    │
│  │             │                             │                     │    │
│  │  22 Systems │   PlayerMoveMessage         │  18 Render Systems  │    │
│  │  (gameplay) │ ◄─────────────────────────  │  (Three.js)         │    │
│  └─────────────┘                             └─────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Directory Structure

```
godcell/
├── shared/                     # Shared code (types, ECS core)
│   ├── ecs/                    # ECS framework
│   │   ├── World.ts            # Entity/component container
│   │   ├── Component.ts        # ComponentStore class
│   │   ├── components.ts       # All component interfaces
│   │   └── types.ts            # Tags, ComponentType enum
│   ├── math.ts                 # Geometry, spatial algorithms
│   └── index.ts                # Network messages, constants, shared types
│
├── server/                     # Game server
│   └── src/
│       ├── index.ts            # Main loop, socket handlers
│       ├── abilities.ts        # AbilitySystem (EMP, Pseudopod, Projectile, Melee, Trap)
│       ├── bots.ts             # Bot AI decisions
│       ├── jungleFauna.ts      # Stage 3 fauna spawning
│       ├── logger.ts           # Pino logging (3 log files)
│       ├── nutrients.ts        # Nutrient spawning, respawning
│       ├── swarms.ts           # Swarm spawning, respawns
│       ├── ecs/
│       │   ├── factories.ts    # Entity creation, lookups
│       │   ├── serialization/  # ECS → network format
│       │   └── systems/        # 22 gameplay systems
│       └── helpers/            # Math, spawning, stage utilities
│           ├── math.ts         # Vector math, distance calculations
│           ├── spawning.ts     # Spawn position utilities
│           └── stages.ts       # Stage threshold lookups
│
└── client/                     # Game client
    └── src/
        ├── main.ts             # Bootstrap, event wiring
        ├── ecs/                # Client ECS (factories, AuraStateSystem)
        ├── core/
        │   ├── events/         # EventBus
        │   ├── input/          # InputManager
        │   └── net/            # SocketManager
        ├── render/
        │   ├── systems/        # 17 render systems
        │   ├── hud/            # HUDOverlay
        │   ├── three/          # ThreeRenderer, postprocessing
        │   └── meshes/         # Stage-specific mesh factories
        └── ui/                 # Debug overlay, start screen, dev panel, specialization modal
```

---

## 2. ECS Core (`shared/ecs/`)

The ECS framework provides the foundation for both server (gameplay) and client (rendering).

### World (`World.ts`)

Central container managing entities, components, tags, and resources.

```typescript
class World {
  // Entity lifecycle
  createEntity(): EntityId; // Returns numeric ID (1, 2, 3...)
  destroyEntity(id: EntityId): void;
  hasEntity(id: EntityId): boolean;
  getAllEntities(): EntityId[];

  // Component management
  registerStore<T>(type: ComponentType, store: ComponentStore<T>): void;
  addComponent<T>(entity: EntityId, type: ComponentType, data: T): void;
  getComponent<T>(entity: EntityId, type: ComponentType): T | undefined;
  hasComponent(entity: EntityId, type: ComponentType): boolean;
  removeComponent(entity: EntityId, type: ComponentType): void;

  // Queries (find entities with specific components)
  query(...types: ComponentType[]): EntityId[]; // Returns all matching
  queryEach(types: ComponentType[], cb: Function): void; // Iterate without allocation

  // Tags (lightweight entity classification)
  addTag(entity: EntityId, tag: Tag): void;
  removeTag(entity: EntityId, tag: Tag): void;
  hasTag(entity: EntityId, tag: Tag): boolean;
  getEntitiesWithTag(tag: Tag): Set<EntityId>;
  forEachWithTag(tag: Tag, cb: Function): void;
  clearTagFromAll(tag: Tag): void; // Clear transient tags

  // Resources (singleton data)
  setResource<T>(key: string, value: T): void;
  getResource<T>(key: string): T | undefined;
}
```

### ComponentStore (`Component.ts`)

Typed storage for a single component type:

```typescript
class ComponentStore<T> {
  set(entity: EntityId, data: T): void;
  get(entity: EntityId): T | undefined;
  has(entity: EntityId): boolean;
  delete(entity: EntityId): boolean;
  entries(): IterableIterator<[EntityId, T]>;
  size: number;
}
```

### Components (`components.ts`)

All component interfaces defined in one place:

| Component                | Purpose                  | Key Fields                                                                  |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| **Position**             | World location           | `x, y, z?`                                                                  |
| **Velocity**             | Movement vector          | `x, y, z?`                                                                  |
| **Energy**               | Health/fuel              | `current, max`                                                              |
| **Player**               | Player metadata          | `socketId, name, color`                                                     |
| **Stage**                | Evolution stage          | `stage, isEvolving, evolvingUntil?`                                         |
| **Input**                | Movement intent          | `direction: {x, y, z?}`                                                     |
| **Sprint**               | Sprint state             | `isSprinting`                                                               |
| **Stunned**              | Stun effect              | `until` (timestamp)                                                         |
| **Cooldowns**            | Ability cooldowns        | `lastEMPTime?, lastPseudopodTime?, lastMeleeSwipeTime?, lastTrapPlaceTime?` |
| **DamageTracking**       | Damage sources           | `lastDamageSource?, activeDamage[]`                                         |
| **DrainTarget**          | Being drained by         | `predatorId`                                                                |
| **CombatSpecialization** | Stage 3 combat path      | `specialization: melee\|ranged\|traps, selectionPending`                    |
| **Knockback**            | Applied force            | `forceX, forceY, decayRate`                                                 |
| **Nutrient**             | Food entity              | `value, capacityIncrease, isHighValue`                                      |
| **Obstacle**             | Gravity well             | `radius, strength`                                                          |
| **Swarm**                | Entropy swarm            | `size, state, targetPlayerId?, homePosition`                                |
| **Pseudopod**            | Lightning beam           | `ownerId, width, maxDistance, hitEntities`                                  |
| **Tree**                 | Jungle tree              | `radius, height, variant`                                                   |
| **DataFruit**            | Harvestable fruit        | `treeEntityId, value, capacityIncrease, ripeness, fallenAt?`                |
| **CyberBug**             | Skittish prey            | `swarmId, state, value, capacityIncrease`                                   |
| **JungleCreature**       | Larger fauna             | `variant, state, value, capacityIncrease`                                   |
| **EntropySerpent**       | Apex predator            | `size, state, targetEntityId?, homePosition, heading`                       |
| **Projectile**           | Ranged spec attack       | `ownerId, damage, speed, maxDistance, state`                                |
| **Trap**                 | Traps spec mine          | `ownerId, damage, stunDuration, triggerRadius, lifetime`                    |
| **PendingRespawn**       | Deferred entity creation | `respawnAt, entityType, stage?, position?, metadata?`                       |

**Ability Markers** (presence = ability unlocked):

- `CanFireEMP` (Stage 2+)
- `CanFirePseudopod` (Stage 2+)
- `CanSprint` (Stage 3+)
- `CanEngulf` (Stage 2+)
- `CanDetect` (Stage 2+, has `radius`)

**Client-Only**:

- `InterpolationTarget` - Smooth movement interpolation
- `ClientDamageInfo` - Damage visualization data

### Tags (`types.ts`)

Lightweight entity classification:

```typescript
const Tags = {
  // Entity types
  Player: 'player',
  Bot: 'bot',
  Nutrient: 'nutrient',
  Obstacle: 'obstacle',
  Swarm: 'swarm',
  Pseudopod: 'pseudopod',
  Tree: 'tree',

  // Stage 3+ jungle ecosystem
  DataFruit: 'datafruit',
  CyberBug: 'cyberbug',
  JungleCreature: 'junglecreature',
  EntropySerpent: 'entropyserpent',
  Projectile: 'projectile',
  Trap: 'trap',

  // Client-only
  LocalPlayer: 'local_player',

  // Transient per-tick tags (cleared each tick)
  SlowedThisTick: 'slowed_this_tick',
  DamagedThisTick: 'damaged_this_tick',
};
```

---

## 3. Server Architecture (`server/`)

### Main Loop (`index.ts`)

The server runs at 60fps, processing systems in priority order:

```typescript
const world: World = createWorld();
const systemRunner = new SystemRunner();

// Socket.io connection handler
io.on('connection', (socket) => {
  // Player joins → create entity with all components
  const entity = createPlayer(world, socket.id, name, color, position, stage);

  // Input messages → update InputComponent
  socket.on('playerMove', (msg) => {
    const input = world.getComponent(entity, Components.Input);
    input.direction = msg.direction;
  });
});

// Game tick (60fps)
setInterval(() => {
  const delta = getDelta();
  systemRunner.update(world, delta, io);
}, 1000 / 60);
```

### System Runner & Priorities

Systems execute in priority order each tick (lower = earlier):

| Priority | System                           | Responsibility                                     |
| -------- | -------------------------------- | -------------------------------------------------- |
| 50       | **RespawnSystem**                | Process pending respawns (bots, swarms, nutrients) |
| 100      | **BotAISystem**                  | Bot decision-making, steering                      |
| 105      | **CyberBugAISystem**             | Stage 3 prey AI (idle/patrol/flee)                 |
| 106      | **JungleCreatureAISystem**       | Stage 3 fauna AI (grazer/stalker/ambusher)         |
| 107      | **EntropySerpentAISystem**       | Stage 3 apex predator AI (patrol/chase/attack)     |
| 110      | **SwarmAISystem**                | Swarm movement, patrol/chase, respawns             |
| 120      | **SpecializationSystem**         | Stage 3 combat spec timeout auto-assign            |
| 150      | **DataFruitSystem**              | Fruit ripening, ripeness decay                     |
| 200      | **GravitySystem**                | Gravity well attraction                            |
| 300      | **PseudopodSystem**              | Stage 2 beam travel & hits                         |
| 310      | **ProjectileSystem**             | Ranged spec projectile travel & hits               |
| 320      | **TrapSystem**                   | Traps spec trigger detection & lifetime            |
| 400      | **PredationSystem**              | Multi-cell contact draining                        |
| 410      | **SwarmCollisionSystem**         | Swarm damage, sets SlowedThisTick                  |
| 480      | **TreeCollisionSystem**          | Pushes jungle players out of trees                 |
| 500      | **MovementSystem**               | Physics (reads SlowedThisTick, Knockback)          |
| 600      | **MetabolismSystem**             | Energy decay                                       |
| 610      | **NutrientCollisionSystem**      | Stage 1-2 nutrient pickup                          |
| 615      | **MacroResourceCollisionSystem** | Stage 3 fruit/fauna collection                     |
| 620      | **NutrientAttractionSystem**     | Visual pull toward nutrients                       |
| 700      | **DeathSystem**                  | Check deaths, trigger respawns                     |
| 900      | **NetworkBroadcastSystem**       | Send state to clients                              |

**Key Dependencies:**

- SwarmCollision (410) sets `SlowedThisTick` → Movement (500) reads it
- TreeCollision (480) runs after swarm but before movement
- MacroResourceCollision (615) handles Stage 3+ pickups
- EntropySerpentAI (107) hunts players, runs after other fauna AI

### Entity Factories (`ecs/factories.ts`)

Functions to create entities with proper component initialization:

```typescript
// Players
createPlayer(world, socketId, name, color, position, stage): EntityId
createBot(world, position, stage): EntityId

// Stage 1-2 world entities
createNutrient(world, position, value, multiplier): EntityId
createObstacle(world, position): EntityId
createSwarm(world, position, homePosition): EntityId
createPseudopod(world, ownerId, start, end, ownerSocketId): EntityId

// Stage 3+ jungle entities
createTree(world, position, radius, height, variant): EntityId
createDataFruit(world, position, treeEntityId): EntityId
createCyberBug(world, position, swarmId): EntityId
createJungleCreature(world, position, variant): EntityId
createEntropySerpent(world, position): EntityId

// Stage 3+ combat specialization entities
createProjectile(world, ownerId, start, target, color): EntityId
createTrap(world, ownerId, position, color): EntityId
```

**Lookup Tables** (bidirectional ID mapping):

```typescript
// EntityId ↔ Socket ID (for players)
entityToSocket.get(entity); // → socketId
socketToEntity.get(socketId); // → entity

// EntityId ↔ String ID (for world entities)
entityToStringId.get(entity); // → "nutrient_5" or "swarm_3"
stringIdToEntity.get(stringId); // → entity
```

### Serialization (`ecs/serialization/`)

Convert ECS entities to network message format:

```typescript
playerSerializer(entity, world): Player
nutrientSerializer(entity, world): Nutrient
obstacleSerializer(entity, world): Obstacle
swarmSerializer(entity, world): EntropySwarm
treeSerializer(entity, world): Tree
dataFruitSerializer(entity, world): DataFruit
cyberBugSerializer(entity, world): CyberBug
jungleCreatureSerializer(entity, world): JungleCreature
entropySerpentSerializer(entity, world): EntropySerpent
projectileSerializer(entity, world): Projectile
trapSerializer(entity, world): Trap
```

---

## 4. Client Architecture (`client/`)

### Bootstrap (`main.ts`)

```typescript
// Show start screen, then initialize
new StartScreen({ onStart: initializeGame });

function initializeGame(settings) {
  const world = createClientWorld();
  const socketManager = new SocketManager(world);
  const renderer = new ThreeRenderer();
  const inputManager = new InputManager();
  const hudOverlay = new HUDOverlay(world); // In render/hud/

  // Event wiring
  eventBus.on('client:inputMove', (e) => socketManager.sendMove(e.direction));
  eventBus.on('playerDied', (e) => renderer.handleDeath(e));

  // Render loop
  function animate(time) {
    renderer.render(deltaTime);
    requestAnimationFrame(animate);
  }
}
```

### SocketManager (`core/net/SocketManager.ts`)

Handles network communication and updates ECS World directly:

```typescript
class SocketManager {
  constructor(world: World) {
    this.world = world;

    // Receive server messages → update world
    socket.on('gameState', (state) => {
      state.players.forEach((p) => upsertPlayer(world, p));
      state.nutrients.forEach((n) => upsertNutrient(world, n));
      state.trees?.forEach((t) => upsertTree(world, t));
      state.dataFruits?.forEach((f) => upsertDataFruit(world, f));
      state.entropySerpents?.forEach((s) => upsertEntropySerpent(world, s));
      // ...
    });
  }

  // Send client actions
  sendMove(direction: Vector3): void;
  sendPseudopodFire(targetX: number, targetY: number): void;
  sendOrganismProjectileFire(targetX: number, targetY: number): void;
  sendEMPActivate(): void;
  sendSprint(sprinting: boolean): void;
}
```

### InputManager (`core/input/InputManager.ts`)

Captures keyboard/mouse input and emits events:

```typescript
class InputManager {
  // Movement: WASD + Q/E for vertical (Stage 5)
  // Emits to EventBus:
  // - client:inputMove { direction: {x, y, z} }
  // - client:sprint { sprinting: boolean }
  // - client:empActivate {}
  // - client:pseudopodFire { targetX, targetY }
  // - client:organismProjectileFire { targetX, targetY }
  // - client:mouseLook { angle }
}
```

### EventBus (`core/events/EventBus.ts`)

Type-safe pub/sub for internal communication:

```typescript
// Server events (from SocketManager)
'playerJoined' | 'playerDied' | 'playerMoved' | 'playerEvolutionStarted';
'nutrientCollected' | 'dataFruitCollected' | 'cyberBugKilled' | 'jungleCreatureKilled';
'entropySerpentAttack' | 'entropySerpentKilled';

// Client events (from InputManager)
'client:inputMove' | 'client:sprint' | 'client:empActivate';
'client:pseudopodFire' | 'client:organismProjectileFire';

// Usage
eventBus.on('playerDied', (e) => {
  effectsSystem.spawnDeathBurst(e.x, e.y, e.color);
  playerRenderSystem.removePlayer(e.playerId);
});
```

---

## 5. Render Architecture (`client/src/render/`)

The renderer uses a **system-based architecture** where each system owns a specific visual domain.

### ThreeRenderer (`three/ThreeRenderer.ts`)

Central orchestrator:

```typescript
class ThreeRenderer {
  init(container, width, height, world) {
    this.scene = new THREE.Scene();
    this.world = world;

    // Initialize render systems + AuraStateSystem (18 total)
    this.cameraSystem = new CameraSystem();
    this.environmentSystem = new EnvironmentSystem();
    this.playerRenderSystem = new PlayerRenderSystem();
    this.nutrientRenderSystem = new NutrientRenderSystem();
    this.obstacleRenderSystem = new ObstacleRenderSystem();
    this.swarmRenderSystem = new SwarmRenderSystem();
    this.pseudopodRenderSystem = new PseudopodRenderSystem();
    this.treeRenderSystem = new TreeRenderSystem();
    this.dataFruitRenderSystem = new DataFruitRenderSystem();
    this.cyberBugRenderSystem = new CyberBugRenderSystem();
    this.jungleCreatureRenderSystem = new JungleCreatureRenderSystem();
    this.entropySerpentRenderSystem = new EntropySerpentRenderSystem();
    this.projectileRenderSystem = new ProjectileRenderSystem();
    this.trapRenderSystem = new TrapRenderSystem();
    this.effectsSystem = new EffectsSystem();
    this.auraStateSystem = new AuraStateSystem(); // In client/src/ecs/systems/
    this.auraRenderSystem = new AuraRenderSystem();
    this.trailSystem = new TrailSystem();

    // Each system.init(scene, world, ...)
  }

  render(dt) {
    // Each system queries world directly
    this.playerRenderSystem.update(this.world, dt);
    this.nutrientRenderSystem.update(this.world, dt);
    // ... all systems

    this.composer.render(); // Postprocessing
  }
}
```

### Render Systems (`render/systems/`)

| System                         | Owns                                                | Queries                      |
| ------------------------------ | --------------------------------------------------- | ---------------------------- |
| **CameraSystem**               | Camera position, zoom, mode (topdown/orbit/TPS/FPS) | Local player position, stage |
| **EnvironmentSystem**          | Background, sky, particles, ground, grass, hex grid | World bounds, stage          |
| **PlayerRenderSystem**         | Player meshes (5 stages), outlines, evolution       | All player entities          |
| **NutrientRenderSystem**       | Nutrient spheres (color by multiplier)              | All nutrient entities        |
| **ObstacleRenderSystem**       | Gravity well visuals (black sphere + glow)          | All obstacle entities        |
| **SwarmRenderSystem**          | Swarm particle clouds                               | All swarm entities           |
| **PseudopodRenderSystem**      | Lightning beam effects                              | All pseudopod entities       |
| **TreeRenderSystem**           | Jungle trees (procedural meshes)                    | All tree entities            |
| **DataFruitRenderSystem**      | Harvestable fruits (ripeness glow)                  | All datafruit entities       |
| **CyberBugRenderSystem**       | Small prey bugs                                     | All cyberbug entities        |
| **JungleCreatureRenderSystem** | Larger fauna (variant models)                       | All junglecreature entities  |
| **EntropySerpentRenderSystem** | Apex predator (segmented body, clawed arms)         | All entropyserpent entities  |
| **ProjectileRenderSystem**     | Ranged spec projectile beams                        | All projectile entities      |
| **TrapRenderSystem**           | Traps spec mine indicators                          | All trap entities            |
| **EffectsSystem**              | Particle effects (death, evolution)                 | EventBus                     |
| **AuraStateSystem**†           | ECS-driven damage state tracking                    | Player/swarm entities        |
| **AuraRenderSystem**           | Damage/drain visual feedback                        | Player/swarm damage info     |
| **TrailSystem**                | Glowing movement trails                             | Player positions             |

†AuraStateSystem is in `client/src/ecs/systems/`, not `render/systems/`

**Pattern**: Each system:

1. Gets `scene` and `world` on init
2. Maintains a Map of entity → Three.js object
3. In `update(world, dt)`: query ECS, sync Three.js objects

Example:

```typescript
class PlayerRenderSystem {
  private meshes = new Map<string, THREE.Group>();

  update(world: World, dt: number) {
    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity);
      const pos = world.getComponent(entity, Components.Position);
      const stage = world.getComponent(entity, Components.Stage);

      let mesh = this.meshes.get(playerId);
      if (!mesh) {
        mesh = createMeshForStage(stage.stage);
        this.scene.add(mesh);
        this.meshes.set(playerId, mesh);
      }

      mesh.position.set(pos.x, pos.y, 0);
    });
  }
}
```

### Mesh Factories (`render/meshes/`)

Create stage-specific geometry (in separate mesh files):

```typescript
// SingleCellMesh.ts
createSingleCell(radius, colorHex)     // Stage 1: Glowing orb

// MultiCellMesh.ts
createMultiCell(params: MultiCellParams)  // Stage 2: Pulsing segments

// CyberOrganismMesh.ts
createCyberOrganism(radius, colorHex)  // Stage 3: Neon hexapod

// HumanoidMesh.ts
createHumanoid(...)                    // Stage 4: First-person humanoid

// GodcellMesh.ts
createGodcell(...)                     // Stage 5: Transcendent form
```

### PostProcessing (`three/postprocessing/composer.ts`)

EffectComposer with bloom for neon aesthetic:

```typescript
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(resolution, strength, radius, threshold));
// Bloom toggle: B key to disable for performance
```

---

## 6. Evolution Stages

Players evolve through 5 stages by increasing their `maxEnergy` through nutrient collection:

| Stage | Name               | Threshold | Abilities                      | Camera Mode  |
| ----- | ------------------ | --------- | ------------------------------ | ------------ |
| 1     | **Single-Cell**    | 0         | Basic movement                 | Top-down     |
| 2     | **Multi-Cell**     | 300       | EMP, Pseudopod, Detection      | Top-down     |
| 3     | **Cyber-Organism** | 3,000     | Sprint + Combat Specialization | Orbit        |
| 4     | **Humanoid**       | 30,000    | First-person controls          | First-person |
| 5     | **Godcell**        | 100,000   | 3D flight (Q/E vertical)       | First-person |

**Stage Progression:**

- Stage 1→2: Collect ~20 nutrients in soup
- Stage 2→3: Hunt swarms with EMP + pseudopod
- Stage 3→4: Hunt jungle fauna (fruits, bugs, creatures), avoid entropy serpents
- Stage 4→5: Full ecosystem mastery

### Stage 3 Combat Specializations

At Stage 3, players choose one of three combat specializations (locked for that life):

| Specialization | Attack       | Mechanics                                        |
| -------------- | ------------ | ------------------------------------------------ |
| **Melee**      | Swipe/Thrust | Close-range arc attack with knockback            |
| **Ranged**     | Projectile   | Homing projectile with damage + capacity steal   |
| **Traps**      | Mine         | Disguised trap that stuns + damages on proximity |

**Selection Flow:**

1. Player evolves to Stage 3 → `specializationPrompt` sent to client
2. Modal appears with 3 choices (timeout: 10s)
3. Player selects → `selectSpecialization` sent to server
4. If timeout: `SpecializationSystem` auto-assigns random choice
5. Choice stored in `CombatSpecializationComponent`

**Combat Inputs:**

- **Melee**: LMB (swipe) / RMB (thrust)
- **Ranged**: LMB (fire at cursor)
- **Traps**: RMB (place at cursor)

---

## 7. World Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│                    JUNGLE (19,200 x 12,800)                         │
│                                                                     │
│   Trees, DataFruits, CyberBugs, JungleCreatures, EntropySerpents   │
│                                                                     │
│                    ┌───────────────────────┐                        │
│                    │    SOUP (4,800 x      │                        │
│                    │       3,200)          │                        │
│                    │                       │                        │
│                    │  Nutrients, Obstacles │                        │
│                    │  Swarms, Players      │                        │
│                    │  (Stage 1-2)          │                        │
│                    └───────────────────────┘                        │
│                    (centered at 7200, 4800)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- **Soup**: Central 4,800×3,200 area for Stage 1-2 gameplay
- **Jungle**: Surrounding 19,200×12,800 area for Stage 3+ gameplay
- Stage 3+ players transition to jungle view with trees and fauna

---

## 8. Data Flow

### Server → Client

```
Server Game Loop (60fps)
    │
    ▼
Systems modify ECS components
    │
    ▼
NetworkBroadcastSystem serializes entities
    │
    ▼
Socket.emit('gameState', { players, nutrients, obstacles, swarms,
                           trees, dataFruits, cyberBugs, jungleCreatures,
                           entropySerpents })
    │
    ▼
Client SocketManager receives
    │
    ▼
upsertPlayer/upsertNutrient/upsertTree/etc. update client World
    │
    ▼
Render systems query World each frame
    │
    ▼
Three.js objects created/updated/removed
```

### Client → Server

```
InputManager detects keyboard/mouse
    │
    ▼
eventBus.emit('client:inputMove', {direction})
    │
    ▼
SocketManager.sendMove(direction)
    │
    ▼
Server receives 'playerMove' message
    │
    ▼
Updates InputComponent on player entity
    │
    ▼
MovementSystem processes input next tick
    │
    ▼
Position changes broadcast to all clients
```

---

## 9. Network Messages

### Client → Server

| Message                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `playerMove`           | Direction vector (x, y, z?)                   |
| `playerRespawnRequest` | Request respawn after death                   |
| `playerSprint`         | Toggle sprint (Stage 3+)                      |
| `pseudopodFire`        | Fire beam at target (Stage 2+)                |
| `empActivate`          | Activate EMP pulse (Stage 2+)                 |
| `selectSpecialization` | Choose combat path (melee/ranged/traps)       |
| `projectileFire`       | Ranged spec: fire at target (Stage 3+)        |
| `meleeAttack`          | Melee spec: swipe/thrust attack (Stage 3+)    |
| `placeTrap`            | Traps spec: place mine at position (Stage 3+) |
| `devCommand`           | Dev panel commands                            |

### Server → Client

| Message                                                                    | Purpose                             |
| -------------------------------------------------------------------------- | ----------------------------------- |
| `gameState`                                                                | Full world state (all entities)     |
| `playerJoined`, `playerLeft`, `playerMoved`                                | Player lifecycle                    |
| `playerDied`, `playerRespawned`                                            | Death/respawn events                |
| `playerEvolutionStarted`, `playerEvolved`                                  | Evolution events                    |
| `nutrientSpawned`, `nutrientCollected`, `nutrientMoved`                    | Nutrient events                     |
| `swarmSpawned`, `swarmMoved`, `swarmConsumed`                              | Swarm events                        |
| `pseudopodSpawned`, `pseudopodMoved`, `pseudopodRetracted`, `pseudopodHit` | Beam events                         |
| `empActivated`                                                             | EMP pulse with affected entities    |
| `playerDrainState`                                                         | Comprehensive damage tracking       |
| `detectionUpdate`                                                          | Radar info for Stage 2+             |
| `dataFruitSpawned`, `dataFruitCollected`                                   | Fruit events                        |
| `cyberBugSpawned`, `cyberBugKilled`, `cyberBugMoved`                       | Bug events                          |
| `jungleCreatureSpawned`, `jungleCreatureKilled`, `jungleCreatureMoved`     | Creature events                     |
| `entropySerpentSpawned`, `entropySerpentMoved`, `entropySerpentAttack`     | Serpent movement/attack             |
| `entropySerpentDamaged`, `entropySerpentKilled`                            | Serpent damage/death                |
| `specializationPrompt`                                                     | Prompt player to choose combat spec |
| `specializationSelected`                                                   | Confirm combat spec choice          |
| `projectileSpawned`, `projectileHit`, `projectileRetracted`                | Ranged spec projectile events       |
| `meleeAttackExecuted`                                                      | Melee spec attack event             |
| `trapPlaced`, `trapTriggered`, `trapDespawned`                             | Traps spec events                   |
| `knockbackApplied`                                                         | Knockback force applied to entity   |

---

## 10. Key Patterns

### Querying Entities

```typescript
// By tag
world.forEachWithTag(Tags.Player, (entity) => {
  const pos = world.getComponent(entity, Components.Position);
  // ...
});

// By components
const movingEntities = world.query(Components.Position, Components.Velocity);

// Lookup by ID
const entity = getEntityBySocketId(socketId);
const entity = getEntityByStringId('nutrient_5');
```

### Component Modification

```typescript
// Via helper functions (preferred)
setEnergyBySocketId(world, socketId, newEnergy);
setPositionBySocketId(world, socketId, x, y);

// Direct mutation
const energy = world.getComponent(entity, Components.Energy);
energy.current = newEnergy;
```

### Transient Tags

Used for per-tick state that shouldn't persist:

```typescript
// Set during collision processing
world.addTag(entity, Tags.SlowedThisTick);

// Used by movement system
if (world.hasTag(entity, Tags.SlowedThisTick)) {
  velocity *= 0.5;
}

// Cleared at end of tick
world.clearTagFromAll(Tags.SlowedThisTick);
```

---

## 11. Adding New Features

### New Component

1. Add interface to `shared/ecs/components.ts`
2. Add to `Components` object in `shared/ecs/types.ts`
3. Register store in `createWorld()` (server and/or client)
4. Use in systems as needed

### New Server System

1. Create system in `server/src/ecs/systems/`
2. Implement `update(world, delta, io)` method
3. Add priority to `SystemPriority` in `types.ts`
4. Register in `index.ts` with `systemRunner.register()`
5. Consider what data to broadcast to clients

### New Render System

1. Create system in `client/src/render/systems/`
2. Implement `init(scene, world)` and `update(world, dt)`
3. Register in ThreeRenderer
4. Maintain entity → Three.js object mapping

### New Entity Type

1. Add component(s) to `shared/ecs/components.ts`
2. Add tag to `Tags` in `shared/ecs/types.ts`
3. Create factory in `server/src/ecs/factories.ts`
4. Add serializer in `server/src/ecs/serialization/`
5. Add network message type(s) in `shared/index.ts`
6. Create client factory in `client/src/ecs/factories.ts`
7. Create render system or extend existing one

---

## 12. Logging Architecture

Server uses Pino with 3 separate rotating log files (10MB max, 5 old files):

| Logger         | File                   | Purpose                                  |
| -------------- | ---------------------- | ---------------------------------------- |
| `logger`       | `logs/server.log`      | Game events (deaths, evolutions, spawns) |
| `perfLogger`   | `logs/performance.log` | Performance metrics (FPS, entity counts) |
| `clientLogger` | `logs/client.log`      | Forwarded client debug info              |

**Usage:**

```typescript
import { logger, perfLogger, clientLogger } from './logger';

// Game events
logger.info({ event: 'player_evolved', playerId, stage }, 'Player evolved');

// Performance metrics
perfLogger.info({ event: 'tick_stats', fps, entityCount }, 'Tick complete');
```

**Telemetry Focus:** Log spawns, deaths (with cause), ability usage, AI decisions, and anomalies for debugging and balance tuning.

---

## 13. Performance Considerations

- **Server**: Systems run sequentially; keep each system O(n)
- **Client**: Render systems run every frame; minimize Three.js object churn
- **Queries**: `queryEach` avoids array allocation; prefer for hot paths
- **Tags**: O(1) lookup; use for transient per-tick state
- **Interpolation**: Client interpolates positions to smooth 60fps server → 60fps+ render
- **Bloom Toggle**: B key disables bloom for performance on slower machines

---

## 14. Resource Management

Proper cleanup prevents memory leaks. Follow these patterns consistently.

### Three.js Disposal Pattern

Render systems that create Three.js objects MUST dispose of geometry and materials when removing entities:

```typescript
class PlayerRenderSystem {
  private meshes = new Map<string, THREE.Group>();

  // Dispose helper - use when removing entities
  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          (child.material as THREE.Material)?.dispose();
        }
      }
    });
  }

  removePlayer(playerId: string): void {
    const mesh = this.meshes.get(playerId);
    if (mesh) {
      this.scene.remove(mesh);
      this.disposeGroup(mesh); // ALWAYS dispose geometry + materials
      this.meshes.delete(playerId);
    }
  }
}
```

### EventBus Subscription Cleanup

Components that subscribe to EventBus MUST track and clean up subscriptions:

```typescript
class MyComponent {
  private subscriptions: Array<() => void> = [];

  init() {
    // Store unsubscribe functions
    this.subscriptions.push(eventBus.on('playerDied', this.handleDeath));
    this.subscriptions.push(eventBus.on('playerEvolved', this.handleEvolution));
  }

  dispose() {
    // Clean up all subscriptions
    this.subscriptions.forEach((unsub) => unsub());
    this.subscriptions = [];
  }
}
```

### Event Listener Cleanup

Classes that add DOM event listeners MUST store handler references and remove them:

```typescript
class InputState {
  // Store handlers as class properties (not inline functions)
  private keydownHandler = (e: KeyboardEvent) => { ... };
  private mousedownHandler = (e: MouseEvent) => { ... };

  constructor() {
    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('mousedown', this.mousedownHandler);
  }

  dispose() {
    // Remove using the SAME handler references
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('mousedown', this.mousedownHandler);
  }
}
```

### ECS-Based Timers (Deferred Actions)

Prefer ECS components over setTimeout for game logic timing. This makes pending actions queryable, debuggable, and prevents orphaned timers on shutdown.

**Pattern: PendingRespawn**

Instead of:

```typescript
// ❌ Fire-and-forget, not trackable
setTimeout(() => respawnBot(botId), 5000);
```

Use:

```typescript
// ✅ ECS-native, queryable, no orphans
const entity = world.createEntity();
world.addComponent(entity, Components.PendingRespawn, {
  respawnAt: Date.now() + 5000,
  entityType: 'bot',
  stage: 2,
  metadata: { botId },
});
```

**RespawnSystem** processes these entities each tick:

```typescript
class RespawnSystem {
  update(world: World, delta: number, io: Server) {
    const now = Date.now();
    for (const entity of world.query(Components.PendingRespawn)) {
      const pending = world.getComponent(entity, Components.PendingRespawn);
      if (now >= pending.respawnAt) {
        // Execute the deferred action
        if (pending.entityType === 'bot') {
          respawnBotNow(pending.metadata.botId, pending.stage, io, world);
        }
        world.destroyEntity(entity);
      }
    }
  }
}
```

**Benefits:**

- All pending actions visible in ECS (queryable, debuggable)
- No orphaned timers on server shutdown
- Consistent with ECS architecture
- Can extend to swarms, nutrients, etc.

---

## 15. Testing

- **Unit tests**: Test systems with mock World instances
- **Integration**: Run server + client locally, verify sync
- **Debug overlay**: `?debug` query param enables performance overlay
- **Dev panel**: Spawn entities, teleport, set energy, pause game
- **Logs**: Check `logs/` for structured event logs
