# Phase 1: Core State + Message Contract

**Estimated Time:** 1-2 hours
**Dependencies:** Phase 0 must be complete

## Overview

Extract game state from GameScene into a normalized, renderer-agnostic `GameState` class. Add an event bus for local pub/sub between modules. Set up Vitest and write headless unit tests for message → state transformations.

This establishes the foundation for renderer independence: state becomes the single source of truth, and all modules communicate through events rather than direct coupling.

## Goals

1. Create normalized entity storage (maps keyed by ID)
2. Implement state lifecycle methods (upsert, remove, reset)
3. Add local event bus for module communication
4. Write unit tests for state transformations
5. GameScene still renders, but reads from GameState instead of local properties

## Files to Create

### `client/src/core/events/EventBus.ts`
Simple pub/sub for local events.

```typescript
type EventHandler<T = any> = (data: T) => void;

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  /**
   * Subscribe to an event
   * @returns unsubscribe function
   */
  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off<T = any>(event: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit an event
   */
  emit<T = any>(event: string, data?: T): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
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
```

### `client/src/core/state/GameState.ts`
Normalized entity storage with lifecycle methods.

```typescript
import type {
  Player,
  Nutrient,
  Obstacle,
  EntropySwarm,
  Pseudopod,
} from '@godcell/shared';

export interface InterpolationTarget {
  x: number;
  y: number;
  timestamp: number;
}

export class GameState {
  // Entity maps (normalized storage)
  readonly players: Map<string, Player> = new Map();
  readonly nutrients: Map<string, Nutrient> = new Map();
  readonly obstacles: Map<string, Obstacle> = new Map();
  readonly swarms: Map<string, EntropySwarm> = new Map();
  readonly pseudopods: Map<string, Pseudopod> = new Map();

  // Interpolation targets (for smooth movement)
  readonly playerTargets: Map<string, InterpolationTarget> = new Map();
  readonly swarmTargets: Map<string, InterpolationTarget> = new Map();

  // Local player reference
  myPlayerId: string | null = null;

  /**
   * Apply full game state snapshot from server
   */
  applySnapshot(snapshot: {
    players: Player[];
    nutrients: Nutrient[];
    obstacles: Obstacle[];
    swarms: EntropySwarm[];
  }): void {
    // Clear existing state
    this.players.clear();
    this.nutrients.clear();
    this.obstacles.clear();
    this.swarms.clear();

    // Populate from snapshot
    snapshot.players.forEach(p => this.players.set(p.id, p));
    snapshot.nutrients.forEach(n => this.nutrients.set(n.id, n));
    snapshot.obstacles.forEach(o => this.obstacles.set(o.id, o));
    snapshot.swarms.forEach(s => this.swarms.set(s.id, s));

    // Initialize interpolation targets
    snapshot.players.forEach(p => {
      this.playerTargets.set(p.id, { x: p.x, y: p.y, timestamp: Date.now() });
    });
    snapshot.swarms.forEach(s => {
      this.swarmTargets.set(s.id, { x: s.x, y: s.y, timestamp: Date.now() });
    });
  }

  /**
   * Upsert player (add or update)
   */
  upsertPlayer(player: Player): void {
    this.players.set(player.id, player);
    this.playerTargets.set(player.id, { x: player.x, y: player.y, timestamp: Date.now() });
  }

  /**
   * Remove player
   */
  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    this.playerTargets.delete(playerId);
  }

  /**
   * Update player position target (for interpolation)
   */
  updatePlayerTarget(playerId: string, x: number, y: number): void {
    const player = this.players.get(playerId);
    if (player) {
      player.x = x;
      player.y = y;
      this.playerTargets.set(playerId, { x, y, timestamp: Date.now() });
    }
  }

  /**
   * Upsert nutrient
   */
  upsertNutrient(nutrient: Nutrient): void {
    this.nutrients.set(nutrient.id, nutrient);
  }

  /**
   * Remove nutrient
   */
  removeNutrient(nutrientId: string): void {
    this.nutrients.delete(nutrientId);
  }

  /**
   * Update nutrient position (for animated nutrients)
   */
  updateNutrientPosition(nutrientId: string, x: number, y: number): void {
    const nutrient = this.nutrients.get(nutrientId);
    if (nutrient) {
      nutrient.x = x;
      nutrient.y = y;
    }
  }

  /**
   * Upsert swarm
   */
  upsertSwarm(swarm: EntropySwarm): void {
    this.swarms.set(swarm.id, swarm);
    this.swarmTargets.set(swarm.id, { x: swarm.x, y: swarm.y, timestamp: Date.now() });
  }

  /**
   * Remove swarm
   */
  removeSwarm(swarmId: string): void {
    this.swarms.delete(swarmId);
    this.swarmTargets.delete(swarmId);
  }

  /**
   * Update swarm position target (for interpolation)
   */
  updateSwarmTarget(swarmId: string, x: number, y: number): void {
    const swarm = this.swarms.get(swarmId);
    if (swarm) {
      swarm.x = x;
      swarm.y = y;
      this.swarmTargets.set(swarmId, { x, y, timestamp: Date.now() });
    }
  }

  /**
   * Upsert pseudopod
   */
  upsertPseudopod(pseudopod: Pseudopod): void {
    this.pseudopods.set(pseudopod.id, pseudopod);
  }

  /**
   * Remove pseudopod
   */
  removePseudopod(pseudopodId: string): void {
    this.pseudopods.delete(pseudopodId);
  }

  /**
   * Get local player
   */
  getMyPlayer(): Player | null {
    return this.myPlayerId ? this.players.get(this.myPlayerId) || null : null;
  }

  /**
   * Reset all state (for cleanup/testing)
   */
  reset(): void {
    this.players.clear();
    this.nutrients.clear();
    this.obstacles.clear();
    this.swarms.clear();
    this.pseudopods.clear();
    this.playerTargets.clear();
    this.swarmTargets.clear();
    this.myPlayerId = null;
  }
}
```

### `client/vitest.config.ts`
Vitest configuration for unit tests.

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
```

### `client/src/core/state/GameState.test.ts`
Unit tests for GameState.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GameState } from './GameState';
import type { Player, Nutrient, Obstacle, EntropySwarm, Pseudopod } from '@godcell/shared';
import { EvolutionStage } from '@godcell/shared';

describe('GameState', () => {
  let state: GameState;

  beforeEach(() => {
    state = new GameState();
  });

  describe('applySnapshot', () => {
    it('should populate all entity maps from snapshot', () => {
      const snapshot = {
        players: [
          { id: 'p1', x: 100, y: 200, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player,
        ],
        nutrients: [
          { id: 'n1', x: 300, y: 400, radius: 10, value: 25, valueMultiplier: 1 } as Nutrient,
        ],
        obstacles: [
          { id: 'o1', x: 500, y: 600, eventHorizonRadius: 200, singularityRadius: 60, gravityStrength: 5000 } as Obstacle,
        ],
        swarms: [
          { id: 's1', x: 700, y: 800, vx: 0, vy: 0, radius: 15 } as EntropySwarm,
        ],
      };

      state.applySnapshot(snapshot);

      expect(state.players.size).toBe(1);
      expect(state.nutrients.size).toBe(1);
      expect(state.obstacles.size).toBe(1);
      expect(state.swarms.size).toBe(1);
      expect(state.playerTargets.size).toBe(1);
      expect(state.swarmTargets.size).toBe(1);
    });

    it('should clear existing state before applying snapshot', () => {
      // Pre-populate
      state.upsertPlayer({ id: 'old', x: 0, y: 0, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player);

      // Apply new snapshot
      state.applySnapshot({ players: [], nutrients: [], obstacles: [], swarms: [] });

      expect(state.players.size).toBe(0);
    });
  });

  describe('Player operations', () => {
    it('should upsert player', () => {
      const player = { id: 'p1', x: 100, y: 200, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player;
      state.upsertPlayer(player);

      expect(state.players.get('p1')).toEqual(player);
      expect(state.playerTargets.has('p1')).toBe(true);
    });

    it('should remove player', () => {
      state.upsertPlayer({ id: 'p1', x: 100, y: 200, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player);
      state.removePlayer('p1');

      expect(state.players.has('p1')).toBe(false);
      expect(state.playerTargets.has('p1')).toBe(false);
    });

    it('should update player target position', () => {
      state.upsertPlayer({ id: 'p1', x: 100, y: 200, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player);
      state.updatePlayerTarget('p1', 150, 250);

      const target = state.playerTargets.get('p1');
      expect(target?.x).toBe(150);
      expect(target?.y).toBe(250);
    });
  });

  describe('Nutrient operations', () => {
    it('should upsert nutrient', () => {
      const nutrient = { id: 'n1', x: 300, y: 400, radius: 10, value: 25, valueMultiplier: 1 } as Nutrient;
      state.upsertNutrient(nutrient);

      expect(state.nutrients.get('n1')).toEqual(nutrient);
    });

    it('should remove nutrient', () => {
      state.upsertNutrient({ id: 'n1', x: 300, y: 400, radius: 10, value: 25, valueMultiplier: 1 } as Nutrient);
      state.removeNutrient('n1');

      expect(state.nutrients.has('n1')).toBe(false);
    });
  });

  describe('getMyPlayer', () => {
    it('should return local player when set', () => {
      const player = { id: 'me', x: 100, y: 200, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player;
      state.upsertPlayer(player);
      state.myPlayerId = 'me';

      expect(state.getMyPlayer()).toEqual(player);
    });

    it('should return null when myPlayerId not set', () => {
      expect(state.getMyPlayer()).toBeNull();
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      state.upsertPlayer({ id: 'p1', x: 100, y: 200, vx: 0, vy: 0, radius: 20, color: '#ff0000', health: 100, maxHealth: 100, energy: 100, maxEnergy: 100, stage: EvolutionStage.SINGLE_CELL, energyCapacity: 100 } as Player);
      state.upsertNutrient({ id: 'n1', x: 300, y: 400, radius: 10, value: 25, valueMultiplier: 1 } as Nutrient);
      state.myPlayerId = 'p1';

      state.reset();

      expect(state.players.size).toBe(0);
      expect(state.nutrients.size).toBe(0);
      expect(state.myPlayerId).toBeNull();
    });
  });
});
```

## Files to Modify

### `client/package.json`
Add Vitest dependencies.

```json
{
  "devDependencies": {
    "@types/node": "^20.10.6",
    "typescript": "^5.3.3",
    "vite": "^5.0.11",
    "vitest": "^1.0.4",
    "happy-dom": "^12.10.3"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

### `client/src/scenes/GameScene.ts`
Wire GameState - replace local maps with GameState access.

**Add at top of class:**
```typescript
import { eventBus } from '../core/events/EventBus';
import { GameState } from '../core/state/GameState';

// Replace existing Map declarations with:
private gameState: GameState = new GameState();
```

**In `create()` method, when receiving `game:state` message:**
```typescript
// OLD:
this.socket.on('game:state', (state: GameStateMessage) => {
  // ... populate local maps ...
});

// NEW:
this.socket.on('game:state', (state: GameStateMessage) => {
  this.gameState.applySnapshot(state);
  this.myPlayerId = this.socket.id;
  this.gameState.myPlayerId = this.socket.id;

  // Emit event for other modules (future phases)
  eventBus.emit('game:state:loaded', this.gameState);

  // ... create sprites from gameState.players, etc ...
});
```

**In `player:moved` handler:**
```typescript
// OLD:
this.playerTargetPositions.set(data.playerId, { x: data.x, y: data.y });

// NEW:
this.gameState.updatePlayerTarget(data.playerId, data.x, data.y);
```

Similar pattern for all entity updates (nutrients, swarms, pseudopods).

**In `update()` method:**
```typescript
// OLD:
this.playerSprites.forEach((sprite, playerId) => { ... });

// NEW:
this.gameState.players.forEach((player, playerId) => {
  const sprite = this.playerSprites.get(playerId);
  if (sprite) {
    // ... interpolation logic ...
  }
});
```

## Test Cases

### Automated Tests

```bash
npm install
npm test

# Should see:
# ✓ GameState > applySnapshot > should populate all entity maps
# ✓ GameState > Player operations > should upsert player
# ✓ GameState > getMyPlayer > should return local player
# ... 10+ tests passing
```

### Manual Testing

```bash
npm run dev
# Open: http://localhost:8080

# Verify:
# - Game looks identical to before
# - Movement works
# - Nutrients spawn and can be collected
# - Other players visible and move
# - Death/respawn works
# - No console errors
```

## Acceptance Criteria

- [ ] GameState class created with all entity maps
- [ ] EventBus created for local pub/sub
- [ ] Vitest configured and running
- [ ] 10+ unit tests passing for GameState
- [ ] GameScene uses GameState instead of local maps
- [ ] Game visually identical to Phase 0
- [ ] All gameplay features still work
- [ ] No regressions in FPS/memory (check debug overlay)

## Implementation Notes

**Gotchas:**
- Don't forget to update ALL socket handlers to use gameState methods
- Interpolation targets must be updated in gameState, not kept separately
- myPlayerId needs to be set in both GameScene (for now) and GameState
- EventBus is set up but not heavily used yet - that comes in Phase 2

**Testing notes:**
- Use fixtures for Player/Nutrient types to avoid verbose test setup
- happy-dom provides minimal browser APIs for testing
- Tests should be fast (<100ms total) - they're just data transformations

**Performance:**
- Maps are fast for lookups/inserts (O(1))
- No performance impact from normalized storage
- EventBus overhead is negligible (Set iterations)

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Delete client/src/core/events/EventBus.ts
# 2. Delete client/src/core/state/GameState.ts
# 3. Delete client/src/core/state/GameState.test.ts
# 4. Delete client/vitest.config.ts
# 5. Remove vitest/happy-dom from package.json
# 6. Revert changes to GameScene.ts (restore local maps)
# 7. npm install
```

## Next Phase

Once this phase is approved, proceed to **Phase 2: Socket Manager Extraction**.
