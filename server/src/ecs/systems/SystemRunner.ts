// ============================================
// ECS System Runner
// Manages and executes all game systems in priority order
// ============================================

import type { World } from '@godcell/shared';
import type { System } from './types';

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
 * The runner receives the World and passes it to all systems.
 * All data (entities, components, resources) lives in the World.
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
   * @param world The ECS World containing all state
   */
  update(world: World): void {
    for (const { system } of this.systems) {
      system.update(world);
    }
  }

  /**
   * Get list of registered systems (for debugging)
   */
  getSystemNames(): string[] {
    return this.systems.map(s => `${s.system.name} (priority: ${s.priority})`);
  }
}
