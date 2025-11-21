# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads) for issue tracking. Use `bd` commands instead of markdown TODOs. See AGENTS.md for workflow details.

## Project Overview: GODCELL

**GODCELL** is a multiplayer evolution game where players begin as single-celled cyber-organisms in a digital primordial soup and evolve toward transcendence.

### Current State (November 2025)

**What's Built:**

**Core Gameplay:**
- Real-time multiplayer (Socket.io, 60fps server tick)
- Digital ocean aesthetic with Three.js rendering (flowing particles, grid, neon colors, postprocessing effects)
- Cyber-cell movement with momentum/inertia physics and glowing trails
- Nutrient collection and metabolism system
- Energy decay and starvation mechanics
- Eva-style energy countdown timer (MM:SS format, color-coded warnings)
- Evolution system (5 stages: single-cell → multi-cell → cyber-organism → humanoid → godcell)
- Death/respawn system with session statistics and manual respawn
- Expanded world (4800×3200) with stage-based camera zoom

**Stage-Specific Features:**
- **Single-Cell (Stage 1):**
  - Basic movement with momentum system
  - Simple circle sprite (24px radius)
  - 37.5s survival time without nutrients
  - Base camera zoom (1.0x)

- **Multi-Cell (Stage 2+):**
  - Star cluster sprite pattern (6 overlapping circles, 96px radius)
  - Chemical sensing detection (1800px radius with proximity-based arrows)
  - Extended viewport (1.5x camera zoom-out)
  - Improved metabolic efficiency (~2 minutes survival time)
  - Pseudopod hunting mechanic (contact predation)
  - Scaled hitboxes matching visual size

**AI & Threats:**
- 15 AI bot players with intelligent steering behaviors
- Bot obstacle and swarm avoidance (graduated threat zones)
- 18 entropy swarms (virus enemies) with chase/patrol AI
- Swarm contact applies 40% movement slow debuff
- 12 gravity distortion obstacles (mini black holes with inverse-square physics, instant-death cores)
- Risk/reward high-value nutrients near obstacles (2x/3x/5x multipliers)

**Tech Stack:**
- **Client:** TypeScript + Three.js + Vite + Vitest
- **Server:** Node.js + Socket.io (server-authoritative) + Pino (logging)
- **Shared:** Common types and constants in monorepo structure
- **Issue Tracking:** bd (beads)

**Architecture:**
- Monorepo with workspaces: `client/`, `server/`, `shared/`
- Server-authoritative game logic (movement, physics, damage, collisions)
- Client renders state with Three.js and handles input
- Clean separation: `client/core` (state, events, input, net), `client/render` (Three.js renderer, HUD), `client/ui` (debug overlay)
- EventBus for client-side event handling
- 60fps game loop on server, smooth interpolation on client

### Game Design Philosophy

This project follows an **emergent, experimental approach**:

1. **Start with exploration** - Don't over-plan; discover as you build
2. **Iterate organically** - Like sketching in art, refine through cycles
3. **Embrace serendipity** - Follow interesting tangents when they emerge
4. **Track discoveries** - Use `discovered-from` dependencies when new work emerges
5. **Keep it fluid** - This is an experiment in creative process, not production software

### Current Focus: Stage 2 Multi-Cell Mechanics

**Recently Completed:**
- Stage 1 difficulty tuning (momentum physics, AI improvements, countdown timer)
- Multi-cell evolution mechanics (size, sprites, detection, viewport scaling)
- Chemical sensing detection system with proximity-based UI
- Contact predation and pseudopod hunting

**Current Development:**
- Pseudopod visual improvements (squiggly tendril animations)
- NPC prey population for multi-cell hunting grounds
- Balancing predation mechanics (slow-drain vs instant kill)
- Stage 3+ features (cyber-organism abilities)

## Issue Tracking with bd (beads)

**All work tracking must use bd commands** - no markdown TODOs or other tracking methods.

### Essential Commands

**Check for work:**
```bash
bd ready --json                    # Show unblocked issues ready to work on
bd list --json                     # List all issues
bd show <issue-id> --json          # Show detailed info for an issue
```

**Create and manage issues:**
```bash
bd create "Issue title" -t task -p 2 --json
bd update <issue-id> --status in_progress --json
bd close <issue-id> --reason "Completed" --json
```

**Dependencies:**
```bash
bd dep <from-id> blocks <to-id> --json
bd create "New issue" --deps discovered-from:<parent-id> --json
```

### MCP Server Integration

This project has the beads MCP server configured. Use the `mcp__plugin_beads_beads__*` functions for direct database operations:

- `mcp__plugin_beads_beads__set_context` - Set workspace root (call this first!)
- `mcp__plugin_beads_beads__ready` - Get ready tasks
- `mcp__plugin_beads_beads__list` - List issues with filters
- `mcp__plugin_beads_beads__create` - Create new issues
- `mcp__plugin_beads_beads__update` - Update issue status/fields
- `mcp__plugin_beads_beads__close` - Complete issues

## Development Philosophy

This project follows an **emergent, experimental approach**:

1. **Start with exploration** - Don't over-plan; discover as you build
2. **Iterate organically** - Like sketching in art, refine through cycles
3. **Embrace serendipity** - Follow interesting tangents when they emerge
4. **Track discoveries** - Use `discovered-from` dependencies when new work emerges
5. **Keep it fluid** - This is an experiment in creative process, not production software

## Development Workflow

### Testing Locally

**Run the game:**
```bash
# Terminal 1 - Server
cd server && npm run dev

# Terminal 2 - Client
cd client && npm run dev
```

**Multiple players:** Open multiple browser tabs to `http://localhost:5173`

**Bots:** 15 AI bots spawn automatically on server start for testing

### Code Organization

**Key Files:**

**Shared:**
- `shared/index.ts` - All shared types, interfaces, constants, network messages (~370 lines)

**Server:**
- `server/src/index.ts` - Main game loop, physics, metabolism, collisions (~1200 lines)
- `server/src/bots.ts` - AI bot system with steering behaviors and avoidance (~400 lines)
- `server/src/swarms.ts` - Entropy swarm AI (chase/patrol behaviors) (~300 lines)
- `server/src/logger.ts` - Pino logging configuration and helpers

**Client:**
- `client/src/main.ts` - Bootstrap and main update loop
- `client/src/core/state/GameState.ts` - Client-side game state management
- `client/src/core/net/SocketManager.ts` - Socket.io connection and message handling
- `client/src/core/input/InputManager.ts` - Keyboard/mouse input handling
- `client/src/core/events/EventBus.ts` - Client-side event system
- `client/src/render/three/ThreeRenderer.ts` - Three.js renderer with postprocessing (~600 lines)
- `client/src/render/three/postprocessing/composer.ts` - Bloom/glow effects configuration
- `client/src/render/hud/HUDOverlay.ts` - HUD elements (energy bars, stats, timer)
- `client/src/ui/DebugOverlay.ts` - Performance metrics and debug info

**Patterns:**
- Server is authoritative for all game logic
- Client receives state updates and renders with Three.js
- Network messages typed in `shared/index.ts`
- Constants in `GAME_CONFIG` object (tunable parameters)
- Position updates at 60fps, energy/detection updates throttled
- EventBus mediates communication between client systems

### Server Logging

The server uses **Pino** for structured logging to both console and file:

**Log Files:**
- Location: `server/logs/server.log`
- Format: JSON lines (machine-parseable)
- Includes: timestamps, PIDs, event types, structured data

**Viewing Logs:**
```bash
# View recent logs
tail -50 server/logs/server.log

# View logs in real-time
tail -f server/logs/server.log

# Search for specific events
grep "player_died" server/logs/server.log
grep "event\":\"bot_respawned" server/logs/server.log

# Pretty-print JSON logs
tail -20 server/logs/server.log | jq
```

**Logged Events:**
- `server_started` - Server initialization
- `player_connected` / `player_disconnected` - Player connections
- `player_died` - Player deaths (with cause: starvation/singularity)
- `player_respawned` - Player respawns
- `player_evolved` - Evolution stage changes
- `bot_died` / `bot_respawned` - Bot lifecycle
- `bots_spawned` - Bot initialization
- `nutrients_spawned` - Nutrient initialization
- `obstacles_spawned` - Obstacle initialization
- `gravity_applied` - Debug gravity physics (level: debug)
- `singularity_crush` - Singularity deaths

**When Debugging:**
1. Check console output for immediate feedback (pretty formatted)
2. Review `server/logs/server.log` for historical events and patterns
3. Use grep to find specific player IDs or event types
4. Parse JSON logs with `jq` for advanced queries

**Log Levels:**
- Set via `LOG_LEVEL` environment variable: `debug`, `info`, `warn`, `error`
- Default: `info` (gravity debug logs require `LOG_LEVEL=debug`)

### Common Tasks

**Adding a new game mechanic:**
1. Add types/constants to `shared/index.ts`
2. Implement server logic in `server/src/index.ts` or new module
3. Add client rendering in `client/src/render/three/ThreeRenderer.ts`
4. Wire up input handling in `client/src/core/input/InputManager.ts` if needed
5. Test with bots and multiple browser tabs
6. Tune constants in `GAME_CONFIG`

**Debugging physics issues:**
- Check `server/logs/server.log` for event history and patterns
- Use `grep` to find specific player deaths, crashes, or events
- Set `LOG_LEVEL=debug` for detailed gravity physics logs
- Check network messages in browser console
- Add debug overlay with `?debug` URL parameter
- Use Plan mode to trace logic step-by-step

**Adding new obstacles/entities:**
1. Define interface in `shared/index.ts`
2. Add spawn/update logic on server
3. Broadcast creation/updates to clients via Socket.io
4. Add rendering logic in ThreeRenderer (create meshes, update positions)
5. Handle cleanup on despawn (remove from scene, dispose geometries/materials)

**Testing:**
- Unit tests: `npm run test` in `client/` workspace (Vitest)
- Manual testing: Run server + client, open multiple tabs
- Debug mode: Add `?debug` to URL for performance overlay
- Bots provide automatic testing of core gameplay loops

## Git Workflow

**Commit Style:**
- **One-line commit messages** - Keep it simple and concise
- Example: `Add server logging with Pino (events, aggregate stats, snapshots)`
- No multi-paragraph explanations or bullet lists in commit messages
- Let the code diff speak for itself

**Workflow:**
- The repository uses a custom git merge driver for `.beads/beads.jsonl` files
- Always commit `.beads/beads.left.jsonl` together with related code changes
- Unless otherwise told, do not make bead-only commits.
- Issue state should stay synchronized with code state
- Use feature branches for non-trivial work
- PR descriptions should include test plan and issue references

## Documentation

**Worklogs:** Daily logs in `worklogs/YYYY-MM-DD.md` document progress, decisions, and learnings

**Ephemeral Planning:** If planning documents are needed during development (PLAN.md, DESIGN.md, etc.), store them in a `history/` directory to keep the repository root clean. Only access these when explicitly asked to review past planning.

**Game Design:** See `GAME_DESIGN.md` for vision, evolution stages, and future plans
