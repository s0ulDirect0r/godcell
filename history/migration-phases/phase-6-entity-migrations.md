# Phase 6: Entity Migrations

**Estimated Time:** 3-5 hours total
**Dependencies:** Phase 5 (Three.js POC) must be complete

## Overview

Migrate each entity type from Phaser to Three.js one at a time. After migrating nutrients in Phase 5, we now add: trails/particles, obstacles, swarms, pseudopods (if implemented), and players. Each gets visual approval before moving to the next.

## Migration Order (Low Risk → High Risk)

1. **Trails/Particles** (~30min) - Ambient background, low risk
2. **Obstacles** (~1h) - Gravity wells with gradients
3. **Swarms** (~1h) - Virus enemies
4. **Pseudopods** (~30min) - If implemented (can skip for now)
5. **Players** (~2h) - Most critical, interpolation + trails + stages

## Process for Each Entity

**Iterative approach:**
1. Add sync method to `ThreeRenderer` (e.g., `syncPlayers()`)
2. Create geometries/materials for that entity type
3. Update `render()` to call new sync method
4. Test in `three-only` mode
5. Visual check - compare to Phaser version
6. **Approve → move to next entity**

## Example: Players Migration

### In `ThreeRenderer.ts`:

```typescript
private playerMeshes: Map<string, THREE.Mesh> = new Map();

private syncPlayers(state: GameState): void {
  // Remove players that left
  this.playerMeshes.forEach((mesh, id) => {
    if (!state.players.has(id)) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.playerMeshes.delete(id);
    }
  });

  // Add or update players
  state.players.forEach((player, id) => {
    let mesh = this.playerMeshes.get(id);

    if (!mesh) {
      // Create player mesh (circle for now, can enhance later)
      const geometry = new THREE.CircleGeometry(player.radius, 32);
      const colorHex = parseInt(player.color.replace('#', ''), 16);
      const material = new THREE.MeshBasicMaterial({ color: colorHex });
      mesh = new THREE.Mesh(geometry, material);
      this.scene.add(mesh);
      this.playerMeshes.set(id, mesh);
    }

    // Update position from interpolation targets
    const target = state.playerTargets.get(id);
    if (target) {
      // Smooth interpolation (lerp toward target)
      mesh.position.x += (target.x - mesh.position.x) * 0.2;
      mesh.position.y += (target.y - mesh.position.y) * 0.2;
    }

    // Update radius if evolved
    mesh.scale.set(player.radius / 20, player.radius / 20, 1);
  });
}
```

### In `render()` method:

```typescript
render(state: GameState, dt: number): void {
  this.syncNutrients(state); // Phase 5
  this.syncPlayers(state);   // NEW
  // ... other entities

  this.renderer.render(this.scene, this.camera);
}
```

## Entity-Specific Notes

### Trails
- Use `THREE.Line` with `LineBasicMaterial`
- Store trail points per player
- Fade alpha over time (update material opacity)

### Obstacles
- Circle geometry for event horizon
- Smaller circle for singularity core
- Gradient effect: use shader or radial texture

### Swarms
- Instanced meshes if many swarms (performance)
- Or individual circles like players
- Update positions from swarmTargets

### Pseudopods (Optional)
- Line from player to target
- Circle at tip
- Can defer to later if not implemented

## Test Cases

**After each entity migration:**
```bash
npm run dev
# Open: http://localhost:8080?renderer=three-only

# Visual checklist per entity:
# - Renders at correct position
# - Correct size
# - Correct color
# - Animates/moves smoothly
# - Matches Phaser version visually

# Compare side-by-side:
# Open two tabs:
# Tab 1: http://localhost:8080?renderer=phaser-only
# Tab 2: http://localhost:8080?renderer=three-only
# Should look nearly identical
```

## Acceptance Criteria

- [ ] All entity types render in Three.js
- [ ] Visual parity with Phaser (within reason)
- [ ] Interpolation works (smooth movement)
- [ ] Trails render and fade correctly
- [ ] Particles/ambient effects work
- [ ] Camera follows local player
- [ ] No memory leaks (check over 5 minutes)
- [ ] FPS near baseline (55-60)

## Implementation Notes

**Gotchas:**
- Dispose geometries/materials when removing entities (prevent leaks)
- Player trails need line rendering (not just sprites)
- Obstacle gradients may need custom shaders
- Interpolation must match server tick rate
- Color parsing: Phaser uses "#RRGGBB", Three.js uses 0xRRGGBB

**Performance tips:**
- Reuse geometries where possible (players of same size)
- Use object pooling for frequently created/destroyed entities
- Consider instanced rendering for swarms if >50 entities

**Visual polish:**
- Don't worry about making it "better" yet - that's Phase 9
- Goal is functional parity
- Glow/bloom/effects come later

## Rollback

If an entity migration breaks things:
1. Comment out that sync method
2. Test with remaining entities working
3. Fix the broken entity
4. Retry

Don't proceed to next entity until current one works.

## Next Phase

Once **all entities are migrated and approved**, proceed to **Phase 7: HUD/DOM Overlay**.
