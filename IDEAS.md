# IDEAS

Someday-maybe ideas. No priority, no status, no guilt. Good ideas come back.

---

## Visual test harness page for isolated render testing

Create a dedicated page (e.g., `/test-visuals` or separate entry point) that renders entities in isolation without gameplay logic. This enables:

1. **Playwright-based visual verification** - Screenshot comparisons without player death/movement
2. **Rapid iteration on shaders/effects** - See changes without playing the game
3. **Stage showcase** - Render all evolution stages side-by-side
4. **Effect gallery** - Pseudopod beams, death bursts, trails, auras in controlled states

The page should:
- Use the same Three.js renderer and render systems
- Allow spawning specific entity types at fixed positions
- Support URL params for specific test scenarios (e.g., `?entity=player&stage=4`)
- Skip server connection entirely (client-only mock data)

---

## Leaderboard system

Add a leaderboard to track and display player performance. Design TBD - need to figure out what metrics to track (highest stage reached? longest survival? most nutrients collected?) and how to persist/display them.

---

## Generative procedural algorithms for stage 3+ being models

Explore procedural/generative algorithms for creating unique visual models for stage 3+ beings (cyber-organism, humanoid, godcell). Especially important for godcells, which should feel truly unique and alien—each one visually distinct rather than templated.

Potential approaches:
- L-systems or fractal growth patterns
- Wave function collapse for structural generation
- Noise-based morphing/deformation
- Emergent geometry from evolution history (what nutrients consumed, how they evolved, etc.)
- Shader-based procedural detail layers

Goal: Each advanced being feels like a one-of-a-kind evolved entity, not a reskinned prefab.

---

## Make nutrients visually/mechanically important and consumable

Nutrients should feel valuable and their consumption should be satisfying. Currently they may not read as important or have sufficient feedback when collected.

Areas to address:

**Visual Importance:**
- Make nutrients more visually distinct and "desirable" looking
- Size/glow variation based on energy value
- Pulsing or animated effects that draw the eye
- Color coding for different nutrient types (if applicable)

**Consumption Feedback:**
- Satisfying visual effect on pickup (burst, absorption animation)
- Sound effect (if audio is added)
- Brief UI feedback (energy bar flash, floating +energy text)
- Screen-space effect for high-value pickups

**Mechanical Clarity:**
- Clear indication of nutrient value before pickup
- Visual connection between nutrient and energy gain
- Maybe show attraction radius or "magnet" effect as player approaches

**Scarcity/Value:**
- Ensure nutrient spawn rates create meaningful choices
- High-value nutrients should be rarer and more contested
- Consider nutrient "quality" tiers with distinct visuals

---

## Perception layer for semantic game state queries

Add a perception layer that provides semantic queries over ECS game state. This is foundational infrastructure for AI-native game development - enabling intent-based AI decisions, explainable game events, and eventually natural language game modification.

The perception layer sits between raw ECS state and high-level decision making, providing meaningful queries like "what threatens this entity" rather than "entities with Position component within radius".

This is exploratory/foundational work toward abstracting GODCELL's engine into something more general-purpose and AI-friendly.

---

## Slow-field and speed-field obstacles

Add two new obstacle/entity types to fill map spaces and create tactical variety:

**Slow-Field**: Smaller obstacle that slows player movement when inside its radius (like swarm slow effect but stationary). Visual: blue pulsing zone.

**Speed-Field**: Smaller obstacle that boosts player speed when inside its radius. High-risk high-reward - go fast but harder to control. Visual: yellow/gold pulsing zone.

Both should:
- Be smaller than gravity distortions (complement existing obstacles)
- Use Bridson's distribution with their own separation rules
- Have clear visual indicators
- Add tactical depth to navigation and risk/reward decisions
