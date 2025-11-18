# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads) for issue tracking. Use `bd` commands instead of markdown TODOs. See AGENTS.md for workflow details.

## Project Overview: GODCELL

**GODCELL** is a multiplayer evolution game where players begin as single-celled cyber-organisms in a digital primordial soup and evolve toward transcendence.

### Current State (November 2025)

**What's Built:**
- Real-time multiplayer (Socket.io, 60fps server tick)
- Digital ocean aesthetic (flowing particles, grid, neon colors)
- Cyber-cell movement with glowing trails
- Nutrient collection and metabolism system
- Energy decay and starvation mechanics
- Evolution system (5 stages: single-cell → multi-cell → cyber-organism → humanoid → godcell)
- Death/respawn system with session statistics
- 5 AI bot players with wander/seek behaviors
- 12 gravity distortion obstacles (mini black holes with inverse-square physics)
- Risk/reward high-value nutrients
- Expanded world (4800×3200) with camera follow

**Tech Stack:**
- **Client:** TypeScript + Phaser 3 + Vite
- **Server:** Node.js + Socket.io (server-authoritative) + Pino (logging)
- **Shared:** Common types and constants in monorepo structure
- **Issue Tracking:** bd (beads)

**Architecture:**
- Monorepo with workspaces: `client/`, `server/`, `shared/`
- Server-authoritative game logic (movement, physics, damage, collisions)
- Client renders state and handles input
- 60fps game loop on server, smooth interpolation on client

### Game Design Philosophy

This project follows an **emergent, experimental approach**:

1. **Start with exploration** - Don't over-plan; discover as you build
2. **Iterate organically** - Like sketching in art, refine through cycles
3. **Embrace serendipity** - Follow interesting tangents when they emerge
4. **Track discoveries** - Use `discovered-from` dependencies when new work emerges
5. **Keep it fluid** - This is an experiment in creative process, not production software

### Current Focus: Stage 1 Difficulty

Stage 1 (single-cell) now has:
- Scarcity pressure (halved nutrients, doubled world size)
- Environmental hazards (gravity distortions with instant-death cores)
- Resource competition (5 AI bots competing for nutrients)
- Risk/reward decisions (high-value nutrients near dangers)

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

**Bots:** 5 AI bots spawn automatically on server start for testing

### Code Organization

**Key Files:**
- `shared/index.ts` - All shared types, interfaces, constants, network messages
- `server/src/index.ts` - Main game loop, physics, metabolism, collisions (~800 lines)
- `server/src/bots.ts` - AI bot system with steering behaviors (~300 lines)
- `client/src/scenes/GameScene.ts` - Phaser game scene, rendering, input (~1000 lines)

**Patterns:**
- Server is authoritative for all game logic
- Client receives state updates and renders
- Network messages typed in `shared/index.ts`
- Constants in `GAME_CONFIG` object (tunable parameters)
- Position updates at 60fps, energy updates throttled to 10fps

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
3. Add client rendering in `client/src/scenes/GameScene.ts`
4. Test with bots and multiple browser tabs
5. Tune constants in `GAME_CONFIG`

**Debugging physics issues:**
- Check `server/logs/server.log` for event history and patterns
- Use `grep` to find specific player deaths, crashes, or events
- Set `LOG_LEVEL=debug` for detailed gravity physics logs
- Check network messages in browser console
- Use Plan mode to trace logic step-by-step

**Adding new obstacles/entities:**
1. Define interface in `shared/index.ts`
2. Add spawn/update logic on server
3. Broadcast creation/updates to clients
4. Render on client with Phaser
5. Handle cleanup on despawn

## Git Workflow

- The repository uses a custom git merge driver for `.beads/beads.jsonl` files
- Always commit `.beads/beads.left.jsonl` together with related code changes
- Issue state should stay synchronized with code state
- Use feature branches for non-trivial work
- PR descriptions should include test plan and issue references

## Documentation

**Worklogs:** Daily logs in `worklogs/YYYY-MM-DD.md` document progress, decisions, and learnings

**Ephemeral Planning:** If planning documents are needed during development (PLAN.md, DESIGN.md, etc.), store them in a `history/` directory to keep the repository root clean. Only access these when explicitly asked to review past planning.

**Game Design:** See `GAME_DESIGN.md` for vision, evolution stages, and future plans
