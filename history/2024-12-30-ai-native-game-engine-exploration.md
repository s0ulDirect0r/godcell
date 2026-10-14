# AI-Native Game Engine Exploration

**Date:** 2024-12-30
**Status:** Research/ideation - not ready for implementation
**Related Issue:** godcell-rkgh (perception layer)
**Branch:** feature/godcell-rkgh-perception-layer (created but unused)

---

## The Core Question

> What would an AI-native game engine look like?

The reasoning for building GODCELL in TypeScript/Three.js/Node was about giving AI agents more access to everything - text-based, inspectable, modifiable. But is that actually what makes something "AI-native"?

---

## What Makes Something AI-Native?

### Current advantages of TypeScript/Node stack:
- Text-based everything (no binary formats, no compiled shaders hidden away)
- Hot reloading - changes reflect immediately
- The entire codebase is readable by LLMs
- npm ecosystem - lots of inspectable code

### But that's necessary, not sufficient.

True AI-native architecture would need:

1. **Semantic over implementation** - Instead of `entity.velocity.x = 5`, something like `move(entity, toward: target, speed: 'fast')`. The AI expresses *intent*, the engine handles *how*.

2. **Queryable state with meaning** - Not just "entities with Position component" but "entities threatening player" or "resources player can reach before dying". Relationships and goals as first-class concepts.

3. **Simulation as a primitive** - Fork game state, run "what if" scenarios, test changes before committing. AI can experiment safely.

4. **Self-describing systems** - The engine knows what its systems *do*, not just what they *are*. Can answer "what affects entity speed?" with a real answer.

5. **Explicit invariants** - Not just types, but constraints: "energy can't go negative", "dead entities can't act", "server is authoritative on X". Things the AI literally *can't* violate.

---

## The Market Opportunity

| Play | Customer | Market Size | Competition |
|------|----------|-------------|-------------|
| "AI copilot for game devs" | Existing devs | ~3M people | Everyone (Copilot, Cursor, etc.) |
| "AI middleware layer" | Game studios | ~10K studios | Low but niche |
| **"Anyone can make games"** | Everyone who ever wanted to make a game but can't code | **~500M+ people** | Roblox (kinda), nothing else |

The third one is the only "get rich as fuck" tier.

**The actual play:** Build the semantic layer (intent → implementation, safe AI actions, simulation) but position it as:

> "Describe your game. Watch it come to life. Iterate in conversation."

Not a tool for Unity devs. A *replacement* for needing to be a dev at all.

---

## Semantic Layers Are Everywhere

LLMs are just the newest instance. Every successful abstraction in computing is a semantic layer:

| Domain | Raw Layer | Semantic Layer |
|--------|-----------|----------------|
| **Databases** | Disk sectors, B-trees | SQL: `SELECT * FROM users WHERE active = true` |
| **Networking** | IP packets | HTTP: `GET /api/users` |
| **Graphics** | GPU draw calls | Scene graph, CSS |
| **Programming** | Assembly, registers | `for item in items:` |
| **Robotics** | Motor torques | "pick up the cup" → motion planning |

**What's different about LLMs:**
- Natural language vocabulary (no pre-definition needed)
- Fuzzy interpretation ("make it faster" works)
- Dynamic mapping (can generate novel implementations)
- Cross-domain bridging (can translate between semantic systems)

---

## Perception Layer Design for GODCELL

The concrete first step toward AI-native: a perception layer that provides semantic queries over ECS state.

### The Layers

```
┌─────────────────────────────────────────────────┐
│  INTENT LAYER                                   │
│  "bot flees from threats when low energy"       │
│  ↓                                              │
├─────────────────────────────────────────────────┤
│  PERCEPTION LAYER  ← WE'RE BUILDING THIS        │
│  Queries with meaning:                          │
│  - "threats near entity X" → [swarm_1, player_2]│
│  - "entity X energy status" → 'critical'        │
│  - "escape routes from X" → [(north, safe),     │
│                               (east, blocked)]  │
│  ↓                                              │
├─────────────────────────────────────────────────┤
│  PLANNING LAYER                                 │
│  Intent + Perception → Action sequence          │
│  ↓                                              │
├─────────────────────────────────────────────────┤
│  EXECUTION LAYER (traditional engine)           │
│  - Physics, collision, networking               │
└─────────────────────────────────────────────────┘
```

### Core Types

```typescript
interface Threat {
  entity: number;
  type: 'obstacle' | 'swarm' | 'predator' | 'projectile' | 'trap';
  position: { x: number; y: number; z?: number };
  threatLevel: number;  // 0.0-1.0 graduated (not binary!)
  distance: number;
  velocity?: { x: number; y: number; z?: number };
}

interface Resource {
  entity: number;
  type: 'nutrient' | 'disabledSwarm' | 'dataFruit' | 'prey';
  position: { x: number; y: number; z?: number };
  value: number;
  distance: number;
  risk: number;  // 0.0-1.0 based on threats nearby
}

interface SafetyAssessment {
  score: number;  // 0.0 (death) to 1.0 (safe)
  threats: Threat[];
  reasoning: string;
}
```

### Core Queries

```typescript
// Threat queries
getThreatsFor(world, entity, options?): Threat[]
getDangerLevel(world, entity): number
isThreatTo(world, source, target): boolean

// Resource queries
getResourcesFor(world, entity, options?): Resource[]
getBestResource(world, entity): Resource | null
hasSafeFood(world, entity): boolean
timeToStarvation(world, entity): number | null

// Spatial queries
getSafetyAt(world, position): SafetyAssessment
getSafestDirection(world, entity): { x: number; y: number }
isPathClear(world, from, to): { clear: boolean; obstacles: Threat[] }
```

---

## Why the Original Plan Might Fail

We originally planned: build abstraction → add tests → integrate with bots.

Risks identified:

1. **shared/ can't import server code** - Snapshot functions live in `server/src/ecs/factories.ts`. Either duplicate or restructure.

2. **Building queries without consumers is backwards** - We'd be guessing what API BotAI actually wants.

3. **Cache key explosion** - Queries have options (`maxDistance`, `types`). Cache invalidation gets complex.

4. **Graduated threat zones are subtle** - Existing bot code has finely-tuned magic numbers. Easy to break behavior.

5. **Benchmarks measure the wrong thing** - Vitest benchmarks won't catch GC pauses or real game loop interactions.

6. **Over-engineering for a working game** - Current O(n²) queries work fine at scale.

---

## Recommended Approach: Spike First

Instead of building abstraction first:

1. **Spike in bots.ts** - Add perception types and helpers inline. Make single-cell bot use them.
2. **Learn what works** - Does the API feel right? Do thresholds work? Is caching needed?
3. **Extract if successful** - Only then move to `server/src/perception/`, add tests.

### Spike Structure

```typescript
// In bots.ts - SPIKE: will extract if useful

interface PerceivedThreat {
  type: 'obstacle' | 'swarm';
  position: Position;
  distance: number;
  threatLevel: number;
}

interface PerceivedResource {
  type: 'nutrient';
  position: Position;
  distance: number;
  value: number;
  risk: number;
}

function perceiveThreats(pos, obstacles, swarms, stage): PerceivedThreat[] { ... }
function perceiveResources(pos, nutrients, threats): PerceivedResource[] { ... }
function getDangerLevel(threats): number { ... }
function getBestResource(resources): PerceivedResource | null { ... }

// Feature flag for rollback
const USE_PERCEPTION = true;

function updateBotAI(...) {
  if (USE_PERCEPTION) {
    const threats = perceiveThreats(...);
    const dangerLevel = getDangerLevel(threats);
    // Decision based on perception
  } else {
    // Existing logic
  }
}
```

---

## Future Phases (Not Implemented)

### Phase 3: Extract and Formalize

If spike succeeds:
```
server/src/perception/
├── index.ts
├── types.ts
├── threats.ts
├── resources.ts
└── __tests__/
```

### Phase 4: Explanation Engine

```typescript
interface DeathExplanation {
  cause: DeathCause;
  primaryFactor: string;
  contributingFactors: string[];
  timeline: Array<{ timestamp: number; event: string }>;
}

function explainDeath(world, entity, cause, damageTracking): DeathExplanation { ... }
function explainSituation(world, entity): string { ... }
function explainDecision(world, entity, action): Explanation { ... }
```

### Phase 5: Intent Layer

Beyond perception - expressing game behavior declaratively:

```typescript
engine.behavior('bot', {
  when: 'energy < 20%',
  intent: 'flee',
  from: 'nearest-threat',
  priority: 'high'
});
```

### Phase 6: Natural Language Interface

```
Human: "Make bots more aggressive when they're winning"
→ Perception query: entities where stage > neighbors.avgStage
→ Intent modification: increase attack priority, reduce flee threshold
→ Engine applies changes
```

---

## Key Insight

Claude Code has already done for coding what we want to do for game development:

| Before | After |
|--------|-------|
| "Learn Unity (100+ hours) → make your game" | "Describe your game → iterate in conversation" |
| "Learn to code → use Claude Code" | "Have an idea → Claude Code helps you build" |

The barrier moved from "can you learn this complex tool" to "can you articulate what you want."

GODCELL is living proof: picked Three.js/Node not because it's the "right" choice technically, but because it's the choice where the AI can actually help. Optimized for *collaboration surface* over raw capability.

**The best engine isn't the most powerful one, it's the one where human intent translates most cleanly into running game.**

---

## References

- Beads issue: godcell-rkgh
- Branch: feature/godcell-rkgh-perception-layer
- Key files: `server/src/bots.ts` (existing bot AI), `shared/ecs/components.ts` (ECS types)
