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

### Stage 3: Lantern Grove trial

```bash
npm run grove
```

Open `http://localhost:5173/?grove`, enter, and choose melee, ranged, or traps. Follow the pale root trail east: gather fruit, hunt the copper grazer, then approach the serpent's den. Its amber sector warns of a committed strike; dodge out and attack during recovery. Kills increase both energy and capacity.

WASD moves, Shift sprints, and the mouse aims. Melee uses left click for swipe and right click for thrust; ranged uses left click to fire; traps uses either mouse button to plant a mine. The trial panel lets you change form, refill energy, and return to the entrance. Fauna respawn on their normal timers; changing form preserves the shared world.

This command starts a local server with development controls and a focused grove population. The grove also appears in the normal game's jungle. Stop any existing dev server before launching the trial.

The player retains the original cyber-organism's pearl body, curved legs, and beaded tail, with rounded tail details and distinct slash, thrust, and eye-fired recoil animations. Its geometry and motion live in `client/src/render/meshes/CyberOrganismMesh.ts` and `CyberAttackMotion.ts`.

Inspect the revision at `http://localhost:5173/model-viewer.html?cyber`. Toggle **Original Stage 3** to compare the previous model. **Attack Preview → Motion** loops swipe, thrust, or fire; **Slow Motion**, **Freeze Pose**, and **Attack Frame** let you inspect individual poses and effects. These controls use the same motion and effect code as gameplay. **Movement Preview → Walk** and **Travel Speed** let you inspect planted steps, body compression, and stopping independently from energy cycling.

The grazer uses editable Blender sources and GLB exports in `client/public/models/grove/`. The earlier armored hexapod source is retained there for reference. Regenerate those Blender assets with:

```bash
blender --background --factory-startup --python scripts/build-grove-models.py
```

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

_"To become a god is to realize you're still just a cell in a vaster ocean."_
