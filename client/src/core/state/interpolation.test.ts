import { describe, it, expect, beforeEach } from 'vitest';
import { InterpolationBuffer, type StateSnapshot } from './interpolation';

describe('InterpolationBuffer', () => {
  let buffer: InterpolationBuffer;

  // Helper to create a mock snapshot
  const createSnapshot = (tick: number, timestamp: number): StateSnapshot => ({
    tick,
    timestamp,
    serverTime: 0,
    players: new Map(),
    nutrients: new Map(),
    obstacles: new Map(),
    swarms: new Map(),
    pseudopods: new Map(),
  });

  beforeEach(() => {
    buffer = new InterpolationBuffer(5); // Buffer size of 5
  });

  it('should start empty', () => {
    expect(buffer.isEmpty).toBe(true);
    expect(buffer.size).toBe(0);
  });

  it('should add snapshots and track size', () => {
    buffer.addSnapshot(createSnapshot(1, 100));
    expect(buffer.size).toBe(1);
    expect(buffer.isEmpty).toBe(false);

    buffer.addSnapshot(createSnapshot(2, 200));
    expect(buffer.size).toBe(2);
  });

  it('should maintain sorted order by timestamp', () => {
    buffer.addSnapshot(createSnapshot(1, 300));
    buffer.addSnapshot(createSnapshot(2, 100));
    buffer.addSnapshot(createSnapshot(3, 200));

    const snapshots = buffer.getAll();
    expect(snapshots[0].timestamp).toBe(100);
    expect(snapshots[1].timestamp).toBe(200);
    expect(snapshots[2].timestamp).toBe(300);
  });

  it('should not exceed max size (ring buffer behavior)', () => {
    for (let i = 0; i < 10; i++) {
      buffer.addSnapshot(createSnapshot(i, i * 100));
    }

    expect(buffer.size).toBe(5); // Should cap at buffer size
  });

  it('should get latest snapshot', () => {
    buffer.addSnapshot(createSnapshot(1, 100));
    buffer.addSnapshot(createSnapshot(2, 300));
    buffer.addSnapshot(createSnapshot(3, 200));

    const latest = buffer.getLatest();
    expect(latest?.timestamp).toBe(300);
  });

  it('should get oldest snapshot', () => {
    buffer.addSnapshot(createSnapshot(1, 100));
    buffer.addSnapshot(createSnapshot(2, 300));
    buffer.addSnapshot(createSnapshot(3, 200));

    const oldest = buffer.getOldest();
    expect(oldest?.timestamp).toBe(100);
  });

  it('should get snapshots in range', () => {
    buffer.addSnapshot(createSnapshot(1, 100));
    buffer.addSnapshot(createSnapshot(2, 200));
    buffer.addSnapshot(createSnapshot(3, 300));
    buffer.addSnapshot(createSnapshot(4, 400));

    const inRange = buffer.getSnapshotsInRange(150, 350);
    expect(inRange.length).toBe(2);
    expect(inRange[0].timestamp).toBe(200);
    expect(inRange[1].timestamp).toBe(300);
  });

  it('should get bracketing snapshots', () => {
    buffer.addSnapshot(createSnapshot(1, 100));
    buffer.addSnapshot(createSnapshot(2, 200));
    buffer.addSnapshot(createSnapshot(3, 300));

    const brackets = buffer.getBracketingSnapshots(250);
    expect(brackets).toBeDefined();
    expect(brackets![0].timestamp).toBe(200);
    expect(brackets![1].timestamp).toBe(300);
  });

  it('should return undefined for bracketing snapshots if not enough data', () => {
    buffer.addSnapshot(createSnapshot(1, 100));

    const brackets = buffer.getBracketingSnapshots(150);
    expect(brackets).toBeUndefined();
  });

  it('should clear all snapshots', () => {
    buffer.addSnapshot(createSnapshot(1, 100));
    buffer.addSnapshot(createSnapshot(2, 200));

    buffer.clear();

    expect(buffer.isEmpty).toBe(true);
    expect(buffer.size).toBe(0);
  });
});
