// ============================================
// ECS System Runner
// Manages and executes all game systems in priority order
// ============================================

import type { System } from './types';
import type { GameContext } from './GameContext';

/**
 * Registered system with its priority
 */
interface RegisteredSystem {
  system: System;
  priority: number;
}

/**
 * SystemRunner - Manages and executes all game systems
 *
 * Systems are executed in priority order (lower numbers first).
 * The runner receives a GameContext each tick and passes it to all systems.
 */
export class SystemRunner {
  private systems: RegisteredSystem[] = [];

  /**
   * Register a system with a priority
   * @param system The system to register
   * @param priority Lower numbers run first
   */
  register(system: System, priority: number): void {
    this.systems.push({ system, priority });
    // Keep sorted by priority
    this.systems.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Run all systems in priority order
   * @param ctx Game context with all state and helpers
   */
  update(ctx: GameContext): void {
    for (const { system } of this.systems) {
      system.update(ctx);
    }
  }

  /**
   * Get list of registered systems (for debugging)
   */
  getSystemNames(): string[] {
    return this.systems.map(s => `${s.system.name} (priority: ${s.priority})`);
  }
}
