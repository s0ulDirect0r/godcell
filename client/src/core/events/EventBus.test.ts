// ============================================
// EventBus Unit Tests
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from './EventBus';
import type { PlayerMovedMessage, NutrientCollectedMessage } from '#shared';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('Server message events', () => {
    it('should emit and receive server messages with correct types', () => {
      const received: PlayerMovedMessage[] = [];

      bus.on('playerMoved', (msg) => {
        received.push(msg);
      });

      const message: PlayerMovedMessage = {
        type: 'playerMoved',
        playerId: 'p1',
        position: { x: 100, y: 200 },
        velocity: { x: 10, y: 5 },
      };

      bus.emit(message);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(message);
    });

    it('should handle multiple handlers for same event', () => {
      let count1 = 0;
      let count2 = 0;

      bus.on('nutrientCollected', () => count1++);
      bus.on('nutrientCollected', () => count2++);

      const message: NutrientCollectedMessage = {
        type: 'nutrientCollected',
        nutrientId: 'n1',
        playerId: 'p1',
        collectorEnergy: 125,
        collectorMaxEnergy: 110,
      };

      bus.emit(message);

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('should not receive events after unsubscribe', () => {
      let count = 0;
      const unsubscribe = bus.on('playerMoved', () => count++);

      bus.emit({ type: 'playerMoved', playerId: 'p1', position: { x: 100, y: 200 }, velocity: { x: 10, y: 5 } });
      expect(count).toBe(1);

      unsubscribe();

      bus.emit({ type: 'playerMoved', playerId: 'p2', position: { x: 150, y: 250 }, velocity: { x: 15, y: 10 } });
      expect(count).toBe(1); // Still 1, not incremented
    });
  });

  describe('Client-only events', () => {
    it('should emit and receive client events', () => {
      const received: Array<{ x: number; y: number }> = [];

      bus.on('client:inputMove', (event) => {
        received.push(event.direction);
      });

      bus.emit({ type: 'client:inputMove', direction: { x: 1, y: 0 } });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ x: 1, y: 0 });
    });

    it('should handle zoom events', () => {
      let zoomLevel = 1.0;

      bus.on('client:cameraZoom', (event) => {
        zoomLevel = event.level;
      });

      bus.emit({ type: 'client:cameraZoom', level: 1.5 });

      expect(zoomLevel).toBe(1.5);
    });
  });

  describe('clear', () => {
    it('should remove all handlers', () => {
      let count = 0;
      bus.on('playerMoved', () => count++);

      bus.clear();

      bus.emit({ type: 'playerMoved', playerId: 'p1', position: { x: 100, y: 200 }, velocity: { x: 10, y: 5 } });

      expect(count).toBe(0); // Handler was cleared
    });
  });

  describe('off', () => {
    it('should unsubscribe specific handler', () => {
      let count1 = 0;
      let count2 = 0;

      const handler1 = () => count1++;
      const handler2 = () => count2++;

      bus.on('playerMoved', handler1);
      bus.on('playerMoved', handler2);

      bus.off('playerMoved', handler1);

      bus.emit({ type: 'playerMoved', playerId: 'p1', position: { x: 100, y: 200 }, velocity: { x: 10, y: 5 } });

      expect(count1).toBe(0); // handler1 was removed
      expect(count2).toBe(1); // handler2 still active
    });
  });
});
