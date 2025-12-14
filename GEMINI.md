# Gemini Interaction Guide

**Note**: This project uses [bd (beads)](https://github.com/steveyegge/beads)
for issue tracking. Use `bd` commands instead of markdown TODOs.
See AGENTS.md for workflow details.

This document provides guidance for interacting with the Gemini CLI to develop the Godcell project.

## Project Overview

Godcell is a real-time multiplayer game with a client-server architecture. The client is a web-based game rendered with Three.js, and the server manages game logic and player state using Node.js. The project uses TypeScript and is structured as a monorepo with shared code.

## Development Setup

The project is a monorepo using npm workspaces. To get started:

1.  **Install Dependencies:** Run `npm install` in the root directory. This will install dependencies for the root, client, and server workspaces.
2.  **Run Development Servers:** Run `npm run dev` in the root directory. This will start the server in watch mode and the client development server simultaneously.

## Key Commands

The following commands are available in the root `package.json`:

- `npm run dev`: Starts both the client and server development servers.
- `npm run dev:client`: Starts only the client development server.
- `npm run dev:server`: Starts only the server development server.
- `npm run build`: Builds the client and server for production.
- `npm run clean`: Removes all `dist` folders and `node_modules` from all workspaces.

### Client (`client/`)

- `npm run dev`: Starts the Vite development server.
- `npm test`: Runs the client-side tests with Vitest.
- `npm run build`: Builds the client assets for production.

### Server (`server/`)

- `npm run dev`: Starts the Node.js server with `tsx` for live reloading.
- `npm run build`: Compiles the server code with `tsc`.
- `npm run start`: Runs the compiled server code.

## Project Structure

- `client/`: Contains the frontend game client, including all Three.js rendering logic, UI, and user input handling.
- `server/`: Contains the backend game server, responsible for game state, physics, and communication with clients.
- `shared/`: Contains code shared between the client and server, such as type definitions and game constants.
- `.beads/`: Contains project-related documents and issues for the [Beads](https://github.com/a-s-o/beads) project management tool.

## Architectural Conventions

- **Event-Driven:** The client uses an `EventBus` (`client/src/core/events/EventBus.ts`) for decoupled communication between different parts of the application. Please use this for new events.
- **State Management:** Game state is managed in `client/src/core/state/GameState.ts`. Avoid putting state directly into renderer components.
- **Renderer Abstraction:** The rendering logic is abstracted through a `Renderer` interface. The main implementation is `ThreeRenderer` (`client/src/render/three/ThreeRenderer.ts`).
- **Monorepo:** The project is a monorepo. The `client`, `server`, and `shared` packages are defined as npm workspaces.

## Example Prompts

Here are some examples of how you can ask me to perform tasks:

- "Gemini, run the client-side tests and show me the output."
- "Gemini, add a new event called `PlayerHealed` to the `EventBus`."
- "Gemini, in the `server`'s `package.json`, add a new script called `test` that runs `vitest`."
- "Gemini, what are the dependencies of the `shared` package?"
