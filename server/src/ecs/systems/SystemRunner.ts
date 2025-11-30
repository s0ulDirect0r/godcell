// ============================================
// ECS System Runner
// Manages and executes all game systems in priority order
// ============================================

import type { Server } from 'socket.io';
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
   */
  update(world: World, deltaTime: number, io: Server): void {
    for (const { system } of this.systems) {
      system.update(world, deltaTime, io);
    }
  }

  /**
   * Get list of registered systems (for debugging)
   */
  getSystemNames(): string[] {
    return this.systems.map(s => `${s.system.name} (priority: ${s.priority})`);
  }
}
