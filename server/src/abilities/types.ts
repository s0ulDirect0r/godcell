import type { Server } from 'socket.io';
import type { Position } from '#shared';
import type { World } from '../ecs/factories';

/**
 * Game context required by the ability system.
 * Passed at construction to avoid circular dependencies.
 */
export interface AbilityContext {
  world: World;
  io: Server;
  checkBeamHitscan: (start: Position, end: Position, shooterId: string) => string | null;
}
