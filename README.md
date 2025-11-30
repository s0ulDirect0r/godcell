# GODCELL

**An evolutionary survival game where you begin as a fragile cyber-cell and fight to transcend.**

---

## What is GODCELL?

GODCELL is a real-time multiplayer evolution game set in a hostile digital world. You start as a tiny, desperate single-cell organism competing for scarce nutrients. Survive entropy swarms, avoid gravity wells, and evolve through increasingly powerful forms—or die and lose everything.

The game models evolutionary pressure to create emergent gameplay: scarcity forces competition, predation creates tension, and the constant threat of entropy keeps you moving. You don't learn from tutorials—you learn by dying.

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
git clone https://github.com/s0ulDirect0r/godcell.git
cd godcell
npm install
```

### Running the Game

```bash
# Start both server and client
npm run dev

# Or run separately
npm run dev:server   # Server on port 3000
npm run dev:client   # Client on Vite dev server
```

Open your browser to the URL shown by Vite (usually `http://localhost:5173`).

## Tech Stack

- **Client:** TypeScript, Vite, Three.js, Vitest
- **Server:** Node.js, Socket.io, Pino (logging)
- **Shared:** Monorepo with common types and ECS core
- **Architecture:** Entity-Component-System (ECS) on both client and server

## Project Structure

```
godcell/
├── client/           # Game client (Three.js renderer)
│   └── src/
│       ├── ecs/      # Client ECS factories
│       ├── core/     # Input, networking, events
│       ├── render/   # Three.js render systems
│       └── ui/       # HUD and overlays
├── server/           # Game server (authoritative)
│   └── src/
│       ├── ecs/      # Server ECS systems and factories
│       └── helpers/  # Math, spawning, logging
└── shared/           # Shared code
    ├── ecs/          # ECS framework (World, components)
    └── index.ts      # Network messages, constants
```

## Documentation

- **[SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md)** — Technical architecture, ECS details, data flow
- **[GAME_DESIGN.md](./GAME_DESIGN.md)** — Game vision, mechanics, evolution stages
- **[CLAUDE.md](./CLAUDE.md)** — AI pair-programming guide for contributors

## Development

### Build

```bash
npm run build        # Build all workspaces
```

### Clean

```bash
npm run clean        # Remove all build artifacts and node_modules
```

### Issue Tracking

This project uses [beads](https://github.com/steveyegge/beads) for issue tracking:

```bash
bd ready             # Show ready tasks
bd list              # List all issues
bd create "title"    # Create new issue
```

## License

This project is private/proprietary. All rights reserved.

---

*"To become a god is to realize you're still just a cell in a vaster ocean."*
