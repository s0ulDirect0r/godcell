# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads) for issue tracking. Use `bd` commands instead of markdown TODOs. See AGENTS.md for workflow details.

## Project Context

This repository is an experimental workspace for **emergent creativity** - building software using AI tools in a manner similar to creating art. The project embraces exploration, iteration, and organic development rather than following rigid specifications upfront.

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

## Git Workflow

- The repository uses a custom git merge driver for `.beads/beads.jsonl` files
- Always commit `.beads/issues.jsonl` together with related code changes
- Issue state should stay synchronized with code state

## Ephemeral Documentation

If planning documents are needed during development (PLAN.md, DESIGN.md, etc.), store them in a `history/` directory to keep the repository root clean. Only access these when explicitly asked to review past planning.
