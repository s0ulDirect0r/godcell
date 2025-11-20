# Renderer-Agnostic Client Architecture Spec

**Version:** 1.0
**Date:** 2025-11-19
**Target:** TypeScript browser client for GODCELL multiplayer game
**Goal:** Decouple simulation/network logic from rendering; migrate from Phaser to Three.js while keeping server protocol unchanged

---

## Executive Summary

This spec defines a clean separation between **core game logic** (state, networking, simulation, input) and **rendering** (Three.js-based visualization). The core layer is renderer-agnostic and can drive any visual implementation. The renderer layer consumes read-only state and produces visuals, never mutating game state directly.

**Key principles:**
- **Unidirectional data flow**: Server → core/net → core/state → core/sim → renderer
- **Renderer is a pure consumer**: Reads state, draws visuals, handles DOM events
- **Core is renderer-blind**: No imports of Three.js, Phaser, or any graphics library
- **Server protocol unchanged**: Socket.io, existing message shapes, shared TypeScript types

---

## Directory Structure

```
client/src/
├── core/                          # Renderer-agnostic game logic
│   ├── state/
│   │   ├── GameState.ts           # Canonical client-side state container
│   │   ├── entities.ts            # Normalized maps (players, nutrients, obstacles, etc.)
│   │   ├── interpolation.ts       # Interpolation buffer (ring buffer of timestamped snapshots)
│   │   └── selectors.ts           # Read-only accessors for derived data
│   ├── net/
│   │   ├── SocketManager.ts       # Socket.io connection, reconnect, error handling
│   │   ├── MessageProcessor.ts    # Process server snapshots/diffs → update state
│   │   ├── IntentSender.ts        # Send player intents (movement, actions) to server
│   │   └── types.ts               # Re-export shared network message types
│   ├── sim/
│   │   ├── interpolator.ts        # Lerp/extrapolate positions from buffered snapshots
│   │   ├── camera.ts              # Camera target calculation (position, zoom, shake)
│   │   ├── timers.ts              # Client-side countdown helpers (energy decay, etc.)
│   │   └── utils.ts               # Math helpers (lerp, clamp, distance, etc.)
│   ├── input/
│   │   ├── InputManager.ts        # Map raw input → high-level intents
│   │   ├── InputState.ts          # Current keyboard/mouse state snapshot
│   │   └── types.ts               # Intent types (MoveIntent, ActionIntent, etc.)
│   ├── ui-model/
│   │   ├── HUDViewModel.ts        # Derive HUD data (health, energy, countdown strings)
│   │   ├── MinimapViewModel.ts    # Derive minimap data (player positions, viewport rect)
│   │   └── formatters.ts          # Number/string formatting for display
│   └── config/
│       ├── gameConfig.ts          # Import GAME_CONFIG from shared code
│       └── clientConfig.ts        # Client-only tuning (interpolation window, camera easing, etc.)
│
├── render/                        # Three.js rendering layer
│   ├── three/
│   │   ├── scene2d/
│   │   │   ├── Scene2D.ts         # Orthographic scene for current 2D phase
│   │   │   ├── Grid.ts            # Background grid
│   │   │   ├── Particles.ts       # Instanced particle system (ambient flow)
│   │   │   ├── Trails.ts          # Player/entity trails (instanced or line geometry)
│   │   │   ├── Nutrients.ts       # Instanced nutrient sprites
│   │   │   ├── Obstacles.ts       # Gravity distortions (circles + cores)
│   │   │   ├── Players.ts         # Player billboards/sprites
│   │   │   └── Pseudopods.ts      # Line2/tube geometry for future pseudopod rendering
│   │   ├── camera/
│   │   │   ├── Camera2D.ts        # Orthographic camera with zoom/lerp
│   │   │   ├── CameraController.ts # Drive camera from core/sim camera descriptors
│   │   │   └── effects.ts         # Camera shake/pulse effects
│   │   ├── hud/
│   │   │   ├── HUDOverlay.ts      # DOM or 2D canvas overlay
│   │   │   ├── EnergyBar.ts       # Energy/health bar component
│   │   │   ├── StageIndicator.ts  # Evolution stage display
│   │   │   └── Minimap.ts         # Minimap component
│   │   ├── input-adapter/
│   │   │   └── DOMInputAdapter.ts # DOM event handling → core/input
│   │   ├── materials/
│   │   │   ├── shaders.ts         # Custom shaders (glow, trails, etc.)
│   │   │   └── materials.ts       # Shared material instances
│   │   └── debug/
│   │       ├── DebugPanel.ts      # Leva/dat.GUI panel for runtime tuning
│   │       ├── DebugOverlay.ts    # Perf stats, hitbox viz, wireframe toggle
│   │       └── logger.ts          # Client-side debug logging helpers
│   ├── loop/
│   │   └── RenderLoop.ts          # requestAnimationFrame loop with fixed-step accumulator
│   └── postprocessing/
│       ├── composer.ts            # EffectComposer setup (bloom, glow, etc.)
│       └── passes.ts              # Custom postprocessing passes
│
├── app/
│   ├── bootstrap.ts               # Initialize core + renderer, start main loop
│   ├── services/
│   │   ├── ServiceLocator.ts      # Optional lightweight DI (logger, metrics, etc.)
│   │   └── logger.ts              # Client-side logging service
│   └── types.ts                   # App-level types
│
└── main.ts                        # Entry point (Vite calls this)
```

---

## Module Responsibilities

### Core Layer (No Renderer Imports)

#### `core/state/`

**GameState.ts:**
- Single source of truth for client-side game state
- Normalized maps: `players: Map<string, Player>`, `nutrients: Map<string, Nutrient>`, etc.
- Current tick number, server time offset
- Local player ID
- Methods: `reset()`, `getPlayer()`, `getNutrient()`, etc.

**interpolation.ts:**
- Ring buffer of timestamped state snapshots (configurable size, default 3-5 snapshots)
- Stores: tick number, timestamp, full entity maps
- Methods: `addSnapshot()`, `getSnapshotAt(time)`, `getSnapshotsInRange(startTime, endTime)`
- Used by core/sim to interpolate visual positions

**selectors.ts:**
- Read-only derived data: `getLocalPlayer()`, `getVisiblePlayers()`, `getPlayersInRange(position, radius)`
- No side effects, pure functions
- Used by core/ui-model and renderer

#### `core/net/`

**SocketManager.ts:**
- Socket.io connection lifecycle (connect, disconnect, reconnect)
- Room join/leave
- Basic error handling and exponential backoff
- Emits events: `'connected'`, `'disconnected'`, `'snapshot'`, `'diff'`, etc.
- **Does not** mutate state directly

**MessageProcessor.ts:**
- Listens to SocketManager events
- Processes `snapshot` and `diff` messages → updates GameState and interpolation buffers
- Handles entity creation, updates, removal
- Calculates server time offset for interpolation
- Methods: `processSnapshot(snapshot)`, `processDiff(diff)`

**IntentSender.ts:**
- Sends player intents to server (movement vector, actions)
- Buffers intents if disconnected (optional, based on game design)
- Methods: `sendMove(vector)`, `sendAction(actionType)`

#### `core/sim/`

**interpolator.ts:**
- Interpolate/extrapolate positions from buffered snapshots
- Methods: `getInterpolatedPosition(entityId, renderTime)`, `extrapolatePosition(lastKnown, velocity, deltaTime)`
- Uses configurable interpolation delay (e.g., 100ms behind server to smooth jitter)

**camera.ts:**
- Calculate camera target descriptor from GameState
- Descriptor shape:
  ```typescript
  {
    target: { x: number, y: number },  // World position to center on
    zoom: number,                      // Zoom level (based on evolution stage)
    shake?: { intensity: number, duration: number },
    easing: number                     // Lerp factor (0-1)
  }
  ```
- Methods: `getCameraTarget(state)`, `calculateZoom(evolutionStage)`
- Maps evolution stage → zoom band (closer zoom for single-cell, zoomed out for godcell)

**timers.ts:**
- Client-side countdown helpers for energy decay, respawn timers, etc.
- Methods: `getRemainingEnergy(player, deltaTime)`, `formatCountdown(seconds)`
- Pure functions, no side effects

#### `core/input/`

**InputManager.ts:**
- Maintains current input state: `keys: Set<string>`, `mouse: { x, y, buttons }`
- Maps raw input → high-level intents: `getMoveIntent()` → `{ dx, dy }` normalized vector
- Pluggable consumer: calls `core/net/IntentSender` or test harness
- Methods: `update()`, `getMoveIntent()`, `getActionIntent()`

#### `core/ui-model/`

**HUDViewModel.ts:**
- Derive display-ready HUD data from GameState
- Output: `{ health: string, energy: string, stage: string, countdown: string, detectionIndicator: boolean }`
- Formatted strings, no DOM manipulation
- Methods: `deriveHUD(state)`, `formatEnergy(value)`, `formatStage(stage)`

**MinimapViewModel.ts:**
- Derive minimap data: player positions (relative to viewport), viewport rect
- Output: `{ players: Array<{x, y, color}>, viewport: {x, y, w, h} }`

#### `core/config/`

**gameConfig.ts:**
- Import `GAME_CONFIG` from `shared/index.ts` (speeds, ranges, decay rates, etc.)
- Re-export for core and renderer

**clientConfig.ts:**
- Client-only tuning knobs:
  - `INTERPOLATION_DELAY_MS = 100` (how far behind server to render)
  - `INTERPOLATION_BUFFER_SIZE = 5` (number of snapshots to keep)
  - `CAMERA_EASING_FACTOR = 0.1` (lerp speed for camera movement)
  - `CAMERA_ZOOM_EASING = 0.05` (lerp speed for zoom changes)
  - `EXTRAPOLATION_MAX_MS = 200` (max time to extrapolate before freezing)

---

### Renderer Layer (Three.js)

#### `render/three/scene2d/`

**Scene2D.ts:**
- Main orthographic scene for 2D phase
- Owns Three.js `Scene`, manages entity meshes/sprites
- Methods: `create()`, `update(state, interpolatedPositions)`, `dispose()`
- Calls specialized modules (Grid, Particles, Trails, etc.)

**Grid.ts:**
- Background grid (instanced lines or shader-based)
- Methods: `create(scene)`, `update(cameraZoom)`, `dispose()`

**Particles.ts:**
- Instanced particle system for ambient flow (InstancedMesh)
- Update positions based on time + noise or flow field
- Methods: `create(scene)`, `update(deltaTime)`, `dispose()`

**Trails.ts:**
- Player/entity trails (InstancedMesh or Line2 from three-stdlib)
- Fade over time, update positions from interpolated player movement
- Methods: `create(scene)`, `addTrailPoint(playerId, position)`, `update(deltaTime)`

**Nutrients.ts:**
- Instanced sprites for nutrients (InstancedMesh with billboard shader)
- Update from GameState nutrient map
- Methods: `create(scene)`, `update(nutrients)`, `dispose()`

**Obstacles.ts:**
- Gravity distortions: outer circle mesh + inner core mesh
- Update from GameState obstacle map
- Methods: `create(scene)`, `update(obstacles)`, `dispose()`

**Players.ts:**
- Player billboards/sprites (InstancedMesh or individual sprites)
- Update from interpolated positions
- Methods: `create(scene)`, `update(players, interpolatedPositions)`, `dispose()`

**Pseudopods.ts:**
- Future: Line2/tube geometry for pseudopod rendering (multi-cell stage)
- Methods: `create(scene)`, `update(pseudopods)`, `dispose()`

#### `render/three/camera/`

**Camera2D.ts:**
- Orthographic camera (fixed aspect ratio or responsive)
- Methods: `create(width, height)`, `resize(width, height)`, `getCamera()`

**CameraController.ts:**
- Drives camera from core/sim camera descriptors
- Lerps position and zoom smoothly
- Applies shake effects
- Methods: `update(cameraDescriptor, deltaTime)`, `applyShake(intensity, duration)`

#### `render/three/hud/`

**HUDOverlay.ts:**
- DOM overlay (HTML/CSS) or 2D canvas
- Binds to core/ui-model HUDViewModel
- Methods: `create(container)`, `update(hudViewModel)`, `dispose()`

**EnergyBar.ts, StageIndicator.ts, Minimap.ts:**
- Individual HUD components
- Pure presentation, no game logic

#### `render/three/input-adapter/`

**DOMInputAdapter.ts:**
- Registers DOM event listeners (keydown/up, mousemove, click, etc.)
- Calls `core/input/InputManager` methods
- Handles pointer lock if needed
- Methods: `attach(container, inputManager)`, `detach()`

#### `render/loop/`

**RenderLoop.ts:**
- `requestAnimationFrame`-based main loop
- Fixed-step accumulator for sim/net (e.g., 60 ticks/sec or match server tick rate)
- On each frame:
  1. Process incoming network messages via `core/net/MessageProcessor.tick()`
  2. Step `core/sim` helpers (interpolation, timers)
  3. Update `core/ui-model`
  4. Render via `render/three/Scene2D.update()` and `render/three/camera/CameraController.update()`
- Methods: `start()`, `stop()`, `tick(timestamp)`

**Pseudocode:**
```
RenderLoop.tick(currentTime):
  deltaTime = currentTime - lastTime
  accumulator += deltaTime

  // Fixed-step simulation (match server tick rate, e.g. 16.67ms for 60Hz)
  while accumulator >= FIXED_STEP:
    MessageProcessor.tick()         // Process network messages
    InputManager.update()            // Update input state
    IntentSender.sendPendingIntents() // Send intents to server
    accumulator -= FIXED_STEP
    simulationTime += FIXED_STEP

  // Derive interpolation time (simulationTime - INTERPOLATION_DELAY_MS)
  renderTime = simulationTime - INTERPOLATION_DELAY_MS

  // Interpolate visual positions
  interpolatedPositions = Interpolator.getPositions(renderTime)

  // Update UI models
  hudViewModel = HUDViewModel.deriveHUD(GameState)
  minimapViewModel = MinimapViewModel.deriveMap(GameState)

  // Update camera
  cameraDescriptor = SimCamera.getCameraTarget(GameState)
  CameraController.update(cameraDescriptor, deltaTime)

  // Render
  Scene2D.update(GameState, interpolatedPositions)
  HUDOverlay.update(hudViewModel)
  Renderer.render(Scene2D.scene, CameraController.camera)

  lastTime = currentTime
  requestAnimationFrame(RenderLoop.tick)
```

#### `render/postprocessing/`

**composer.ts:**
- Setup `EffectComposer` from `postprocessing` library
- Add passes: UnrealBloomPass, custom glow pass, etc.
- Methods: `createComposer(renderer, scene, camera)`, `resize(width, height)`

**passes.ts:**
- Custom postprocessing passes (e.g., custom bloom, trail glow, etc.)

#### `render/three/materials/`

**shaders.ts:**
- Custom GLSL shaders (glow, trails, billboard sprites, etc.)

**materials.ts:**
- Shared material instances (avoid recreating materials per entity)
- Methods: `getPlayerMaterial()`, `getTrailMaterial()`, etc.

#### `render/three/debug/`

**DebugPanel.ts:**
- Leva or dat.GUI panel for runtime tuning
- Exposes `core/config/clientConfig` knobs (interpolation delay, camera easing, etc.)
- Exposes render settings (wireframe, hitbox viz, etc.)

**DebugOverlay.ts:**
- Perf stats (FPS, tick rate, network latency)
- Overlay toggles (hitboxes, trails, grid, etc.)

---

### Glue and Bootstrap

#### `app/bootstrap.ts`

**Responsibilities:**
- Initialize `core/state/GameState`
- Initialize `core/net/SocketManager` and `MessageProcessor`
- Initialize `core/input/InputManager`
- Initialize `render/three/Scene2D`, `Camera2D`, `CameraController`, `HUDOverlay`
- Wire up renderer with core (pass read-only state/ui-model references)
- Initialize `RenderLoop` and start it
- Handle window resize and visibility changes (pause loop when tab inactive)

**Pseudocode:**
```
bootstrap():
  1. Create GameState
  2. Create SocketManager, MessageProcessor (wired to GameState)
  3. Create InputManager, IntentSender (wired to SocketManager)
  4. Create Scene2D, Camera2D, CameraController
  5. Create HUDOverlay (wired to core/ui-model)
  6. Create DOMInputAdapter (wired to InputManager)
  7. Create RenderLoop (wired to all core + render modules)
  8. Register resize/visibility handlers
  9. Start RenderLoop
```

#### `app/services/`

**ServiceLocator.ts:**
- Optional lightweight DI for logger, metrics, feature flags, debug hooks
- Avoids global singletons, makes testing easier

**logger.ts:**
- Client-side logging (console.log wrapper with levels, optional remote logging)

---

## Core ↔ Renderer Boundary

### Core Exposes:

1. **Read-only state accessors** (`core/state/selectors.ts`):
   - `getLocalPlayer()`, `getAllPlayers()`, `getNutrients()`, etc.
   - No direct access to internal maps; always go through selectors

2. **UI view models** (`core/ui-model/`):
   - `HUDViewModel.deriveHUD(state)` → formatted, display-ready data
   - `MinimapViewModel.deriveMap(state)` → minimap data

3. **Camera descriptors** (`core/sim/camera.ts`):
   - `{ target: {x, y}, zoom: number, shake?: {...}, easing: number }`
   - Renderer uses this to position and animate camera, but doesn't decide where to point it

### Renderer Consumes:

- **State snapshots** via selectors (read-only)
- **Interpolated positions** from `core/sim/interpolator`
- **Camera descriptors** from `core/sim/camera`
- **UI view models** from `core/ui-model`

### Renderer MUST NOT:

- Mutate `core/state` directly
- Process network messages
- Send network messages (except via `core/net/IntentSender` through `core/input`)
- Implement game logic (collision detection, damage calculation, etc.)

---

## Data Flow

```
Server → Socket.io
  ↓
core/net/SocketManager (emits 'snapshot' event)
  ↓
core/net/MessageProcessor.processSnapshot()
  ↓
core/state/GameState (update entities)
core/state/interpolation (add snapshot to buffer)
  ↓
core/sim/interpolator (compute visual positions from buffer)
core/ui-model (derive HUD data from state)
  ↓
render/three/Scene2D.update(state, interpolatedPositions)
render/three/hud/HUDOverlay.update(hudViewModel)
  ↓
Three.js render
```

**Input flow:**
```
DOM events
  ↓
render/three/input-adapter/DOMInputAdapter
  ↓
core/input/InputManager (update input state)
  ↓
core/input/InputManager.getMoveIntent()
  ↓
core/net/IntentSender.sendMove(intent)
  ↓
Socket.io → Server
```

---

## Interpolation and Fixed-Step Loop

### Interpolation Approach

**Goal:** Smooth rendering despite network jitter and mismatched server tick vs. client FPS.

**Strategy:**
1. **Buffer snapshots:** Keep last 3-5 server snapshots in a ring buffer with timestamps
2. **Interpolation delay:** Render at `currentTime - INTERPOLATION_DELAY_MS` (e.g., 100ms behind)
3. **Interpolate between snapshots:** For each entity, find the two snapshots bracketing the render time and lerp position/rotation between them
4. **Extrapolate if needed:** If render time exceeds the latest snapshot (late packets), extrapolate forward using last known velocity for up to `EXTRAPOLATION_MAX_MS` (e.g., 200ms), then freeze

**Buffer size:** 5 snapshots (covers ~83ms at 60 ticks/sec, enough for jitter tolerance)

**Handling late/dropped packets:**
- If a snapshot arrives late (out-of-order), insert it into the buffer in correct timestamp order
- If a snapshot is dropped, interpolator will extrapolate briefly then freeze until next snapshot
- Renderer shows a "reconnecting" indicator if no snapshots for >1 second

**Server tick vs. client FPS:**
- Server ticks at 60Hz (16.67ms per tick)
- Client renders at vsync (usually 60fps, but could be 120fps or 30fps)
- Fixed-step accumulator on client runs at server tick rate (16.67ms steps)
- Rendering happens every frame using interpolated positions from the latest fixed step

**Pseudocode (interpolator.ts):**
```
getInterpolatedPosition(entityId, renderTime):
  snapshots = interpolationBuffer.getSnapshotsInRange(renderTime - 50ms, renderTime + 50ms)
  if snapshots.length < 2:
    // Not enough snapshots, extrapolate or freeze
    latestSnapshot = interpolationBuffer.getLatest()
    if renderTime - latestSnapshot.time < EXTRAPOLATION_MAX_MS:
      return extrapolate(latestSnapshot, renderTime)
    else:
      return latestSnapshot.position  // Freeze

  // Find two snapshots bracketing renderTime
  [snapshotBefore, snapshotAfter] = findBracketingSnapshots(snapshots, renderTime)
  alpha = (renderTime - snapshotBefore.time) / (snapshotAfter.time - snapshotBefore.time)
  return lerp(snapshotBefore.position, snapshotAfter.position, alpha)
```

### Fixed-Step Loop

**Why:** Decouple simulation rate from rendering rate; ensures consistent physics/logic updates.

**Implementation:**
- Accumulator pattern: accumulate deltaTime until it exceeds FIXED_STEP (16.67ms for 60Hz)
- Step simulation in fixed increments
- Render after stepping (possibly multiple steps per frame if client stutters, or zero steps if running faster than 60fps)

**Benefits:**
- Deterministic simulation (same inputs → same outputs)
- Smooth rendering even if server tick rate changes (just adjust FIXED_STEP)
- Easy to add client-side prediction later (run same logic as server in fixed steps)

---

## Supporting Future 3D Scene/Camera

### Abstraction Strategy

**Camera descriptor (from `core/sim/camera.ts`):**
```typescript
{
  target: { x: number, y: number, z?: number },  // World position (z optional for 2D)
  zoom: number,                                   // Abstract zoom level (mapped to ortho size or perspective distance)
  orientation?: { pitch: number, yaw: number },   // For 3D camera
  shake?: { intensity: number, duration: number },
  easing: number
}
```

**2D camera (Camera2D.ts):**
- Maps `zoom` → orthographic size
- Ignores `z` and `orientation`

**3D camera (future Camera3D.ts):**
- Maps `zoom` → distance from target
- Uses `z` for target height
- Uses `orientation` for pitch/yaw
- Still consumes same descriptor shape from core/sim

### Adding 3D Scene

**Proposed structure:**
```
render/three/scene3d/
├── Scene3D.ts           # Perspective scene for 3D phase
├── Terrain.ts           # 3D terrain/environment
├── Players3D.ts         # 3D player models (instead of billboards)
├── Nutrients3D.ts       # 3D nutrient meshes
└── ...
```

**Switch between 2D and 3D:**
- `bootstrap.ts` checks evolution stage or config flag
- Instantiates `Scene2D` or `Scene3D` accordingly
- Both implement same interface: `update(state, interpolatedPositions)`, `dispose()`
- RenderLoop doesn't care which scene is active

**Core changes needed:** None. Core already outputs positions and descriptors; renderer interprets them.

**Camera changes:**
- `CameraController` checks camera descriptor for `orientation` field
- If present, switches to perspective projection and applies pitch/yaw
- If absent, uses orthographic

---

## Migration Plan

### Phase 1: Carve Current Phaser Client

**Goal:** Extract renderer-agnostic logic from `client/src/scenes/GameScene.ts` into core modules without breaking Phaser.

**Steps:**

1. **Create `core/state/GameState.ts`:**
   - Move player/nutrient/obstacle maps from GameScene into GameState
   - Keep Phaser sprites in GameScene for now, but read from GameState

2. **Create `core/net/SocketManager.ts` and `MessageProcessor.ts`:**
   - Move socket event listeners from GameScene into SocketManager
   - Move snapshot/diff processing logic into MessageProcessor
   - MessageProcessor updates GameState instead of directly updating Phaser sprites

3. **Create `core/input/InputManager.ts`:**
   - Move keyboard/pointer input handling from GameScene into InputManager
   - InputManager calls `core/net/IntentSender` to send intents

4. **Create `core/sim/interpolator.ts`:**
   - Add interpolation buffer to GameState
   - Implement interpolation logic (for now, just lerp between last two snapshots)
   - GameScene uses interpolated positions instead of direct state positions

5. **Create `core/ui-model/HUDViewModel.ts`:**
   - Extract HUD logic from GameScene (energy bar, stage indicator, etc.)
   - HUDViewModel derives data from GameState
   - GameScene renders HUD from ViewModel

6. **Test with Phaser:**
   - Phaser still works, but now driven by core modules
   - GameScene becomes a "Phaser adapter" that consumes core state and renders

### Phase 2: Add Three.js Renderer (Parallel)

**Goal:** Build Three.js renderer alongside Phaser; switch via config flag.

**Steps:**

1. **Create `render/three/scene2d/Scene2D.ts`:**
   - Implement orthographic scene with grid, particles, trails
   - Read from GameState via selectors
   - Use interpolated positions from core/sim

2. **Create `render/three/camera/Camera2D.ts` and `CameraController.ts`:**
   - Implement ortho camera driven by core/sim camera descriptors
   - Test camera follow and zoom

3. **Create `render/loop/RenderLoop.ts`:**
   - Implement fixed-step loop with interpolation
   - Wire up to Scene2D and CameraController

4. **Create `render/three/hud/HUDOverlay.ts`:**
   - DOM overlay for HUD
   - Consumes HUDViewModel from core

5. **Add config flag in `app/bootstrap.ts`:**
   - `USE_THREE = true` → initialize Three.js renderer
   - `USE_THREE = false` → initialize Phaser renderer (existing GameScene)
   - Both renderers consume same core state

6. **Test with Three.js:**
   - Switch flag, run game, verify visuals match Phaser
   - Iterate on rendering quality (materials, postprocessing, etc.)

### Phase 3: Deprecate Phaser

**Goal:** Remove Phaser once Three.js renderer is feature-complete.

**Steps:**

1. **Verify feature parity:**
   - All Phaser visuals replicated in Three.js (grid, particles, trails, nutrients, obstacles, players)
   - HUD matches Phaser HUD
   - Performance is acceptable

2. **Remove Phaser dependencies:**
   - Delete `client/src/scenes/GameScene.ts`
   - Remove Phaser from `package.json`
   - Remove `USE_THREE` flag (Three.js is now the only renderer)

3. **Clean up:**
   - Remove any Phaser-specific code from core (should be none)
   - Update docs and README

---

## Recommended Helper Libraries

### Three.js Ecosystem

**Core:**
- `three` (v0.160+) - Main library
- `@types/three` - TypeScript types

**Utilities:**
- `three-stdlib` - Standard utilities (Line2, OrbitControls, etc.)
- `postprocessing` - Efficient postprocessing effects (UnrealBloomPass, etc.)

**Where used:**
- `render/three/scene2d/Trails.ts` - Line2 for trails
- `render/postprocessing/composer.ts` - EffectComposer, UnrealBloomPass
- `render/three/debug/` - OrbitControls for debug camera

### Tweening/Animation

**Library:** `gsap` or `popmotion`

**Where used:**
- `render/three/camera/effects.ts` - Camera shake tweens
- `render/three/hud/` - HUD animations (number count-ups, transitions)

**Alternative:** Write custom lerp-based animations in `core/sim/utils.ts` (no external dependency)

### UI/Debug

**Library:** `leva` (lightweight, React-free debug GUI)

**Where used:**
- `render/three/debug/DebugPanel.ts` - Runtime tuning of `core/config/clientConfig`

### Performance Monitoring

**Library:** `stats.js` or Three.js built-in `Stats`

**Where used:**
- `render/three/debug/DebugOverlay.ts` - FPS/MS stats

---

## Testing Strategy

### Unit Tests (Vitest)

**Core modules:**
- `core/state/selectors.ts` - Test derived data logic
- `core/sim/interpolator.ts` - Test interpolation math (lerp, extrapolation, edge cases)
- `core/sim/camera.ts` - Test camera target calculation
- `core/ui-model/` - Test HUD formatting and derivation

**Test approach:**
- Create mock GameState snapshots
- Call functions, assert outputs
- No renderer dependencies, fast tests

### Integration Tests

**Core + net:**
- Create mock SocketManager (emit fake snapshots)
- Verify MessageProcessor updates GameState correctly
- Verify interpolation buffer fills and purges correctly

**Core + renderer:**
- Create mock GameState
- Verify Scene2D.update() correctly positions meshes (check mesh.position.x/y)
- Verify HUDOverlay correctly displays formatted data

### E2E Tests (Playwright)

**Full client:**
- Start dev server with mock server (emit fake snapshots at 60Hz)
- Load client in Playwright
- Verify visual rendering (screenshot comparison)
- Verify input (send key events, check network messages sent)
- Verify HUD updates (energy decreases, stage changes, etc.)

---

## Open Questions and Future Considerations

### Client-Side Prediction

**Current:** Client renders interpolated server state (no prediction)

**Future:** Add client-side prediction for local player:
1. Client simulates local player movement immediately (responsive input)
2. Server sends authoritative position
3. Client reconciles prediction with server state (rollback if mismatch)

**Where to add:**
- `core/sim/predictor.ts` - Client-side simulation of player movement (same logic as server)
- `core/net/MessageProcessor.ts` - Reconciliation logic (compare predicted vs. server position)

**Impact on architecture:** Minimal. Core/sim already has movement helpers; just run them predictively.

### Lag Compensation

**Current:** No lag compensation (server decides hits based on current state)

**Future:** Server rewinds time to client's input timestamp, checks hit, then fast-forwards

**Impact on architecture:** None on client (server-side feature). Client just sends input timestamps.

### Adaptive Interpolation Delay

**Current:** Fixed 100ms interpolation delay

**Future:** Dynamically adjust delay based on network jitter (measure RTT variance, increase delay if jittery)

**Where to add:**
- `core/net/MessageProcessor.ts` - Track snapshot arrival times, calculate jitter
- `core/config/clientConfig.ts` - Update `INTERPOLATION_DELAY_MS` dynamically

### Entity Pooling

**Current:** Create/destroy entities as server sends updates

**Future:** Object pooling for entities (reuse Nutrient objects instead of creating/destroying)

**Where to add:**
- `core/state/entities.ts` - Pool helpers (getFromPool, returnToPool)
- `render/three/scene2d/` - Reuse meshes instead of creating/disposing

**Impact:** Better performance (fewer GC pauses), especially for high entity count

---

## Summary

This architecture cleanly separates concerns:

- **Core** owns game state, networking, simulation, input, and UI models (renderer-agnostic)
- **Renderer** consumes read-only state and camera descriptors, produces visuals (Three.js-specific, swappable)
- **Glue (bootstrap)** wires everything together and starts the main loop

The migration from Phaser to Three.js can be done incrementally:
1. Extract logic into core (keep Phaser working)
2. Build Three.js renderer in parallel (switch via flag)
3. Deprecate Phaser once feature-complete

Adding a 3D scene/camera later requires zero changes to core; just swap in `Scene3D` and `Camera3D` in the renderer layer.

This design is future-proof, testable, and maintainable.
