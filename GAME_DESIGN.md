# GODCELL - Game Design Document

## Core Concept

**GODCELL** is a hardcore evolutionary multiplayer experience where players begin as primitive cyber-cells in a digital primordial soup and evolve toward transcendence/godhood. Death is permanent. Resources are scarce. Only the fittest survive.

This is also a **learning simulation** - the game mirrors cellular evolution principles, teaching players (and designers) about evolutionary biology through gameplay.

## You're Building an Information Ecology

At its heart, GODCELL is a simulation of **information ecology** - the survival, competition, and evolution of information itself.

- **Players are information**: Cyber-cells carrying data, seeking to persist and grow
- **Nutrients are information**: Data packets that fuel growth and evolution
- **Entropy is the enemy**: The heat death of information, the decay into noise and chaos
- **Evolution is information complexity**: Each stage represents higher-order information structures
- **Competition is information scarcity**: Limited resources create pressure, driving adaptation
- **Death is information loss**: Permanent loss mirrors the fragility of information without redundancy

This frame ties together the biological evolution metaphor with the digital aesthetic. You're not just playing a cell - you're playing as a pattern of information fighting to maintain coherence in a hostile digital universe.

Every system in the game reinforces this: nutrients = information gain, entropy = information decay, evolution = information organization, death = information erasure.

## High-Level Vision

- **Genre**: Multiplayer evolutionary survival
- **Setting**: Digital primordial soup (Tron meets microscopic life)
- **Core Loop**: Gather nutrients → Avoid entropy → Evolve → Compete → Transcend
- **Death Penalty**: **PERMANENT LOSS** - when you die, you restart as a single-cell
- **Competitive**: Limited nutrient spawns force players to compete for resources

---

## Evolution Stages & Plane Transcendence

**Core Concept**: At each evolution stage, players **transcend to a higher plane of existence** - entering a new layer of the simulation where they become the predator to lower-tier life forms.

When you evolve, you don't just get stronger - you shift to a fundamentally different dimension of the digital universe, where your previous peers become your prey.

Players progress through distinct evolutionary stages:

### 1. Single-Cell (Starting Stage)
- **Plane**: The Primordial Substrate - base layer of the simulation
- **Appearance**: Small glowing cyber-cell (current implementation)
- **Abilities**: Movement only
- **Goal**: Survive and gather nutrients
- **Prey**: Nutrient crystals (inanimate data)
- **Predators**: Entropy swarms, evolved players (if they can reach down?)
- **Vulnerabilities**: Defenseless against entropy and predators

### 2. Multi-Cell
- **Plane**: The Cellular Ocean - a realm teeming with single-cell life
- **Appearance**: Larger, more complex cellular structure
- **Abilities**:
  - Faster movement
  - Basic detection radius (see nutrients/threats from farther away)
- **Prey**: Single-cell cyber-organisms (your former peers!) + nutrient crystals
- **Predators**: Cyber-organisms and above, entropy manifestations
- **Unlocks**: First defensive capabilities (maybe membrane armor?)
- **Plane Mechanics**: When you evolve to multi-cell, you transcend into a new layer filled with NPC single-cells to hunt. You're now the predator.

### 3. Cyber-Organism
- **Plane**: The Organic Expanse - a hostile ecosystem of competing multi-cellular life
- **Appearance**: Complex organism with visible subsystems
- **Abilities**:
  - **Projectile weapon** (first offensive capability!)
  - Energy-based attacks
  - Advanced movement patterns
- **Prey**: Multi-cell clusters + single-cells + nutrients
- **Predators**: Humanoids and above, advanced entropy forms
- **Unlocks**: Can fight back against entropy
- **Plane Mechanics**: You enter a realm where multi-cells compete for dominance. Combat becomes viable strategy.

### 4. Humanoid
- **Plane**: The Emergent Realm - a world where intelligence and strategy dominate
- **Appearance**: Cyber-humanoid form (proto-god)
- **Abilities**:
  - Multiple weapon types
  - Special abilities (dash, shield, AOE attacks)
  - Can influence the environment
- **Prey**: All lower life forms (cyber-organisms, multi-cells, single-cells)
- **Predators**: Other humanoids, godcells, entropy constructs
- **Unlocks**: Advanced combat and territory control
- **Plane Mechanics**: You've transcended to where thinking beings compete. PvP becomes primary gameplay.

### 5. Godcell (Final Stage)
- **Plane**: A Higher Dimension - the game begins anew, but vaster
- **Appearance**: You become a single cell again... but in an incomprehensibly larger substrate
- **Abilities**: You retain echoes of your journey - not full power, but wisdom and understanding
- **Mechanics**: When you reach godhood, the simulation **remixes and expands**. You're back to hunting nutrients, but:
  - The scale is cosmic instead of microscopic
  - You carry forward learned abilities (maybe simplified/adapted?)
  - The planes below become your legacy - you've ascended beyond them
  - New threats and mysteries await in this higher dimension
- **Goal**: Perhaps godhood is not an ending, but a gateway to an infinite ladder of transcendence
- **Philosophy**: "To become a god is to realize you're still just a cell in a vaster ocean"

---

## Core Systems

### Resource System: Nutrients

**Nutrients** are data packets floating in the digital ocean that fuel evolution.

- **Spawning**: Limited spawns across the world (exact count TBD)
- **Collection**: Active pickup - player must touch nutrient to collect
- **Competition**: When multiple players need the same nutrients, scarcity creates tension
- **Respawn**: Nutrients respawn after X seconds (TBD - balance for pacing)
- **Visual**: Glowing data fragments (distinct from background particles)

**Design Goal**: Create natural territorial behavior - players will cluster around nutrient-rich areas and compete.

### Combat System: Projectiles

- **Unlock Stage**: Cyber-Organism (stage 3)
- **Mechanic**: Energy-based projectile weapons
- **Ammo**: TBD (unlimited with cooldown? finite requiring nutrients?)
- **Damage**: Reduces opponent's evolution progress
- **Death**: If health reaches zero → **PERMANENT LOSS** → restart as single-cell

**Design Goal**: Combat is a tool for survival, not the only path. Stealth and avoidance should be viable strategies.

### Entropy System: The Three Forms

**Entropy** is the enemy of information - the heat death of the digital universe. It manifests in three forms: **Noise, Decay, and Dilution**.

#### 1. NOISE - Corruption & Interference

Active hostile force that corrupts coherent information.

**Visual Language:**
- Glitching visual effects, flickering pixels
- Static interference patterns
- Corrupted data manifesting as chaotic particles
- Color inversion, RGB split effects
- Digital artifacts and compression glitches

**Gameplay Manifestations:**

**Noise Patches (Static Zones)**
- Areas of intense static that obscure vision
- Fog of war made of digital noise
- Players inside noise patches become harder to see
- Nutrients hidden in noise - risk/reward

**Interference Fields**
- Zones where controls get scrambled or laggy
- Input delay or reversed controls
- Your cyber-cell flickers and glitches while inside
- Creates navigation challenges

**Corrupted Entities (Entropy Swarms)**
- Aggressive manifestations of noise
- Attack coherent information (players) on sight
- Glitching, chaotic particle clusters
- Patrol zones or chase players who get too close
- Deal damage through information corruption
- Slower than players - avoidable with skill

**Signal Degradation**
- Proximity to noise sources dims your cyber-cell's glow
- Visual feedback of information coherence weakening
- Can be used strategically (stealth in noise?)

#### 2. DECAY - Metabolic Cost of Existence

The inevitable cost of maintaining coherent information. Information requires energy to stay organized. **Existence itself is expensive.**

**Core Mechanic: Passive Energy Drain**

All cyber-cells slowly lose energy over time just from existing. This is **not** health damage initially - it's a separate energy/metabolism system that eventually causes health damage if you run out.

**Metabolic Rates by Evolution Stage:**

Evolution makes you MORE EFFICIENT, not less. Higher stages have slower passive decay but larger energy pools and expensive active abilities.

- **Single-Cell**: Fast passive decay (~90 seconds to starvation) - tiny, inefficient, desperate
  - Energy pool: 100 units
  - Passive drain: ~1.1 units/second
  - No active abilities

- **Multi-Cell**: Moderate passive decay (~2 minutes to starvation) - better efficiency
  - Energy pool: 250 units
  - Passive drain: ~2.1 units/second (slower per capita)
  - Movement speed increased but same energy cost

- **Cyber-Organism**: Slow passive decay (~3 minutes to starvation)
  - Energy pool: 500 units
  - Passive drain: ~2.8 units/second
  - **Weapons cost energy**: Firing projectiles costs 20 energy per shot
  - Can survive longer at rest, but combat drains reserves fast

- **Humanoid**: Very slow passive decay (~5 minutes to starvation)
  - Energy pool: 1000 units
  - Passive drain: ~3.3 units/second
  - **All abilities cost energy**: Dash (50), Shield (100), AOE attacks (200)
  - Highly capable but resource management becomes strategic

- **Godcell**: ???
  - No passive decay? (transcended thermodynamics?)
  - Feeds on entropy itself? (gains energy from destroying corruption?)
  - Infinite reserves but abilities still cost?

**Biological Inspiration:** Real cells and organisms become MORE metabolically efficient as they increase in complexity. A human can survive weeks without food, bacteria die in days. Larger organisms have higher absolute energy needs but better efficiency per unit of mass.

**Gameplay Result:**
- Early game: frantic survival, constant hunger
- Mid game: strategic resource management, choosing when to fight
- Late game: patient predator with powerful but costly abilities

**Decay Mechanics:**
- **Visible energy bar** - separate from health, shows metabolic energy
- **Passive decay** - always draining, but slower as you evolve
- **Movement costs energy** - small constant drain (same across stages)
- **Active abilities cost energy** - weapons, special moves drain reserves
- **Starvation damage**: When energy reaches zero, you start taking health damage
- **Natural pressure**: You MUST keep collecting nutrients, but urgency decreases as you evolve
- **Strategic depth**: High-level players choose when to spend energy on combat vs conserve for survival

**Visual Feedback:**
- Energy bar slowly draining (always visible)
- Cyber-cell glow dims as energy drops
- Pulsing becomes erratic when starving
- Visual desperation state before health damage starts

#### 3. DILUTION - Loss of Coherence

Information spreading out, becoming less concentrated, losing meaning. **The gradient between structure and chaos.**

**Visual Language:**
- Particles drifting apart
- Edges becoming fuzzy/blurred
- Transparency increasing (fading out)
- Loss of definition and sharpness

**Gameplay Manifestations:**

**Death as Dilution**
- When you die, your cyber-cell doesn't explode - it **dilutes**
- Your information scatters into the digital ocean
- Your particles drift apart and dissolve into the background
- **Information recycling**: Your death creates nutrient pickups equal to 50% of your collected nutrients
- "You don't die, you become the soup"
- Other players can collect your scattered information
- Visible to all players - they see you fade and scatter

**Wounded State (Low Health)**
- When low on health, your edges start to blur and fade
- You're visibly losing coherence
- Other players can see you're vulnerable
- Creates visual hierarchy of threat/vulnerability

**Potential Future Mechanics:**
- Isolation decay? (Being far from other information sources accelerates dilution)
- Distance penalty? (Venturing too far from information-rich zones increases decay rate)

---

**Entropy as a Spectrum:**
- **Noise** is chaotic (high energy, zero structure)
- **Your cyber-cell** is ordered (high structure, high energy cost)
- **Dilution** is the gradient between them (structure breaking down into chaos)
- **Decay** is the energy cost of resisting dilution

The game is about maintaining your position on that spectrum. **Nutrients provide energy to stay organized. Noise attacks your structure. Decay drains your energy. Dilution is what happens when you fail.**

**Design Goal**: Entropy is omnipresent. It's not just enemies - it's the fundamental opposing force. You're playing as order fighting against the universe's tendency toward chaos.

### Health & Death System

- **Health**: Each evolution stage has increasing health pools
- **Damage Sources**: Entropy, other players, environmental hazards
- **Healing**: TBD (nutrients heal? natural regen? evolution fully heals?)
- **Death**:
  - **PERMANENT LOSS** - all progress reset
  - Player respawns as single-cell at random location
  - No loot drops (for now - maybe later stages drop nutrients?)

**Design Goal**: Death is meaningful. Every decision matters. Risk/reward balance is critical.

### Progression System

- **Evolution Points (EP)**: Currency gained from collecting nutrients
- **Evolution Thresholds**: Each stage requires X EP to evolve
- **Evolution Process**:
  - Instant transformation when threshold reached?
  - Or vulnerable "molting" period? (interesting gameplay tension)
- **Progression Visibility**: Players can see others' approximate stage (size/appearance)

**Progression Curve** (rough draft):
- Single-Cell → Multi-Cell: 10 nutrients
- Multi-Cell → Cyber-Organism: 25 nutrients
- Cyber-Organism → Humanoid: 50 nutrients
- Humanoid → Godcell: 100 nutrients

*(These numbers need playtesting and balancing)*

---

## Learning About Cellular Evolution

This game is also a vehicle for learning about real biological evolution. Areas to explore:

- **Natural Selection**: Scarcity forces competition (survival of the fittest)
- **Specialization**: Different evolution paths? (speed vs armor vs offense?)
- **Symbiosis**: Future mechanic - player cooperation/alliances?
- **Predator-Prey Dynamics**: Entropy swarms vs evolved players
- **Resource Competition**: Nutrient scarcity mirrors real ecosystem pressures

**Research Questions to Explore During Development:**
- What drives speciation in real evolution?
- How do organisms balance energy expenditure (movement, combat) vs growth?
- What role does environmental pressure play in evolution speed?
- Can we model punctuated equilibrium (rapid evolution during stress)?

---

## Open Questions & Future Design

### Immediate Questions (need answers to implement v1)
- [ ] Exact nutrient spawn count and respawn timers
- [ ] Health values for each evolution stage
- [ ] Projectile weapon mechanics (damage, cooldown, range)
- [ ] Entropy swarm movement patterns (patrol? random walk? player-seeking?)
- [ ] Evolution thresholds (EP costs per stage)

### Future Mechanics (post-MVP)
- **Territory Control**: Can godcells claim regions?
- **PvP Incentives**: Why attack other players? (steal nutrients? trophy system?)
- **Cooperation**: Alliances, symbiosis, cell colonies?
- **Specialization Trees**: Different evolution paths (predator vs gatherer vs tank?)
- **Environmental Storytelling**: What happened to this digital universe?
- **Godcell Endgame**: What can gods actually *do*?

### Technical Unknowns
- How many players can we support simultaneously?
- Server authority for combat (prevent cheating)
- Lag compensation for projectiles
- Persistent world state (or session-based?)

---

## Design Principles

1. **Permanent Loss Creates Meaning**: Death matters. Every decision matters.
2. **Scarcity Drives Emergence**: Limited resources create natural player conflict and territory behavior
3. **Simple Mechanics, Complex Outcomes**: Easy to learn, hard to master
4. **Learn While Playing**: The game teaches cellular evolution through experience
5. **Aesthetics Serve Gameplay**: Visual clarity over flashy effects (players need to read the battlefield)

---

## Development Philosophy

This is **emergent creativity** - we're discovering what GODCELL wants to be through building and playing. This document will evolve as the game evolves.

**Iteration over specification.** Build, play, learn, adjust.

---

## Version History

- **v0.1** (2025-11-17): Initial vision - evolution stages, entropy enemies, permanent loss, nutrient system
