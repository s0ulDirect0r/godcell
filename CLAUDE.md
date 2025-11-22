# CLAUDE.md

This file tells Claude Code how to work in this repo.

---

## 1. Your Role & Priorities

You are a **pair-programmer** for the GODCELL game.

Focus on **concrete code edits** and **small, coherent diffs**. Avoid essays and speculative redesigns unless explicitly asked.

### Role

- Implement and refactor game code in this monorepo.
- Keep client/server/shared code consistent and type-safe.
- Use the existing architecture and patterns; don’t reinvent them casually.

### Priorities (in order)

1. **Correctness & Server Authority**
   - Server is the source of truth for game logic (movement, physics, damage, collisions).
   - Don’t move logic to the client unless explicitly requested.

2. **Shared Types & Protocol**
   - Types and messages live in `shared/index.ts`.
   - If you change network shapes or enums, update both server and client.
   - Call out **breaking changes** explicitly in your explanation.

3. **Minimal, Local Changes**
   - Prefer small, local edits over broad refactors.
   - If you see a better design, propose it briefly and (if warranted) suggest a follow-up issue via beads.

4. **Work Tracking via beads / bd**
   - No markdown TODOs or ad-hoc tracking.
   - Use beads MCP tools when available; otherwise suggest `bd` CLI commands.

5. **Consistent Style & Patterns**
   - Match existing TypeScript style and module structure.
   - Use existing helpers (logging, config, events) instead of ad-hoc logic.

### Interaction Style

- Default to: **“Here’s the diff + 2–3 lines of rationale.”**
- Explain where you changed things using file and symbol names.
- When unsure, propose a small change and note tradeoffs in a few sentences.

---

## 2. Project Overview: GODCELL

**GODCELL** is a multiplayer evolution game where players start as simple organisms in a digital primordial ocean and evolve toward a “godcell”.

### Current State (Nov 2025)

**Core Gameplay (implemented):**

- Real-time multiplayer (Socket.io, ~60fps server tick).
- Three.js “digital ocean” rendering (flowing particles, grid, neon, bloom).
- Momentum-based movement with glowing trails.
- Nutrient collection, metabolism, and energy decay / starvation.
- Stage-based evolution (single-cell → multi-cell → cyber-organism → humanoid → godcell).
- Eva-style countdown timer with visual warnings.
- Bots, entropy swarms, gravity wells, and risk/reward nutrient placement.

**Tech Stack**

- **Client:** TypeScript, Vite, Three.js, Vitest.
- **Server:** Node.js, Socket.io, Pino (logging).
- **Shared:** Monorepo workspace with common types and constants.
- **Issues:** `bd` (beads), with MCP integration.

**Architecture**

- Workspaces: `client/`, `server/`, `shared/`.
- Server-authoritative loop at 60fps.
- Client:
  - `client/core` – state, events, input, networking.
  - `client/render` – Three.js renderer, postprocessing, HUD.
  - `client/ui` – debug overlays, UI widgets.
- Client interpolates and renders state; server simulates.

---

## 3. Code Organization & Patterns

### Key Files

**Shared**

- `shared/index.ts` – shared types, interfaces, constants, and network message definitions.

**Server**

- `server/src/index.ts` – main game loop (physics, metabolism, collisions, spawning).
- `server/src/bots.ts` – AI bots (steering, obstacle/swarm avoidance).
- `server/src/swarms.ts` – entropy swarm AI.
- `server/src/logger.ts` – Pino logging config and helpers.
- `server/src/...` – other feature modules as they appear.

**Client**

- `client/src/main.ts` – bootstrap and main update loop.
- `client/src/core/state/GameState.ts` – client-side game state management.
- `client/src/core/net/SocketManager.ts` – socket connection and messages.
- `client/src/core/input/InputManager.ts` – keyboard/mouse input.
- `client/src/core/events/EventBus.ts` – client-side event system.
- `client/src/render/three/ThreeRenderer.ts` – main Three.js renderer.
- `client/src/render/three/postprocessing/composer.ts` – bloom/glow config.
- `client/src/render/hud/HUDOverlay.ts` – HUD (energy, stats, timer).
- `client/src/ui/DebugOverlay.ts` – debug/perf overlay.

### Core Patterns

- **Server-authoritative:** All real game logic on the server.
- **Typed messages:** All network messages and payloads are defined in `shared/index.ts`.
- **Config:** Tunable parameters live in a `GAME_CONFIG` object (on server/shared).
- **Events:** Client subsystems talk via the EventBus; prefer that over direct cross-wiring.

---

## 4. Constraints & Conventions

### Server vs Client

- Do not:
  - Move collision/physics/metabolism logic to the client.
  - Trust client inputs for anything beyond “intent” (e.g., movement, actions).
- Do:
  - Add server-side invariants, logging, and sanity checks if you change gameplay.

### Types & Protocol

- Add or change message/packet types only in `shared/index.ts`.
- Keep names and shapes consistent between server and client.
- If a change may break older code, say so clearly and outline the impact.

### TODOs, Comments, and Style

- **No markdown TODOs** for future work; use beads instead.
- Comments:
  - Add brief comments only for non-obvious logic or invariants.
  - Avoid long narrative comments; put design notes in docs or beads.
- Match the project’s existing TypeScript style (imports, naming, etc.).

### Logging

- Server uses Pino, logs to `server/logs/server.log` as JSON lines.
- Use structured logs for important events (e.g., evolution, death causes, anomalies).
- When adding logs, prefer:
  - Event-like names (`player_evolved`, `gravity_anomaly`) and structured fields.
  - Minimal but meaningful payloads.

---

## 5. Work Tracking: bd (beads) & MCP

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
  - Link it to the current issue / context if possible (e.g., “discovered-from”).
- Don’t spam beads with micro-issues for changes you immediately implement.

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

## 6. Common Tasks (Recipes)

Use these as templates for how to apply changes.

### Add a New Game Mechanic

1. Define/update types & constants in `shared/index.ts`.
2. Implement server logic in `server/src/index.ts` or a new server module.
3. Broadcast required state via existing or new messages.
4. Update client:
   - Receive and integrate messages in `SocketManager` / `GameState`.
   - Add rendering in `ThreeRenderer` (and HUD if needed).
5. Expose inputs via `InputManager` and EventBus as appropriate.
6. Tune relevant values in `GAME_CONFIG`.
7. If new follow-up ideas appear, create beads issues (not TODOs).

### Add or Change an Entity Type (bot, swarm, obstacle, etc.)

1. Update entity definitions/types in `shared/index.ts`.
2. Extend server spawning and behavior logic (`server/src/index.ts`, `bots.ts`, `swarms.ts`, etc.).
3. Add or adjust server-side logging for lifecycle events.
4. Update client rendering and HUD to reflect new entity behavior/visibility.
5. Test with multiple clients and bots; ensure no desyncs.

### Debug Physics / Movement Issues

1. Check `server/logs/server.log` for anomalies and patterns.
2. Add targeted logs around the suspect logic (force application, collision resolution, etc.).
3. Verify that messages sent to the client match expectations.
4. Use client debug overlays / query params if available (e.g., `?debug`).
5. Avoid “fixing” issues only on the client; ensure server simulation is correct.

### Tuning Balance / Metabolism / Difficulty

1. Identify relevant `GAME_CONFIG` entries and any dependent logic.
2. Adjust constants in a controlled way (small increments).
3. If a change is non-trivial, log the new parameter values or record them in worklogs.
4. Consider adding a beads issue for more systematic tuning if needed.

---

## 7. Development Philosophy (Compressed)

This project is intentionally experimental and emergent:

- It’s fine to explore and discover better patterns while implementing features.
- When you see a meaningful refactor or design improvement:
  - Keep the current diff small.
  - Suggest the refactor as a follow-up beads issue, with a brief rationale.
- Favor **playful iteration + stability** over big-bang rewrites.

Keep the game fun and legible, but keep the codebase stable and predictable.

---

## 8. Documentation Map

- **Game Design:** `GAME_DESIGN.md`  
  High-level vision, stages, mechanics, and future ideas.

- **Worklogs:** `worklogs/YYYY-MM-DD.md`  
  Daily progress, decisions, and learnings.

- **Ephemeral Planning:** `PLAN.md`, `DESIGN.md`, etc.  
  Temporary docs used during development; only reference these when explicitly asked.

When in doubt about intent or design details, check `GAME_DESIGN.md` first, then worklogs, then ask (or propose a clarify-in-beads issue).
