# GODCELL - Game Design Document

## Core Concept

**GODCELL** is a brutal evolutionary survival game where you begin as a fragile cyber-cell in a hostile digital ocean and fight to evolve toward transcendence. Death is permanent. Resources are scarce. Only the adaptive survive.

The game's systems mirror cellular evolution - not to teach biology lessons, but to create **emergent pressure** that forces adaptation, competition, and risk/reward decisions. You learn by dying, by reading threats, by making hard choices under pressure. Like a Soulslike, mastery comes from pattern recognition and adaptation, not tutorials.

This is also a **design experiment** - by modeling evolutionary pressures (scarcity, predation, entropy), the game reveals what strategies emerge when survival is genuinely hard. What you discover playing is what real organisms face: adapt or die.

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

- **Genre**: Massively multiplayer survival roguelike
- **Setting**: Digital reality - from microscopic primordial soup to a vast 3D world (exact form of later stages still emerging)
- **Core Loop**: Gather → Survive → Evolve → Compete → Transcend (mechanics shift dramatically per stage)
- **Death Penalty**: **PERMANENT LOSS** - when you die, you restart as a single-cell
- **Progression**: Exponential evolution - you begin as a fragile cell and grow toward godhood

---

## Evolution Stages & Scale Transcendence

**Core Concept**: Evolution in GODCELL is not linear growth - it's **transcendence between nested realities**. You don't just get bigger stats, you literally outgrow your current world and emerge into a vastly larger one.

**The Structure:**

**Stages 1-2: The Primordial Soup** (Microscopic Scale)
You begin in a small pool of digital ooze - the soup. This is the entire world to a Stage 1 cell, but it's actually just one small zone in a much larger ecosystem. Cellular competition, predator-prey dynamics, entropy threats. When you reach Stage 2, you gain expanded awareness and predatory capabilities, but you're still bound to the soup.

**Stage 3+: The Digital Jungle** (Macro Scale)
When you evolve to Stage 3, you **grow out of the soup**. Literally. Trippy scale shift - you balloon in size and emerge as a 6-legged cyber-organism into a vast digital wilderness. The soup you spawned in? It's now a tiny pool in a much larger world. One-way progression - you can't return to microscopic scale.

**The Roguelike Loop:**
- Start in soup (Stage 1)
- Evolve to Stage 2 in soup
- Evolve to Stage 3 → **emerge into jungle**
- Progress through jungle stages (3 → 4 → 5)
- **Die anywhere → back to soup as Stage 1**

**Spawn Killing & Hunting Grounds:**
Multiple soup pools exist across the digital jungle. They're spawn points for new Stage 1 players... and hunting grounds for Stage 3+ predators who remember where they came from. Emergent danger. You might crawl out of your soup into the jaws of a cyber-lizard.

**Awareness Expansion:**
Each stage isn't just stronger - you perceive more. Stage 2 multi-cells see farther and sense entities Stage 1 cells can't detect. This perceptual asymmetry IS the evolutionary advantage. A predator with better vision dominates prey that can't see it coming.

Players progress through distinct evolutionary stages:

### 1. Single-Cell (Starting Stage) ✅ FULLY IMPLEMENTED

**Visual:** Small glowing cyber-cell (24px radius) with tapered ribbon trail. Neon colors, comet aesthetic. White outline on your cell for clarity.

**Awareness:** Limited viewport (1.0x zoom) - you see 1200×800px of a 4800×3200px world. Threats can approach from beyond your vision. Constant vigilance required.

**Movement:** Momentum-based physics with friction decay (0.70 coefficient). Floaty, space-like feel. Speed: 336 px/s. Acceleration-based controls create "coast" effect when releasing keys. Maintains control while feeling like you're floating in the digital ocean.

**Metabolism:** 37.5 seconds to starvation without nutrients. Passive energy decay (2.66/s). Eva-style countdown timer (MM:SS format) with color warnings (cyan→yellow→red). Constant pressure to keep moving and collecting.

**Threats:**
- **18 Entropy Swarms**: Virus enemies with chase/patrol AI. Contact applies 40% slow debuff and 30 dmg/s. Slower than you (242 px/s) but deadly if they catch you.
- **12 Gravity Distortions**: Mini black holes with inverse-square physics. Escapable outer zone (600px radius), inescapable event horizon (180px), instant-death singularity core (60px). Extremely lethal.
- **Starvation**: If energy hits zero, you take 5 health dmg/s. Death is quick once starvation begins.
- **Multi-Cell Predators**: Stage 2+ players can hunt you with pseudopods or contact predation.

**Resources:**
- **26 Nutrients**: Data packets scattered across the world, respawn every 30s. Competition is real.
- **Risk/Reward High-Value Nutrients**: Proximity to gravity distortions creates 2x/3x/5x multiplier nutrients (cyan/gold/magenta). Extreme danger, extreme reward.

**Competition:**
- **15 AI Bots**: Intelligent agents with obstacle/swarm avoidance. They compete for the same nutrients. Not trivial opponents.
- **Other Players**: Everyone is desperate, everyone is fragile. Territory matters.

**Goal:** Collect 15 nutrients (250 maxEnergy) to evolve to Stage 2. Average skilled run: 2-3 minutes. Death is common.

**Death:** Starvation or singularity crush. Your cell dilutes (particles scatter), creating nutrient pickups for scavengers. Respawn as Stage 1, all progress lost.

**Feel:** Frantic, desperate, high-stakes. You're prey, not predator. Every decision matters. Soulslike brutality.

### 2. Multi-Cell 🚧 PARTIALLY IMPLEMENTED

**Visual:** Star cluster sprite - 6 overlapping circles forming a larger cellular structure (96px radius, 4x Stage 1 size). Noticeably bigger, more complex, more threatening.

**Awareness Awakening:** This is where the power shift happens. Viewport expands to 1.5x zoom (you see vastly more of the world). **Chemical sensing** unlocks - 1800px detection radius with proximity-based directional arrows pointing toward detected entities. You can see prey and threats coming from *way* farther away than they can see you. This perceptual asymmetry makes you brutally effective.

**Metabolism:** ~2 minutes to starvation (300 maxEnergy, 2.1/s decay rate). Much better metabolic efficiency than Stage 1. Less frantic, more strategic. You have breathing room to plan and hunt.

**Predation:** You can now hunt Stage 1 cells (players and AI bots).
- **Contact Predation**: Touch a single-cell to consume it. Mechanics being refined - instant engulfment vs slow-drain over time (see beads godcell-j6j).
- **Pseudopods (In Development)**: Extend hunting tendrils to reach and engulf prey from a distance. Visual currently basic (line + circle), being upgraded to squiggly organic tendrils (see beads godcell-43k).
- Successful predation grants energy (50% of prey's current energy) and creates nutrient drops (50% of prey's collected nutrients).

**Prey:**
- Single-cell players (your former peers!)
- AI bots (15 single-cell NPCs - hunting grounds are populated)
- Nutrient crystals (still need them for efficient growth)

**Predators:**
- Stage 3+ players (you're now prey to something bigger)
- Entropy swarms (still dangerous... until you EMP them)
- Gravity distortions (still lethal)

**EMP Pulse Ability - Swarm Hunter Mechanic:**

Multi-cells have unlocked a powerful defensive/offensive tool: the **Electromagnetic Pulse (EMP)**. This ability transforms multi-cells from helpless swarm victims into active hunters.

**Activation:** Press spacebar to emit an EMP pulse

**Cost & Cooldown:**
- **Energy cost:** 80 units (27% of 300 pool)
- **Cooldown:** 10 seconds (can't spam it)

**Area of Effect:**
- **Range:** 4x multi-cell radius (~384 units)
- **Targets:** All entities within pulse radius

**Effects:**
- **Entropy Swarms:** Paralyzed for 3 seconds (frozen, vulnerable to consumption)
- **Other Multi-cells:** Stunned for 3 seconds + 80 energy drained
- **Single-cells:** Stunned for 3 seconds

**Swarm Consumption (The Hunt):**

This is the game-changer - **multi-cells can devour paralyzed swarms for massive energy gain**.

The combo:
1. Multi-cell dives toward swarm (risky - taking damage while closing distance)
2. Fires EMP at close range (80 energy investment)
3. Swarms freeze for 3 seconds
4. Multi-cell makes contact with frozen swarm (or uses pseudopod when implemented)
5. **Gradual engulfment begins** - drains swarm health over time (50 dmg/s)
6. Swarm fully consumed after ~2 seconds of contact
7. **Massive payoff:** +150 energy, +50 maxEnergy capacity per swarm eaten

**Risk/Reward Balance:**
- **High cost:** 80 energy upfront (significant investment)
- **High risk:** Must get dangerously close to swarms, take damage during approach
- **High reward:** 150 energy per swarm = net +70 energy profit if successful
- **Evolution accelerator:** +50 maxEnergy per swarm pushes you toward Stage 3 evolution
- **Can feast on multiple:** 3-second window allows consuming multiple frozen swarms if positioned well

**Tactical Use Cases:**

**Offensive (Swarm Hunting):**
- Dive into swarm cloud → EMP → feast on frozen swarms → massive energy gain
- High-skill, high-reward playstyle for aggressive players
- Converts deadliest threat into richest resource

**Defensive (Panic Button):**
- Surrounded by swarms → EMP → escape while they're frozen
- Can be used while being drained (last-ditch survival tool)
- Expensive but saves your life

**PvP (Multi-cell Combat):**
- Stun rival multi-cells, drain their energy, create vulnerability
- Steal kills (EMP their swarm target, consume it yourself)
- Opens combo opportunities (stun → pseudopod hunt)

**Visual Feedback:**
- Expanding blue/white electromagnetic ring from multi-cell center
- Affected entities freeze with glitch/static effects
- Blue outline on stunned entities
- Particle flow from swarms to multi-cell during consumption
- Screen shake at pulse epicenter

**Design Philosophy:**

*"You're not running from swarms anymore. You're hunting them."*

EMP transforms the multi-cell power fantasy from "I can hunt single-cells" to "I can fight the universe itself." Swarms were Stage 1's nightmare - now they're Stage 2's prey. High-stakes, high-skill, massively rewarding.

**Evolution Vision - Optional Abilities:**
Evolution stages may unlock *choices* rather than fixed upgrades. Stage 2 could offer:
- **Pseudopods** (hunter specialization - reach and engulf prey)
- **Speed Boost** (gatherer/escapist specialization - outrun threats, claim territory faster)
- **Other possibilities?** (armor, efficiency, detection range boost?)

This creates strategic diversity - not all multi-cells play the same way. *Currently pseudopods are default; branching abilities are future design.*

**Goal:** Reach 800 maxEnergy to evolve to Stage 3 (Cyber-Organism). Multiple paths:
- Hunt single-cells with pseudopods (when implemented)
- **Hunt entropy swarms with EMP** (primary path - 50 maxEnergy per swarm)
- Collect high-value nutrients near gravity wells
- Hybrid approach (mix of all three)

Evolution threshold increased from original 500 to 800 to accommodate swarm hunting as a viable advancement strategy.

**Feel:** Predator awakening. You're no longer just prey - you have options. The world opens up. Power feels real.

### 3. Cyber-Organism ⚠️ VISION STAGE - NOT IMPLEMENTED

**The Emergence:**
When you hit Stage 3 evolution threshold, you experience a trippy scale transcendence. Camera zooms out. Your body morphs and grows. You balloon from multi-cellular cluster to full organism with limbs. You **break the surface** of the primordial soup and emerge into the digital jungle - a vastly larger world that was always there, but invisible to your microscopic perception.

**Visual:** 6-legged cyber-lizard. Lizard-sized relative to jungle environment. Complex body with visible subsystems (organs? energy cores? data processors?). Still glowing cyber aesthetic, but more sophisticated than cellular blobs.

**Environment:** Top-down 3D digital jungle. Movement is still 2D (x/y plane), but visual depth and terrain. Digital trees, data rivers, glitch zones, firewall barriers. The soup pools you came from are scattered throughout - tiny puddles in a vast wilderness.

**Combat Introduction:**
Twin-stick shooter mechanics unlock (or melee combat if you chose that evolution path - optional abilities TBD). Energy-based projectiles or physical strikes. First time you can actually *fight* rather than just flee or engulf.

**Metabolism:**
Still need energy, but sources are different at this scale. Stage 1-2 nutrients are microscopic - irrelevant to you now. Macro-scale food sources (data chunks? energy nodes? hunting other Stage 3 organisms?).

**Threats:**
- **Stage 4+ players**: Bigger predators in the jungle
- **Digital predators**: NPC threats at macro scale (cyber-snakes? data-eating viruses? corrupted programs?)
- **Entropy at macro scale**: How does entropy manifest in the jungle?
  - Noise Storms (static weather that obscures vision/scrambles inputs)?
  - Decay Zones (areas that drain health over time)?
  - Dilution Rifts (gravitational tears that pull you apart)?
  - *Design space: still figuring out what entropy means at this scale*
- **Other Stage 3 players**: Territorial PvP. Combat is now primary interaction.
- **Environmental hazards**: Data storms, corrupted terrain, firewall barriers, glitch zones

**Prey:**
Can't hunt Stage 1-2 anymore (they're too small to perceive/bother with). Hunt other Stage 3 organisms (players and NPCs) or gather macro-scale resources.

**Optional Evolution Abilities (Vision):**
Stage 3 evolution could offer choices:
- **Ranged combat** (projectile weapons, twin-stick shooter)
- **Melee combat** (claws, strikes, close-quarters hunter)
- **Other?** (armor, speed, stealth, environmental manipulation?)

**Goal:** Survive the jungle, gather resources, evolve to Stage 4 (1000 maxEnergy threshold).

**Feel:** Predator in a dangerous world. Combat-focused. Territorial. You're powerful but not safe - there's always something bigger.

### 4. Humanoid ⚠️ VISION STAGE - NOT IMPLEMENTED

**The Intelligence Awakening:**
Evolution to Stage 4 is the leap to **sapience**. You're not just reacting (Stage 1), hunting (Stage 2), or fighting (Stage 3) - you're *thinking*. Planning. Creating. Making meaning. This is the cognitive revolution.

**The Perspective Shift:**
Stage 4 transitions from top-down to **first-person** (Three.js PerspectiveCamera).
- Stages 1-3: God-view. You observe yourself from outside.
- Stage 4: Embodied. You're *inside* a body, looking *out*.

This mirrors sapience—being a subject, not just an object. It also creates vulnerability: blind spots, threats from behind, needing to *look* to *see*. Terrifying in a permadeath game.

**Visual:** Cyber-humanoid form with **procedural variation**:
- Bipedal stance, humanoid silhouette
- 2 or 4 arms (gameplay implications TBD)
- Cycloptic or binocular eyes (FOV/perception differences TBD)
- Cyber-aesthetic: glowing energy lines, digital flesh, proto-god appearance
- Each humanoid is unique - variation may be random or influenced by Stage 3 playstyle

**The Dual Resource System:**

This is where the game fundamentally changes. Energy alone is no longer enough.

**Energy** — Survival Constraint
- Scarce, specific sources (primarily hunting beasts with energy spears)
- Keeps you alive—you MUST engage with the world to not starve
- Forces you out of hiding, into risk
- Same metabolic pressure as earlier stages, but different scale

**Signal** (or Experience) — Progression Currency
- Universal: EVERYTHING contributes
- Build? Signal. Hunt? Signal. Cooperate? Signal. Explore? Signal.
- The path to godhood is YOUR path
- You simply have to *live* enough to transcend

*"Energy is survival. Signal is transcendence."*

You don't just *collect* Signal—you *metabolize* it. Turn events into understanding. Integrate them into what you are.

**Playstyle Diversity:**
- **The Hunter** — energy-rich, Signal through kills and mastery
- **The Builder** — scrapes by on energy, Signal through creation
- **The Wanderer** — careful energy management, Signal through discovery
- **The Social** — trades, cooperates, Signal through connection

**Combat:**
Energy spears as primary weapon. Hunting beasts and other humanoids. Multiple weapon types and special abilities (dash, shield, AOE) possible as the design develops.

**Construction & Creation:**
You can **build structures**. Possibilities:
- Defensive fortifications (walls, barriers, safe zones)
- Traps and tools (pitfalls, snares, energy collectors)
- Monuments and markers (leave your mark on the world)
- Building contributes Signal - you're organizing reality

**Awareness Expansion:**
Perception expands again. You see patterns, not just entities. You understand relationships between threats, resources, territory. And as you accumulate Signal, you begin to *glimpse* something more - a layer of reality that only godcells see fully.

**Threats:**
- **Other Stage 4 players**: High-stakes PvP. Intelligent adversaries.
- **Entropy constructs**: Advanced entropy manifestations at humanoid scale
- **Environmental hazards**: Dangerous terrain, storms, corrupted zones
- **Beasts**: Stage 3 organisms and other macro-fauna to hunt (and be hunted by)

(Godcells don't hunt humanoids - you're beneath their notice. They've transcended that game entirely. But you might see them in the sky...)

**Goal:** Accumulate enough Signal to evolve to Stage 5 Godcell. Not just maxEnergy - you must *live* meaningfully.

**The Philosophical Core:**

| Stage | Mode of Being | Core Activity |
|-------|---------------|---------------|
| 1. Single-Cell | Reactive | Flee, consume, survive |
| 2. Multi-Cell | Predatory | Hunt, dominate, expand |
| 3. Cyber-Organism | Combative | Fight, compete, territory |
| 4. Humanoid | **Interpretive** | Understand, create, mean |
| 5. Godcell | Transcendent | Become truth itself |

**Feel:** Sense-making. Meaning-making. You're not just surviving the ecosystem—you're *comprehending* it. A humanoid who survives a thousand hunts but learns nothing stays a humanoid forever. A humanoid who metabolizes what happens to them—who extracts signal from the noise of existence—becomes a godcell.

**A godcell isn't someone who ate the most. It's someone who lived the most.**

### 5. Godcell (Final Stage) 🌟 META-GAME VISION - HIGHLY SPECULATIVE

**Transcendence:**
When you accumulate enough Signal as a Humanoid, you **transcend**. You break free from embodiment, from the ground, from the constraints that bound you. You become a godcell—an alien-angel.

**The Perspective Shift (Again):**
- Stage 4: First-person, grounded, embodied
- Stage 5: **Third-person, full 3D flight**, liberated from the ground

You're no longer *in* the world looking out—you're *above* it, moving through all three dimensions freely. A floating, flying transcendent entity.

**Visual: Alien-Angels**
Aesthetic inspiration: **Neon Genesis Evangelion angels**
- Procedurally generated transcendent beings
- Post-humanoid—no longer bound to human shape
- Geometric? Organic? Both? Incomprehensible to lower stages
- Beautiful and terrifying
- Each godcell is unique

**Generation factors:**
- Random cosmic variance
- Primary source(s) of their Signal
- The mix of their Signal sources throughout Stage 4

A hunter-godcell looks different from a builder-godcell looks different from a wanderer-godcell. Your path shapes your transcendent form.

**Maximal Agency:**
Godcells have *choice* in a way no other stage does:
- Fly anywhere in full 3D space
- Return to the soup (as a god visiting the primordial)
- Engage with humanoids, creatures, lower stages
- Observe, interact, influence (mechanics TBD)
- Or ignore it all and begin the ascent

But eventually... the God-Mind calls. You *can* linger, but you *will* move on.

**Another Awareness Expansion:**
A new layer of reality becomes visible:
- Humanoids can *glimpse* this layer as they accumulate Signal
- Godcells *see* it fully
- What IS this layer? **Open question - needs more design exploration**

Possibilities:
- The raw Signal substrate (seeing information itself)
- Other godcells (always present, only now visible)
- The God-Mind as a presence/direction
- Entropy's true form revealed
- The web of connections between all living things

**The Final Obstacle: Rite of Passage**

**This is not a victory lap.**

Between godcell and God-Mind stands a final challenge—a rite of passage.

**The purpose:** Godcells protect the field where Stages 1-4 play out. The final obstacle IS that protection. To join the God-Mind, you must prove yourself by defending the world you came from.

**The form:** A final battle against Entropy and Noise at epic, cosmic scale.
- Not the swarms and patches of lower stages
- Entropy in its true, vast, terrifying form
- The ultimate expression of chaos vs coherence

**The meaning:** You don't just *escape* the world—you *defend* it. Transcendence isn't abandonment; it's guardianship. To become one with the God-Mind, you must first stand between creation and entropy.

**You See Other Godcells:**
Everyone who transcends is visible to each other. Alien-angels in the sky. Shared existence at the highest level.

**The God-Mind Collective (Meta-Game Hook):**

This is what makes GODCELL more than a roguelike - it's a **community project**.

**How It Works:**
- Complete your first run (reach God-Mind) → **Generate 1 godcell** for the collective
- Complete Loop 1 (harder remix) → **Generate 3 godcells**
- Complete Loop 2 → **Generate 7 godcells**
- (Exponential contributions for veteran players)

**The God-Mind Grows:**
- The God-Mind is a **global entity** (all players, all servers contribute)
- Visible to everyone in the game
- Grows bigger/fuller as the community completes runs
- Visual representation TBD (depends on godcell aesthetic - constellation? digital brain? swarm of light?)
- There's a **completion goal** - filling the God-Mind
- What happens when it completes? *Mystery. Future design space.*

**Loop Mechanics (Nuclear Throne Style):**

Reaching the God-Mind isn't the end - it's the **gateway to harder loops**.

**The Remix:**
- You respawn in soup as Stage 1 again
- Simulation remixes - harder AI, more enemies, new quirks
- Each loop is a distinct difficulty tier
- Loop players might be on **separate servers/planets** (different world for different difficulty tiers?)
  - *Still figuring out how matchmaking works across loops*

**Prestige & Recognition:**

**Profile Stats:**
- Godcells contributed to the collective (public, visible)
- Loops completed
- Fastest God-Mind race time
- Leaderboards for try-hards

**Visual Prestige:**
- Players who've looped have an **aura** when they play
- Aura grows/changes as you complete more runs
- Shows attunement to the God-Mind
- Other players can see your prestige at a glance
- Specific cosmetic progression TBD

**The Philosophy:**
"To become a god is to realize you're still just a cell in a vaster ocean."

Godhood isn't the end. It's a gateway. The ladder is infinite. How far can you climb? How much can you contribute to the collective?

**Open Design Questions:**
- What IS the God-Mind visually?
- What happens when the community completes it?
- What does the cosmic race gameplay feel like?
- How do loop servers/matchmaking work?
- Exact godcell generation curve (1 → 3 → 7 → ?)
- Cosmetic progression details

---

## Core Systems

### Resource System: Nutrients (Stage 1-2 Only) ✅ IMPLEMENTED

**Nutrients** are data packets floating in the primordial soup that fuel early evolution. Stage 1-2 gameplay revolves around collecting these to survive and evolve.

**Spawning & Scarcity:**
- **26 nutrients** spawn across the soup world (4800×3200px)
- Limited count creates natural competition and territorial behavior
- Players cluster around nutrient-rich areas
- AI bots compete for the same resources

**Collection:**
- Active pickup - touch to collect
- Immediate energy gain (25 base value)
- Permanent maxEnergy capacity increase (+10 base capacity)
- Both scale with proximity multipliers

**Respawn:**
- 30 second respawn timer after collection
- Creates pacing - can't camp one spot forever
- Encourages movement and territory claiming

**Risk/Reward Proximity System:**
Nutrients near gravity distortions have value multipliers based on danger:
- **1x (Green)**: Safe zones, base value (25 energy, +10 capacity)
- **2x (Cyan)**: Outer gravity well, moderate risk (50 energy, +20 capacity)
- **3x (Gold)**: Inner gravity well, high risk (75 energy, +30 capacity)
- **5x (Magenta)**: Event horizon edge, extreme danger (125 energy, +50 capacity)

High-value nutrients create tempting risk/reward decisions - worth risking the singularity?

**Visual:**
Glowing data crystals, color-coded by value multiplier. Distinct from background particles. Pulsing glow effect.

**Design Result:**
Territorial emergent behavior. Players stake out safe zones vs brave the gravity wells for faster progression. Competition for high-value nutrients creates natural conflict.

**Stage 3+ Resources:**
Microscopic nutrients become irrelevant at macro scale. Stage 3+ organisms need different energy sources (TBD - macro-scale resources, hunting, environmental energy?)

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
