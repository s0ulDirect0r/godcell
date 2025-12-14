# EventBus to ECS Refactor Plan

**Date:** 2025-12-01
**Status:** Proposed
**Trigger:** Complexity felt during Stage 3 organism projectile implementation

---

## Problem Statement

The client uses an EventBus pattern alongside ECS, creating a dual-write architecture that scatters logic and makes debugging harder. As features grow, this complexity compounds.

---

## Current Event Flow Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EMITTERS                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  InputManager                    SocketManager                              │
│  ─────────────                   ─────────────                              │
│  • client:inputMove              • client:socketConnected/Disconnected      │
│  • client:inputRespawn           • ALL server messages re-emitted:          │
│  • client:sprint                   - gameState                              │
│  • client:empActivate              - playerJoined/Left/Moved/Died           │
│  • client:pseudopodFire            - playerEvolutionStarted/Evolved         │
│  • client:mouseLook                - nutrientSpawned/Collected/Moved        │
│                                    - swarmSpawned/Moved/Consumed            │
│  HUDOverlay                        - pseudopodSpawned/Moved/Hit/Retracted   │
│  ──────────                        - empActivated, detectionUpdate          │
│  • client:inputRespawn             - dataFruit*, cyberBug*, jungleCreature* │
│    (respawn button)                - organismProjectile*                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LISTENERS                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  main.ts (Input→Network routing)     ThreeRenderer (Visual effects)         │
│  ───────────────────────────────     ─────────────────────────────          │
│  • client:socketConnected            • playerDied → death burst             │
│  • client:inputMove → sendMove()     • playerEvolutionStarted → evo effect  │
│  • client:inputRespawn → sendResp()  • playerEvolved → evo complete         │
│  • client:empActivate → sendEMP()    • playerRespawned → spawn effect       │
│  • client:pseudopodFire → ????       • empActivated → EMP burst             │
│    ↳ LOGIC: check stage, route to    • swarmConsumed → consume effect       │
│      sendPseudopodFire() OR          • pseudopodHit → hit particles         │
│      sendOrganismProjectileFire()    • nutrientCollected → collect effect   │
│  • client:sprint → sendSprint()      • nutrientSpawned → spawn anim         │
│  • client:mouseLook → sync yaw       • playerEngulfed → engulf effect       │
│                                      • client:mouseLook → camera            │
│                                                                              │
│  HUDOverlay (UI state)                                                       │
│  ─────────────────────                                                       │
│  • playerDied → show death screen                                           │
│  • playerRespawned → hide death screen                                      │
│  • nutrientCollected → HUD flash                                            │
│  • playerEvolved → stage indicator                                          │
│  • empActivated → cooldown display                                          │
│  • detectionUpdate → radar indicator                                        │
│  • gameState → initialize HUD                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Problems

### 1. Dual-Write Pattern in SocketManager

Every server message does TWO things:

```typescript
this.socket.on('playerDied', (data) => {
  removePlayer(this.world, data.playerId); // Update ECS ✓
  eventBus.emit(data); // ALSO emit event ???
});
```

The ECS is the source of truth, but events are a parallel channel for "side effects". This means:

- State flows through two paths
- Debugging requires tracing both paths
- Easy to forget to emit (or emit wrong data)

### 2. Logic Scattered in main.ts

```typescript
eventBus.on('client:pseudopodFire', (event) => {
  const stage = myPlayer?.stage;
  if (stage === EvolutionStage.CYBER_ORGANISM || ...) {
    socketManager.sendOrganismProjectileFire(...);
  } else {
    socketManager.sendPseudopodFire(...);
  }
});
```

This is game logic (stage-based ability routing) sitting in the bootstrap file. Not discoverable, not testable, not part of any system.

### 3. Effects Depend on Ephemeral Events

When `playerDied` fires, ThreeRenderer spawns a death burst. But:

- If renderer isn't initialized yet, effect is missed
- If you pause/resume, no way to "replay" missed effects
- Can't inspect "what effects are pending" - they're gone

### 4. Growing Event Count

Currently tracking **30+ event types** across the codebase. Every new feature adds more. The organism projectile added 3 more.

---

## Component-Based Alternative Design

### Core Principle

**Replace events with queryable component state.**

Instead of:

```text
Server sends playerDied → SocketManager emits event → ThreeRenderer catches event → spawns burst
```

Do:

```text
Server sends playerDied → SocketManager adds DeathEffect component → EffectsSystem queries DeathEffect → spawns burst → removes component
```

### Proposed Architecture

**1. Effect Components (add to `shared/ecs/components.ts`)**

```typescript
// One-shot visual effects - render system processes then removes
export interface VisualEffectComponent {
  type: 'death' | 'evolution' | 'spawn' | 'collect' | 'hit' | 'emp' | 'engulf';
  position: Position;
  color?: string;
  data?: Record<string, unknown>; // Effect-specific params
  createdAt: number;
}

// Client-only: tracks local player input intent (replaces input events)
export interface InputIntentComponent {
  move?: { x: number; y: number; z?: number };
  fire?: { targetX: number; targetY: number };
  sprint?: boolean;
  respawn?: boolean;
  emp?: boolean;
}
```

**2. Dedicated Effects Entity**

Instead of attaching effects to entities that may be destroyed, use a singleton "effects queue" entity:

```typescript
// In client world setup
const effectsEntity = world.createEntity();
world.addTag(effectsEntity, Tags.EffectsQueue);
world.addComponent(effectsEntity, Components.EffectsQueue, { pending: [] });

// EffectsQueue component
export interface EffectsQueueComponent {
  pending: VisualEffectComponent[];
}
```

**3. SocketManager (simplified)**

```typescript
// BEFORE (dual-write)
this.socket.on('playerDied', (data) => {
  eventBus.emit(data); // For effects
  removePlayer(this.world, data.playerId);
});

// AFTER (ECS-only)
this.socket.on('playerDied', (data) => {
  // Queue effect BEFORE removing entity (so we have position)
  const entity = getEntityByStringId(data.playerId);
  const pos = this.world.getComponent(entity, Components.Position);
  queueEffect(this.world, {
    type: 'death',
    position: { x: pos.x, y: pos.y },
    color: data.color,
    createdAt: Date.now(),
  });
  removePlayer(this.world, data.playerId);
});
```

**4. EffectsRenderSystem (new)**

```typescript
class EffectsRenderSystem {
  sync(world: World) {
    const queue = getEffectsQueue(world);

    for (const effect of queue.pending) {
      switch (effect.type) {
        case 'death':
          this.spawnDeathBurst(effect.position, effect.color);
          break;
        case 'evolution':
          this.spawnEvolutionEffect(effect.position, effect.data);
          break;
        // ... etc
      }
    }

    // Clear processed effects
    queue.pending = [];
  }
}
```

**5. InputSystem (replaces main.ts event wiring)**

```typescript
class ClientInputSystem {
  update(world: World, socketManager: SocketManager) {
    const localPlayer = getLocalPlayerEntity(world);
    if (!localPlayer) return;

    const intent = world.getComponent(localPlayer, Components.InputIntent);
    if (!intent) return;

    // Process intents
    if (intent.move) {
      socketManager.sendMove(intent.move);
    }

    if (intent.fire) {
      const stage = world.getComponent(localPlayer, Components.Stage);
      if (stage.current >= EvolutionStage.CYBER_ORGANISM) {
        socketManager.sendOrganismProjectileFire(intent.fire.targetX, intent.fire.targetY);
      } else {
        socketManager.sendPseudopodFire(intent.fire.targetX, intent.fire.targetY);
      }
    }

    if (intent.emp) {
      socketManager.sendEMPActivate();
    }

    // Clear intents after processing
    world.removeComponent(localPlayer, Components.InputIntent);
  }
}
```

**6. InputManager (writes to ECS, not events)**

```typescript
// BEFORE
eventBus.emit({ type: 'client:pseudopodFire', targetX, targetY });

// AFTER
const localPlayer = getLocalPlayerEntity(this.world);
const intent = world.getOrAddComponent(localPlayer, Components.InputIntent, {});
intent.fire = { targetX, targetY };
```

---

## Migration Path

This is a significant refactor. Phased approach recommended:

| Phase | Scope                                                               | Effort |
| ----- | ------------------------------------------------------------------- | ------ |
| 1     | Add EffectsQueue + EffectsRenderSystem, migrate death/spawn effects | Medium |
| 2     | Add InputIntent component, migrate input routing out of main.ts     | Medium |
| 3     | Remove remaining event listeners from ThreeRenderer                 | Small  |
| 4     | Remove EventBus (keep only for connection status)                   | Small  |

**Phase 1 alone** would fix the worst problem (dual-write for effects) and prove the pattern works.

---

## Trade-offs

**Pros:**

- Single source of truth (ECS only)
- All state is queryable/inspectable
- Effects can be "replayed" (they're in a queue)
- Logic lives in systems, not scattered across files
- Easier to debug - just inspect component state

**Cons:**

- More boilerplate for simple effects
- Need to manage effect queue cleanup
- Input latency slightly higher (processed in system tick, not immediate)
- Significant refactor effort

---

## References

- ECS frameworks with event systems: Bevy (has events), flecs, EnTT
- The "pure ECS" argument: state should be queryable, events are ephemeral
- Current codebase: 30+ event types, dual-write in SocketManager

---

## Decision

Pending. This is a proposal for discussion. The refactor would reduce complexity but requires significant effort.
