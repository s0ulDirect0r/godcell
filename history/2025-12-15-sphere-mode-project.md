# Sphere Mode Project

**Date:** 2025-12-15
**Status:** Experimental, in progress
**Branch:** `sphere-mode-experiment`

---

## Vision & Motivation

The endgame of GODCELL involves godcells (Stage 5) gaining the ability to fly off the planet, engage in "space gameplay," and move toward the final encounter (still undefined). To support this, the game world needs to become a navigable planet - not a flat plane.

This project explores: **Can we turn the soup/jungle into a spherical planet that players navigate around?**

If successful, this creates a foundation for:
- Godcells flying around and eventually transcending the planet
- A multi-sphere cosmology: Soup Sphere → Jungle Sphere → Space/God Sphere
- A much more visually striking and thematically coherent world

---

## Development Approach

### The False Start

Initial attempt was a direct refactor of the main game to sphere coordinates. This broke everything - too many interdependent systems to change at once.

### The Iterative Pivot

Committed to a safer approach:
1. Create `sphere-test.ts` - a standalone test harness with sphere rendering
2. Get basic sphere physics working in isolation
3. Gradually port systems: movement, camera, rendering
4. Integrate into main game behind `SPHERE_MODE` flag

This worked. The game now runs in sphere mode at `/` with the flag enabled.

---

## What Was Accomplished

### Server-Side
- `SphereMovementSystem` - Physics on sphere surface (tangent plane movement, geodesic distances)
- Sphere-aware bot AI using great-circle distance calculations
- Sphere-aware swarm spawning and movement
- Gravity well spawning with 3D positions on sphere surface
- Z-coordinate serialization throughout network layer
- `getRandomSpherePosition()` and sphere math helpers

### Client-Side
- All render systems updated for sphere mode (players, nutrients, swarms, obstacles, trails)
- Surface-following camera that orbits with the player
- 3D environment rendering (sphere mesh, equatorial grid, lighting)
- Gravity distortion meshes positioned on sphere surface with proper orientation
- Trail effects that follow sphere curvature
- Swarm auras oriented to surface normal

### Shared
- Sphere math utilities (projection, geodesic distance, tangent planes)
- `SPHERE_RADIUS` constant (3060 - circumference ~19200, roughly 4x original soup width)

---

## Current State: Honest Assessment

### What Works
- Basic gameplay loop functions on sphere
- Movement feels decent - you navigate around a globe
- Visual is striking - the sphere with grid lines, entities crawling on surface
- Gravity wells spawn, render, and kill things
- Swarms, nutrients, bots all present and functional

### What's Rough
- **Scale/Tuning is off everywhere.** Distances between entities, sphere radius, movement speeds - the whole game needs re-tuning for spherical geometry. Things that felt right on a flat plane feel wrong on a curved surface.
- **Special effects need work.** Trails, auras, bloom - designed for flat world, need adjustment.
- **Stage 2 gameplay untested.** Multi-cell mechanics, predation, pseudopods - unknown if they work correctly in sphere mode.
- **Jungle world not addressed at all.** Stage 3+ is completely unimplemented for sphere mode.

---

## Gap Analysis: Sphere vs Flat World

**Bottom line: Sphere mode is ~20-30% complete** - viable as a tech demo for Stage 1 movement but non-functional for actual gameplay.

### Server Systems Status

| System | Sphere Support | Notes |
|--------|---------------|-------|
| SphereMovementSystem | PARTIAL | Stage 1 works. Missing stage multipliers, sprint, knockback, z-flight |
| GravitySystem | WORKAROUND | Gravity baked into SphereMovementSystem - works but should be refactored |
| NutrientCollisionSystem | PARTIAL | Uses `distanceForMode()` but z handling incomplete |
| SwarmCollisionSystem | PARTIAL | Uses `distanceForMode()`, untested |
| PredationSystem | NONE | 2D `distance()` - Stage 2 engulfing broken |
| PseudopodSystem | NONE | 2D ray-circle intersection |
| ProjectileSystem | NONE | Stage 3+ jungle attack |
| TrapSystem | NONE | Stage 3+ jungle specialization |
| TreeCollisionSystem | NONE | Stage 3+ jungle obstacles |
| NutrientAttractionSystem | NONE | 2D pull toward wells |
| MacroResourceCollisionSystem | NONE | Stage 3+ fruit/fauna |

### Server AI Systems Status

| System | Sphere Support | Notes |
|--------|---------------|-------|
| BotAISystem | PARTIAL | Has sphere distance, needs testing |
| SwarmAISystem | PARTIAL | Present but movement untested |
| CyberBugAISystem | NONE | Stage 3+ jungle |
| JungleCreatureAISystem | NONE | Stage 3+ jungle |
| EntropySerpentAISystem | NONE | Stage 3+ apex predator |

### Client Render Systems Status

| System | Sphere Support | Notes |
|--------|---------------|-------|
| PlayerRenderSystem | PARTIAL | Has z-interpolation, Stage 3+ meshes untested |
| NutrientRenderSystem | PARTIAL | Basic support added |
| SwarmRenderSystem | YES | Auras oriented to surface normal |
| ObstacleRenderSystem | YES | 3D positioning works |
| TrailEffect | YES | Follows sphere curvature |
| EnvironmentSystem | PARTIAL | Wireframe only, no particles/effects |
| CameraSystem | PARTIAL | Surface following works, no first-person |
| TreeRenderSystem | NONE | Stage 3+ jungle |
| ProjectileRenderSystem | NONE | Stage 3+ |

### Game Mechanics by Stage

| Feature | Stage | Flat | Sphere | Notes |
|---------|-------|------|--------|-------|
| Basic movement | 1 | ✓ | ✓ | Works |
| Nutrient collection | 1-2 | ✓ | ✓ | Works |
| Gravity wells | 1-2 | ✓ | ✓ | Works - handled in SphereMovementSystem |
| Swarms | 1-2 | ✓ | ? | Present, untested |
| Contact predation | 2 | ✓ | ✗ | Uses 2D distance |
| EMP ability | 2 | ✓ | ✗ | Soup-scale ability |
| Pseudopod attack | 2+ | ✓ | ✗ | 2D ray intersection |
| Multi-cell movement | 2 | ✓ | ✗ | No stage multipliers |
| Trees | 3+ | ✓ | ✗ | Completely missing |
| Cyber-organism movement | 3 | ✓ | ✗ | No acceleration/friction |
| DataFruit/CyberBug | 3+ | ✓ | ✗ | No jungle fauna |
| JungleCreatures | 3+ | ✓ | ✗ | No jungle AI |
| Specializations | 3+ | ✓ | ✗ | Projectile/Melee/Trap all 2D |
| Humanoid movement | 4 | ✓ | ✗ | No first-person |
| Godcell z-flight | 5 | ✓ | ✗ | No 3D flight |

### Architecture Notes

1. **Gravity is a workaround** - Currently baked into SphereMovementSystem rather than making GravitySystem sphere-aware. Works, but violates single responsibility. Should refactor.
2. **Sphere nutrients initialized separately** - spawns near gravity wells with risk/reward placement
3. **No jungle initialization in sphere mode** - trees, creatures, serpents all skip sphere branch

### Files Requiring Changes (Full Implementation)

**Server (~12 systems):** GravitySystem, PredationSystem, TreeCollisionSystem, ProjectileSystem, PseudopodSystem, NutrientAttractionSystem, TrapSystem, SphereMovementSystem (stage params), plus all jungle AI systems

**Client (~8 render systems):** PlayerRenderSystem (orientation), NutrientRenderSystem, TreeRenderSystem, creature renders, ProjectileRenderSystem, EnvironmentSystem (effects), CameraSystem (first-person)

**Shared:** Ensure z-coordinates in all position network messages

---

## What Remains

### Phase 1: Soup Sphere Parity
Get Stage 1-2 gameplay working properly:
- Refactor gravity out of SphereMovementSystem into sphere-aware GravitySystem
- Fix PredationSystem for sphere distance (Stage 2 engulfing)
- Fix PseudopodSystem for sphere targeting
- Add stage multipliers to SphereMovementSystem (multi-cell, cyber-organism)
- Test and fix swarm behavior
- Add environment particles/effects
- Tune scale: distances, radius, movement speeds

### Phase 2: Jungle Sphere
Create Stage 3+ on sphere:
- Design jungle-on-sphere (zones? bands? regions?)
- Port tree spawning and collision
- Port jungle creatures and AI
- Port specialization abilities (projectile, melee, trap)
- Add humanoid first-person camera on sphere

### Phase 3: Space/God Sphere
Stage 5 transcendence:
- Godcell z-flight (break free of surface)
- Outer sphere or space environment
- Path to final encounter

---

## Open Questions

### Should We Follow Through?

**Arguments for:**
- The vision is *insanely cool* - a planet you evolve on, then transcend
- Foundation is working - proof of concept succeeded
- Thematically coherent with "evolution to godhood" narrative
- Unique - no other .io game does this

**Arguments against:**
- Massive tuning effort to make it feel right
- Every system needs sphere-awareness (ongoing maintenance cost)
- Jungle sphere is a whole second implementation
- Might be simpler alternatives (e.g., camera tricks, discrete zones)

### Alternative Approaches?

- **Fake it:** Keep flat gameplay but use camera/visual tricks to suggest sphere
- **Discrete spheres:** Separate levels rather than continuous planet
- **Defer to endgame:** Keep flat world for Stages 1-4, only go spherical for Stage 5+

---

## Technical Notes for Future Sessions

### Key Files
- `server/src/ecs/systems/SphereMovementSystem.ts` - Core physics
- `client/src/render/systems/*` - All have sphere mode branches
- `shared/sphereMath.ts` - Coordinate utilities
- `client/src/sphere-test.ts` - Standalone test harness (useful for isolated testing)

### The Pattern
Most systems check `isSphereMode()` and branch:
```typescript
if (isSphereMode()) {
  // 3D position, surface normal orientation, geodesic distance
} else {
  // Original 2D flat world logic
}
```

### Gotchas
- Z-coordinate must be serialized everywhere (easy to miss in network messages)
- Orientation on sphere uses quaternion from surface normal
- "Distance" means geodesic distance, not Euclidean
- Camera needs to follow surface, not just track position

---

## The Feeling

There's real potential here. Watching entities crawl around a glowing sphere, seeing the curvature, knowing you could eventually fly off it - it creates something special. The question is whether the implementation cost is worth it, or if there's a simpler path to the same feeling.

This document exists to help future sessions understand the context and continue the deliberation.
