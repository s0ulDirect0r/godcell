# Godcell Client-Side Netcode & Camera Smoothing
## Technical Specification

---

## A. Data Structures for Authoritative Snapshots

### Core Types

```typescript
/**
 * Single authoritative position snapshot from server
 * Timestamp is client-side (performance.now() or Phaser time) when packet received
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
  private head: number;  // Next write position
  private count: number; // Number of valid snapshots

  constructor(maxSize = 20) {
    this.snapshots = new Array(maxSize);
    this.maxSize = maxSize;
    this.head = 0;
    this.count = 0;
  }

  /**
   * Add new snapshot, compute velocity from previous snapshot if exists
   */
  add(x: number, y: number, t: number): void {
    const snapshot: PlayerSnapshot = {
      x, y, t,
      vx: 0, vy: 0
    };

    // Compute velocity from last snapshot if available
    if (this.count > 0) {
      const prev = this.getLatest();
      const dt = (t - prev.t) / 1000; // seconds
      if (dt > 0 && dt < 1.0) { // Sanity check: ignore if > 1s gap
        snapshot.vx = (x - prev.x) / dt;
        snapshot.vy = (y - prev.y) / dt;
      } else {
        // Inherit previous velocity if gap is too large
        snapshot.vx = prev.vx;
        snapshot.vy = prev.vy;
      }
    }

    this.snapshots[this.head] = snapshot;
    this.head = (this.head + 1) % this.maxSize;
    this.count = Math.min(this.count + 1, this.maxSize);
  }

  /**
   * Find two snapshots that bound renderTime for interpolation
   * Returns [s0, s1] where s0.t <= renderTime <= s1.t
   * Returns [null, s1] if renderTime < oldest
   * Returns [s0, null] if renderTime > newest (extrapolation case)
   */
  getBounds(renderTime: number): [PlayerSnapshot | null, PlayerSnapshot | null] {
    if (this.count === 0) return [null, null];

    let s0: PlayerSnapshot | null = null;
    let s1: PlayerSnapshot | null = null;

    // Linear scan through circular buffer (only ~20 items max, fast enough)
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.maxSize) % this.maxSize;
      const snapshot = this.snapshots[idx];

      if (snapshot.t <= renderTime) {
        s0 = snapshot; // Keep updating s0 to get the closest one before renderTime
      } else if (snapshot.t > renderTime && s1 === null) {
        s1 = snapshot; // First snapshot after renderTime
        break; // We have our bounds
      }
    }

    return [s0, s1];
  }

  getLatest(): PlayerSnapshot | null {
    if (this.count === 0) return null;
    const idx = (this.head - 1 + this.maxSize) % this.maxSize;
    return this.snapshots[idx];
  }

  /**
   * Remove snapshots older than cutoffTime
   * Called periodically to prevent unbounded growth
   */
  trim(cutoffTime: number): void {
    // Mark old snapshots as invalid by adjusting count
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
  now: number // Phaser time.now or performance.now()
): { x: number, y: number, debugInfo: string } {

  const renderTime = now - NETCODE_CONFIG.INTERP_DELAY_MS;
  const [s0, s1] = history.getBounds(renderTime);

  // Case 1: No snapshots at all (new player, extreme packet loss)
  if (s0 === null && s1 === null) {
    // Fallback: keep sprite at current position (don't move)
    return {
      x: currentSpriteX, // Read from existing sprite
      y: currentSpriteY,
      debugInfo: 'NO_DATA'
    };
  }

  // Case 2: Have both bounds - clean interpolation
  if (s0 !== null && s1 !== null) {
    const alpha = (renderTime - s0.t) / (s1.t - s0.t);
    const clampedAlpha = Math.max(0, Math.min(1, alpha)); // Safety clamp

    return {
      x: lerp(s0.x, s1.x, clampedAlpha),
      y: lerp(s0.y, s1.y, clampedAlpha),
      debugInfo: `INTERP(${(alpha * 100).toFixed(0)}%)`
    };
  }

  // Case 3: Only newer snapshot (renderTime before our oldest data)
  if (s0 === null && s1 !== null) {
    // This shouldn't happen often (means we're rendering further in past than history)
    // Just use the oldest snapshot we have
    return {
      x: s1.x,
      y: s1.y,
      debugInfo: 'SNAP_OLD'
    };
  }

  // Case 4: Only older snapshot (renderTime after newest data - need extrapolation)
  if (s0 !== null && s1 === null) {
    const extrapolationTime = renderTime - s0.t;

    // Bounded extrapolation: only extrapolate for MAX_EXTRAP_MS
    if (extrapolationTime > NETCODE_CONFIG.MAX_EXTRAP_MS) {
      // Beyond safe extrapolation window - hold at last known position
      return {
        x: s0.x,
        y: s0.y,
        debugInfo: `EXTRAP_CLAMPED(${extrapolationTime.toFixed(0)}ms)`
      };
    }

    // Safe extrapolation using last known velocity
    const dt = extrapolationTime / 1000; // seconds
    return {
      x: s0.x + s0.vx * dt,
      y: s0.y + s0.vy * dt,
      debugInfo: `EXTRAP(${extrapolationTime.toFixed(0)}ms)`
    };
  }

  // Should never reach here
  return { x: 0, y: 0, debugInfo: 'ERROR' };
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
    const now = time; // Use Phaser's time for consistency

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
      sprite.setPosition(x, y);

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
- `PlayerHistory` uses a fixed-size circular buffer (no dynamic allocation per snapshot)
- Trim operation doesn't reallocate, just adjusts count pointer
- `getBounds()` linear scan is acceptable for 20 snapshots (~160 bytes, cache-friendly)
- For 50+ players, this is ~10KB total history data, negligible

---

## C. Local Player Prediction and Reconciliation

### Local Player State

```typescript
/**
 * Local player state for client-side prediction
 * This is the authoritative source for the local player's visual position
 */
interface LocalPlayerState {
  // Predicted position (what we show on screen)
  predictedX: number;
  predictedY: number;

  // Predicted velocity (from input)
  vx: number;
  vy: number;

  // Correction tracking
  correctionX: number; // Offset being blended to zero
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

  // Step 1: Update predicted velocity from input
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

  // Step 2: Integrate velocity to position
  state.predictedX += state.vx * dt;
  state.predictedY += state.vy * dt;

  // Step 3: Apply correction blending if active
  let correctionX = 0;
  let correctionY = 0;

  if (state.correctionStartTime > 0) {
    const elapsed = now - state.correctionStartTime;
    const progress = Math.min(1, elapsed / state.correctionDuration);

    // Ease-out: blend correction to zero over time
    const remainingFactor = 1 - progress;
    correctionX = state.correctionX * remainingFactor;
    correctionY = state.correctionY * remainingFactor;

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

  // Update last known server position
  state.lastServerX = serverX;
  state.lastServerY = serverY;
  state.lastServerTime = serverTime;

  // Compute prediction error
  const errorX = state.predictedX - serverX;
  const errorY = state.predictedY - serverY;
  const errorMagnitude = Math.sqrt(errorX * errorX + errorY * errorY);

  // Ignore small errors (likely just floating-point noise or acceptable drift)
  if (errorMagnitude < NETCODE_CONFIG.PREDICTION_ERROR_EPSILON) {
    if (DEBUG_PREDICT) {
      console.log(`[Predict] Error ${errorMagnitude.toFixed(2)}px - ignored (< epsilon)`);
    }
    return;
  }

  // Large error - apply smooth correction
  // Strategy: "rubber-band" the predicted position back toward server position

  // Option 1: Blend over fixed time window
  state.correctionX = errorX;
  state.correctionY = errorY;
  state.correctionStartTime = serverTime;
  state.correctionDuration = NETCODE_CONFIG.PREDICTION_CORRECTION_TIME_MS;

  if (DEBUG_PREDICT) {
    console.log(
      `[Predict] Error ${errorMagnitude.toFixed(2)}px - ` +
      `correcting (${errorX.toFixed(1)}, ${errorY.toFixed(1)}) over ` +
      `${state.correctionDuration}ms`
    );
  }

  // Option 2 (alternative): Snap predicted position closer to server immediately
  // This is more aggressive but can feel snappier for large corrections
  // Uncomment if needed:
  /*
  const snapFactor = 0.5; // Snap halfway to server position
  state.predictedX = lerp(state.predictedX, serverX, snapFactor);
  state.predictedY = lerp(state.predictedY, serverY, snapFactor);

  // Then blend the remaining error
  state.correctionX = (state.predictedX - serverX);
  state.correctionY = (state.predictedY - serverY);
  */
}
```

### Integration Pattern

```typescript
class GameScene extends Phaser.Scene {
  private localPlayerState: LocalPlayerState;
  private localPlayerId: string;

  update(time: number, delta: number): void {
    const dt = delta / 1000; // Convert to seconds

    // Update local player prediction
    if (this.localPlayerId) {
      const input = this.getCurrentInput(); // Read key states
      const { visualX, visualY } = updateLocalPlayerPrediction(
        this.localPlayerState,
        input,
        dt,
        time
      );

      // Update sprite visual position
      const localSprite = this.playerSprites.get(this.localPlayerId);
      if (localSprite) {
        localSprite.setPosition(visualX, visualY);
      }

      // Update camera anchor (see section D)
      this.cameraAnchor.x = visualX;
      this.cameraAnchor.y = visualY;
    }

    // ... rest of update loop
  }

  // When server sends authoritative position for local player
  onPlayerMoved(playerId: string, x: number, y: number): void {
    const now = this.time.now;

    // Add to history for all players (for interpolation)
    if (!this.playerHistories.has(playerId)) {
      this.playerHistories.set(playerId, new PlayerHistory());
    }
    this.playerHistories.get(playerId)!.add(x, y, now);

    // If local player, reconcile prediction
    if (playerId === this.localPlayerId) {
      reconcileLocalPlayer(this.localPlayerState, x, y, now);
    }
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

  // Optional: internal smoothing if we want camera to lag behind anchor
  private targetX: number = 0;
  private targetY: number = 0;
  private smoothFactor: number = 0.1; // 0 = instant, 1 = no movement

  /**
   * Update anchor target (called each frame with local player visual position)
   */
  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Apply smoothing (optional - can skip if Phaser's follow lerp is sufficient)
   */
  update(dt: number): void {
    // Optional smoothing layer - only if we want custom easing
    // Otherwise, Phaser's startFollow lerp handles this
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

  // Camera follow smoothing (0 = instant, 1 = no follow)
  // This is Phaser's built-in lerp factor
  FOLLOW_LERP_X: 0.1,
  FOLLOW_LERP_Y: 0.1,

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
    this.mainCamera.setBounds(0, 0, CAMERA_CONFIG.WORLD_WIDTH, CAMERA_CONFIG.WORLD_HEIGHT);

    // Create deadzone (centered on camera viewport)
    const deadzoneX = (this.mainCamera.width - CAMERA_CONFIG.DEADZONE_WIDTH) / 2;
    const deadzoneY = (this.mainCamera.height - CAMERA_CONFIG.DEADZONE_HEIGHT) / 2;

    this.mainCamera.setDeadzone(
      CAMERA_CONFIG.DEADZONE_WIDTH,
      CAMERA_CONFIG.DEADZONE_HEIGHT
    );

    // Follow the anchor with smoothing
    this.mainCamera.startFollow(
      this.cameraAnchor,
      false, // Don't round pixels (we want smooth sub-pixel movement)
      CAMERA_CONFIG.FOLLOW_LERP_X,
      CAMERA_CONFIG.FOLLOW_LERP_Y
    );

    // UI camera - separate, doesn't follow anything
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setName('UICamera');
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

    // Compute clamped target (hard bounds)
    const clampedX = Phaser.Math.Clamp(currentX, minX, maxX);
    const clampedY = Phaser.Math.Clamp(currentY, minY, maxY);

    // If we're at bounds, apply soft lerp toward clamped position
    // This makes the camera gently approach the edge instead of snapping
    if (currentX !== clampedX || currentY !== clampedY) {
      const softX = lerp(currentX, clampedX, CAMERA_CONFIG.SOFT_BOUNDS_LERP);
      const softY = lerp(currentY, clampedY, CAMERA_CONFIG.SOFT_BOUNDS_LERP);

      cam.setScroll(softX, softY);

      if (DEBUG_CAMERA) {
        console.log(
          `[CameraAnchor] Soft bounds active: ` +
          `(${currentX.toFixed(1)}, ${currentY.toFixed(1)}) -> ` +
          `(${softX.toFixed(1)}, ${softY.toFixed(1)})`
        );
      }
    }
  }
}
```

**How it works step-by-step:**

1. **Each frame:**
   - Local player prediction computes visual position
   - Camera anchor updates to track that position
   - Phaser's `startFollow()` applies deadzone + lerp smoothing to scroll toward anchor
   - `applySoftBounds()` runs AFTER Phaser's follow logic

2. **Deadzone behavior:**
   - Anchor moves freely within deadzone rectangle
   - Camera only starts scrolling when anchor crosses deadzone edge
   - This creates a "free zone" in the center where player can move without camera movement

3. **Soft bounds behavior:**
   - When ideal camera position would exceed world bounds, we clamp it
   - Instead of snapping to clamped position, we lerp toward it
   - Result: camera gently slows as it approaches edge, no visible snap

4. **UI camera:**
   - Completely separate camera
   - Uses `ignore()` to partition world vs UI objects
   - No follow, no bounds - just static overlay
   - Unaffected by all this smoothing logic

---

## E. Integration with Existing Per-Frame Effects

### Trail Rendering Update

**Current pattern (assumed):**
```typescript
// Old: reading raw sprite position each frame
const trailX = playerSprite.x;
const trailY = playerSprite.y;
drawTrail(trailX, trailY);
```

**New pattern:**
```typescript
// New: sprite position is already updated from smoothed/predicted position
// So this just works! No change needed IF sprite is kept in sync.
const trailX = playerSprite.x; // This is now the smoothed visual position
const trailY = playerSprite.y;
drawTrail(trailX, trailY);
```

### Execution Order (Critical)

```typescript
update(time: number, delta: number): void {
  // 1. Update all player visual positions FIRST
  this.updateRemotePlayers(time);        // Interpolated positions
  this.updateLocalPlayerPrediction(time, delta); // Predicted position

  // 2. Update sprites to match visual positions
  this.syncSpritesToVisualPositions();

  // 3. Update camera anchor
  this.updateCameraAnchor();

  // 4. Apply soft bounds
  this.applySoftBounds();

  // 5. NOW run effects that read positions
  this.updateTrails();      // Reads sprite.x/y (now smoothed)
  this.updateParticles();   // Reads sprite.x/y (now smoothed)
  this.updateGlowEffects(); // Reads sprite.x/y (now smoothed)

  // Effects now see smooth, predicted positions - no jitter
}
```

### Migration Checklist

For each effect that currently reads player positions:

1. **Verify it reads from `playerSprites` containers** (not raw network data)
2. **Ensure it runs AFTER `syncSpritesToVisualPositions()`** in update order
3. **Test**: Effects should now be smooth automatically

**Effects that should NOT change:**
- UI elements (health bars, names) - these can stay on sprite positions OR camera anchor
- Click/collision detection - if server-authoritative, should use latest snapshot; if client-side, should use visual position

**If an effect needs raw server position for some reason:**
- Keep a separate `playerAuthoritativePositions` map
- Update it only from network packets
- Document WHY it needs raw position (rare case)

---

## F. Debugging and Observability

### Debug Flags

```typescript
const DEBUG_FLAGS = {
  INTERP: false,        // Log interpolation state per player
  PREDICT: false,       // Log prediction errors and corrections
  CAMERA_ANCHOR: false, // Log camera anchor movement and bounds
  EXTRAP: false,        // Log extrapolation events
};

// Toggle via console or query params
// e.g. ?debug=interp,predict,camera
```

### On-Screen Debug Overlay

```typescript
class DebugOverlay {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  private graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Text overlay in top-right
    this.text = scene.add.text(10, 10, '', {
      font: '12px monospace',
      color: '#00ff00',
      backgroundColor: '#000000',
      padding: { x: 8, y: 8 }
    });
    this.text.setScrollFactor(0); // Fixed to camera
    this.text.setDepth(10000);

    // Graphics for visual debugging (deadzone, anchor position, etc.)
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(9999);
  }

  update(data: {
    interpDelayMs: number,
    avgSnapshotAge: number,
    localPredictionError: number,
    correctionActive: boolean,
    cameraAnchorX: number,
    cameraAnchorY: number,
    localPlayerX: number,
    localPlayerY: number,
    cameraScrollX: number,
    cameraScrollY: number,
    hitBounds: boolean,
    playerStates: Map<string, string> // playerId -> "INTERP" | "EXTRAP" | etc.
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
// Use consistent prefixes for grepping logs
console.log('[Interp] Player abc123: EXTRAP(75ms) -> (1234.5, 678.9)');
console.log('[Predict] Error 15.3px - correcting over 150ms');
console.log('[CameraAnchor] Soft bounds active: (2400, 1600) -> (2380, 1580)');
```

### Fake Server / Latency Injection (Optional)

```typescript
/**
 * Wrapper around Socket.IO events to inject artificial latency/jitter
 * Useful for testing interpolation without changing the real server
 */
class FakeServerWrapper {
  private realSocket: Socket;
  private enabled: boolean = false;
  private latencyMs: number = 100;
  private jitterMs: number = 50;

  constructor(socket: Socket) {
    this.realSocket = socket;
  }

  enable(latencyMs: number, jitterMs: number): void {
    this.enabled = true;
    this.latencyMs = latencyMs;
    this.jitterMs = jitterMs;
  }

  disable(): void {
    this.enabled = false;
  }

  /**
   * Wrap socket.on() to delay incoming messages
   */
  on(event: string, callback: (...args: any[]) => void): void {
    this.realSocket.on(event, (...args: any[]) => {
      if (this.enabled && event === 'playerMoved') {
        const delay = this.latencyMs + (Math.random() - 0.5) * 2 * this.jitterMs;
        setTimeout(() => callback(...args), Math.max(0, delay));
      } else {
        callback(...args);
      }
    });
  }

  // Pass through all other socket methods
  emit(...args: any[]): void {
    this.realSocket.emit(...args);
  }
}

// Usage
const socket = io('http://localhost:3000');
const fakeServer = new FakeServerWrapper(socket);

// Enable 100ms latency ± 50ms jitter for testing
fakeServer.enable(100, 50);

// Use fakeServer instead of socket for all event handlers
fakeServer.on('playerMoved', (data) => { /* ... */ });
```

---

## Implementation Plan

### Phase 1: Schema & Infrastructure (1-2 sessions)

**Goal:** Set up data structures without changing visual behavior yet

**Files to edit:**
- `client/src/scenes/GameScene.ts`
- `client/src/netcode/` (new directory)
  - `PlayerHistory.ts` - Snapshot buffer implementation
  - `LocalPlayerState.ts` - Prediction state
  - `NetcodeConfig.ts` - All tunables
  - `types.ts` - Interfaces (PlayerSnapshot, etc.)

**Steps:**
1. Create `netcode/` directory structure
2. Implement `PlayerSnapshot` interface and `PlayerHistory` class
3. Add `PlayerHistoryMap` to `GameScene` state
4. Hook up `playerMoved` handler to populate histories (but don't use them yet)
5. Add debug logging to verify snapshots are being recorded
6. **Test:** Check console logs confirm snapshots accumulating

**Acceptance:**
- Snapshots recorded for all players
- History trimming works (no memory leak)
- Game still plays normally (no visual changes yet)

---

### Phase 2: Remote Player Interpolation (1 session)

**Goal:** Make remote players smooth by rendering from interpolated history

**Files to edit:**
- `client/src/scenes/GameScene.ts` - `update()` loop
- `client/src/netcode/interpolation.ts` (new) - Interpolation logic

**Steps:**
1. Implement `updateRemotePlayerVisualPosition()` function
2. In `update()`, call it for each remote player
3. Update remote player sprites to interpolated positions
4. Add debug overlay toggle (backtick key)
5. **Test:** Remote players should look smoother, especially with FakeServerWrapper latency

**Acceptance:**
- Remote players move smoothly even with simulated jitter
- Debug overlay shows "INTERP" state for most frames
- Local player still uses direct packet positions (will be jerky - that's expected)

---

### Phase 3: Local Player Prediction (1-2 sessions)

**Goal:** Make local player responsive with client-side prediction

**Files to edit:**
- `client/src/netcode/LocalPlayerState.ts` - Prediction logic
- `client/src/scenes/GameScene.ts` - Hook up prediction to update loop

**Steps:**
1. Implement `LocalPlayerState` class
2. Implement `updateLocalPlayerPrediction()` function
3. Implement `reconcileLocalPlayer()` function
4. In `update()`, run prediction for local player INSTEAD of direct packet position
5. When `playerMoved` arrives for local player, trigger reconciliation
6. Add debug logging for prediction errors
7. **Test:** Local player moves instantly on input; corrections are smooth

**Acceptance:**
- Zero perceived input latency on local player
- Prediction errors logged (should be small, < 10px typically)
- Corrections blend smoothly over 150ms
- Debug overlay shows correction state

---

### Phase 4: Camera Anchor & Deadzone (1 session)

**Goal:** Make camera smooth and avoid snapping at world edges

**Files to edit:**
- `client/src/camera/CameraAnchor.ts` (new)
- `client/src/camera/CameraConfig.ts` (new)
- `client/src/scenes/GameScene.ts` - Camera setup in `create()` and bounds in `update()`

**Steps:**
1. Implement `CameraAnchor` class
2. Move camera config constants to dedicated file
3. In `create()`:
   - Set up camera deadzone
   - `startFollow(cameraAnchor)` instead of player sprite
4. In `update()`:
   - Update anchor position from local player visual position
   - Call `applySoftBounds()` AFTER all other camera updates
5. Add camera debug visualization (deadzone rectangle, anchor dot)
6. **Test:**
   - Move to world edges - camera should ease into bounds, not snap
   - Move within deadzone - camera should stay still
   - Move outside deadzone - camera should follow

**Acceptance:**
- No camera snapping at world bounds
- Deadzone visible in debug overlay
- Smooth follow behavior
- UI camera unaffected (verify UI elements don't move with world)

---

### Phase 5: Effects Integration (1 session)

**Goal:** Ensure trails and other effects use smoothed positions

**Files to edit:**
- `client/src/scenes/GameScene.ts` - Reorder update loop
- Any effect rendering code (trails, particles, etc.)

**Steps:**
1. Audit all per-frame effects that read player positions
2. Ensure they run AFTER sprite positions are updated from netcode layer
3. Verify they read from `playerSprites` map (not raw network data)
4. Reorder `update()` method:
   ```
   1. Update netcode (interpolation + prediction)
   2. Sync sprites to visual positions
   3. Update camera anchor
   4. Apply soft bounds
   5. Run effects
   ```
5. **Test:** Trails should be smooth for both local and remote players

**Acceptance:**
- All effects smooth
- No jitter in trails or particles
- Effects follow predicted/interpolated positions

---

### Phase 6: Polish & Tuning (1 session)

**Goal:** Fine-tune constants and add final debugging tools

**Steps:**
1. Play extensively with debug overlay enabled
2. Tune `INTERP_DELAY_MS` (try 80ms, 100ms, 120ms - find sweet spot)
3. Tune `PREDICTION_CORRECTION_TIME_MS` (try 100ms, 150ms, 200ms)
4. Tune `SOFT_BOUNDS_LERP` (try 0.1, 0.2, 0.3)
5. Test with FakeServerWrapper at various latencies (50ms, 100ms, 200ms)
6. Test edge cases:
   - Rapid direction changes
   - Standing still
   - Moving near world corners
   - Tab backgrounded (pause/resume)
7. Document final tuned values in `NetcodeConfig.ts`

**Acceptance:**
- Smooth motion at various latencies
- No visible artifacts
- Comfortable feel for local player control

---

## Testing Strategy (No Server Changes)

### Manual Test Plan

**Test 1: Remote Player Smoothness**
1. Open two browser tabs
2. Enable FakeServerWrapper with 100ms ± 50ms jitter in one tab
3. Move player in other tab rapidly
4. Observer in first tab should see smooth movement (no stutter)
5. Check debug overlay: should show "INTERP" most of the time

**Test 2: Local Player Responsiveness**
1. Open single browser tab
2. Enable FakeServerWrapper with 150ms latency
3. Press movement keys
4. Player should move INSTANTLY (no lag)
5. Check debug overlay: prediction errors should be small (< 10px)
6. Watch for smooth corrections (no snapping)

**Test 3: Camera Deadzone**
1. Move player slowly in small circles in center of screen
2. Camera should NOT move (player stays in deadzone)
3. Move player rapidly to screen edge
4. Camera should start following once player crosses deadzone boundary
5. Debug overlay should show deadzone rectangle

**Test 4: Soft World Bounds**
1. Move player toward world edge (0, 0)
2. Camera should smoothly approach edge (no snap)
3. Continue moving player against edge
4. Camera should stay clamped, player can still move within bounds
5. Move back toward center
6. Camera should smoothly follow back

**Test 5: Prediction Correction**
1. Modify local prediction code temporarily to add artificial error:
   ```typescript
   state.predictedX += 50; // Add 50px error
   ```
2. Move player
3. Should see smooth rubber-band correction back toward server position
4. Debug overlay should show "Correction: ACTIVE"

**Test 6: Effects Smoothness**
1. Enable all visual effects (trails, particles, etc.)
2. Move player rapidly
3. Effects should follow smoothly (no jitter)
4. Open second tab and observe remote player effects - also smooth

### Automated Testing Hooks

```typescript
// Expose netcode state for automated tests
if (window.location.search.includes('test=true')) {
  (window as any).godcellDebug = {
    getPlayerHistory: (playerId: string) => this.playerHistories.get(playerId),
    getLocalState: () => this.localPlayerState,
    getCameraAnchor: () => this.cameraAnchor,
    injectLatency: (ms: number) => this.fakeServer?.enable(ms, ms * 0.5),
  };
}
```

### Success Metrics

**Quantitative:**
- Prediction error < 10px average over 1-minute session
- Interpolation coverage > 95% (INTERP vs EXTRAP states)
- Frame rate stable (60 FPS with smoothing overhead < 1ms)

**Qualitative:**
- Local player "feels instant"
- Remote players "look smooth"
- Camera "never snaps"
- Comfortable to play for 10+ minutes

---

## Risks and Mitigations

### Risk 1: Packet Loss / Long Pauses

**Symptom:** Tab backgrounded, network hiccup, server pause - no snapshots arrive for > 1 second

**Mitigation:**
- Extrapolation clamped to `MAX_EXTRAP_MS` (50ms)
- After that, sprites "freeze" at last known position instead of diverging
- When snapshots resume, interpolation picks up smoothly
- Visual: player appears to "pause" then "resume" (better than flying off screen)

**Fallback:** If > 3 seconds without snapshot, show "connection lost" indicator on that player

---

### Risk 2: Teleports / Respawns

**Symptom:** Server moves player instantly (death/respawn, portal, etc.) - large prediction error

**Mitigation:**
- Reconciliation detects large error (> 100px)
- Instead of blending over 150ms (would look like slow drift), detect "teleport threshold"
- If error > 100px, snap predicted position immediately:
  ```typescript
  if (errorMagnitude > 100) {
    state.predictedX = serverX;
    state.predictedY = serverY;
    state.correctionX = 0;
    state.correctionY = 0;
    return; // Don't blend, just snap
  }
  ```
- Visual: instant teleport (expected for respawn)

---

### Risk 3: Clock Skew / Time Base Mismatch

**Symptom:** Client and server clocks drift apart over time, causing interpolation to "skip"

**Mitigation:**
- Use **client-side timestamps only** (`performance.now()` or Phaser `time.now`)
- Never mix server time and client time
- If server adds timestamps in future, use them for drift correction:
  ```typescript
  // Periodically adjust INTERP_DELAY based on server clock offset
  const serverClientOffset = serverTimestamp - performance.now();
  const adjustedDelay = INTERP_DELAY_MS + serverClientOffset;
  ```
- For initial version: client time only, no cross-domain timestamps

---

### Risk 4: High Latency / Jitter > Interpolation Delay

**Symptom:** Latency > 100ms, packets arrive later than `renderTime`, constant extrapolation

**Mitigation:**
- **Adaptive interpolation delay:** Measure actual packet arrival jitter and adjust `INTERP_DELAY_MS` dynamically:
  ```typescript
  // Track last N packet intervals
  const intervals: number[] = [/* last 20 packet intervals */];
  const avgInterval = average(intervals);
  const p95Interval = percentile(intervals, 0.95);

  // Set INTERP_DELAY to p95 + small margin
  INTERP_DELAY_MS = p95Interval + 20;
  ```
- **Manual override:** Allow debug overlay to increase delay (e.g., increase to 200ms for high-latency connections)
- **Visual indicator:** Show "high latency" warning if INTERP_DELAY > 200ms

**Fallback:** If latency consistently > 500ms, warn user "poor connection - gameplay may be degraded"

---

### Risk 5: Performance with Many Players

**Symptom:** 50+ players, per-frame interpolation work causes FPS drops

**Mitigation:**
- **Profiling:** Measure interpolation overhead in update loop
- **Optimization 1:** Only interpolate players in viewport + margin
  ```typescript
  if (!isInViewport(playerId, camera)) {
    continue; // Skip interpolation for off-screen players
  }
  ```
- **Optimization 2:** Reduce history size for distant players (20 snapshots nearby, 5 for far)
- **Optimization 3:** Use object pooling for snapshot allocation (already done with circular buffer)

**Limit:** If > 100 players in viewport, fall back to direct packet positions for players beyond 50

---

### Risk 6: UI Camera Affected by Accident

**Symptom:** UI elements move/shake due to netcode smoothing

**Mitigation:**
- **Strict separation:** UI camera never calls `startFollow()`
- **Double-check `ignore()` calls:**
  ```typescript
  uiCamera.ignore(worldLayer);
  mainCamera.ignore(uiContainer);
  ```
- **Test:** Add UI element that moves rapidly - ensure it's stable

**Fallback:** If UI affected, add all UI objects to explicit "ignore" list for main camera

---

### Risk 7: Trail Rendering Breaks

**Symptom:** Trails jitter, lag behind, or draw from wrong positions

**Mitigation:**
- **Update order enforcement:** Document and enforce order in `update()`:
  ```typescript
  // THIS ORDER IS CRITICAL - DO NOT REORDER
  updateNetcode();
  syncSpritesToVisualPositions();
  updateCameraAnchor();
  applySoftBounds();
  updateEffects(); // <-- trails go here
  ```
- **Add assertion:** In dev mode, verify sprites have been updated before effects run
- **Test:** Move rapidly and watch trails - should be perfectly smooth

---

## Summary

This specification provides:

1. **Concrete data structures** for snapshot buffering with minimal GC churn
2. **Step-by-step algorithms** for interpolation, extrapolation, and prediction
3. **Camera design** with virtual anchor, deadzone, and soft bounds
4. **Integration patterns** for existing effects
5. **Debug tools** for observability and tuning
6. **Ordered implementation plan** with clear phases and acceptance criteria
7. **Risk analysis** with specific mitigations for common netcode issues

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
