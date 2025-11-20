# Godcell Client-Side Netcode & Camera Smoothing
## Technical Specification

---

## A. Data Structures for Authoritative Snapshots

### Core Types

```typescript
/**
 * Single authoritative position snapshot from server
 * Timestamp is client-side Phaser time (`this.time.now`) when packet received
 */
interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;  // Approximate velocity (derived from delta between packets)
  vy: number;
  t: number;   // Client timestamp in ms when this snapshot was received
}

/**
 * Circular buffer of recent authoritative snapshots for one player
 * Maintains snapshots in chronological order for interpolation
 */
class PlayerHistory {
  private snapshots: PlayerSnapshot[];
  private maxSize: number;
  private head: number;  // Next write position (wraps around)
  private count: number; // Number of valid snapshots

  constructor(maxSize: number = 64) {
    this.snapshots = new Array(maxSize);
    this.maxSize = maxSize;
    this.head = 0;
    this.count = 0;
  }

  /**
   * Add a new snapshot at the current head position
   * Overwrites oldest snapshot when buffer is full
   */
  add(x: number, y: number, t: number): void {
    const prev = this.getLatest();

    const vx = prev ? (x - prev.x) / (t - prev.t || 1) : 0;
    const vy = prev ? (y - prev.y) / (t - prev.t || 1) : 0;

    this.snapshots[this.head] = { x, y, vx, vy, t };
    this.head = (this.head + 1) % this.maxSize;
    this.count = Math.min(this.count + 1, this.maxSize);
  }

  /**
   * Get the latest snapshot (most recent t)
   */
  getLatest(): PlayerSnapshot | null {
    if (this.count === 0) return null;
    const idx = (this.head - 1 + this.maxSize) % this.maxSize;
    return this.snapshots[idx];
  }

  /**
   * Get the two snapshots surrounding a target time
   *
   * Returns [s0, s1] where:
   * - s0.t <= renderTime <= s1.t
   * - s0 is the latest snapshot at or before renderTime
   * - s1 is the earliest snapshot at or after renderTime
   *
   * Edge cases:
   * - Returns [null, s1] if renderTime < oldest snapshot
   * - Returns [s0, null] if renderTime > newest snapshot
   * - Returns [null, null] if no snapshots exist
   */
  getBounds(renderTime: number): [PlayerSnapshot | null, PlayerSnapshot | null] {
    if (this.count === 0) return [null, null];

    // Linear scan from oldest to newest (buffer is small, ~20)
    let s0: PlayerSnapshot | null = null;
    let s1: PlayerSnapshot | null = null;

    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.maxSize) % this.maxSize;
      const snap = this.snapshots[idx];

      if (snap.t <= renderTime) {
        s0 = snap;
      }
      if (snap.t >= renderTime) {
        s1 = snap;
        break;
      }
    }

    // If renderTime is after newest snapshot
    if (s1 === null) {
      s1 = this.getLatest();
    }

    // If renderTime is before oldest snapshot
    if (s0 === null) {
      // s1 is already the earliest snapshot
    }

    return [s0, s1];
  }

  /**
   * Remove snapshots older than cutoffTime
   * Called periodically to prevent unbounded growth
   */
  trim(cutoffTime: number): void {
    // Mark old snapshots as logically removed by shrinking `count`.
    // We do not re-pack the array; indices before the new oldest element are treated as invalid.
    let removed = 0;
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.maxSize) % this.maxSize;
      if (this.snapshots[idx].t < cutoffTime) {
        removed++;
      } else {
        break; // Rest are newer
      }
    }
    this.count -= removed;
  }
}

/**
 * Global history map: playerId -> PlayerHistory
 * Note: local player is also stored here primarily for debugging/metrics.
 * The local visual position comes from LocalPlayerState prediction, not from interpolating this history.
 */
type PlayerHistoryMap = Map<string, PlayerHistory>;
```

### Configuration Constants

```typescript
const NETCODE_CONFIG = {
  // Interpolation delay - render the world N ms in the past
  // This gives us a buffer of snapshots to interpolate between
  // Larger = smoother but more visual latency; smaller = more responsive but jerkier
  INTERP_DELAY_MS: 100,

  // Maximum history to keep per player (time window)
  MAX_HISTORY_MS: 1000,

  // Maximum extrapolation time beyond newest snapshot
  // If renderTime > latestSnapshot.t + MAX_EXTRAP_MS, clamp extrapolation
  MAX_EXTRAP_MS: 50,

  // Prediction error threshold - ignore corrections below this (pixels)
  PREDICTION_ERROR_EPSILON: 2.0,

  // Prediction correction blend time (ms)
  // When server disagrees, smooth correction over this window
  PREDICTION_CORRECTION_TIME_MS: 150,

  // How often to trim old snapshots (ms)
  HISTORY_TRIM_INTERVAL_MS: 1000,
};
```

---

## B. Interpolation / Extrapolation Algorithm for Rendering

### Algorithm Overview

```typescript
/**
 * Called every Phaser frame for each remote (non-local) player
 *
 * Process:
 * 1. Compute renderTime = now - INTERP_DELAY_MS
 * 2. Find bounding snapshots in player's history
 * 3. Interpolate or extrapolate to compute visual position
 * 4. Update sprite/container to visual position
 */
function updateRemotePlayerVisualPosition(
  playerId: string,
  history: PlayerHistory,
  now: number // Phaser `this.time.now` (single client time base)
): { x: number, y: number, debugInfo: string } {

  const renderTime = now - NETCODE_CONFIG.INTERP_DELAY_MS;
  const [s0, s1] = history.getBounds(renderTime);

  // Case 1: No data at all
  if (s0 === null && s1 === null) {
    // Fallback: no history yet (new player or extreme packet loss).
    // We signal 'NO_DATA' and let the caller decide whether to keep the current sprite position.
    return {
      x: 0,
      y: 0,
      debugInfo: 'NO_DATA'
    };
  }

  // Case 2: Have both bounds - clean interpolation
  if (s0 !== null && s1 !== null && s0 !== s1) {
    const span = s1.t - s0.t;
    const alpha = span > 0 ? (renderTime - s0.t) / span : 0;
    const x = s0.x + (s1.x - s0.x) * alpha;
    const y = s0.y + (s1.y - s0.y) * alpha;
    return { x, y, debugInfo: 'INTERP' };
  }

  // Case 3: Only one snapshot (either before or after renderTime)
  const snap = s0 ?? s1!;
  const latest = history.getLatest()!;

  // If renderTime is slightly beyond newest snapshot, allow bounded extrapolation
  const dt = renderTime - latest.t;

  if (dt > 0 && dt <= NETCODE_CONFIG.MAX_EXTRAP_MS) {
    const x = latest.x + latest.vx * dt;
    const y = latest.y + latest.vy * dt;
    return { x, y, debugInfo: 'EXTRAP' };
  }

  // If too far beyond, or renderTime is before oldest, just use closest snapshot
  return {
    x: snap.x,
    y: snap.y,
    debugInfo: dt > 0 ? 'EXTRAP_CLAMP' : 'PAST_CLAMP'
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

### Integration in Phaser Update Loop

```typescript
class GameScene extends Phaser.Scene {
  private playerHistories: PlayerHistoryMap = new Map();
  private lastHistoryTrimTime: number = 0;

  update(time: number, delta: number): void {
    const now = this.time.now; // Single time base for snapshots, interpolation, and prediction

    // Periodic cleanup: trim old snapshots
    if (now - this.lastHistoryTrimTime > NETCODE_CONFIG.HISTORY_TRIM_INTERVAL_MS) {
      const cutoff = now - NETCODE_CONFIG.MAX_HISTORY_MS;
      this.playerHistories.forEach(history => history.trim(cutoff));
      this.lastHistoryTrimTime = now;
    }

    // Update all remote players
    this.playerHistories.forEach((history, playerId) => {
      if (playerId === this.localPlayerId) return; // Skip local player (handled separately)

      const sprite = this.playerSprites.get(playerId);
      if (!sprite) return;

      const { x, y, debugInfo } = updateRemotePlayerVisualPosition(playerId, history, now);
      if (debugInfo !== 'NO_DATA') {
        sprite.setPosition(x, y);
      }

      // Debug logging if enabled
      if (DEBUG_INTERP) {
        console.log(`[Interp] ${playerId}: ${debugInfo} -> (${x.toFixed(1)}, ${y.toFixed(1)})`);
      }
    });

    // ... continue with local player prediction (see section C)
    // ... continue with camera anchor update (see section D)
  }

  // Called when 'playerMoved' socket event received
  onPlayerMoved(playerId: string, x: number, y: number): void {
    const now = this.time.now;

    if (!this.playerHistories.has(playerId)) {
      this.playerHistories.set(playerId, new PlayerHistory());
    }

    this.playerHistories.get(playerId)!.add(x, y, now);

    // If this is the local player, also trigger reconciliation (see section C)
    if (playerId === this.localPlayerId) {
      this.reconcileLocalPlayer(x, y, now);
    }
  }
}
```

**Memory/GC optimization notes:**
- `PlayerHistory` is a fixed-size circular buffer, no per-frame allocations
- `PlayerHistoryMap` grows with number of players, not with time
- `trim()` only adjusts `count` and does not allocate

**Edge case behavior summary:**
- New player with no snapshots: position unchanged until first packet (`NO_DATA`)
- Intermittent packet loss: short gaps filled by extrapolation up to `MAX_EXTRAP_MS`
- Long gaps: snaps to last known position (`EXTRAP_CLAMP`)

---

## C. Local Player Prediction and Reconciliation

### Local Player State

```typescript
/**
 * Local player state for client-side prediction
 * This is the authoritative source for the local player's visual position
 */
interface LocalPlayerState {
  // Predicted position based on input
  predictedX: number;
  predictedY: number;

  // Predicted velocity (based on current input)
  vx: number;
  vy: number;

  // Last update timestamp (client time)
  lastUpdateTime: number;

  // Active correction (if any)
  correctionX: number;
  correctionY: number;
  correctionStartTime: number; // When correction began
  correctionDuration: number;  // How long to blend (ms)

  // Last server-authoritative position received
  lastServerX: number;
  lastServerY: number;
  lastServerTime: number;
}
```

### Prediction Algorithm

```typescript
/**
 * Update local player prediction based on input
 * Called every frame BEFORE rendering
 *
 * Process:
 * 1. Apply input to predicted velocity
 * 2. Integrate velocity to predicted position
 * 3. Apply any active correction blending
 * 4. Return final visual position for rendering
 */
function updateLocalPlayerPrediction(
  state: LocalPlayerState,
  input: InputState, // Current key states
  dt: number, // Delta time in seconds
  now: number
): { visualX: number, visualY: number } {

  // Step 1: Update velocity from input
  // (This matches whatever movement model the game uses)
  const speed = PLAYER_SPEED; // From game config
  state.vx = 0;
  state.vy = 0;

  if (input.up) state.vy -= speed;
  if (input.down) state.vy += speed;
  if (input.left) state.vx -= speed;
  if (input.right) state.vx += speed;

  // Normalize diagonal movement
  if (state.vx !== 0 && state.vy !== 0) {
    const mag = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
    state.vx = (state.vx / mag) * speed;
    state.vy = (state.vy / mag) * speed;
  }

  // Step 2: Integrate velocity -> position
  state.predictedX += state.vx * dt;
  state.predictedY += state.vy * dt;
  state.lastUpdateTime = now;

  // Step 3: Apply any active correction
  let correctionX = 0;
  let correctionY = 0;

  if (state.correctionStartTime > 0) {
    const elapsed = now - state.correctionStartTime;
    const duration = state.correctionDuration;

    // Clamp between 0 and 1
    const progress = Math.min(Math.max(elapsed / duration, 0), 1);

    // Smoothstep easing (optional)
    const t = progress * progress * (3 - 2 * progress);

    correctionX = state.correctionX * (1 - t);
    correctionY = state.correctionY * (1 - t);

    // If correction is complete, clear it
    if (progress >= 1) {
      state.correctionStartTime = 0;
      state.correctionX = 0;
      state.correctionY = 0;
    }
  }

  // Step 4: Compute final visual position
  const visualX = state.predictedX + correctionX;
  const visualY = state.predictedY + correctionY;

  return { visualX, visualY };
}

// IMPORTANT: client-side movement integration must exactly match the server's movement model.
// - Use the same PLAYER_SPEED and any friction/acceleration rules.
// - Apply the same diagonal normalization strategy.
// - Use the same timestep semantics (fixed vs variable).
// If these diverge, prediction error will continuously accumulate and corrections will be visible.

/**
 * Reconcile local prediction with authoritative server snapshot
 * Called when 'playerMoved' event received for local player
 *
 * Process:
 * 1. Compute prediction error (difference between predicted and server position)
 * 2. If error > epsilon, initiate smooth correction
 * 3. Store correction vector to be blended over time
 */
function reconcileLocalPlayer(
  state: LocalPlayerState,
  serverX: number,
  serverY: number,
  serverTime: number
): void {
  state.lastServerX = serverX;
  state.lastServerY = serverY;
  state.lastServerTime = serverTime;

  const errorX = serverX - state.predictedX;
  const errorY = serverY - state.predictedY;
  const errorDist = Math.sqrt(errorX * errorX + errorY * errorY);

  // Small error: ignore (no visible correction)
  if (errorDist < NETCODE_CONFIG.PREDICTION_ERROR_EPSILON) {
    return;
  }

  // Large error: initiate correction blend
  state.correctionX = errorX;
  state.correctionY = errorY;
  state.correctionStartTime = serverTime;
  state.correctionDuration = NETCODE_CONFIG.PREDICTION_CORRECTION_TIME_MS;
}
```

### Integration with GameScene

```typescript
class GameScene extends Phaser.Scene {
  private localPlayerState: LocalPlayerState;
  private localPlayerId: string | null = null;

  // Input state cached each frame
  private inputState: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  create(): void {
    // Initialize LocalPlayerState when we know local player id & spawn
    this.localPlayerState = {
      predictedX: spawnX,
      predictedY: spawnY,
      vx: 0,
      vy: 0,
      lastUpdateTime: this.time.now,
      correctionX: 0,
      correctionY: 0,
      correctionStartTime: 0,
      correctionDuration: 0,
      lastServerX: spawnX,
      lastServerY: spawnY,
      lastServerTime: this.time.now,
    };

    // Setup input listeners to update inputState
    this.setupInput();
  }

  update(time: number, delta: number): void {
    const dt = delta / 1000;
    const now = this.time.now;

    // 1. Update local prediction BEFORE applying to sprite/camera
    if (this.localPlayerId) {
      const { visualX, visualY } = updateLocalPlayerPrediction(
        this.localPlayerState,
        this.inputState,
        dt,
        now
      );

      // Apply to local player sprite
      const localSprite = this.playerSprites.get(this.localPlayerId);
      if (localSprite) {
        localSprite.setPosition(visualX, visualY);
      }
    }

    // 2. Update remote players via interpolation (see section B)
    this.updateRemotePlayers(now);

    // 3. Update camera anchor using local player's visual position (see section D)
    this.updateCameraAnchor();
  }

  // Called when 'playerMoved' socket event received for local player
  onLocalPlayerMoved(x: number, y: number, t: number): void {
    reconcileLocalPlayer(this.localPlayerState, x, y, t);

    // Also record in history for debugging/metrics
    const history = this.playerHistories.get(this.localPlayerId!)!;
    history.add(x, y, t);
  }

  private setupInput(): void {
    const cursors = this.input.keyboard!.createCursorKeys();

    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp' or event.code === 'KeyW') this.inputState.up = true;
      if (event.code === 'ArrowDown' or event.code === 'KeyS') this.inputState.down = true;
      if (event.code === 'ArrowLeft' or event.code === 'KeyA') this.inputState.left = true;
      if (event.code === 'ArrowRight' or event.code === 'KeyD') this.inputState.right = true;
    });

    this.input.keyboard!.on('keyup', (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp' or event.code === 'KeyW') this.inputState.up = false;
      if (event.code === 'ArrowDown' or event.code === 'KeyS') this.inputState.down = false;
      if (event.code === 'ArrowLeft' or event.code === 'KeyA') this.inputState.left = false;
      if (event.code === 'ArrowRight' or event.code === 'KeyD') this.inputState.right = false;
    });
  }
}
```

**Key properties of this scheme:**
- **Zero input latency**: Local movement happens immediately in `update()`
- **Smooth corrections**: Errors blended over 150ms, not snapped
- **Server-authoritative**: Prediction always corrects toward server truth
- **Simple**: No input buffering, no rollback, no replay
- **Robust**: Large errors (teleports, respawns) handled gracefully via correction blend

---

## D. Camera Design: Virtual Anchor, Deadzone, and Soft Bounds

### Camera Anchor Object

```typescript
/**
 * Virtual point that the camera follows
 * Updated each frame to track smoothed local player position
 * Separate from player sprite to allow independent camera smoothing
 */
class CameraAnchor {
  x: number = 0;
  y: number = 0;

  // Internal smoothing so the anchor can lag smoothly toward the player
  private targetX: number = 0;
  private targetY: number = 0;
  private smoothFactor: number = CAMERA_CONFIG.ANCHOR_SMOOTH_FACTOR; // 0 = no movement, 1 = instant snap

  /**
   * Update anchor target (called each frame with local player visual position)
   */
  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Apply smoothing toward the latest target
   * Camera follow lerp is set to 1; all smoothing is done here to avoid double-smoothing.
   */
  update(dt: number): void {
    this.x = lerp(this.x, this.targetX, this.smoothFactor);
    this.y = lerp(this.y, this.targetY, this.smoothFactor);
  }
}
```

### Deadzone Configuration

```typescript
const CAMERA_CONFIG = {
  // Deadzone: rectangular area where camera doesn't move
  // Anchor can move freely within deadzone, camera only scrolls when crossing edges
  DEADZONE_WIDTH: 200,   // pixels (centered on camera)
  DEADZONE_HEIGHT: 150,

  // Camera anchor smoothing factor (0 = no movement, 1 = instant snap to target)
  ANCHOR_SMOOTH_FACTOR: 0.1,

  // Phaser follow lerp is effectively disabled (we smooth via CameraAnchor instead)
  FOLLOW_LERP_X: 1.0,
  FOLLOW_LERP_Y: 1.0,

  // Soft bounds easing: when clamping to world edges
  // Higher = gentler approach to bounds (0 = hard clamp, 1 = no clamp)
  SOFT_BOUNDS_LERP: 0.2,

  // World bounds (should match server GAME_CONFIG.WORLD_WIDTH/HEIGHT)
  WORLD_WIDTH: 4800,
  WORLD_HEIGHT: 3200,
};
```

### Camera Setup and Update

```typescript
class GameScene extends Phaser.Scene {
  private cameraAnchor: CameraAnchor;
  private mainCamera: Phaser.Cameras.Scene2D.Camera;
  private uiCamera: Phaser.Cameras.Scene2D.Camera;

  create(): void {
    // Create camera anchor
    this.cameraAnchor = new CameraAnchor();

    // Main world camera
    this.mainCamera = this.cameras.main;
    // NOTE: do NOT call setBounds here; world limits are enforced via applySoftBounds()

    // Create deadzone (centered on camera viewport)
    const deadzoneX = (this.mainCamera.width - CAMERA_CONFIG.DEADZONE_WIDTH) / 2;
    const deadzoneY = (this.mainCamera.height - CAMERA_CONFIG.DEADZONE_HEIGHT) / 2;

    this.mainCamera.setDeadzone(
      CAMERA_CONFIG.DEADZONE_WIDTH,
      CAMERA_CONFIG.DEADZONE_HEIGHT
    );

    // Follow the anchor. Phaser lerp is set to 1; smoothing is handled by CameraAnchor to avoid double-smoothing.
    this.mainCamera.startFollow(
      this.cameraAnchor,
      false, // Don't round pixels (we want smooth sub-pixel movement)
      CAMERA_CONFIG.FOLLOW_LERP_X,
      CAMERA_CONFIG.FOLLOW_LERP_Y
    );

    // UI camera - separate, doesn't follow anything
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('UICamera');
    // Assumes `worldLayer` holds all world objects and `uiContainer` holds all UI
    this.uiCamera.ignore(this.worldLayer); // UI camera ignores world objects

    // Make sure world camera ignores UI objects
    this.mainCamera.ignore(this.uiContainer); // Assuming UI is in a container
  }

  update(time: number, delta: number): void {
    // ... local player prediction updates cameraAnchor.x/y ...

    // Update camera anchor position from local player visual position
    if (this.localPlayerId) {
      const { visualX, visualY } = this.getLocalPlayerVisualPosition();
      this.cameraAnchor.setTarget(visualX, visualY);
      this.cameraAnchor.update(delta / 1000);
    }

    // Apply soft bounds clamping AFTER Phaser's follow logic
    this.applySoftBounds();
  }

  /**
   * Soft bounds clamping
   *
   * Process:
   * 1. Compute ideal camera scroll position (after follow + deadzone)
   * 2. Compute hard-clamped position (respecting world bounds)
   * 3. Lerp actual camera toward clamped position (soft approach)
   *
   * This prevents the camera from snapping when hitting edges
   * Instead, it gently eases into the bound limit
   */
  private applySoftBounds(): void {
    const cam = this.mainCamera;

    // Compute hard bounds (where camera must not go beyond)
    const minX = 0;
    const maxX = CAMERA_CONFIG.WORLD_WIDTH - cam.width;
    const minY = 0;
    const maxY = CAMERA_CONFIG.WORLD_HEIGHT - cam.height;

    // Get current camera scroll (after Phaser's follow logic)
    const currentX = cam.scrollX;
    const currentY = cam.scrollY;

    // Compute clamped scroll
    const clampedX = Phaser.Math.Clamp(currentX, minX, maxX);
    const clampedY = Phaser.Math.Clamp(currentY, minY, maxY);

    const lerp = CAMERA_CONFIG.SOFT_BOUNDS_LERP;

    // Softly approach the clamped position
    cam.scrollX = currentX + (clampedX - currentX) * lerp;
    cam.scrollY = currentY + (clampedY - currentY) * lerp;
  }

  /**
   * Helper: get local player visual position (from prediction system)
   * This is the position that the camera should follow, not raw server data
   */
  private getLocalPlayerVisualPosition(): { visualX: number, visualY: number } {
    // Assumes localPlayerState is kept up-to-date by prediction system
    const { predictedX, predictedY, correctionX, correctionY } = this.localPlayerState;
    return {
      visualX: predictedX + correctionX,
      visualY: predictedY + correctionY,
    };
  }
}
```

**Key camera behaviors:**
- Camera follows **cameraAnchor**, not raw sprite
- Deadzone prevents camera from moving until anchor leaves central region
- Soft bounds ensure camera never snaps hard against world edges
- UI camera remains unaffected and does not follow the anchor

---

## E. Integration with Existing Per-Frame Effects

### Requirement

All effects that previously read raw sprite/container positions each frame (e.g. trails, glow, particles) must now read the **smoothed/predicted** positions that drive rendering.

### Sprite vs. Netcode State

- `LocalPlayerState` and `PlayerHistory` hold netcode state
- Each frame we **apply** the computed visual positions to the actual sprite containers
- Effects should **only** read from the sprite containers, not from netcode structures

### Update Order

```typescript
class GameScene extends Phaser.Scene {
  update(time: number, delta: number): void {
    const dt = delta / 1000;
    const now = this.time.now;

    // 1. Update local player prediction and apply to sprite
    this.updateLocalPlayerPredictionAndSprite(dt, now);

    // 2. Update remote players via interpolation and apply to sprites
    this.updateRemotePlayers(now);

    // 3. Update camera anchor and camera
    this.updateCameraAnchorAndCamera(delta);

    // 4. Sync any other visual-only containers to sprite positions
    this.syncSpritesToVisualPositions();

    // 5. NOW run effects that read positions
    this.updateTrails();      // Reads sprite.x/y (now smoothed)
    this.updateParticles();   // Reads sprite.x/y (now smoothed)
    this.updateGlowEffects(); // Reads sprite.x/y (now smoothed)

    // Effects now see smooth, predicted positions - no jitter
  }
}
```

### Migration Checklist

For each effect that currently reads player positions:

1. **Verify it reads from `playerSprites` containers** (not raw network data)
2. **Ensure it runs AFTER `syncSpritesToVisualPositions()`** in update order
3. **Test**: Effects should now be smooth automatically

**Effects that should NOT change:**
- UI overlays that derive from logical state (e.g. health, ammo) rather than positions
- Any logic that uses raw server positions for gameplay decisions (if any)

---

## F. Debugging and Observability

### Debug Overlay

```typescript
class DebugOverlay {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  private graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.text = scene.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#00FF00',
    }).setScrollFactor(0);

    this.graphics = scene.add.graphics();
    this.graphics.setScrollFactor(0);
  }

  update(data: {
    interpDelayMs: number;
    avgSnapshotAge: number;
    localPlayerX: number;
    localPlayerY: number;
    localPredictionError: number;
    correctionActive: boolean;
    cameraAnchorX: number;
    cameraAnchorY: number;
    cameraScrollX: number;
    cameraScrollY: number;
    hitBounds: boolean;
    playerStates: Map<string, string>; // playerId -> "INTERP" | "EXTRAP" | etc.
  }): void {

    const lines = [
      `=== NETCODE DEBUG ===`,
      `Interp Delay: ${data.interpDelayMs}ms`,
      `Avg Snapshot Age: ${data.avgSnapshotAge.toFixed(0)}ms`,
      ``,
      `Local Player:`,
      `  Pos: (${data.localPlayerX.toFixed(1)}, ${data.localPlayerY.toFixed(1)})`,
      `  Prediction Error: ${data.localPredictionError.toFixed(2)}px`,
      `  Correction: ${data.correctionActive ? 'ACTIVE' : 'none'}`,
      ``,
      `Camera:`,
      `  Anchor: (${data.cameraAnchorX.toFixed(1)}, ${data.cameraAnchorY.toFixed(1)})`,
      `  Scroll: (${data.cameraScrollX.toFixed(1)}, ${data.cameraScrollY.toFixed(1)})`,
      `  Bounds: ${data.hitBounds ? 'CLAMPING' : 'free'}`,
      ``,
      `Remote Players:`,
    ];

    data.playerStates.forEach((state, id) => {
      lines.push(`  ${id.substring(0, 8)}: ${state}`);
    });

    this.text.setText(lines.join('\n'));

    // Draw visual debug
    this.graphics.clear();

    // Draw camera deadzone (in world space)
    const cam = this.scene.cameras.main;
    const deadzoneWorldX = cam.scrollX + (cam.width - CAMERA_CONFIG.DEADZONE_WIDTH) / 2;
    const deadzoneWorldY = cam.scrollY + (cam.height - CAMERA_CONFIG.DEADZONE_HEIGHT) / 2;

    this.graphics.lineStyle(2, 0x00ff00, 0.5);
    this.graphics.strokeRect(
      deadzoneWorldX,
      deadzoneWorldY,
      CAMERA_CONFIG.DEADZONE_WIDTH,
      CAMERA_CONFIG.DEADZONE_HEIGHT
    );

    // Draw camera anchor position
    this.graphics.fillStyle(0xff0000, 1.0);
    this.graphics.fillCircle(data.cameraAnchorX, data.cameraAnchorY, 5);

    // Draw local player position (should overlap anchor if working correctly)
    this.graphics.fillStyle(0x0000ff, 0.7);
    this.graphics.fillCircle(data.localPlayerX, data.localPlayerY, 3);
  }

  toggle(): void {
    this.text.setVisible(!this.text.visible);
    this.graphics.setVisible(!this.graphics.visible);
  }

  get visible(): boolean {
    return this.text.visible;
  }
}

// Usage in GameScene
class GameScene extends Phaser.Scene {
  private debugOverlay: DebugOverlay | null = null;

  create(): void {
    // ... setup ...

    // Create debug overlay (toggled with backtick key)
    this.debugOverlay = new DebugOverlay(this);
    this.debugOverlay.toggle(); // Start hidden

    this.input.keyboard?.on('keydown-BACKTICK', () => {
      this.debugOverlay?.toggle();
    });
  }

  update(time: number, delta: number): void {
    // ... game logic ...

    if (this.debugOverlay?.visible) {
      this.debugOverlay.update(this.collectDebugData());
    }
  }
}
```

### Console Logging Conventions

```typescript
// Use consistent tags for filtering logs
const DEBUG_INTERP = true;
const DEBUG_PREDICT = true;
const DEBUG_CAMERA = true;

console.log(`[Interp] player=${playerId} mode=${mode} pos=(${x.toFixed(1)},${y.toFixed(1)})`);
console.log(`[Predict] err=${errorDist.toFixed(2)} snap=(${serverX.toFixed(1)},${serverY.toFixed(1)})`);
console.log(`[CameraDebug] anchor=(${ax.toFixed(1)},${ay.toFixed(1)}) scroll=(${sx.toFixed(1)},${sy.toFixed(1)})`);
```

---

## G. Implementation Plan

### Phase 1: Snapshot Buffer and Interpolation (Remote Players)

1. Add `PlayerSnapshot`, `PlayerHistory`, `PlayerHistoryMap` types
2. Add `NETCODE_CONFIG` constants
3. Implement `PlayerHistory` methods (`add`, `getLatest`, `getBounds`, `trim`)
4. Wire `playerMoved` handler to record snapshots into `playerHistories`
5. Implement `updateRemotePlayerVisualPosition` and call it from `GameScene.update`
6. Verify:
   - Remote players move smoothly with no snaps
   - Interp delay feels acceptable (~100ms)

### Phase 2: Local Prediction and Reconciliation

1. Add `LocalPlayerState` type and `localPlayerState` field in `GameScene`
2. Hook input into `inputState`
3. Implement `updateLocalPlayerPrediction` and call before rendering
4. Implement `reconcileLocalPlayer` and call from local `playerMoved` handler
5. Connect local sprite position to predicted + correction
6. Verify:
   - Local input instant
   - Occasional corrections are smooth, not jarring
   - Prediction error remains small under normal latency

### Phase 3: Camera Anchor + Deadzone + Soft Bounds

1. Add `CameraAnchor` class and `CAMERA_CONFIG` constants
2. Instantiate `cameraAnchor` in `GameScene`
3. Change camera follow from player sprite to `cameraAnchor`
4. Implement deadzone and soft bounds (`applySoftBounds`)
5. Ensure UI camera remains unchanged and ignores worldLayer, main camera ignores uiContainer
6. Verify:
   - Camera follows smoothly with deadzone
   - No snapping at world edges
   - UI remains fixed and unaffected

### Phase 4: Effects Integration and Cleanup

1. Audit all effects that read positions (trails, glow, particles)
2. Ensure they read from `playerSprites` after netcode updates
3. Adjust update order so effects run last
4. Add debug overlay and logging
5. Add config toggles for interpolation delay, prediction correction, camera smoothing

---

## H. Risks and Mitigations

### Risk 1: Packet Loss / Long Gaps

**Symptom:** Remote players "freeze" or snap when packets are dropped

**Mitigation:**
- Bounded extrapolation (`MAX_EXTRAP_MS`) bridges short gaps
- After that, clamp to last known position (`EXTRAP_CLAMP`)
- Optionally, fade out or show indicator if player is "stale" for too long

### Risk 2: Sudden Teleports (Respawns, Portals)

**Symptom:** Player appears to slide instead of teleport

**Mitigation:**
- Detect large deltas in server snapshot (distance > threshold)
- Bypass interpolation for that frame:
  ```typescript
  if (teleportDist > TELEPORT_THRESHOLD) {
    // Snap prediction to server and clear corrections
    state.predictedX = serverX;
    state.predictedY = serverY;
    state.correctionX = 0;
    state.correctionY = 0;
    return; // Don't blend, just snap
  }
  ```
- Visual: instant teleport (expected for respawn)

### Risk 3: Clock Skew / Time Base Mismatch

**Symptom:** Client and server clocks drift apart over time, causing interpolation to "skip"

**Mitigation:**
- Use **client-side Phaser time only** (the scene's `this.time.now`, passed into `update` as `time`)
- Never mix server time and client time in interpolation/prediction math
- If server adds timestamps in future, use them only for higher-level drift diagnostics; keep interpolation based on client time
- For this version: treat server timestamps as opaque, do not plug them into `renderTime` or snapshot `t`

### Risk 4: High Latency / Jitter > Interpolation Delay

**Symptom:** Latency > 100ms, packets arrive too late for INTERP_DELAY_MS

**Mitigation:**
- Increase `INTERP_DELAY_MS` (trade visual latency for smoothness)
- Use jitter buffer on client (already implicit through history)
- Log average snapshot age and tune delay accordingly

### Risk 5: Performance with Many Players

**Symptom:** Per-frame interpolation cost grows with player count

**Mitigation:**
- History buffer is small (e.g. 32–64 snapshots per player)
- `getBounds()` linear scan is acceptable for 20 snapshots (~160 bytes, cache-friendly)
- For 50+ players, this is ~10KB total history data, negligible

**Key properties of this design:**
- ✅ Zero input latency for local player
- ✅ Smooth remote players despite irregular packets
- ✅ Smooth camera with no edge snapping
- ✅ No server protocol changes required
- ✅ Simple, robust, maintainable (no complex rollback)
- ✅ Debuggable with clear observability
- ✅ Tunable via centralized config

**Next steps:**
1. Review this spec
2. Clarify any ambiguities or ask questions
3. Begin Phase 1 implementation
4. Iterate and tune based on testing
```
