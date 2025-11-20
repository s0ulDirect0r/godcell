# Three.js Incremental Migration Plan

**Date:** 2025-11-20  
**Goal:** Migrate from Phaser to a renderer-agnostic core with a Three.js frontend in small, reviewable phases.

## Current State (after review)

```
client/src/
  main.ts               - boots Phaser + GameScene
  scenes/GameScene.ts   - 1779 lines: sockets, interpolation, rendering, camera, input, UI bars, DOM death overlay, particles, pseudopods, detection
```

**Issues:**
- Everything is owned by GameScene (networking, state, rendering, input, UI), making it impossible to test headlessly.
- Rendering math, camera zoom, and pointer world coords are tightly coupled to Phaser types.
- No renderer contract; state is implicit and scattered across maps in GameScene.
- Success criteria today are visual-only; no automated checks for message → state mapping or input intent generation.

## Target Architecture

```
client/src/
  main.ts              - bootstrap core + chosen renderer

  core/                - renderer-agnostic
    state/GameState.ts - normalized entity maps + lifecycle hooks
    events/EventBus.ts - local pub/sub
    net/SocketManager.ts - socket.io lifecycle → bus/state
    input/InputManager.ts - keyboard/mouse → intents (world/screen aware)

  render/
    Renderer.ts        - init/render/dispose contract
    phaser/            - Phaser adapter (temporary)
    three/             - Three.js renderer
      Scene2D.ts, Camera2D.ts
      entities/…       - per-entity renderers
    hud/               - DOM HUD overlay (bars, countdown, death UI)
```

**Data flow:**
```
Server → SocketManager → GameState → Renderer(s)
                          ↑
InputManager ─────────────┘
```

**3D/Camera considerations (for Stage 3+):**
- Renderer contract exposes camera modes (`topdown`, `orbit`, `tps`, `fps`) and a capability flag (e.g., `supports3D`).
- Input uses projection adapters for screen↔world mapping; a 3D-capable renderer provides raycasts for picking when available.
- Early stages: top-down ortho/high-tilt perspective over a z=0 plane with 3D meshes ("3D cells on a 2D plane").
- Later stages: switchable orbit/TPS/FPS cameras without rewriting core logic; entities carry z but default to 0 for 2D plane.

## Migration Phases

- Keep phases small (1–3 files). Every phase keeps the game playable and has a clear rollback.

### Phase 0: Baseline + guardrails (Est: 0.5h)
- Capture FPS/memory and a quick visual reference to spot regressions during dual-render.
- Add a runtime flag/env to toggle Phaser-only vs hybrid vs Three-only.
- Success: no behavior changes; just toggle plumbing + baseline notes.

### Phase 1: Core state + message contract (Est: 1–2h)
- Add `core/state/GameState.ts` with normalized maps and lifecycle (`applySnapshot`, `upsert`, `remove`, `reset`, interpolation targets).
- Add `core/events/EventBus.ts` for local pub/sub between socket, input, and renderers.
- Add Vitest and headless unit tests for message → state transforms (using fixtures from shared message types).
- Success: game unchanged visually; tests cover snapshot/apply and spawn/update/despawn for players, nutrients, swarms, pseudopods.

### Phase 2: Socket manager extraction (Est: 1–2h)
- Create `core/net/SocketManager.ts` to own socket.io and emit normalized events (gameState, playerMoved, nutrientCollected/moved, swarmMoved, pseudopodSpawned/Retracted, detectionUpdate, etc.).
- Move interpolation target updates into state, not the renderer.
- Wire GameScene to consume bus/state instead of socket callbacks.
- Success: visual parity; reconnect/disconnect still works; single source of truth is GameState.

### Phase 3: Input manager extraction (Est: 1h)
- Create `core/input/InputManager.ts` to own keyboard/pointer, camera-projection adapters (world ↔ screen), and emit intents (`move`, `pseudopodExtend`, `respawn`).
- Add a small test for intent generation and cooldown gating.
- Support both 2D and 3D projections (raycast hook) so Stage 3+ modes can reuse input paths.
- Success: WASD, pseudopod targeting, and respawn behave identically; no double-handling when dual-render is on.

### Phase 4: Renderer contract + Phaser adapter (Est: 2h)
- Define `render/Renderer.ts` (`init`, `render(state, dt)`, `dispose`) plus camera/capabilities (`mode: 'topdown'|'orbit'|'tps'|'fps'`, `supports3D`), and per-entity adapter shape.
- Implement `render/phaser/PhaserRenderer` by moving existing render logic (players, nutrients, obstacles, swarms, trails, detection, pseudopods, UI bars, death overlay hooks) behind the contract.
- Slim GameScene to just bootstrap Phaser, wire bus/state/input, and delegate updates to the renderer contract.
- Success: visuals unchanged; core loop no longer depends on Phaser types.

### Phase 5: Three.js proof-of-concept behind a flag (Est: 2–3h)
- Add Three.js deps; set up `render/three/ThreeRenderer` with both orthographic and perspective cameras; start in top-down/ortho for Stage 1–2.
- Render nutrients in Three.js while Phaser renders everything else; toggle ownership via runtime flag.
- Add resize/DPR handling, disposal checklist, and a basic lighting pass (ambient + key light) to support real 3D later.
- Success: nutrients show via Three.js without tanking FPS; Phaser visuals unchanged; flag can disable Three.js instantly.

### Phase 6: Entity migrations (Est: 3–5h total)
- Order (low risk → high): nutrients (harden), trails/particles, obstacles (gradient/shader), swarms (instanced meshes + particles), pseudopods (line + glow), players (stage variants + self-outline/volume).
- For each: enable Three path behind flag → compare vs Phaser → approve → remove Phaser path.
- When migrating players/swarms, give them volume-ready meshes so camera mode can flip to orbit/TPS/FPS at Stage 3/4 without refactors; keep z=0 for Stage 1/2.
- Success: visual parity per entity, no leaks (dispose geometries/materials), FPS near baseline; camera mode toggle remains correct.

### Phase 7: HUD/DOM overlay (Est: 1–2h)
- Move HUD (bars, countdown) to DOM overlay fed by state events; keep death overlay but wire through bus.
- Decouple HUD from camera zoom/scroll; avoid layout thrash.
- Success: HUD/death UI accurate in both renderers; no jank on resize.

### Phase 8: Remove Phaser (Est: 1h)
- Drop Phaser deps/paths; Three.js is primary renderer.
- Success: build passes; full gameplay works without Phaser.

### Phase 9: Polish (Est: 2–3h)
- Add Three-only upgrades: bloom/vignette, improved particles/materials, gentle camera motion, optional perf overlay.
- Resource hygiene: pooled geometries/textures, dispose on scene tear-down.
- Success: visual uplift over Phaser baseline with stable performance.

## Review Checkpoints
- After each phase: implement → you test locally → discuss → approve before next phase.
- Rollback = git revert of that phase’s changes.

## Estimates
- Phase 0: 0.5h
- Phase 1: 1–2h
- Phase 2: 1–2h
- Phase 3: 1h
- Phase 4: 2h
- Phase 5: 2–3h
- Phase 6: 3–5h
- Phase 7: 1–2h
- Phase 8: 1h
- Phase 9: 2–3h

Total: ~14–19.5h with review breaks.

## Success Metrics
- Technical: headless tests green; no Phaser in final build; steady FPS near baseline; no GPU/resource leaks.
- UX: visual parity (or better) per entity; inputs and camera feel identical or improved.
- Comprehension: renderer contract and core data flow are clear and documented in code.

## Next Steps
- Confirm the revised phases.
- Start Phase 0/1 (baseline + GameState/EventBus + tests).
