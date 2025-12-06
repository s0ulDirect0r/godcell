// ============================================
// ECS System Runner
// Manages and executes all game systems in priority order
// ============================================

import type { Server } from 'socket.io';
import type { World } from '#shared';
import type { System } from './types';
import { logger, perfLogger } from '../../logger';

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
   * Tracks per-system timing and logs when tick is slow
   */
  update(world: World, deltaTime: number, io: Server): void {
    const tickStart = performance.now();
    const timings: { name: string; ms: number }[] = [];

    for (const { system } of this.systems) {
      const systemStart = performance.now();
      try {
        system.update(world, deltaTime, io);
      } catch (error) {
        logger.error({
          event: 'system_error',
          system: system.name,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }, `System ${system.name} threw an error`);
        // Continue with next system - don't crash the game loop
      }
      const systemMs = performance.now() - systemStart;
      timings.push({ name: system.name, ms: systemMs });
    }

    const totalMs = performance.now() - tickStart;

    // Log breakdown when tick takes > 10ms (should be < 5ms normally)
    if (totalMs > 10) {
      // Sort by time descending to show slowest first
      const sorted = [...timings].sort((a, b) => b.ms - a.ms);
      const breakdown = sorted
        .filter(t => t.ms > 0.5) // Only show systems that took > 0.5ms
        .map(t => `${t.name}:${t.ms.toFixed(1)}`)
        .join(' ');

      perfLogger.info({
        event: 'slow_tick_breakdown',
        totalMs: totalMs.toFixed(1),
        breakdown: sorted.filter(t => t.ms > 0.5).map(t => ({ name: t.name, ms: parseFloat(t.ms.toFixed(2)) })),
      }, `Slow tick ${totalMs.toFixed(1)}ms: ${breakdown}`);
    }
  }

  /**
   * Get list of registered systems (for debugging)
   */
  getSystemNames(): string[] {
    return this.systems.map(s => `${s.system.name} (priority: ${s.priority})`);
  }
}
