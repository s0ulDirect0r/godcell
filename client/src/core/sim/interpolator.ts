/**
 * Entity position interpolation using buffered server snapshots.
 * Smooths rendering despite network jitter and mismatched tick rates.
 */

import type { Position } from '@godcell/shared';
import type { GameState } from '../state/GameState';
import { CLIENT_CONFIG } from '../config/clientConfig';
import { lerpPosition } from './utils';

/**
 * Interpolated position data for an entity
 */
export interface InterpolatedPosition {
  position: Position;
  wasExtrapolated: boolean; // True if we had to extrapolate beyond last snapshot
  wasFrozen: boolean;       // True if extrapolation max exceeded (entity frozen)
}

/**
 * Get interpolated position for an entity at a specific render time
 * Uses ring buffer to interpolate between snapshots
 */
export function getInterpolatedPosition(
  state: GameState,
  entityId: string,
  entityType: 'player' | 'nutrient' | 'obstacle' | 'swarm' | 'pseudopod',
  renderTime: number
): InterpolatedPosition | undefined {
  const buffer = state.interpolationBuffer;

  // Not enough snapshots to interpolate
  if (buffer.size < 2) {
    // Fall back to latest snapshot (or current state if no snapshots)
    const latest = buffer.getLatest();
    if (!latest) {
      // No snapshots yet - use current state
      const entity = getEntityFromState(state, entityId, entityType);
      if (!entity) return undefined;
      return {
        position: entity.position,
        wasExtrapolated: false,
        wasFrozen: false,
      };
    }

    // Use latest snapshot, extrapolate if needed
    const entity = getEntityFromSnapshot(latest, entityId, entityType);
    if (!entity) return undefined;

    const timeSinceSnapshot = renderTime - latest.timestamp;

    // If render time is beyond snapshot + extrapolation limit, freeze
    if (timeSinceSnapshot > CLIENT_CONFIG.EXTRAPOLATION_MAX_MS) {
      return {
        position: entity.position,
        wasExtrapolated: true,
        wasFrozen: true,
      };
    }

    // Extrapolate forward (for moving entities with velocity)
    // For now, just return the position (no velocity data in snapshot)
    // TODO: Add velocity to snapshots for better extrapolation
    return {
      position: entity.position,
      wasExtrapolated: timeSinceSnapshot > 0,
      wasFrozen: false,
    };
  }

  // Find bracketing snapshots
  const brackets = buffer.getBracketingSnapshots(renderTime);

  if (!brackets) {
    // Render time is outside our snapshot range - use latest
    const latest = buffer.getLatest()!;
    const entity = getEntityFromSnapshot(latest, entityId, entityType);
    if (!entity) return undefined;

    return {
      position: entity.position,
      wasExtrapolated: true,
      wasFrozen: false,
    };
  }

  const [before, after] = brackets;

  // Get entity from both snapshots
  const entityBefore = getEntityFromSnapshot(before, entityId, entityType);
  const entityAfter = getEntityFromSnapshot(after, entityId, entityType);

  // Entity doesn't exist in one or both snapshots
  if (!entityBefore || !entityAfter) {
    // Use whichever one we have
    const entity = entityBefore || entityAfter;
    if (!entity) return undefined;
    return {
      position: entity.position,
      wasExtrapolated: false,
      wasFrozen: false,
    };
  }

  // Interpolate between the two positions
  const timeDelta = after.timestamp - before.timestamp;
  const alpha = timeDelta > 0 ? (renderTime - before.timestamp) / timeDelta : 0;

  return {
    position: lerpPosition(entityBefore.position, entityAfter.position, alpha),
    wasExtrapolated: false,
    wasFrozen: false,
  };
}

/**
 * Get all interpolated positions for a specific entity type
 */
export function getInterpolatedPositions(
  state: GameState,
  entityType: 'player' | 'nutrient' | 'obstacle' | 'swarm' | 'pseudopod',
  renderTime: number
): Map<string, InterpolatedPosition> {
  const positions = new Map<string, InterpolatedPosition>();

  // Get all entity IDs from current state
  const entities = getEntitiesFromState(state, entityType);

  for (const [id] of entities) {
    const interpolated = getInterpolatedPosition(state, id, entityType, renderTime);
    if (interpolated) {
      positions.set(id, interpolated);
    }
  }

  return positions;
}

/**
 * Helper: Get entity from state by type
 */
function getEntityFromState(
  state: GameState,
  id: string,
  type: 'player' | 'nutrient' | 'obstacle' | 'swarm' | 'pseudopod'
): { position: Position } | undefined {
  switch (type) {
    case 'player':
      return state.getPlayer(id);
    case 'nutrient':
      return state.getNutrient(id);
    case 'obstacle':
      return state.getObstacle(id);
    case 'swarm':
      return state.getSwarm(id);
    case 'pseudopod': {
      // Pseudopod has startPosition, not position
      const pseudopod = state.getPseudopod(id);
      return pseudopod ? { position: pseudopod.startPosition } : undefined;
    }
  }
}

/**
 * Helper: Get entities from state by type
 */
function getEntitiesFromState(
  state: GameState,
  type: 'player' | 'nutrient' | 'obstacle' | 'swarm' | 'pseudopod'
): Map<string, any> {
  switch (type) {
    case 'player':
      return state.players;
    case 'nutrient':
      return state.nutrients;
    case 'obstacle':
      return state.obstacles;
    case 'swarm':
      return state.swarms;
    case 'pseudopod':
      return state.pseudopods;
  }
}

/**
 * Helper: Get entity from snapshot by type
 */
function getEntityFromSnapshot(
  snapshot: any,
  id: string,
  type: 'player' | 'nutrient' | 'obstacle' | 'swarm' | 'pseudopod'
): { position: Position } | undefined {
  switch (type) {
    case 'player':
      return snapshot.players.get(id);
    case 'nutrient':
      return snapshot.nutrients.get(id);
    case 'obstacle':
      return snapshot.obstacles.get(id);
    case 'swarm':
      return snapshot.swarms.get(id);
    case 'pseudopod': {
      // Pseudopod has startPosition, not position
      const pseudopod = snapshot.pseudopods.get(id);
      return pseudopod ? { position: pseudopod.startPosition } : undefined;
    }
  }
}
