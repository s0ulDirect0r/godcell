// ============================================
// SnapshotBuffer - Jitter Buffer for Smooth Movement
// ============================================
// Buffers incoming position snapshots and plays them back with a delay
// to absorb network jitter and provide smooth interpolation.
//
// Timeline visualization:
//   Server sends: ──●──●──●──●──●──●──●──●──●──●──►
//                       ↓ network jitter
//   Client receives: ──●───●●────●──●●●────●──●───►
//                       ↓ buffer (100ms delay)
//   Client renders: ────────●──●──●──●──●──●──●──►  (smooth)
// ============================================

/**
 * A single position snapshot from the server.
 */
export interface Snapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  serverTime: number; // Server timestamp (ms)
  clientTime: number; // When we received it (performance.now())
}

/**
 * Buffer statistics for diagnostics.
 */
export interface BufferStats {
  entityCount: number; // Number of entities being buffered
  avgOccupancy: number; // Average snapshots per entity
  underrunCount: number; // Times buffer was empty when queried
  currentDelay: number; // Current buffer delay setting (ms)
}

/**
 * SnapshotBuffer - Ring buffer per entity for delayed playback.
 *
 * Instead of immediately applying server positions, we buffer them
 * and play back from `now - bufferDelay`. This absorbs network jitter
 * by always having data ahead of playback time.
 *
 * Key insight: We interpolate based on SERVER timestamps (evenly spaced at 16ms)
 * not client arrival times (bursty due to network jitter). This gives smooth
 * playback even when packets arrive in bursts.
 */
export class SnapshotBuffer {
  // Per-entity snapshot buffers (ring buffer behavior via slice)
  private buffers: Map<string, Snapshot[]> = new Map();

  // Configuration
  private maxSnapshots = 30; // ~500ms at 60Hz server tick
  private bufferDelay = 80; // ms - tunable, balances smoothness vs latency

  // Clock offset estimation (client time - server time)
  // Updated on each received packet to track drift
  private clockOffsets: Map<string, number> = new Map();

  // Statistics
  private underrunCount = 0;

  // Debug logging throttle
  private _lastCase2Log: Record<string, number> = {};
  private _loggedPlayerInterp = false;

  /**
   * Push a new snapshot into the buffer for an entity.
   * Maintains chronological order and trims old snapshots.
   * Also updates clock offset estimation for server-time interpolation.
   */
  push(entityId: string, snapshot: Snapshot): void {
    let buffer = this.buffers.get(entityId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(entityId, buffer);
    }

    // Add snapshot (should already be in order from server)
    buffer.push(snapshot);

    // Update clock offset (clientTime - serverTime)
    // Use exponential moving average to smooth out variations
    const newOffset = snapshot.clientTime - snapshot.serverTime;
    const prevOffset = this.clockOffsets.get(entityId);
    if (prevOffset !== undefined) {
      // EMA with alpha=0.1 for smooth tracking
      this.clockOffsets.set(entityId, prevOffset * 0.9 + newOffset * 0.1);
    } else {
      this.clockOffsets.set(entityId, newOffset);
    }

    // Trim old snapshots (keep buffer size bounded)
    if (buffer.length > this.maxSnapshots) {
      buffer.shift();
    }
  }

  /**
   * Get interpolated position for an entity at the given playback time.
   *
   * Key insight: We interpolate based on SERVER timestamps, not client arrival times.
   * Server sends at consistent 16ms intervals, so serverTime is evenly spaced.
   * Client arrival times are bursty due to network jitter.
   *
   * By interpolating on serverTime, we get smooth playback even when packets
   * arrive in bursts.
   *
   * @param entityId - The entity to query
   * @param playbackTime - The target time in client time (typically now - bufferDelay)
   */
  getInterpolated(entityId: string, playbackTime: number): Snapshot | null {
    const buffer = this.buffers.get(entityId);
    if (!buffer || buffer.length === 0) {
      this.underrunCount++;
      return null;
    }

    // Convert client playbackTime to equivalent server time
    const clockOffset = this.clockOffsets.get(entityId) ?? 0;
    const targetServerTime = playbackTime - clockOffset;

    // Find two snapshots bracketing targetServerTime (using serverTime)
    // Buffer is sorted by arrival order, which should match serverTime order
    let before: Snapshot | null = null;
    let after: Snapshot | null = null;

    for (let i = 0; i < buffer.length; i++) {
      const snap = buffer[i];
      if (snap.serverTime <= targetServerTime) {
        before = snap;
      } else {
        after = snap;
        break;
      }
    }

    // Case 1: No data before targetServerTime - buffer underrun
    if (!before) {
      this.underrunCount++;
      // Return oldest snapshot as fallback
      return buffer[0];
    }

    // Case 2: No data after targetServerTime - use most recent
    // This happens when buffer is running low (need more delay)
    if (!after) {
      return before;
    }

    // DEBUG: Log successful interpolation for first player (once)
    if (entityId.startsWith('player') && !this._loggedPlayerInterp) {
      console.log(`[BUFFER_DEBUG] ${entityId} INTERPOLATING: targetST=${targetServerTime.toFixed(0)} between ${before.serverTime.toFixed(0)} and ${after.serverTime.toFixed(0)}`);
      this._loggedPlayerInterp = true;
    }

    // Case 3: Interpolate between before and after based on serverTime
    // ServerTime is evenly spaced (~16ms intervals), giving smooth interpolation
    const t1 = before.serverTime;
    const t2 = after.serverTime;
    const dt = t2 - t1;

    // Avoid division by zero (shouldn't happen but be safe)
    if (dt <= 0) {
      return before;
    }

    // Interpolation factor (0 = before, 1 = after)
    const alpha = Math.min(1, Math.max(0, (targetServerTime - t1) / dt));

    // Linear interpolation
    return {
      x: before.x + (after.x - before.x) * alpha,
      y: before.y + (after.y - before.y) * alpha,
      z: before.z + (after.z - before.z) * alpha,
      vx: before.vx + (after.vx - before.vx) * alpha,
      vy: before.vy + (after.vy - before.vy) * alpha,
      vz: before.vz + (after.vz - before.vz) * alpha,
      serverTime: before.serverTime + (after.serverTime - before.serverTime) * alpha,
      clientTime: playbackTime,
    };
  }

  /**
   * Remove an entity's buffer (when entity is destroyed).
   */
  remove(entityId: string): void {
    this.buffers.delete(entityId);
    this.clockOffsets.delete(entityId);
  }

  /**
   * Clear all buffers (e.g., on reconnect).
   */
  clear(): void {
    this.buffers.clear();
    this.clockOffsets.clear();
    this.underrunCount = 0;
  }

  /**
   * Set the buffer delay (playback lag).
   * Higher values = more jitter resistance but more latency.
   */
  setBufferDelay(ms: number): void {
    this.bufferDelay = Math.max(0, ms);
  }

  /**
   * Get the current buffer delay setting.
   */
  getBufferDelay(): number {
    return this.bufferDelay;
  }

  /**
   * Get buffer statistics for diagnostics.
   */
  getStats(): BufferStats {
    let totalSnapshots = 0;
    let entityCount = 0;

    this.buffers.forEach((buffer) => {
      totalSnapshots += buffer.length;
      entityCount++;
    });

    return {
      entityCount,
      avgOccupancy: entityCount > 0 ? totalSnapshots / entityCount : 0,
      underrunCount: this.underrunCount,
      currentDelay: this.bufferDelay,
    };
  }

  /**
   * Reset underrun count (for periodic stats logging).
   */
  resetUnderrunCount(): void {
    this.underrunCount = 0;
  }

  /**
   * Check if buffer has data for an entity.
   */
  hasEntity(entityId: string): boolean {
    const buffer = this.buffers.get(entityId);
    return buffer !== undefined && buffer.length > 0;
  }

  /**
   * Get raw buffer size for an entity (for debugging).
   */
  getBufferSize(entityId: string): number {
    const buffer = this.buffers.get(entityId);
    return buffer ? buffer.length : 0;
  }
}
