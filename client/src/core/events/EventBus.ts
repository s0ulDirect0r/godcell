// ============================================
// Event Bus - Type-Safe Local Pub/Sub
// ============================================

import type { ServerMessage, CombatSpecialization, MeleeAttackType } from '@shared';

// Client-only events (internal state, not from server)
type ClientEvent =
  | { type: 'client:inputMove'; direction: { x: number; y: number; z?: number } }
  | { type: 'client:inputRespawn' }
  | { type: 'client:sprint'; sprinting: boolean }
  | { type: 'client:empActivate' }
  | { type: 'client:pseudopodFire'; targetX: number; targetY: number }
  | { type: 'client:mouseLook'; deltaX: number; deltaY: number } // First-person mouse look
  | { type: 'client:cameraZoom'; level: number }
  | { type: 'client:debugToggle'; enabled: boolean }
  | { type: 'client:socketConnected'; socketId: string }
  | { type: 'client:socketDisconnected' }
  | { type: 'client:socketFailed'; error: string }
  | { type: 'client:selectSpecialization'; specialization: CombatSpecialization }
  | { type: 'client:meleeAttack'; attackType: MeleeAttackType; targetX: number; targetY: number }
  | { type: 'client:placeTrap' }
  | { type: 'client:projectileFire'; targetX: number; targetY: number };

// All possible events = server messages + client-only events
export type GameEvent = ServerMessage | ClientEvent;

type EventHandler<T extends GameEvent> = (event: T) => void;

export class EventBus {
  private handlers: Map<GameEvent['type'], Set<EventHandler<any>>> = new Map();

  /**
   * Subscribe to an event (type-safe)
   * @returns unsubscribe function
   */
  on<T extends GameEvent['type']>(
    type: T,
    handler: EventHandler<Extract<GameEvent, { type: T }>>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => this.off(type, handler);
  }

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   */
  once<T extends GameEvent['type']>(
    type: T,
    handler: EventHandler<Extract<GameEvent, { type: T }>>
  ): () => void {
    const wrappedHandler = (event: Extract<GameEvent, { type: T }>) => {
      this.off(type, wrappedHandler);
      handler(event);
    };
    return this.on(type, wrappedHandler);
  }

  /**
   * Unsubscribe from an event
   */
  off<T extends GameEvent['type']>(
    type: T,
    handler: EventHandler<Extract<GameEvent, { type: T }>>
  ): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event (type-safe)
   */
  emit<T extends GameEvent['type']>(
    event: Extract<GameEvent, { type: T }>
  ): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  /**
   * Clear all handlers (for cleanup/testing)
   */
  clear(): void {
    this.handlers.clear();
  }
}

// Singleton instance
export const eventBus = new EventBus();
