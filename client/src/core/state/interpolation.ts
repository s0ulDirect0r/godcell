/**
 * Ring buffer for storing timestamped game state snapshots.
 * Used for smooth interpolation between server updates.
 */

import type { Player, Nutrient, Obstacle, EntropySwarm, Pseudopod } from '@godcell/shared';
import { CLIENT_CONFIG } from '../config/clientConfig';

/**
 * A snapshot of the game state at a specific point in time
 */
export interface StateSnapshot {
  tick: number;              // Server tick number
  timestamp: number;         // Client-side timestamp (performance.now())
  serverTime: number;        // Server timestamp
  players: Map<string, Player>;
  nutrients: Map<string, Nutrient>;
  obstacles: Map<string, Obstacle>;
  swarms: Map<string, EntropySwarm>;
  pseudopods: Map<string, Pseudopod>;
}

/**
 * Ring buffer that stores the last N snapshots for interpolation
 */
export class InterpolationBuffer {
  private buffer: StateSnapshot[] = [];
  private maxSize: number;
  private writeIndex = 0;

  constructor(maxSize: number = CLIENT_CONFIG.INTERPOLATION_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Add a new snapshot to the buffer
   * Handles out-of-order snapshots by inserting in timestamp order
   */
  addSnapshot(snapshot: StateSnapshot): void {
    // If buffer isn't full yet, just append
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(snapshot);
      this.buffer.sort((a, b) => a.timestamp - b.timestamp);
      return;
    }

    // Buffer is full - use ring buffer behavior
    // Replace the oldest snapshot (writeIndex)
    this.buffer[this.writeIndex] = snapshot;
    this.writeIndex = (this.writeIndex + 1) % this.maxSize;

    // Keep sorted by timestamp
    this.buffer.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get the snapshot at a specific time (exact match)
   */
  getSnapshotAt(time: number): StateSnapshot | undefined {
    return this.buffer.find((s) => s.timestamp === time);
  }

  /**
   * Get all snapshots within a time range [startTime, endTime]
   */
  getSnapshotsInRange(startTime: number, endTime: number): StateSnapshot[] {
    return this.buffer.filter(
      (s) => s.timestamp >= startTime && s.timestamp <= endTime
    );
  }

  /**
   * Get the two snapshots that bracket a given render time
   * Returns [before, after] or undefined if not enough snapshots
   */
  getBracketingSnapshots(renderTime: number): [StateSnapshot, StateSnapshot] | undefined {
    // Need at least 2 snapshots
    if (this.buffer.length < 2) {
      return undefined;
    }

    // Find the snapshot just before and just after renderTime
    let before: StateSnapshot | undefined;
    let after: StateSnapshot | undefined;

    for (const snapshot of this.buffer) {
      if (snapshot.timestamp <= renderTime) {
        if (!before || snapshot.timestamp > before.timestamp) {
          before = snapshot;
        }
      }
      if (snapshot.timestamp >= renderTime) {
        if (!after || snapshot.timestamp < after.timestamp) {
          after = snapshot;
        }
      }
    }

    if (before && after) {
      return [before, after];
    }

    return undefined;
  }

  /**
   * Get the most recent (latest) snapshot
   */
  getLatest(): StateSnapshot | undefined {
    if (this.buffer.length === 0) return undefined;

    return this.buffer.reduce((latest, snapshot) =>
      snapshot.timestamp > latest.timestamp ? snapshot : latest
    );
  }

  /**
   * Get the oldest snapshot
   */
  getOldest(): StateSnapshot | undefined {
    if (this.buffer.length === 0) return undefined;

    return this.buffer.reduce((oldest, snapshot) =>
      snapshot.timestamp < oldest.timestamp ? snapshot : oldest
    );
  }

  /**
   * Clear all snapshots
   */
  clear(): void {
    this.buffer = [];
    this.writeIndex = 0;
  }

  /**
   * Get the current number of snapshots in the buffer
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Check if buffer is empty
   */
  get isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Get all snapshots (for debugging)
   */
  getAll(): StateSnapshot[] {
    return [...this.buffer];
  }
}
