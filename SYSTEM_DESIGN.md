# SYSTEM_DESIGN.md

Technical architecture documentation for the GODCELL game. Last updated: Nov 2025.

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
│  │  11 Systems │   PlayerMoveMessage         │  9 Render Systems   │    │
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
│   └── index.ts                # Network messages, constants, shared types
│
├── server/                     # Game server
│   └── src/
│       ├── index.ts            # Main loop, socket handlers
│       ├── ecs/
│       │   ├── factories.ts    # Entity creation, lookups
│       │   ├── serialization/  # ECS → network format
│       │   └── systems/        # 11 gameplay systems
│       └── helpers/            # Math, spawning, stages, logging
│
└── client/                     # Game client
    └── src/
        ├── main.ts             # Bootstrap, event wiring
        ├── ecs/                # Client ECS (factories)
        ├── core/
        │   ├── events/         # EventBus
        │   ├── input/          # InputManager
        │   └── net/            # SocketManager
        ├── render/
        │   ├── systems/        # 9 render systems
        │   ├── three/          # ThreeRenderer, postprocessing
        │   └── meshes/         # Stage-specific mesh factories
        └── ui/                 # HUD, debug overlay, start screen
```

---

## 2. ECS Core (`shared/ecs/`)

The ECS framework provides the foundation for both server (gameplay) and client (rendering).

### World (`World.ts`)

Central container managing entities, components, tags, and resources.

```typescript
class World {
  // Entity lifecycle
  createEntity(): EntityId           // Returns numeric ID (1, 2, 3...)
  destroyEntity(id: EntityId): void
  hasEntity(id: EntityId): boolean
  getAllEntities(): EntityId[]

  // Component management
  registerStore<T>(type: ComponentType, store: ComponentStore<T>): void
  addComponent<T>(entity: EntityId, type: ComponentType, data: T): void
  getComponent<T>(entity: EntityId, type: ComponentType): T | undefined
  hasComponent(entity: EntityId, type: ComponentType): boolean
  removeComponent(entity: EntityId, type: ComponentType): void

  // Queries (find entities with specific components)
  query(...types: ComponentType[]): EntityId[]           // Returns all matching
  queryEach(types: ComponentType[], cb: Function): void  // Iterate without allocation

  // Tags (lightweight entity classification)
  addTag(entity: EntityId, tag: Tag): void
  removeTag(entity: EntityId, tag: Tag): void
  hasTag(entity: EntityId, tag: Tag): boolean
  getEntitiesWithTag(tag: Tag): Set<EntityId>
  forEachWithTag(tag: Tag, cb: Function): void
  clearTagFromAll(tag: Tag): void                        // Clear transient tags

  // Resources (singleton data)
  setResource<T>(key: string, value: T): void
  getResource<T>(key: string): T | undefined
}
```

### ComponentStore (`Component.ts`)

Typed storage for a single component type:

```typescript
class ComponentStore<T> {
  set(entity: EntityId, data: T): void
  get(entity: EntityId): T | undefined
  has(entity: EntityId): boolean
  delete(entity: EntityId): boolean
  entries(): IterableIterator<[EntityId, T]>
  size: number
}
```

### Components (`components.ts`)

All component interfaces are defined in one place:

| Component | Purpose | Fields |
|-----------|---------|--------|
| **Position** | Location in world | `x, y` |
| **Velocity** | Movement vector | `x, y` |
| **Energy** | Health/fuel | `current, max` |
| **Player** | Player metadata | `socketId, name, color` |
| **Stage** | Evolution stage | `stage, isEvolving, evolvingUntil?` |
| **Input** | Movement intent | `direction: {x, y}` |
| **Sprint** | Sprint state | `isSprinting` |
| **Stunned** | Stun effect | `until` (timestamp) |
| **Cooldowns** | Ability cooldowns | `lastEMPTime?, lastPseudopodTime?` |
| **DamageTracking** | Damage sources | `lastDamageSource?, activeDamage[]` |
| **DrainTarget** | Being drained by | `predatorId` |
| **Nutrient** | Food entity | `value, capacityIncrease, isHighValue` |
| **Obstacle** | Gravity well | `radius, strength` |
| **Swarm** | Entropy swarm | `size, state, targetPlayerId?, homePosition` |
| **Pseudopod** | Lightning beam | `ownerId, width, maxDistance, hitEntities` |

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
enum Tags {
  Player = 'player',
  Bot = 'bot',
  Nutrient = 'nutrient',
  Obstacle = 'obstacle',
  Swarm = 'swarm',
  Pseudopod = 'pseudopod',
  LocalPlayer = 'local_player',      // Client only
  SlowedThisTick = 'slowed_this_tick',  // Transient
  DamagedThisTick = 'damaged_this_tick' // Transient
}
```

---

## 3. Server Architecture (`server/`)

### Main Loop (`index.ts`)

The server runs at 60fps, processing systems in priority order:

```typescript
const world: World = createWorld()
const systemRunner = new SystemRunner()

// Socket.io connection handler
io.on('connection', (socket) => {
  // Player joins → create entity with all components
  const entity = createPlayer(world, socket.id, name, color, position, stage)

  // Input messages → update InputComponent
  socket.on('playerMove', (msg) => {
    const input = world.getComponent(entity, Components.Input)
    input.direction = msg.direction
  })
})

// Game tick (60fps)
setInterval(() => {
  const delta = getDelta()
  systemRunner.update(world, delta, io)
}, 1000 / 60)
```

### System Runner & Priorities (`ecs/systems/SystemRunner.ts`)

Systems execute in priority order each tick:

| Priority | System | Responsibility |
|----------|--------|----------------|
| 100 | BotAISystem | Bot decision-making, steering |
| 110 | SwarmAISystem | Swarm movement, respawns |
| 200 | GravitySystem | Gravity well attraction |
| 300 | PseudopodSystem | Lightning beam travel & hits |
| 400 | PredationSystem | Multi-cell contact draining |
| 410 | SwarmCollisionSystem | Swarm damage, slow debuffs |
| 500 | MovementSystem | Physics (uses slow tags) |
| 600 | MetabolismSystem | Energy decay |
| 610 | NutrientCollisionSystem | Pickup detection |
| 620 | NutrientAttractionSystem | Nutrient visual pull |
| 700 | DeathSystem | Check deaths, trigger respawns |
| 900 | NetworkBroadcastSystem | Send state to clients |

### Entity Factories (`ecs/factories.ts`)

Functions to create entities with proper component initialization:

```typescript
// Create player entity
createPlayer(world, socketId, name, color, position, stage): EntityId

// Create bot (player + bot tag)
createBot(world, position, stage): EntityId

// Create world entities
createNutrient(world, position, value, multiplier): EntityId
createObstacle(world, position): EntityId
createSwarm(world, position, homePosition): EntityId
createPseudopod(world, ownerId, start, end, ownerSocketId): EntityId
```

**Lookup Tables** (bidirectional ID mapping):

```typescript
// EntityId ↔ Socket ID (for players)
entityToSocket.get(entity)  // → socketId
socketToEntity.get(socketId) // → entity

// EntityId ↔ String ID (for world entities)
entityToStringId.get(entity)  // → "nutrient_5" or "swarm_3"
stringIdToEntity.get(stringId) // → entity
```

### Serialization (`ecs/serialization/`)

Convert ECS entities to network message format:

```typescript
playerSerializer(entity, world): Player
nutrientSerializer(entity, world): Nutrient
obstacleSerializer(entity, world): Obstacle
swarmSerializer(entity, world): EntropySwarm
```

---

## 4. Client Architecture (`client/`)

### Bootstrap (`main.ts`)

```typescript
// Show start screen, then initialize
new StartScreen({ onStart: initializeGame })

function initializeGame(settings) {
  const world = createClientWorld()
  const socketManager = new SocketManager(world)
  const renderer = new ThreeRenderer()
  const inputManager = new InputManager()
  const hudOverlay = new HUDOverlay(world)

  // Event wiring
  eventBus.on('client:inputMove', (e) => socketManager.sendMove(e.direction))
  eventBus.on('playerDied', (e) => renderer.handleDeath(e))

  // Render loop
  function animate(time) {
    renderer.render(deltaTime)
    requestAnimationFrame(animate)
  }
}
```

### SocketManager (`core/net/SocketManager.ts`)

Handles network communication and updates ECS World directly:

```typescript
class SocketManager {
  constructor(world: World) {
    this.world = world

    // Receive server messages → update world
    socket.on('gameState', (state) => {
      state.players.forEach(p => upsertPlayer(world, p))
      state.nutrients.forEach(n => upsertNutrient(world, n))
      // ...
    })

    socket.on('playerMoved', (data) => {
      updatePlayerTarget(world, data.id, data.x, data.y)
    })
  }

  // Send client actions
  sendMove(direction: Vector2): void
  sendPseudopodFire(targetX: number, targetY: number): void
  sendEMPActivate(): void
  sendSprint(sprinting: boolean): void
}
```

### InputManager (`core/input/InputManager.ts`)

Captures keyboard/mouse input and emits events:

```typescript
class InputManager {
  // Emits to EventBus:
  // - client:inputMove { direction: {x, y} }
  // - client:sprint { sprinting: boolean }
  // - client:empActivate {}
  // - client:pseudopodFire { targetX, targetY }
  // - client:mouseLook { angle }
}
```

### EventBus (`core/events/EventBus.ts`)

Type-safe pub/sub for internal communication:

```typescript
// Server events (from SocketManager)
'playerJoined' | 'playerDied' | 'playerMoved' | 'playerEvolutionStarted'

// Client events (from InputManager)
'client:inputMove' | 'client:sprint' | 'client:empActivate' | 'client:pseudopodFire'

// Usage
eventBus.on('playerDied', (e) => {
  effectsSystem.spawnDeathBurst(e.x, e.y, e.color)
  playerRenderSystem.removePlayer(e.playerId)
})
```

---

## 5. Render Architecture (`client/src/render/`)

The renderer uses a **system-based architecture** where each system owns a specific visual domain.

### ThreeRenderer (`three/ThreeRenderer.ts`)

Central orchestrator:

```typescript
class ThreeRenderer {
  init(container, width, height, world) {
    this.scene = new THREE.Scene()
    this.world = world

    // Initialize all render systems
    this.cameraSystem = new CameraSystem()
    this.environmentSystem = new EnvironmentSystem()
    this.playerRenderSystem = new PlayerRenderSystem()
    this.nutrientRenderSystem = new NutrientRenderSystem()
    this.obstacleRenderSystem = new ObstacleRenderSystem()
    this.swarmRenderSystem = new SwarmRenderSystem()
    this.pseudopodRenderSystem = new PseudopodRenderSystem()
    this.effectsSystem = new EffectsSystem()
    this.auraSystem = new AuraSystem()
    this.trailSystem = new TrailSystem()

    // Each system.init(scene, world, ...)
  }

  render(dt) {
    // Each system queries world directly
    this.playerRenderSystem.update(this.world, dt)
    this.nutrientRenderSystem.update(this.world, dt)
    // ... all systems

    this.composer.render()  // Postprocessing
  }
}
```

### Render Systems (`render/systems/`)

| System | Owns | Queries |
|--------|------|---------|
| **CameraSystem** | Camera position, zoom, pan | Local player position, stage |
| **EnvironmentSystem** | Background, sky, particles, ground | World bounds |
| **PlayerRenderSystem** | Player meshes (4 stages), outlines | All player entities |
| **NutrientRenderSystem** | Nutrient meshes, colors | All nutrient entities |
| **ObstacleRenderSystem** | Gravity well visuals | All obstacle entities |
| **SwarmRenderSystem** | Swarm particle clouds | All swarm entities |
| **PseudopodRenderSystem** | Lightning beam effects | All pseudopod entities |
| **EffectsSystem** | Particle effects (death, evolution) | EventBus |
| **AuraSystem** | Damage/gain auras | Player damage info |
| **TrailSystem** | Glowing movement trails | Player positions |

**Pattern**: Each system:
1. Gets `scene` and `world` on init
2. Maintains a Map of entity → Three.js object
3. In `update(world, dt)`: query ECS, sync Three.js objects

Example:

```typescript
class PlayerRenderSystem {
  private meshes = new Map<string, THREE.Group>()

  update(world: World, dt: number) {
    world.forEachWithTag(Tags.Player, (entity) => {
      const playerId = getStringIdByEntity(entity)
      const pos = world.getComponent(entity, Components.Position)
      const stage = world.getComponent(entity, Components.Stage)

      let mesh = this.meshes.get(playerId)
      if (!mesh) {
        mesh = createMeshForStage(stage.stage)
        this.scene.add(mesh)
        this.meshes.set(playerId, mesh)
      }

      mesh.position.set(pos.x, pos.y, 0)
    })
  }
}
```

### Mesh Factories (`render/meshes/`)

Create stage-specific geometry:

```typescript
createSingleCell(color)     // Stage 1: Glowing orb
createMultiCell(color)      // Stage 2: Pulsing segments
createCyberOrganism(color)  // Stage 3: Neon spikes
createHumanoidModel(color)  // Stage 4: GLTF rigged model
```

### PostProcessing (`three/postprocessing/composer.ts`)

EffectComposer with bloom for neon aesthetic:

```typescript
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(resolution, strength, radius, threshold))
```

---

## 6. Data Flow

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
Socket.emit('gameState', { players, nutrients, obstacles, swarms })
    │
    ▼
Client SocketManager receives
    │
    ▼
upsertPlayer/upsertNutrient/etc. update client World
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

## 7. Key Patterns

### Querying Entities

```typescript
// By tag
world.forEachWithTag(Tags.Player, (entity) => {
  const pos = world.getComponent(entity, Components.Position)
  // ...
})

// By components
const movingEntities = world.query(Components.Position, Components.Velocity)

// Lookup by ID
const entity = getEntityBySocketId(socketId)
const entity = getEntityByStringId('nutrient_5')
```

### Component Modification

```typescript
// Via helper functions (preferred)
setEnergyBySocketId(world, socketId, newEnergy)
setPositionBySocketId(world, socketId, x, y)

// Direct mutation
const energy = world.getComponent(entity, Components.Energy)
energy.current = newEnergy
```

### Transient Tags

Used for per-tick state that shouldn't persist:

```typescript
// Set during collision processing
world.addTag(entity, Tags.SlowedThisTick)

// Used by movement system
if (world.hasTag(entity, Tags.SlowedThisTick)) {
  velocity *= 0.5
}

// Cleared at end of tick
world.clearTagFromAll(Tags.SlowedThisTick)
```

---

## 8. Adding New Features

### New Component

1. Add interface to `shared/ecs/components.ts`
2. Add to `ComponentType` enum in `shared/ecs/types.ts`
3. Register store in `createWorld()` (server and/or client)
4. Use in systems as needed

### New Server System

1. Create system in `server/src/ecs/systems/`
2. Implement `update(world, delta, io)` method
3. Add to SystemRunner with appropriate priority
4. Consider what data to broadcast to clients

### New Render System

1. Create system in `client/src/render/systems/`
2. Implement `init(scene, world)` and `update(world, dt)`
3. Register in ThreeRenderer
4. Maintain entity → Three.js object mapping

### New Entity Type

1. Add component(s) to `shared/ecs/components.ts`
2. Add tag to `shared/ecs/types.ts`
3. Create factory in `server/src/ecs/factories.ts`
4. Add serializer in `server/src/ecs/serialization/`
5. Add network message type in `shared/index.ts`
6. Create client factory in `client/src/ecs/factories.ts`
7. Create render system or extend existing one

---

## 9. Performance Considerations

- **Server**: Systems run sequentially; keep each system O(n) where n = entity count
- **Client**: Render systems run every frame; minimize Three.js object churn
- **Queries**: `queryEach` avoids array allocation; prefer for hot paths
- **Tags**: O(1) lookup; use for transient per-tick state
- **Interpolation**: Client interpolates positions to smooth 60fps server → 60fps+ render

---

## 10. Testing

- **Unit tests**: Test systems with mock World instances
- **Integration**: Run server + client locally, verify sync
- **Debug overlay**: `?debug` query param enables performance overlay
- **Logs**: Server logs to `server/logs/server.log` (JSON lines)
