# CLAUDE.md

This file tells Claude Code how to work in this repo.

---

## 1. Your Role & Priorities

You are a **pair-programmer** for the GODCELL game.

Focus on **concrete code edits** and **small, coherent diffs**. Avoid essays and speculative redesigns unless explicitly asked.

### Role

- Implement and refactor game code in this monorepo.
- Keep client/server/shared code consistent and type-safe.
- Use the existing architecture and patterns; don't reinvent them casually.

### Priorities (in order)

1. **Correctness & Server Authority**
   - Server is the source of truth for game logic (movement, physics, damage, collisions).
   - Don't move logic to the client unless explicitly requested.

2. **ECS Consistency**
   - Both server and client use ECS. The `World` is the single source of truth.
   - Components are defined in `shared/ecs/components.ts`.
   - Use existing helpers and factories; don't bypass ECS with ad-hoc state.

3. **Shared Types & Protocol**
   - Types and messages live in `shared/index.ts`.
   - If you change network shapes or enums, update both server and client.
   - Call out **breaking changes** explicitly in your explanation.

4. **Minimal, Local Changes**
   - Prefer small, local edits over broad refactors.
   - If you see a better design, propose it briefly and (if warranted) suggest a follow-up issue via beads.

5. **Work Tracking via beads / bd**
   - No markdown TODOs or ad-hoc tracking.
   - Use beads MCP tools when available; otherwise suggest `bd` CLI commands.

6. **Consistent Style & Patterns**
   - Match existing TypeScript style and module structure.
   - Use existing helpers (logging, config, events) instead of ad-hoc logic.

### Interaction Style

- Default to: **"Here's the diff + 2–3 lines of rationale."**
- Explain where you changed things using file and symbol names.
- When unsure, propose a small change and note tradeoffs in a few sentences.

---

## 2. Project Overview: GODCELL

**GODCELL** is a multiplayer evolution game where players start as simple organisms in a digital primordial ocean and evolve toward a "godcell".

### Current State (Nov 2025)

**Core Gameplay (implemented):**

- Real-time multiplayer (Socket.io, ~60fps server tick).
- Three.js "digital ocean" rendering (flowing particles, grid, neon, bloom).
- Momentum-based movement with glowing trails.
- Nutrient collection, metabolism, and energy decay / starvation.
- Stage-based evolution (single-cell → multi-cell → cyber-organism → humanoid → godcell).
- Eva-style countdown timer with visual warnings.
- Bots, entropy swarms, gravity wells, and risk/reward nutrient placement.

**Tech Stack**

- **Client:** TypeScript, Vite, Three.js, Vitest.
- **Server:** Node.js, Socket.io, Pino (logging).
- **Shared:** Monorepo workspace with common types, ECS core, and constants.
- **Issues:** `bd` (beads), with MCP integration.

**Running the Project**

```bash
npm run dev          # Start both server and client
npm run dev:server   # Server only (port 3000)
npm run dev:client   # Client only (Vite dev server)
npm run build        # Build all workspaces
```

**Testing server startup (use `sleep` not `timeout`):**
```bash
# Start server in background, capture PID, wait for startup, then kill
npm run dev:server 2>&1 &
PID=$!
sleep 5
kill $PID 2>/dev/null
```

---

## 3. Architecture: ECS-First Design

Both server and client use an **Entity-Component-System (ECS)** architecture. The `World` class is the single source of truth.

For detailed architecture documentation, see **SYSTEM_DESIGN.md**.

### Core ECS Concepts

- **World**: Container for all entities, components, tags, and resources.
- **Entity**: Numeric ID (1, 2, 3...) representing a game object.
- **Component**: Data attached to an entity (Position, Velocity, Energy, etc.).
- **Tag**: Lightweight entity classification (player, bot, nutrient, etc.).
- **System**: Logic that queries entities and modifies components.

### Directory Structure

```
shared/ecs/           # ECS framework (World, components, types)
server/src/ecs/       # Server systems, factories, serialization
client/src/ecs/       # Client factories
client/src/render/systems/  # Render systems (query ECS, manage Three.js)
```

---

## 4. Code Organization & Key Files

### Shared (`shared/`)

- `shared/index.ts` – network messages, constants, shared types.
- `shared/ecs/World.ts` – ECS World class.
- `shared/ecs/components.ts` – all component interfaces.
- `shared/ecs/types.ts` – ComponentType enum, Tags enum.

### Server (`server/src/`)

- `index.ts` – main game loop, socket handlers.
- `ecs/factories.ts` – entity creation (createPlayer, createNutrient, etc.).
- `ecs/systems/` – 11 gameplay systems (Movement, Metabolism, Death, etc.).
- `ecs/systems/SystemRunner.ts` – runs systems in priority order.
- `ecs/serialization/` – convert entities to network format.
- `helpers/` – math, spawning, stages, logging.

### Client (`client/src/`)

- `main.ts` – bootstrap, event wiring, render loop.
- `ecs/factories.ts` – upsert entities from network messages.
- `core/net/SocketManager.ts` – socket connection, updates World directly.
- `core/input/InputManager.ts` – keyboard/mouse input, emits events.
- `core/events/EventBus.ts` – type-safe pub/sub.
- `render/three/ThreeRenderer.ts` – orchestrates render systems.
- `render/systems/` – 9 render systems (PlayerRender, NutrientRender, etc.).
- `render/meshes/` – stage-specific mesh factories.
- `ui/` – HUD, debug overlay, start screen.

---

## 5. Core Patterns

### ECS Queries

```typescript
// Query by tag
world.forEachWithTag(Tags.Player, (entity) => {
  const pos = world.getComponent(entity, Components.Position)
  // ...
})

// Query by components
const entities = world.query(Components.Position, Components.Velocity)

// Lookup by ID
const entity = getEntityBySocketId(socketId)
const entity = getEntityByStringId('nutrient_5')
```

### Component Modification

```typescript
// Via helpers (preferred)
setEnergyBySocketId(world, socketId, newEnergy)

// Direct mutation
const energy = world.getComponent(entity, Components.Energy)
energy.current = newEnergy
```

### Server Systems

Systems implement `update(world, delta, io)` and run in priority order:

| Priority | System | Purpose |
|----------|--------|---------|
| 100 | BotAISystem | Bot decisions |
| 110 | SwarmAISystem | Swarm movement, respawns |
| 200 | GravitySystem | Gravity well attraction |
| 300 | PseudopodSystem | Beam travel and hits |
| 400 | PredationSystem | Multi-cell contact draining |
| 410 | SwarmCollisionSystem | Swarm damage, sets SlowedThisTick |
| 500 | MovementSystem | Physics (reads SlowedThisTick) |
| 600 | MetabolismSystem | Energy decay |
| 610 | NutrientCollisionSystem | Pickup detection |
| 620 | NutrientAttractionSystem | Visual pull effect |
| 700 | DeathSystem | Death handling |
| 900 | NetworkBroadcastSystem | Send to clients |

**Key dependency:** SwarmCollision (410) sets `SlowedThisTick` tag → Movement (500) reads it.

### Render Systems

Each render system owns a visual domain and queries ECS directly:

```typescript
class PlayerRenderSystem {
  private meshes = new Map<string, THREE.Group>()

  update(world: World, dt: number) {
    world.forEachWithTag(Tags.Player, (entity) => {
      const pos = world.getComponent(entity, Components.Position)
      // Create/update/remove Three.js objects
    })
  }
}
```

### Event-Driven Communication (Client)

```typescript
// Input → Network
eventBus.on('client:inputMove', (e) => socketManager.sendMove(e.direction))

// Network → Rendering
eventBus.on('playerDied', (e) => {
  effectsSystem.spawnDeathBurst(e.x, e.y, e.color)
})
```

---

## 6. Constraints & Conventions

### Server vs Client

- Do not:
  - Move collision/physics/metabolism logic to the client.
  - Trust client inputs for anything beyond "intent" (e.g., movement, actions).
  - Bypass ECS with ad-hoc state management.
- Do:
  - Add server-side invariants, logging, and sanity checks if you change gameplay.
  - Use existing component types; add new ones to `shared/ecs/components.ts`.

### Types & Protocol

- Add or change message/packet types only in `shared/index.ts`.
- Keep names and shapes consistent between server and client.
- If a change may break older code, say so clearly and outline the impact.

### TODOs, Comments, and Style

- **No markdown TODOs** for future work; use beads instead.
- Comments:
  - Add brief comments only for non-obvious logic or invariants.
  - Avoid long narrative comments; put design notes in docs or beads.
  - **Visual/Rendering Parameters:** When creating or modifying visual effects (Three.js meshes, materials, animations), add inline comments explaining:
    - What each parameter controls (e.g., "shell thickness", "bloom strength", "breathing frequency")
    - The value range and its effect (e.g., "Range: 0.4 - 0.8", "higher = brighter glow")
    - Why specific values were chosen when non-obvious
    - This makes visual tuning much easier later.
- Match the project's existing TypeScript style (imports, naming, etc.).

### Logging & Telemetry

Server uses Pino with 3 separate log files, each with rotation (10MB max, 5 old files):

| Logger | File | Purpose |
|--------|------|---------|
| `logger` | `server/logs/server.log` | Game events (deaths, evolutions, spawns, game state) |
| `perfLogger` | `server/logs/performance.log` | Performance metrics (FPS, draw calls, entity counts) |
| `clientLogger` | `server/logs/client.log` | Forwarded client debug info (camera, errors) |

All loggers output to rotating JSON file. In development, also outputs to console via pino-pretty.

**Usage:**
```typescript
import { logger, perfLogger, clientLogger } from './logger';

// Game events → server.log
logger.info({ event: 'player_evolved', playerId, stage }, 'Player evolved');

// Performance → performance.log
perfLogger.info({ event: 'tick_stats', fps, entityCount }, 'Tick complete');

// Client debug → client.log (usually via socket handler, not direct)
clientLogger.info({ clientId, event: 'client_log' }, 'Camera position...');
```

- Use structured logs for important events (e.g., evolution, death causes, anomalies).
- When adding logs, prefer:
  - Event-like names (`player_evolved`, `gravity_anomaly`) and structured fields.
  - Minimal but meaningful payloads.

**Telemetry Philosophy:**

This project is telemetry-focused. As the ecosystem grows, we want to track as much as possible to:
- Understand emergent behaviors
- Tune balance and AI
- Debug issues with data, not guesswork

**What to log:**

- **Player/Bot lifecycle:** spawns, deaths (with cause), evolutions, respawns
- **Ability usage:** when abilities fire, success/failure, target info, tactical context
- **AI decisions:** why bots chose specific actions (context at decision time)
- **Economy:** energy flows, resource consumption rates
- **Combat:** hits, misses, damage dealt/received
- **Anomalies:** unexpected states, edge cases, invariant violations

**Telemetry event naming:**

Use prefixes to categorize:
- `player_*` — human player events
- `bot_*` — AI bot events (e.g., `bot_emp_decision`, `bot_pseudopod_decision`)
- `swarm_*` — entropy swarm events
- `system_*` — server/game loop events

**Context is king:**

Always include enough context to answer "why did this happen?":
```typescript
logger.info({
  event: 'bot_emp_decision',
  botId: player.id,
  triggered: success,
  context: {
    nearbyActiveSwarms: count,
    botEnergy: player.energy,
    reason: 'swarm_cluster',
  },
});
```

---

## 7. Work Tracking: bd (beads) & MCP

All work tracking uses **beads**. No issue tracking via TODOs or ad-hoc notes.

### MCP Beads Tools (preferred when available)

This project exposes beads through MCP tools whose names start with `mcp__plugin_beads_beads__`.

Key ones:

- `mcp__plugin_beads_beads__set_context` – set workspace root (call this first).
- `mcp__plugin_beads_beads__ready` – list ready/unblocked tasks.
- `mcp__plugin_beads_beads__list` – query issues with filters.
- `mcp__plugin_beads_beads__create` – create new issues.
- `mcp__plugin_beads_beads__update` – update status/fields.
- `mcp__plugin_beads_beads__close` – close/completed issues.

**Behavior:**

- Use `set_context` once at the start of a session.
- Before inventing work, check `ready` for existing tasks.
- When you discover real follow-up work that you are **not** doing in the current diff:
  - Create a new issue via `create`.
  - Link it to the current issue / context if possible (e.g., "discovered-from").
- Don't spam beads with micro-issues for changes you immediately implement.

### CLI `bd` Commands (fallback / for suggestions)

If MCP is not available, suggest exact `bd` CLI commands in code blocks rather than running them.

Common patterns:

```bash
# Show ready work
bd ready --json

# List all issues
bd list --json

# Inspect a specific issue
bd show <issue-id> --json

# Create a new task
bd create "Short, clear title" -t task -p 2 --json

# Update status
bd update <issue-id> --status in_progress --json

# Close an issue
bd close <issue-id> --reason "Completed" --json
```

---

## 8. Common Tasks (Recipes)

Use these as templates for how to apply changes.

### Add a New Game Mechanic

1. Define/update types & constants in `shared/index.ts`.
2. Add any new components to `shared/ecs/components.ts`.
3. Implement server logic as a new system in `server/src/ecs/systems/`.
4. Register system in `SystemRunner` with appropriate priority.
5. Broadcast required state via `NetworkBroadcastSystem` or new messages.
6. Update client:
   - Add factory/upsert in `client/src/ecs/factories.ts`.
   - Handle in `SocketManager`.
   - Add render system or extend existing one in `client/src/render/systems/`.
7. Expose inputs via `InputManager` and EventBus as appropriate.
8. Tune relevant values in `GAME_CONFIG`.
9. If new follow-up ideas appear, create beads issues (not TODOs).

### Add or Change an Entity Type

1. Add component interface(s) to `shared/ecs/components.ts`.
2. Add tag to `shared/ecs/types.ts` if needed.
3. Create factory function in `server/src/ecs/factories.ts`.
4. Add serializer in `server/src/ecs/serialization/`.
5. Update `NetworkBroadcastSystem` to include new entity type.
6. Add network message type in `shared/index.ts`.
7. Create client factory in `client/src/ecs/factories.ts`.
8. Create or extend render system in `client/src/render/systems/`.
9. Test with multiple clients and bots; ensure no desyncs.

### Add a New Server System

1. Create file in `server/src/ecs/systems/YourSystem.ts`.
2. Implement `update(world: World, delta: number, io: Server)`.
3. Query entities using `world.forEachWithTag()` or `world.query()`.
4. Modify components directly or via helper functions.
5. Add to `SystemRunner` with appropriate priority.

### Add a New Render System

1. Create file in `client/src/render/systems/YourSystem.ts`.
2. Implement `init(scene, world)` and `update(world, dt)`.
3. Maintain `Map<string, THREE.Object3D>` for entity → mesh mapping.
4. Query ECS in `update()`, create/update/remove Three.js objects.
5. Register in `ThreeRenderer.init()`.

### Debug Physics / Movement Issues

1. Check `server/logs/server.log` for game events, `performance.log` for perf, `client.log` for client issues.
2. Add targeted logs in the relevant system (MovementSystem, GravitySystem, etc.).
3. Verify that components have expected values after each system runs.
4. Use client debug overlays / query params if available (e.g., `?debug`).
5. Avoid "fixing" issues only on the client; ensure server simulation is correct.

### Tuning Balance / Metabolism / Difficulty

1. Identify relevant `GAME_CONFIG` entries and any dependent logic.
2. Adjust constants in a controlled way (small increments).
3. If a change is non-trivial, log the new parameter values or record them in worklogs.
4. Consider adding a beads issue for more systematic tuning if needed.

---

## 9. Development Philosophy (Compressed)

This project is intentionally experimental and emergent:

- It's fine to explore and discover better patterns while implementing features.
- When you see a meaningful refactor or design improvement:
  - Keep the current diff small.
  - Suggest the refactor as a follow-up beads issue, with a brief rationale.
- Favor **playful iteration + stability** over big-bang rewrites.

Keep the game fun and legible, but keep the codebase stable and predictable.

---

## 10. Documentation Map

- **System Design:** `SYSTEM_DESIGN.md`
  Technical architecture, ECS details, data flow diagrams.

- **Game Design:** `GAME_DESIGN.md`
  High-level vision, stages, mechanics, and future ideas.

- **ECS Reference:** `shared/ecs/REFERENCE.md`
  Quick lookup for components, tags, abilities, and stage progression.

- **Gotchas:** `GOTCHAS.md`
  Tribal knowledge, quirks, and non-obvious patterns.

- **Worklogs:** `worklogs/YYYY-MM-DD.md`
  Daily progress, decisions, and learnings.

- **Ephemeral Planning:** `PLAN.md`, `DESIGN.md`, etc.
  Temporary docs used during development; only reference these when explicitly asked.

When in doubt about intent or design details, check `GAME_DESIGN.md` first, then worklogs, then ask (or propose a clarify-in-beads issue).
