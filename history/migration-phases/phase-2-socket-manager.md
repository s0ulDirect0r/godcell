# Phase 2: Socket Manager Extraction

**Estimated Time:** 1-2 hours
**Dependencies:** Phase 1 (Core State + Message Contract) must be complete

## Overview

Extract socket.io connection and message handling from GameScene into a dedicated `SocketManager` class. This class owns the socket lifecycle, handles all server messages, and updates GameState accordingly. GameScene becomes a passive consumer of state changes via EventBus.

## Goals

1. Move socket.io ownership out of GameScene
2. Centralize all network message handling
3. Use EventBus to notify GameScene of state changes
4. Single source of truth: GameState updated only by SocketManager
5. GameScene focuses purely on rendering

## Files to Create

### `client/src/core/net/SocketManager.ts`
Socket.io lifecycle and message handling.

```typescript
import { io, Socket } from 'socket.io-client';
import type {
  GameStateMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerMovedMessage,
  PlayerRespawnedMessage,
  PlayerDiedMessage,
  PlayerEvolvedMessage,
  NutrientSpawnedMessage,
  NutrientCollectedMessage,
  NutrientMovedMessage,
  EnergyUpdateMessage,
  SwarmSpawnedMessage,
  SwarmMovedMessage,
  PseudopodSpawnedMessage,
  PseudopodRetractedMessage,
  PlayerEngulfedMessage,
  DetectionUpdateMessage,
} from '@godcell/shared';
import { GameState } from '../state/GameState';
import { eventBus } from '../events/EventBus';

export class SocketManager {
  private socket: Socket;
  private gameState: GameState;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(serverUrl: string, gameState: GameState) {
    this.gameState = gameState;
    this.socket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
    });

    this.setupHandlers();
  }

  /**
   * Get socket ID (our player ID)
   */
  getSocketId(): string | undefined {
    return this.socket.id;
  }

  /**
   * Send player move intent
   */
  sendMove(vx: number, vy: number): void {
    this.socket.emit('player:move', { vx, vy });
  }

  /**
   * Send pseudopod extension intent
   */
  sendPseudopodExtend(targetX: number, targetY: number): void {
    this.socket.emit('player:pseudopod:extend', { targetX, targetY });
  }

  /**
   * Send respawn request
   */
  sendRespawn(): void {
    this.socket.emit('player:respawn');
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private setupHandlers(): void {
    // Connection lifecycle
    this.socket.on('connect', () => {
      console.log('[Socket] Connected:', this.socket.id);
      this.reconnectAttempts = 0;
      this.gameState.myPlayerId = this.socket.id || null;
      eventBus.emit('socket:connected', { socketId: this.socket.id });
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      eventBus.emit('socket:disconnected');
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      console.error(`[Socket] Connection error (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        eventBus.emit('socket:failed', { error: 'Max reconnect attempts reached' });
      }
    });

    // Game state snapshot
    this.socket.on('game:state', (data: GameStateMessage) => {
      this.gameState.applySnapshot(data);
      this.gameState.myPlayerId = this.socket.id || null;
      eventBus.emit('game:state:loaded', { state: this.gameState });
    });

    // Player events
    this.socket.on('player:joined', (data: PlayerJoinedMessage) => {
      this.gameState.upsertPlayer(data.player);
      eventBus.emit('player:joined', data);
    });

    this.socket.on('player:left', (data: PlayerLeftMessage) => {
      this.gameState.removePlayer(data.playerId);
      eventBus.emit('player:left', data);
    });

    this.socket.on('player:moved', (data: PlayerMovedMessage) => {
      this.gameState.updatePlayerTarget(data.playerId, data.x, data.y);
      eventBus.emit('player:moved', data);
    });

    this.socket.on('player:respawned', (data: PlayerRespawnedMessage) => {
      this.gameState.upsertPlayer(data.player);
      eventBus.emit('player:respawned', data);
    });

    this.socket.on('player:died', (data: PlayerDiedMessage) => {
      eventBus.emit('player:died', data);
    });

    this.socket.on('player:evolved', (data: PlayerEvolvedMessage) => {
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.stage = data.newStage;
        player.radius = data.newRadius;
        player.maxHealth = data.newMaxHealth;
        player.maxEnergy = data.newMaxEnergy;
        player.energyCapacity = data.newEnergyCapacity;
      }
      eventBus.emit('player:evolved', data);
    });

    this.socket.on('player:engulfed', (data: PlayerEngulfedMessage) => {
      eventBus.emit('player:engulfed', data);
    });

    // Nutrient events
    this.socket.on('nutrient:spawned', (data: NutrientSpawnedMessage) => {
      this.gameState.upsertNutrient(data.nutrient);
      eventBus.emit('nutrient:spawned', data);
    });

    this.socket.on('nutrient:collected', (data: NutrientCollectedMessage) => {
      this.gameState.removeNutrient(data.nutrientId);
      eventBus.emit('nutrient:collected', data);
    });

    this.socket.on('nutrient:moved', (data: NutrientMovedMessage) => {
      this.gameState.updateNutrientPosition(data.nutrientId, data.x, data.y);
      eventBus.emit('nutrient:moved', data);
    });

    // Energy updates
    this.socket.on('energy:update', (data: EnergyUpdateMessage) => {
      const player = this.gameState.players.get(data.playerId);
      if (player) {
        player.energy = data.energy;
        player.health = data.health;
      }
      eventBus.emit('energy:update', data);
    });

    // Swarm events
    this.socket.on('swarm:spawned', (data: SwarmSpawnedMessage) => {
      this.gameState.upsertSwarm(data.swarm);
      eventBus.emit('swarm:spawned', data);
    });

    this.socket.on('swarm:moved', (data: SwarmMovedMessage) => {
      this.gameState.updateSwarmTarget(data.swarmId, data.x, data.y);
      eventBus.emit('swarm:moved', data);
    });

    // Pseudopod events
    this.socket.on('pseudopod:spawned', (data: PseudopodSpawnedMessage) => {
      this.gameState.upsertPseudopod(data.pseudopod);
      eventBus.emit('pseudopod:spawned', data);
    });

    this.socket.on('pseudopod:retracted', (data: PseudopodRetractedMessage) => {
      this.gameState.removePseudopod(data.pseudopodId);
      eventBus.emit('pseudopod:retracted', data);
    });

    // Detection updates (for Stage 2+ chemical sensing)
    this.socket.on('detection:update', (data: DetectionUpdateMessage) => {
      eventBus.emit('detection:update', data);
    });
  }
}
```

## Files to Modify

### `client/src/scenes/GameScene.ts`
Remove socket handling, consume state via EventBus.

**Remove:**
- `private socket!: Socket;`
- All `socket.on(...)` handlers
- Socket emit calls (replace with SocketManager methods)

**Add at top of class:**
```typescript
import { SocketManager } from '../core/net/SocketManager';

private socketManager!: SocketManager;
```

**In `create()` method:**
```typescript
// Replace socket initialization with:
const serverUrl = import.meta.env.DEV
  ? 'http://localhost:3000'
  : window.location.origin;

this.socketManager = new SocketManager(serverUrl, this.gameState);

// Subscribe to events
eventBus.on('game:state:loaded', this.onGameStateLoaded.bind(this));
eventBus.on('player:joined', this.onPlayerJoined.bind(this));
eventBus.on('player:left', this.onPlayerLeft.bind(this));
eventBus.on('player:died', this.onPlayerDied.bind(this));
eventBus.on('player:evolved', this.onPlayerEvolved.bind(this));
eventBus.on('nutrient:spawned', this.onNutrientSpawned.bind(this));
eventBus.on('nutrient:collected', this.onNutrientCollected.bind(this));
eventBus.on('swarm:spawned', this.onSwarmSpawned.bind(this));
eventBus.on('pseudopod:spawned', this.onPseudopodSpawned.bind(this));
eventBus.on('pseudopod:retracted', this.onPseudopodRetracted.bind(this));
```

**Convert handlers to methods:**
```typescript
private onGameStateLoaded(data: { state: GameState }): void {
  // Create sprites for all entities
  this.gameState.players.forEach(player => this.createPlayerSprite(player));
  this.gameState.nutrients.forEach(nutrient => this.createNutrientSprite(nutrient));
  this.gameState.obstacles.forEach(obstacle => this.createObstacleSprite(obstacle));
  this.gameState.swarms.forEach(swarm => this.createSwarmSprite(swarm));

  // Start update loop
  this.sessionStats.spawnTime = Date.now();

  // Set camera to follow local player
  if (this.myPlayerId) {
    const myPlayer = this.gameState.players.get(this.myPlayerId);
    if (myPlayer) {
      this.cameras.main.startFollow(this.playerSprites.get(this.myPlayerId)!);
    }
  }
}

private onPlayerJoined(data: PlayerJoinedMessage): void {
  this.createPlayerSprite(data.player);
}

private onPlayerLeft(data: PlayerLeftMessage): void {
  this.destroyPlayerSprite(data.playerId);
}

// ... similar for other events
```

**Replace socket emits:**
```typescript
// OLD:
this.socket.emit('player:move', { vx, vy });

// NEW:
this.socketManager.sendMove(vx, vy);
```

**In `shutdown()` method:**
```typescript
// Add cleanup
this.socketManager.disconnect();
eventBus.clear();
```

## Test Cases

### Automated Tests

No new tests for this phase (SocketManager is mostly I/O), but existing GameState tests should still pass:

```bash
npm test
# All Phase 1 tests should pass
```

### Manual Testing

```bash
npm run dev
# Open: http://localhost:8080

# Verify:
# - Game loads and connects
# - Local player spawns
# - Other players visible
# - Movement works (WASD)
# - Nutrients can be collected
# - Death/respawn works
# - R key respawns
# - Click extends pseudopod (if Stage 2)
# - Check console: should see "[Socket] Connected: <id>"
```

**Test reconnection:**
```bash
# With game running:
# 1. Stop server
# 2. Should see disconnect message
# 3. Restart server
# 4. Should reconnect automatically
```

**Test multiple clients:**
```bash
# Open two browser tabs
# Verify:
# - Both players see each other
# - Movement is synced
# - No console errors
```

## Acceptance Criteria

- [ ] SocketManager class created and owns socket.io
- [ ] All network message handlers moved to SocketManager
- [ ] GameScene subscribes to EventBus for state changes
- [ ] GameScene no longer imports socket.io-client
- [ ] Game visually identical to Phase 1
- [ ] All multiplayer features work (movement, collection, death)
- [ ] Reconnection works automatically
- [ ] No FPS/memory regressions

## Implementation Notes

**Gotchas:**
- Must bind event handler methods (`.bind(this)`) when subscribing to EventBus
- Don't forget to call `socketManager.disconnect()` in shutdown/cleanup
- EventBus should be cleared on scene shutdown to prevent memory leaks
- Server URL detection: use `import.meta.env.DEV` for Vite dev mode check

**Architecture benefits:**
- GameScene is now ~200 lines shorter
- Socket logic can be tested independently (future)
- Easy to add socket reconnection strategies
- Can swap socket.io for different transport later

**Event flow:**
```
Server → Socket.io → SocketManager → GameState update → EventBus → GameScene → Render
```

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Delete client/src/core/net/SocketManager.ts
# 2. Revert client/src/scenes/GameScene.ts to Phase 1 version
# 3. Restore socket handling in GameScene
```

## Next Phase

Once this phase is approved, proceed to **Phase 3: Input Manager Extraction**.
