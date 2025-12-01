# Stage 3 Design Decisions & Execution Plan

**Date:** 2025-11-30
**Status:** Decisions locked, ready for implementation

---

## Design Decisions Summary

### Decision 1: Scale Separation → Same coordinates, scale is perspective

One continuous world. Evolution is a scale shift, not a location change. You don't leave the soup - you outgrow it.

- Single ECS world, single coordinate space
- All entities exist in same world regardless of stage
- Visibility/rendering filtered by stage
- Collision filtered by stage (Stage 1-2 don't collide with Stage 3+)
- Stage 3+ sees soup pools as tiny terrain features (glowing puddles)
- Stage 1-2 could see Stage 3+ as massive shadows overhead

### Decision 2: The Jungle → Digital jungle (literal jungle at macro scale)

The jungle IS a jungle. Towering data-trees, wilderness, complex terrain. Just made of data instead of carbon.

- Data-trees with fiber-optic bark, glowing foliage
- Undergrowth, clearings, terrain variation
- Soup pools visible as tiny glowing puddles on jungle floor
- Same color palette as soup (neon, cyan, magenta, bloom)

### Decision 3: Stage 3 Form → DEFERRED (needs playtesting)

Current: 6-legged cyber-organism with shift-dash. Form and movement will emerge from experimentation.

### Decision 4: Resources → Multi-source (PvP + macro-nodes + NPC fauna)

Stage 3 does NOT hunt Stage 1-2 players. The soup is beneath you.

- **PvP** - Kill other Stage 3 players
- **Macro-resources** - Data nodes, energy caches in jungle
- **NPC fauna** - Huntable jungle creatures

### Decision 5: Combat → Three specialization pathways

Stage 3 introduces player choice. You specialize rather than having universal toolkit.

- **Melee** - Close-range combat focus
- **Ranged** - Projectile/distance combat focus
- **Traps** - Area denial, ambush, territorial control

EMP and contact drain do NOT carry over from Stage 1-2.

---

## Execution Plan

### Phase 1: Scale Architecture (Foundation)

**Goal:** Make one world work at multiple scales with filtered visibility/collision.

1. **Add scale/zone concept to entities**
   - Add `Scale` component or extend `Stage` component with scale tier
   - Scale 1 = soup (Stages 1-2), Scale 2 = jungle (Stages 3-4), Scale 3 = sky (Stage 5)

2. **Filter collisions by scale**
   - Collision systems check scale compatibility before processing
   - Stage 1-2 entities only collide with Stage 1-2
   - Stage 3-4 entities only collide with Stage 3-4
   - Stage 5 TBD (maximal agency - may collide with anything)

3. **Filter network broadcasts by scale**
   - Clients only receive entity updates for their scale
   - Reduces bandwidth, prevents soup players from getting jungle state

4. **Update evolution to handle scale transition**
   - When evolving to Stage 3, entity stays in place but changes scale
   - Size increases dramatically (TBD multiplier)
   - Collision filter automatically changes

### Phase 2: Jungle Environment Rendering

**Goal:** Make Stage 3+ players see the jungle instead of soup.

1. **Create JungleEnvironmentSystem** (parallel to current EnvironmentSystem)
   - Procedural data-trees (glowing, fiber-optic aesthetic)
   - Ground plane with terrain features
   - Ambient particles (macro-scale equivalent of soup particles)

2. **Show soup pools from above**
   - Render soup activity as tiny glowing puddles on jungle floor
   - Position based on actual Stage 1-2 entity clusters
   - Visual indicator of "life below"

3. **Stage-based environment switching**
   - Already have render mode switching infrastructure
   - Extend to use JungleEnvironmentSystem for Stage 3+

### Phase 3: Macro Resources

**Goal:** Give Stage 3 players something to eat that isn't soup players.

1. **Create macro-nutrient entity type**
   - Data nodes / energy caches
   - Larger, more valuable than soup nutrients
   - Scattered through jungle terrain

2. **Macro-nutrient spawning system**
   - Separate from soup nutrient spawning
   - Different density, respawn rates
   - Possibly contested locations (near center, etc.)

3. **Macro-nutrient collision/pickup**
   - Only Stage 3+ can pick up macro-nutrients
   - Higher energy values

### Phase 4: NPC Fauna

**Goal:** Populate the jungle with huntable creatures.

1. **Design jungle creature types**
   - What are they? Data-beasts? Corrupted programs?
   - Different sizes/difficulties?
   - Behavior patterns (aggressive, passive, territorial)

2. **Create jungle creature entities**
   - New entity type with appropriate components
   - AI system for behavior (similar to bot AI but different goals)

3. **Jungle creature spawning**
   - Where do they spawn? How many?
   - Respawn logic after being killed

4. **Combat interaction**
   - Stage 3 can attack and kill fauna
   - Fauna can fight back (damage Stage 3 players)
   - Energy reward on kill

### Phase 5: Combat Specialization

**Goal:** Implement the three pathway system (melee, ranged, traps).

1. **Specialization selection UI**
   - When/how does player choose?
   - On evolution to Stage 3? Separate choice screen?

2. **Melee pathway abilities**
   - Close-range attack(s)
   - Movement/gap-closer ability?
   - Higher defense/health?

3. **Ranged pathway abilities**
   - Projectile system
   - Energy cost per shot
   - Aim mechanics (twin-stick? click-to-aim?)

4. **Trap pathway abilities**
   - Placeable trap entities
   - Trigger/activation logic
   - Duration, damage, effects

5. **Balance and counter-play**
   - Each pathway should have strengths and weaknesses
   - Encourage variety, not one dominant meta

### Phase 6: Cross-Scale Visual Polish

**Goal:** Make the scale transition feel magical.

1. **Stage 3+ shadows visible to soup players**
   - Giant silhouettes passing overhead
   - Creates "god sighting" moments
   - Doesn't affect soup gameplay, just atmosphere

2. **Evolution animation for Stage 2 → 3**
   - "Breaking the surface" feeling
   - Camera zoom out as you grow
   - Soup fades to tiny below you

3. **Soup pool visualization for jungle players**
   - Tiny glowing puddles on the ground
   - See the swirling activity of soup-scale life
   - Can see where battles are happening

---

## Open Questions (Need Playtesting)

- Stage 3 movement feel (XY only? terrain height? jumping?)
- Exact size multiplier (how big is Stage 3 vs Stage 1-2?)
- Specialization: locked choice or hybrid possible?
- Specialization: when is choice made?
- Resource balance: relative value of PvP vs nodes vs fauna
- NPC fauna: what are they, how do they behave?

---

## Related Beads

- `godcell-r85` - Stage 3 Epic
- `godcell-gbr` - Multi-scale architecture (Decision 1)
- `godcell-j2a` - Jungle rendering (Decision 2)
- `godcell-1c2` - Macro resources (Decision 4)
- `godcell-bkf` - NPC fauna (Decision 4)
- `godcell-7pd` - Combat specialization (Decision 5)
- `godcell-aei` - Spawn/death flow (answered by Decision 1)
