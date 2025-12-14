# Plan: Stage 5 Skeleton - 3D Flying Sphere Godcell

**Issue:** godcell-cd7l

## Goal

Prove out Stage 5 technical bones with dev panel access only:

- Simple glowing sphere model
- Third-person camera following the sphere
- Full 3D movement (WASD + Q/E for vertical)
- Existing dev panel button already works to force Stage 5

---

## Implementation Steps

### Step 1: Add Z-Axis to ECS Components (shared)

**File:** `shared/ecs/components.ts`

```typescript
// Extend PositionComponent
export interface PositionComponent {
  x: number;
  y: number;
  z: number; // NEW: height in 3D space (default: 0)
}

// Extend VelocityComponent
export interface VelocityComponent {
  x: number;
  y: number;
  z: number; // NEW: vertical velocity (default: 0)
}

// Extend InputComponent
export interface InputComponent {
  direction: { x: number; y: number; z: number }; // ADD z
  // ...
}
```

### Step 2: Update Network Message Types (shared)

**File:** `shared/index.ts`

- Add `z` to `PlayerMoveMessage.direction`
- Add `z` to `PlayerMovedMessage.position`
- Add `z` to `Position` interface
- Add `z` to `Player.position`

### Step 3: Add Vertical Input Keys (client)

**File:** `client/src/core/input/InputManager.ts`

- Map **Q key → z = 1** (ascend)
- Map **E key → z = -1** (descend)
- Only apply vertical input for Stage 5 (godcell) players
- Normalize 3D direction vector
- Emit 3D direction in `client:inputMove` event

### Step 4: Update Socket Manager (client)

**File:** `client/src/core/net/SocketManager.ts`

- Update `sendMove()` to include z coordinate

### Step 5: Update Server Movement System

**File:** `server/src/ecs/systems/MovementSystem.ts`

- Process z input for Stage 5 players only
- Apply 3D acceleration and velocity
- Clamp to Z world bounds (e.g., 0 to 2000)
- Calculate 3D distance for energy cost
- Broadcast 3D positions

### Step 6: Create Godcell Mesh (client)

**File:** `client/src/render/meshes/GodcellMesh.ts` (NEW)

```typescript
// Simple glowing sphere - NOT the full alien-angel
// - Outer sphere: semi-transparent, player color
// - Inner nucleus: emissive, bright glow
// - Size: PLAYER_SIZE * 10.0 (500px radius)
// - Bloom-friendly materials
```

### Step 7: Update PlayerRenderSystem

**File:** `client/src/render/systems/PlayerRenderSystem.ts`

- Import and use `createGodcell()` for stage 5
- Fix `getPlayerRadius()` to include godcell case
- Position meshes with z coordinate

### Step 8: Implement Third-Person Camera

**File:** `client/src/render/systems/CameraSystem.ts`

- Add `'thirdperson'` to CameraMode type
- Create perspective camera for TPS view
- Position: behind and above player (offset ~300-500 units)
- Smooth follow with lerp
- Look at player position

### Step 9: Switch Camera for Stage 5

**File:** `client/src/render/three/ThreeRenderer.ts`

- Add condition: if stage === GODCELL → setCameraMode('thirdperson')
- Update camera position each frame based on player 3D position

---

## Critical Files to Modify

| File                                              | Changes                             |
| ------------------------------------------------- | ----------------------------------- |
| `shared/ecs/components.ts`                        | Add z to Position, Velocity, Input  |
| `shared/index.ts`                                 | Add z to message types              |
| `client/src/core/input/InputManager.ts`           | Q/E for vertical input              |
| `client/src/core/net/SocketManager.ts`            | Send 3D direction                   |
| `server/src/ecs/systems/MovementSystem.ts`        | 3D physics for Stage 5              |
| `server/src/ecs/factories.ts`                     | Initialize z=0 in position/velocity |
| `client/src/render/meshes/GodcellMesh.ts`         | NEW: glowing sphere                 |
| `client/src/render/systems/PlayerRenderSystem.ts` | Use godcell mesh, 3D position       |
| `client/src/render/systems/CameraSystem.ts`       | Third-person mode                   |
| `client/src/render/three/ThreeRenderer.ts`        | Camera mode switching               |

---

## Success Criteria

1. ✅ Can click "Max Energy + Stage 5" in dev panel
2. ✅ Camera switches to third-person behind/above sphere
3. ✅ Can fly freely in 3D space (WASD + Q/E)
4. ✅ Sphere model visible (simple glowing sphere)
5. ✅ Player can move through full 3D volume

---

## Out of Scope (per issue description)

- Procedural alien-angel generation
- Signal system
- Rite of passage / final battle
- Interaction with lower stages
- Stage 5 gameplay mechanics
- Proper evolution trigger from Stage 4

---

## Decisions Made

- **Vertical input:** Q = ascend, E = descend
- **Sphere size:** 10x player size (500px radius)
- **Z world bounds:** 0 (ground) to 2000 (sky ceiling)
