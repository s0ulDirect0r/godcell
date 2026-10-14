# GODCELL Server Rewrite: Node.js/TypeScript → Rust/Bevy

**Created**: 2025-12-27
**Status**: Planning
**Scope**: Full server rewrite from TypeScript/Node.js/Socket.IO to Rust/Bevy/WebSocket

---

## Executive Summary

| Metric | Current (TypeScript) | Target (Rust/Bevy) |
|--------|---------------------|-------------------|
| Server LOC | ~18,000 | ~12,000 (estimated) |
| ECS Framework | Custom | Bevy ECS (battle-tested) |
| Networking | Socket.IO | tokio + tungstenite |
| Tick Rate | 60 fps | 60 fps |
| Systems | 23 | 23 (1:1 mapping) |
| Components | ~25 | ~25 |
| Entity Types | 13 | 13 |

## Migration Philosophy

1. **Protocol Compatibility**: Keep JSON message format identical so TypeScript client works with Rust server
2. **Incremental Verification**: Each PR produces a runnable server that passes specific integration tests
3. **Session-Scoped PRs**: Each PR fits in ~1 context window (5-10 files, <2000 lines changed)
4. **Feature Parity Before Optimization**: Get it working, then make it fast

---

# PHASE 0: Foundation & Infrastructure
*Setup Rust workspace, Bevy headless, and basic structure*

---

## PR 0.1: Rust Workspace Scaffolding
**Session Goal**: Create the Rust workspace with proper Cargo configuration

**Files Created:**
```
server-rs/
├── Cargo.toml              # Workspace root
├── .cargo/config.toml      # Faster linking, dev flags
├── rust-toolchain.toml     # Pin Rust version
└── crates/
    ├── godcell-server/
    │   ├── Cargo.toml      # Main binary crate
    │   └── src/
    │       └── main.rs     # Entry point (prints "GODCELL Server starting")
    ├── godcell-shared/
    │   ├── Cargo.toml      # Shared types crate
    │   └── src/
    │       └── lib.rs      # Re-exports
    └── godcell-protocol/
        ├── Cargo.toml      # Network message types
        └── src/
            └── lib.rs      # Message enums
```

**Dependencies to Add:**
- `bevy` (with `minimal`, no render features)
- `tokio` (async runtime)
- `serde`, `serde_json` (serialization)
- `tracing`, `tracing-subscriber` (logging)

**Verification**: `cargo build` succeeds, binary prints startup message

---

## PR 0.2: Protocol Types (Client ↔ Server Messages)
**Session Goal**: Port all network message types to Rust

**Files:**
- `godcell-protocol/src/lib.rs` - Re-exports
- `godcell-protocol/src/messages.rs` - All `*Message` types
- `godcell-protocol/src/types.rs` - `Position`, `Velocity`, `Player`, `Nutrient`, etc.
- `godcell-protocol/src/enums.rs` - `EvolutionStage`, `DeathCause`, `DamageSource`

**Key Work:**
- Port ~70 message types with `#[derive(Serialize, Deserialize)]`
- Ensure field names match TypeScript (use `#[serde(rename_all = "camelCase")]`)
- Add `#[serde(skip_serializing_if = "Option::is_none")]` for optional fields

**Verification**: Unit tests that round-trip JSON matches TypeScript format

---

## PR 0.3: Bevy Headless App Skeleton
**Session Goal**: Configure Bevy for headless server operation

**Files:**
- `godcell-server/src/main.rs` - Bevy app with MinimalPlugins
- `godcell-server/src/plugin.rs` - `GodcellServerPlugin` (empty shell)
- `godcell-server/src/config.rs` - `GAME_CONFIG` equivalent
- `godcell-server/src/lib.rs` - Module structure

**Key Work:**
- `App::new()` with `MinimalPlugins` (no rendering)
- `FixedUpdate` schedule at 60 Hz
- Port `GAME_CONFIG` constants to Rust structs
- Add `tracing` logging infrastructure

**Verification**: Server runs, logs tick count every second

---

## PR 0.4: Logging Infrastructure
**Session Goal**: Pino-equivalent structured logging

**Files:**
- `godcell-server/src/logging.rs` - Log setup
- `godcell-server/src/telemetry.rs` - Performance metrics

**Key Work:**
- Configure `tracing-subscriber` with JSON output
- Create log rotation (similar to Pino's rotating file transport)
- Add performance timing utilities

**Verification**: Logs appear in `logs/server.log` with structured JSON

---

# PHASE 1: Core ECS & Entity Types
*Port components, tags, and entity factories*

---

## PR 1.1: Core Components (Position, Velocity, Energy)
**Session Goal**: Port foundational components shared by all entities

**Files:**
- `godcell-server/src/ecs/mod.rs`
- `godcell-server/src/ecs/components/mod.rs`
- `godcell-server/src/ecs/components/core.rs` - `Position`, `Velocity`, `Energy`
- `godcell-server/src/ecs/components/sphere.rs` - `SphereContext`

**Key Work:**
- Bevy components with `#[derive(Component)]`
- `Position { x: f32, y: f32, z: f32 }` (no Option, default 0)
- `Velocity { x: f32, y: f32, z: f32 }`
- `Energy { current: f32, max: f32 }`
- `SphereContext { surface_radius: Option<f32>, is_inner_surface: bool }`

**Verification**: Unit tests for component creation

---

## PR 1.2: Player Components
**Session Goal**: Port player-specific components

**Files:**
- `godcell-server/src/ecs/components/player.rs`
- `godcell-server/src/ecs/components/stage.rs`
- `godcell-server/src/ecs/components/abilities.rs`

**Components:**
- `PlayerInfo { socket_id: String, name: String, color: String }`
- `Stage { stage: EvolutionStage, is_evolving: bool, radius: f32 }`
- `Input { direction: Vec3 }`
- `Sprint { is_sprinting: bool }`
- `Stunned { until: f64 }`
- `Cooldowns { last_emp: Option<f64>, last_pseudopod: Option<f64>, ... }`
- `DamageTracking { ... }`
- `CombatSpecialization { specialization: Option<Spec>, pending: bool }`
- Marker components: `CanFireEMP`, `CanFirePseudopod`, `CanSprint`, etc.

**Verification**: Can create player entity with all components

---

## PR 1.3: World Entity Components
**Session Goal**: Port non-player entity components

**Files:**
- `godcell-server/src/ecs/components/nutrient.rs`
- `godcell-server/src/ecs/components/obstacle.rs`
- `godcell-server/src/ecs/components/swarm.rs`
- `godcell-server/src/ecs/components/pseudopod.rs`
- `godcell-server/src/ecs/components/tree.rs`

**Components:**
- `Nutrient { value, capacity_increase, multiplier, is_high_value }`
- `Obstacle { radius, strength }`
- `Swarm { size, state, target_player_id, home_position, disabled_until, ... }`
- `Pseudopod { owner_entity, width, max_distance, hit_entities, ... }`
- `Tree { radius, height, variant }`

**Verification**: Unit tests for each component

---

## PR 1.4: Stage 3+ Jungle Components
**Session Goal**: Port jungle ecosystem entity components

**Files:**
- `godcell-server/src/ecs/components/jungle.rs`

**Components:**
- `DataFruit { tree_entity, value, capacity_increase, ripeness, fallen_at }`
- `CyberBug { swarm_id, size, state, fleeing_from, home_position, value, ... }`
- `JungleCreature { variant, size, state, target_entity, territory_radius, value, ... }`
- `EntropySerpent { size, state, target_entity, home_position, heading, ... }`
- `Projectile { owner_entity, damage, capacity_steal, state, ... }`
- `Trap { owner_entity, damage, stun_duration, trigger_radius, lifetime, ... }`

**Verification**: Unit tests

---

## PR 1.5: Tags (Marker Components)
**Session Goal**: Port entity classification tags

**Files:**
- `godcell-server/src/ecs/tags.rs`

**Tags (as marker components):**
```rust
#[derive(Component)]
pub struct PlayerTag;

#[derive(Component)]
pub struct BotTag;

#[derive(Component)]
pub struct NutrientTag;

// ... etc for all 15 tags
```

**Also:**
- `SlowedThisTick` (transient, cleared each tick)
- `DamagedThisTick` (transient)

**Verification**: Queries using tags work correctly

---

## PR 1.6: Entity Factories & Lookups
**Session Goal**: Port entity creation functions and ID lookups

**Files:**
- `godcell-server/src/ecs/factories/mod.rs`
- `godcell-server/src/ecs/factories/player.rs`
- `godcell-server/src/ecs/factories/world_entities.rs`
- `godcell-server/src/ecs/factories/jungle_entities.rs`
- `godcell-server/src/ecs/lookup.rs` - Entity ↔ ID bidirectional maps

**Key Work:**
- `spawn_player(commands, socket_id, name, color, position, stage)`
- `spawn_nutrient(commands, id, position, value, ...)`
- `spawn_obstacle(commands, id, position, radius, strength)`
- ... etc for all 13 entity types
- `EntityLookup` resource with `HashMap<String, Entity>` and reverse

**Verification**: Can spawn each entity type, lookup by ID

---

## PR 1.7: Entity Serialization (ECS → Network)
**Session Goal**: Convert Bevy entities to network message format

**Files:**
- `godcell-server/src/ecs/serialization/mod.rs`
- `godcell-server/src/ecs/serialization/player.rs`
- `godcell-server/src/ecs/serialization/world.rs`
- `godcell-server/src/ecs/serialization/jungle.rs`

**Key Work:**
- `serialize_player(entity, world) -> Player` (network type)
- `serialize_nutrient(entity, world) -> Nutrient`
- ... etc for all entity types
- `build_world_snapshot(world) -> WorldSnapshotMessage`

**Verification**: Serialized output matches TypeScript format exactly

---

# PHASE 2: Movement & Physics
*Port physics systems - gravity, movement, sphere math*

---

## PR 2.1: Sphere Math Utilities
**Session Goal**: Port 3D sphere geometry functions

**Files:**
- `godcell-shared/src/math.rs`
- `godcell-shared/src/sphere_math.rs`

**Functions:**
- `geodesic_distance(p1, p2, radius)` - Great-circle distance
- `tangent_velocity(position, velocity, radius)` - Project velocity to sphere surface
- `project_to_sphere(position, radius)` - Snap position to sphere surface
- `fibonacci_sphere_point(index, total, radius)` - Uniform distribution
- `get_random_sphere_position(radius)` - Random point on sphere
- `slerp(p1, p2, t, radius)` - Spherical interpolation

**Verification**: Unit tests match TypeScript implementation

---

## PR 2.2: GravitySystem
**Session Goal**: Port gravity well attraction

**Files:**
- `godcell-server/src/systems/gravity.rs`

**Logic:**
- Query entities with `Position` + `Velocity`
- For each obstacle, apply attraction force
- Use geodesic distance on sphere surface
- Handle spawn immunity component

**Verification**: Player moves toward gravity well correctly

---

## PR 2.3: MovementSystem
**Session Goal**: Port sphere-surface movement physics

**Files:**
- `godcell-server/src/systems/movement.rs`

**Logic:**
- Apply input direction to velocity (with speed multiplier by stage)
- Apply knockback forces
- Project velocity to sphere tangent
- Integrate position
- Project position back to sphere surface
- Handle `SlowedThisTick` tag (swarm debuff)
- Handle sprint speed bonus

**Verification**: Player moves correctly on sphere surface

---

## PR 2.4: GodcellFlightSystem
**Session Goal**: Port Stage 5 3D flight

**Files:**
- `godcell-server/src/systems/godcell_flight.rs`

**Logic:**
- Only affects Stage 5 players
- Transform input by camera facing
- Move freely in 3D space (not constrained to sphere)
- Handle phase shift (Intangible component)

**Verification**: Godcell can fly off sphere surface

---

## PR 2.5: TreeCollisionSystem
**Session Goal**: Port tree collision for jungle players

**Files:**
- `godcell-server/src/systems/tree_collision.rs`

**Logic:**
- Only affects Stage 3+ players
- Push players out of tree collision radius
- Trees are solid obstacles in jungle sphere

**Verification**: Cyber-organism cannot walk through trees

---

# PHASE 3: Networking
*WebSocket server and client communication*

---

## PR 3.1: WebSocket Server Foundation
**Session Goal**: Tokio-based WebSocket server accepting connections

**Files:**
- `godcell-server/src/network/mod.rs`
- `godcell-server/src/network/server.rs`
- `godcell-server/src/network/connection.rs`

**Key Work:**
- `tokio-tungstenite` WebSocket server on port 3000
- Connection manager tracking active sockets
- Channel-based message passing to/from game thread
- Connection/disconnection events

**Verification**: Can connect with WebSocket client, see connection log

---

## PR 3.2: Message Parsing & Routing
**Session Goal**: Parse incoming JSON messages and route to handlers

**Files:**
- `godcell-server/src/network/handler.rs`
- `godcell-server/src/network/events.rs`

**Key Work:**
- Parse `playerMove`, `playerRespawnRequest`, `pseudopodFire`, etc.
- Convert to Bevy events: `PlayerMoveEvent`, `PseudopodFireEvent`, etc.
- Handle unknown message types gracefully

**Verification**: Player movement messages update Input component

---

## PR 3.3: NetworkBroadcastSystem
**Session Goal**: Port state broadcasting to clients

**Files:**
- `godcell-server/src/systems/network_broadcast.rs`

**Logic:**
- Runs last each tick (priority 900)
- Serialize all entities to `GameStateMessage`
- Send to all connected clients
- Track changed entities for delta compression (future optimization)

**Verification**: Client receives full game state each tick

---

## PR 3.4: Event Messages (Deaths, Evolutions, etc.)
**Session Goal**: Send discrete event messages

**Files:**
- `godcell-server/src/network/events.rs` (extend)
- `godcell-server/src/systems/network_events.rs`

**Messages to send:**
- `playerJoined`, `playerLeft`, `playerDied`, `playerRespawned`
- `playerEvolutionStarted`, `playerEvolved`
- `nutrientSpawned`, `nutrientCollected`
- `swarmSpawned`, `swarmMoved`, `swarmConsumed`
- ... etc

**Verification**: Client receives event messages, shows death effects

---

## PR 3.5: World Snapshot on Connect
**Session Goal**: Send initial world state to new connections

**Files:**
- `godcell-server/src/network/handler.rs` (extend)

**Logic:**
- On new connection, spawn player entity
- Build `WorldSnapshotMessage` with all entities
- Send to new client
- Broadcast `playerJoined` to others

**Verification**: New client sees existing world state

---

# PHASE 4: Combat & Abilities
*Port ability systems - EMP, Pseudopod, Projectile, Melee, Trap*

---

## PR 4.1: AbilityIntentSystem
**Session Goal**: Queue-based ability execution

**Files:**
- `godcell-server/src/systems/ability_intent.rs`
- `godcell-server/src/ecs/components/ability_intent.rs`

**Logic:**
- `AbilityIntent` component added by network handlers
- System processes intents each tick
- Validates cooldowns, energy costs, stage requirements
- Dispatches to specific ability handlers

**Verification**: Ability intents are processed in tick order

---

## PR 4.2: EMP Ability
**Session Goal**: Port EMP pulse ability

**Files:**
- `godcell-server/src/abilities/emp.rs`

**Logic:**
- Stage 2+ ability
- AoE stun around player
- Affects swarms (disables them, makes consumable)
- Affects other players (brief stun)
- Cooldown management

**Verification**: EMP stuns nearby swarms

---

## PR 4.3: PseudopodSystem
**Session Goal**: Port lightning beam projectile

**Files:**
- `godcell-server/src/systems/pseudopod.rs`

**Logic:**
- Stage 2+ ability
- Travel toward target position
- Check collision with entities
- Drain energy on hit
- Track hit entities (no double-hit)
- Retract after max distance

**Verification**: Beam travels, damages swarms/players

---

## PR 4.4: ProjectileSystem (Ranged Spec)
**Session Goal**: Port Stage 3 ranged specialization

**Files:**
- `godcell-server/src/systems/projectile.rs`

**Logic:**
- Stage 3+ ranged specialization only
- Homing toward target position
- Damage + capacity steal on hit
- Can hit fauna and players

**Verification**: Ranged projectile hits targets

---

## PR 4.5: Melee Abilities
**Session Goal**: Port Stage 3 melee specialization

**Files:**
- `godcell-server/src/abilities/melee.rs`

**Logic:**
- Swipe: Arc attack in front of player
- Thrust: Linear attack with more range
- Apply knockback on hit
- Cooldown per attack type

**Verification**: Melee attacks damage and knock back targets

---

## PR 4.6: TrapSystem
**Session Goal**: Port Stage 3 traps specialization

**Files:**
- `godcell-server/src/systems/trap.rs`

**Logic:**
- Place trap at position (looks like DataFruit)
- Trigger radius detection
- On trigger: damage + stun
- Lifetime expiration

**Verification**: Trap detonates when enemy approaches

---

# PHASE 5: AI Systems
*Port bot and NPC AI*

---

## PR 5.1: BotAISystem
**Session Goal**: Port player bot decision-making

**Files:**
- `godcell-server/src/systems/bot_ai.rs`

**Logic:**
- Target selection (nutrients, prey, threats)
- Steering behaviors (seek, flee, wander)
- Stage-appropriate behavior (Stage 1 eats nutrients, Stage 2+ hunts)
- Ability usage decisions (when to EMP, fire beams)

**Verification**: Bots navigate and collect nutrients

---

## PR 5.2: SwarmAISystem
**Session Goal**: Port entropy swarm behavior

**Files:**
- `godcell-server/src/systems/swarm_ai.rs`

**Logic:**
- Patrol behavior (wander near home position)
- Chase behavior (detect and pursue players)
- State transitions
- Handle disabled state (consumable after EMP)

**Verification**: Swarms patrol and chase players

---

## PR 5.3: CyberBugAISystem
**Session Goal**: Port Stage 3 prey behavior

**Files:**
- `godcell-server/src/systems/cyberbug_ai.rs`

**Logic:**
- Swarm grouping behavior
- Flee when player approaches
- Return to patrol when safe

**Verification**: Bugs flee from approaching players

---

## PR 5.4: JungleCreatureAISystem
**Session Goal**: Port larger fauna behavior

**Files:**
- `godcell-server/src/systems/jungle_creature_ai.rs`

**Logic:**
- Grazer: Passive, flees when attacked
- Stalker: Hunts smaller entities
- Ambusher: Waits in territory, attacks on proximity

**Verification**: Each variant behaves correctly

---

## PR 5.5: EntropySerpentAISystem
**Session Goal**: Port apex predator behavior

**Files:**
- `godcell-server/src/systems/entropy_serpent_ai.rs`

**Logic:**
- Aggressive hunting of Stage 3+ players
- Patrol territory
- Chase and attack behavior
- Attack cooldown

**Verification**: Serpent aggressively hunts players

---

# PHASE 6: Collision & Resource Systems
*Port collision detection and resource management*

---

## PR 6.1: PredationSystem
**Session Goal**: Port player-player predation

**Files:**
- `godcell-server/src/systems/predation.rs`

**Logic:**
- Multi-cell (Stage 2+) can drain smaller stages on contact
- Energy transfer from prey to predator
- Drain rate based on size difference

**Verification**: Multi-cell drains single-cell on contact

---

## PR 6.2: SwarmCollisionSystem
**Session Goal**: Port swarm damage to players

**Files:**
- `godcell-server/src/systems/swarm_collision.rs`

**Logic:**
- Swarm collision detection
- Apply damage to player
- Set `SlowedThisTick` tag
- Handle swarm consumption (when disabled)

**Verification**: Swarms damage and slow players

---

## PR 6.3: NutrientCollisionSystem
**Session Goal**: Port nutrient collection

**Files:**
- `godcell-server/src/systems/nutrient_collision.rs`

**Logic:**
- Stage 1-2 can collect nutrients
- Add energy and capacity
- Despawn nutrient
- Trigger respawn timer

**Verification**: Player collects nutrients, gains energy

---

## PR 6.4: MacroResourceCollisionSystem
**Session Goal**: Port Stage 3+ resource collection

**Files:**
- `godcell-server/src/systems/macro_resource_collision.rs`

**Logic:**
- Collect DataFruits
- Kill CyberBugs
- Kill JungleCreatures
- Damage EntropySerpents

**Verification**: Cyber-organism collects jungle resources

---

# PHASE 7: Lifecycle Systems
*Port death, evolution, metabolism, respawn*

---

## PR 7.1: MetabolismSystem
**Session Goal**: Port energy decay

**Files:**
- `godcell-server/src/systems/metabolism.rs`

**Logic:**
- Passive energy decay over time
- Sprint energy cost
- Stage-specific decay rates

**Verification**: Player energy decreases over time

---

## PR 7.2: DeathSystem
**Session Goal**: Port death detection and handling

**Files:**
- `godcell-server/src/systems/death.rs`

**Logic:**
- Check for zero energy
- Determine death cause
- Clean up entity (or mark for respawn)
- Emit death event

**Verification**: Player dies when energy reaches 0

---

## PR 7.3: RespawnSystem
**Session Goal**: Port deferred respawning

**Files:**
- `godcell-server/src/systems/respawn.rs`

**Logic:**
- Process `PendingRespawn` components
- Check timestamp, spawn entity when ready
- Handle bot, swarm, nutrient respawns

**Verification**: Dead bots respawn after delay

---

## PR 7.4: Evolution Detection
**Session Goal**: Port stage evolution triggers

**Files:**
- `godcell-server/src/systems/evolution.rs`

**Logic:**
- Check maxEnergy thresholds
- Trigger evolution animation
- Update stage and abilities
- Handle Stage 3 specialization prompt

**Verification**: Player evolves when reaching energy thresholds

---

## PR 7.5: SpecializationSystem
**Session Goal**: Port Stage 3 specialization timeout

**Files:**
- `godcell-server/src/systems/specialization.rs`

**Logic:**
- Track pending specialization deadlines
- Auto-assign random on timeout
- Emit selection message

**Verification**: Specialization auto-assigned after 10s

---

## PR 7.6: DataFruitSystem
**Session Goal**: Port fruit ripening lifecycle

**Files:**
- `godcell-server/src/systems/data_fruit.rs`

**Logic:**
- Increase ripeness over time
- Handle fallen fruit decay
- Fruit spawning on trees

**Verification**: Fruits ripen and can be collected

---

# PHASE 8: World Initialization & Testing
*Port world setup and comprehensive testing*

---

## PR 8.1: Obstacle Initialization
**Session Goal**: Port gravity well spawning

**Files:**
- `godcell-server/src/world/obstacles.rs`

**Logic:**
- Poisson disc sampling on sphere
- Minimum separation enforcement
- Create obstacle entities

**Verification**: ~40 obstacles spawn on sphere

---

## PR 8.2: Tree Initialization
**Session Goal**: Port jungle tree spawning

**Files:**
- `godcell-server/src/world/trees.rs`

**Logic:**
- Fibonacci sphere distribution
- Random size variation
- Create tree entities

**Verification**: 200 trees spawn on jungle sphere

---

## PR 8.3: Nutrient Initialization
**Session Goal**: Port nutrient spawning with zone coloring

**Files:**
- `godcell-server/src/world/nutrients.rs`

**Logic:**
- Avoid gravity well centers
- Calculate value multiplier by proximity
- Create nutrient entities

**Verification**: Nutrients spawn with correct colors

---

## PR 8.4: Swarm & Fauna Initialization
**Session Goal**: Port NPC spawning

**Files:**
- `godcell-server/src/world/npcs.rs`

**Logic:**
- Swarm spawning
- CyberBug swarm spawning
- JungleCreature spawning
- EntropySerpent spawning

**Verification**: All NPCs spawn correctly

---

## PR 8.5: Bot Initialization
**Session Goal**: Port bot player spawning

**Files:**
- `godcell-server/src/world/bots.rs`

**Logic:**
- Spawn bots at various stages
- Register in entity lookup
- Start bot AI

**Verification**: Bots spawn and behave

---

## PR 8.6: Integration Tests
**Session Goal**: Comprehensive test suite

**Files:**
- `godcell-server/tests/integration/`
  - `connection_test.rs`
  - `movement_test.rs`
  - `combat_test.rs`
  - `evolution_test.rs`

**Tests:**
- Client connects, receives world snapshot
- Player movement on sphere
- Combat interactions
- Evolution thresholds

**Verification**: All tests pass

---

## PR 8.7: Performance Benchmarks
**Session Goal**: Verify performance targets

**Files:**
- `godcell-server/benches/`
  - `tick_benchmark.rs`
  - `serialization_benchmark.rs`

**Targets:**
- 60 fps with 100 players + 1000 entities
- < 5ms per tick at peak load

**Verification**: Benchmarks pass thresholds

---

## PR 8.8: Dev Panel Support
**Session Goal**: Port development tools

**Files:**
- `godcell-server/src/dev/mod.rs`
- `godcell-server/src/dev/commands.rs`

**Commands:**
- Spawn entities
- Teleport players
- Set energy/stage
- Pause/step

**Verification**: Dev panel works with Rust server

---

# PHASE 9: Cutover & Deployment

---

## PR 9.1: Feature Flag Toggle
**Session Goal**: Runtime switch between TS and Rust servers

**Files:**
- Environment variable `USE_RUST_SERVER=true`
- Docker compose with both servers
- Load balancer routing

**Verification**: Can switch servers without client changes

---

## PR 9.2: Monitoring & Alerting
**Session Goal**: Production observability

**Files:**
- Prometheus metrics endpoint
- Grafana dashboards
- Health check endpoints

**Verification**: Metrics visible in monitoring

---

## PR 9.3: Documentation
**Session Goal**: Update docs for Rust server

**Files:**
- `server-rs/README.md`
- `SYSTEM_DESIGN.md` updates
- `CLAUDE.md` updates for Rust

**Verification**: New devs can build and run

---

## PR 9.4: TypeScript Server Deprecation
**Session Goal**: Final cutover

**Work:**
- Remove `server/` directory
- Update CI/CD
- Update deployment configs

**Verification**: Production running on Rust

---

# Summary

| Phase | PRs | Estimated Sessions |
|-------|-----|-------------------|
| Phase 0: Foundation | 4 | 4 |
| Phase 1: ECS & Entities | 7 | 7 |
| Phase 2: Movement | 5 | 5 |
| Phase 3: Networking | 5 | 5 |
| Phase 4: Combat | 6 | 6 |
| Phase 5: AI | 5 | 5 |
| Phase 6: Collisions | 4 | 4 |
| Phase 7: Lifecycle | 6 | 6 |
| Phase 8: Init & Testing | 8 | 8 |
| Phase 9: Cutover | 4 | 4 |
| **Total** | **54 PRs** | **54 sessions** |

Each PR is designed to be:
1. **Self-contained**: Complete without prior context
2. **Testable**: Has clear verification criteria
3. **Session-scoped**: ~1-2 hours of focused work
4. **Context-independent**: Can be done after compaction

---

# Appendix: Current System Reference

## Current Server Systems (Priority Order)

| Priority | System | Responsibility |
|----------|--------|----------------|
| 50 | RespawnSystem | Process pending respawns |
| 100 | BotAISystem | Bot decision-making |
| 105 | CyberBugAISystem | Prey AI |
| 106 | JungleCreatureAISystem | Fauna AI |
| 107 | EntropySerpentAISystem | Apex predator AI |
| 110 | SwarmAISystem | Swarm movement |
| 120 | SpecializationSystem | Stage 3 spec timeout |
| 150 | DataFruitSystem | Fruit ripening |
| 200 | GravitySystem | Gravity well attraction |
| 250 | AbilityIntentSystem | Process ability intents |
| 300 | PseudopodSystem | Beam physics |
| 310 | ProjectileSystem | Ranged projectiles |
| 320 | TrapSystem | Trap triggers |
| 400 | PredationSystem | Player-player eating |
| 410 | SwarmCollisionSystem | Swarm damage |
| 480 | TreeCollisionSystem | Tree collision |
| 490 | GodcellFlightSystem | Stage 5 flight |
| 500 | MovementSystem | Sphere movement |
| 600 | MetabolismSystem | Energy decay |
| 610 | NutrientCollisionSystem | Nutrient pickup |
| 615 | MacroResourceCollisionSystem | Stage 3+ pickup |
| 700 | DeathSystem | Death checks |
| 900 | NetworkBroadcastSystem | State broadcasts |

## Current Components (~25)

**Core:** Position, Velocity, Energy, SphereContext

**Player:** PlayerInfo, Stage, Input, Sprint, Stunned, SpawnImmunity, Cooldowns, DamageTracking, DrainTarget, CombatSpecialization, Knockback, CameraFacing

**Abilities:** CanFireEMP, CanFirePseudopod, CanSprint, CanEngulf, CanDetect, AbilityIntent

**Entities:** Nutrient, Obstacle, Swarm, Pseudopod, Tree, DataFruit, CyberBug, JungleCreature, EntropySerpent, Projectile, Trap

**Server-only:** PendingRespawn, PendingExpiration

**Client-only:** InterpolationTarget, ClientDamageInfo

## Current Entity Types (13)

1. Player (human)
2. Bot (AI player)
3. Nutrient
4. Obstacle (gravity well)
5. Swarm (entropy swarm)
6. Pseudopod (beam projectile)
7. Tree
8. DataFruit
9. CyberBug
10. JungleCreature
11. EntropySerpent
12. Projectile
13. Trap
