# Entity-Scale Effects Filtering

**Date:** 2025-12-01
**Status:** Planned
**Related Issue:** See beads

## Problem

Currently, auras and effects are filtered by **global render mode** (soup vs jungle):

```typescript
// ThreeRenderer.ts
if (this.environmentSystem.getMode() === 'soup') {
  this.auraSystem.updateDrainAuras(...);
  this.auraSystem.updateGainAuras(...);
} else {
  this.auraSystem.clearAll();
}
```

This is too coarse:
- Stage 3+ players can't see their own damage/gain auras
- All effects are hidden in jungle mode, even ones that should apply to jungle-scale entities
- No path forward for Stage 4-5 effects

## Solution: Entity-Scale Filtering

Effects should be tied to **entities**, not global modes. Each effect has an implicit scale derived from its entity's stage. The viewer only sees effects matching their viewing scale.

### Scale Mapping

| Scale   | Stages              | Environment |
|---------|---------------------|-------------|
| soup    | 1 (single-cell), 2 (multi-cell) | Primordial soup |
| jungle  | 3 (cyber-organism)  | Digital jungle |
| city    | 4 (humanoid)        | Neon city |
| world   | 5 (godcell)         | Transcendent |

### Implementation

**1. Add scale helper (shared/index.ts):**

```typescript
export type EntityScale = 'soup' | 'jungle' | 'city' | 'world';

export function getEntityScale(stage: EvolutionStage): EntityScale {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
    case EvolutionStage.MULTI_CELL:
      return 'soup';
    case EvolutionStage.CYBER_ORGANISM:
      return 'jungle';
    case EvolutionStage.HUMANOID:
      return 'city';
    case EvolutionStage.GODCELL:
      return 'world';
  }
}
```

**2. AuraSystem filters by scale:**

```typescript
updateDrainAuras(
  players: Map<string, PlayerData>,
  swarms: Map<string, SwarmData>,
  meshes: Map<string, THREE.Object3D>,
  viewerStage: EvolutionStage,
  ...
) {
  const viewerScale = getEntityScale(viewerStage);

  for (const [id, player] of players) {
    const entityScale = getEntityScale(player.stage);
    if (entityScale !== viewerScale) continue; // Skip mismatched scales

    // ... existing aura rendering logic
  }
}
```

**3. ThreeRenderer passes viewer stage:**

```typescript
// Remove mode check, pass viewer stage instead
const myPlayer = getLocalPlayer(this.world);
if (myPlayer) {
  this.auraSystem.updateDrainAuras(
    playersForAura,
    swarmsForAura,
    meshes,
    myPlayer.stage, // viewer's stage for scale filtering
    ...
  );
}
```

**4. Same pattern for EffectsSystem:**

- Death bursts: only show for entities at viewer's scale
- Energy transfers: only show when both source and target are at viewer's scale
- Spawn effects: only show for entities at viewer's scale
- EMP pulses: only show if viewer is at soup scale (since EMP is Stage 2 ability)

### Benefits

1. **Extensible:** Works for any number of scales/stages
2. **Entity-centric:** Effects belong to entities, not global state
3. **Correct behavior:** Stage 3+ players see their own auras
4. **Clean separation:** No more scattered `if (mode === 'soup')` checks

### Files to Modify

- `shared/index.ts` - Add EntityScale type and helper
- `client/src/render/systems/AuraSystem.ts` - Accept viewer stage, filter by scale
- `client/src/render/systems/EffectsSystem.ts` - Accept viewer stage, filter by scale
- `client/src/render/three/ThreeRenderer.ts` - Pass viewer stage, remove mode checks

### Migration Path

1. Add helper without changing behavior
2. Update AuraSystem to use scale filtering
3. Update EffectsSystem to use scale filtering
4. Remove old mode-based filtering from ThreeRenderer
5. Test at each stage to verify correct visibility
