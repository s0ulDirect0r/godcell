# Variable-Intensity Drain Auras for All Energy Damage

**Status**: Planned (Not Yet Implemented)
**Created**: 2025-11-24
**Branch**: TBD (will create after PR #42 merges)

## Overview

Show drain auras with variable intensity whenever any entity takes energy/health damage from external sources. Aura appearance scales with damage rate and uses different colors for different damage types.

---

## Design Decisions

Based on user feedback:

- ✅ **Starvation**: Different color (yellow/orange) to distinguish self-inflicted damage
- ✅ **Metabolism**: No aura for passive energy decay (only external threats)
- ✅ **Pseudopod hits**: Flash + brief aura (1-2 seconds with decay)
- ✅ **Gravity wells**: Gradient intensity based on proximity to singularity

---

## Implementation Plan

### 1. **Extend Network Protocol** (shared/index.ts)

Update `PlayerDrainStateMessage` to include damage information:

```typescript
export interface PlayerDrainStateMessage {
  type: 'playerDrainState';
  drainedPlayerIds: string[]; // DEPRECATED - kept for backward compat
  drainedSwarmIds: string[]; // DEPRECATED - kept for backward compat

  // NEW: Comprehensive damage tracking per entity
  damageInfo: Record<
    string,
    {
      totalDamageRate: number; // Combined damage per second from all sources
      primarySource: DamageSource; // Dominant damage source (for color)
      proximityFactor?: number; // 0-1 for gradient effects (gravity wells)
    }
  >;

  swarmDamageInfo: Record<
    string,
    {
      totalDamageRate: number;
      primarySource: DamageSource;
    }
  >;
}

// NEW: Damage source enum for visual treatment
export type DamageSource =
  | 'predation' // Red (multi-cell contact drain)
  | 'swarm' // Red (entropy swarm attacks)
  | 'beam' // Red (pseudopod projectiles)
  | 'gravity' // Red (gravity well crushing)
  | 'starvation'; // Yellow/orange (zero energy)
```

---

### 2. **Server: Track Active Damage Per Entity** (server/src/index.ts)

Create new tracking system in main game loop:

```typescript
// NEW: Track active damage sources per tick
interface ActiveDamage {
  damageRate: number; // DPS this tick
  source: DamageSource; // Which source
  proximityFactor?: number; // For gravity gradient (0-1)
}

const activeDamageThisTick = new Map<string, ActiveDamage[]>();

// In each damage function, record damage instead of just applying:
function recordDamage(playerId: string, rate: number, source: DamageSource, proximity?: number) {
  if (!activeDamageThisTick.has(playerId)) {
    activeDamageThisTick.set(playerId, []);
  }
  activeDamageThisTick
    .get(playerId)!
    .push({ damageRate: rate, source, proximityFactor: proximity });
}
```

**Modify damage application points:**

1. **Contact drain** (checkPredationCollisions):
   - `recordDamage(preyId, CONTACT_DRAIN_RATE, 'predation')`

2. **Swarm attacks** (checkSwarmCollisions in server/src/swarms.ts):
   - `recordDamage(playerId, SWARM_DAMAGE_RATE, 'swarm')`

3. **Pseudopod hits** (checkBeamCollision):
   - Emit instant flash (current behavior)
   - `recordDamage(targetId, PSEUDOPOD_DRAIN_RATE, 'beam')` with 1-2 second decay timer

4. **Gravity wells** (updateMetabolism):
   - Calculate `proximityFactor = 1.0 - (dist / radius)`
   - `recordDamage(playerId, obstacle.damageRate * damageScale, 'gravity', proximityFactor)`

5. **Starvation** (updateMetabolism):
   - `recordDamage(playerId, STARVATION_DAMAGE_RATE, 'starvation')`

**Aggregate and broadcast:**

```typescript
function broadcastDamageState() {
  const damageInfo: Record<string, any> = {};

  for (const [playerId, damages] of activeDamageThisTick) {
    // Sum total damage rate
    const totalDamageRate = damages.reduce((sum, d) => sum + d.damageRate, 0);

    // Find dominant source (highest damage)
    const primarySource = damages.sort((a, b) => b.damageRate - a.damageRate)[0].source;

    // Average proximity for gravity (if applicable)
    const proximityFactors = damages
      .filter((d) => d.proximityFactor !== undefined)
      .map((d) => d.proximityFactor!);
    const proximityFactor =
      proximityFactors.length > 0
        ? proximityFactors.reduce((sum, p) => sum + p, 0) / proximityFactors.length
        : undefined;

    damageInfo[playerId] = { totalDamageRate, primarySource, proximityFactor };
  }

  io.emit('playerDrainState', {
    type: 'playerDrainState',
    drainedPlayerIds: [], // deprecated
    drainedSwarmIds: [], // deprecated
    damageInfo,
    swarmDamageInfo: {}, // TODO: apply same logic to swarms being consumed
  });

  // Clear for next tick
  activeDamageThisTick.clear();
}
```

**Special handling for pseudopod hits:**

- Maintain separate decay timer map: `Map<string, { rate: number, expiresAt: number }>`
- When beam hits, add entry with 1.5 second expiration
- Each tick, include non-expired entries in `activeDamageThisTick`
- Clean up expired entries

---

### 3. **Client: Update State Management** (client/src/core/state/GameState.ts)

```typescript
export interface DamageInfo {
  totalDamageRate: number;
  primarySource: DamageSource;
  proximityFactor?: number;
}

export class GameState {
  // Replace drainedPlayerIds/drainedSwarmIds with:
  playerDamageInfo: Map<string, DamageInfo> = new Map();
  swarmDamageInfo: Map<string, DamageInfo> = new Map();

  updateDamageInfo(damageInfo: Record<string, any>, swarmDamageInfo: Record<string, any>) {
    this.playerDamageInfo.clear();
    for (const [id, info] of Object.entries(damageInfo)) {
      this.playerDamageInfo.set(id, info as DamageInfo);
    }

    this.swarmDamageInfo.clear();
    for (const [id, info] of Object.entries(swarmDamageInfo)) {
      this.swarmDamageInfo.set(id, info as DamageInfo);
    }
  }
}
```

---

### 4. **Client: Variable-Intensity Aura Rendering** (client/src/render/three/ThreeRenderer.ts)

**Update `updateDrainAuras()` to use intensity:**

```typescript
private updateDrainAuras(state: GameState, _dt: number): void {
  const time = Date.now() * 0.001;

  state.players.forEach((player, playerId) => {
    const playerMesh = this.playerMeshes.get(playerId);
    if (!playerMesh) return;

    const damageInfo = state.playerDamageInfo.get(playerId);

    if (damageInfo && damageInfo.totalDamageRate > 0) {
      let auraMesh = this.drainAuraMeshes.get(playerId);

      if (!auraMesh) {
        // Create aura (same logic as current)
        auraMesh = this.createDrainAura(playerRadius);
        this.drainAuraMeshes.set(playerId, auraMesh);
        this.scene.add(auraMesh);
      }

      // Position aura
      auraMesh.position.x = playerMesh.position.x;
      auraMesh.position.y = playerMesh.position.y;

      // CALCULATE INTENSITY from damage rate
      const intensity = this.calculateAuraIntensity(damageInfo.totalDamageRate);

      // CHOOSE COLOR based on primary source
      const color = this.getAuraColor(damageInfo.primarySource);

      // APPLY INTENSITY to visual parameters
      this.applyAuraIntensity(auraMesh, intensity, color, time, damageInfo.proximityFactor);

    } else {
      // Remove aura if no damage
      this.removeDrainAura(playerId);
    }
  });

  // Same logic for swarms with swarmDamageInfo
}
```

**Intensity calculation (maps DPS to 0-1 scale):**

```typescript
private calculateAuraIntensity(damageRate: number): number {
  // Intensity scale:
  // 0-30 dps   → 0.0-0.3 (subtle)
  // 30-80 dps  → 0.3-0.6 (moderate)
  // 80-150 dps → 0.6-0.9 (intense)
  // 150+ dps   → 0.9-1.0 (critical)

  if (damageRate <= 30) {
    return (damageRate / 30) * 0.3; // 0.0-0.3
  } else if (damageRate <= 80) {
    return 0.3 + ((damageRate - 30) / 50) * 0.3; // 0.3-0.6
  } else if (damageRate <= 150) {
    return 0.6 + ((damageRate - 80) / 70) * 0.3; // 0.6-0.9
  } else {
    return Math.min(1.0, 0.9 + ((damageRate - 150) / 150) * 0.1); // 0.9-1.0
  }
}
```

**Color selection:**

```typescript
private getAuraColor(source: DamageSource): number {
  switch (source) {
    case 'starvation':
      return 0xffaa00; // Orange/yellow
    case 'predation':
    case 'swarm':
    case 'beam':
    case 'gravity':
    default:
      return 0xff0000; // Red
  }
}
```

**Apply intensity to visuals:**

```typescript
private applyAuraIntensity(
  auraMesh: THREE.Group,
  intensity: number,
  color: number,
  time: number,
  proximityFactor?: number
): void {
  // Scale animation speed with intensity
  const pulseSpeed = 2.0 + intensity * 4.0;  // 2-6 cycles/sec
  const pulseAmount = 0.1 + intensity * 0.15; // ±10-25% scale
  const scale = 1.0 + Math.sin(time * pulseSpeed) * pulseAmount;
  auraMesh.scale.set(scale, scale, scale);

  // Opacity scales with intensity
  const baseOpacity = 0.3 + intensity * 0.5; // 0.3-0.8 base
  const flickerAmount = 0.1 + intensity * 0.2; // ±10-30% flicker
  let opacity = baseOpacity + Math.sin(time * 6) * flickerAmount;

  // Emissive (bloom) scales with intensity
  const baseEmissive = 1.5 + intensity * 3.0; // 1.5-4.5 base
  const emissiveFlicker = 0.3 + intensity * 0.7; // ±0.3-1.0 variation
  let emissive = baseEmissive + Math.sin(time * 5) * emissiveFlicker;

  // Apply proximity gradient for gravity wells
  if (proximityFactor !== undefined) {
    opacity *= (0.5 + proximityFactor * 0.5); // Fade out at edges
    emissive *= (0.5 + proximityFactor * 0.5);
  }

  // Apply to both spheres
  const group = auraMesh as THREE.Group;
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;

    material.color.setHex(color);
    material.emissive.setHex(color);
    material.opacity = opacity;
    material.emissiveIntensity = emissive;
  }
}
```

---

## Visual Parameters Summary

| Damage Source           | Color  | Intensity Scaling  | Special Behavior                |
| ----------------------- | ------ | ------------------ | ------------------------------- |
| **Predation** (150 dps) | Red    | High (0.9-1.0)     | Fast pulse, high opacity        |
| **Swarm** (60 dps)      | Red    | Medium (0.5-0.7)   | Moderate pulse                  |
| **Beam** (instant 100)  | Red    | Medium-fading      | Flash + 1.5s decay aura         |
| **Gravity** (0-10 dps)  | Red    | Gradient (0.0-0.3) | Fades with distance from center |
| **Starvation** (5 dps)  | Orange | Low (0.15-0.2)     | Slow pulse, subtle              |

---

## Files to Modify

1. **shared/index.ts**: Update `PlayerDrainStateMessage`, add `DamageSource` type
2. **server/src/index.ts**: Add `activeDamageThisTick` tracking, modify all damage functions, update `broadcastDamageState()`
3. **server/src/swarms.ts**: Add `recordDamage()` calls to swarm attack logic
4. **client/src/core/state/GameState.ts**: Replace drain sets with damage info maps
5. **client/src/core/net/SocketManager.ts**: Update message handler to call `updateDamageInfo()`
6. **client/src/render/three/ThreeRenderer.ts**: Rewrite `updateDrainAuras()` with intensity/color logic

---

## Testing Checklist

- [ ] Contact drain shows high-intensity red aura
- [ ] Swarm attacks show medium-intensity red aura on victims
- [ ] Pseudopod hits show flash + 1.5s fading red aura
- [ ] Gravity wells show gradient red aura (bright at center, fades at edges)
- [ ] Starvation shows low-intensity orange aura
- [ ] Multiple simultaneous damage sources combine correctly (highest source determines color, rates sum for intensity)
- [ ] Auras disappear when damage stops
- [ ] No aura shown for passive metabolism
- [ ] Performance is acceptable with many entities taking damage simultaneously

---

## Future Enhancements (Optional)

- Color mixing for multiple simultaneous sources (e.g., red + orange = blend)
- Audio cues that scale with damage intensity
- Screen shake/camera effects for high-intensity damage
- Different aura shapes for different sources (spikes for swarms, vortex for gravity)
