// ============================================
// Game Constants & Configuration
// Runtime-tunable values and static configuration
// ============================================

// Runtime config that can be modified (subset of GAME_CONFIG keys)
export const DEV_TUNABLE_CONFIGS = [
  // Movement (Soup)
  'PLAYER_SPEED',
  'MOVEMENT_FRICTION',
  'MOVEMENT_ENERGY_COST',

  // Movement (Stage 3 - Cyber-Organism)
  'CYBER_ORGANISM_ACCELERATION_MULT',
  'CYBER_ORGANISM_MAX_SPEED_MULT',
  'CYBER_ORGANISM_FRICTION',
  'CYBER_ORGANISM_SPRINT_SPEED_MULT',
  'CYBER_ORGANISM_SPRINT_ENERGY_COST',

  // Movement (Stage 4 - Humanoid)
  'HUMANOID_ACCELERATION_MULT',
  'HUMANOID_MAX_SPEED_MULT',
  'HUMANOID_FRICTION',
  'HUMANOID_SPRINT_SPEED_MULT',
  'HUMANOID_SPRINT_ENERGY_COST',
  'HUMANOID_CAMERA_HEIGHT',

  // Energy & Decay
  'SINGLE_CELL_ENERGY_DECAY_RATE',
  'MULTI_CELL_ENERGY_DECAY_RATE',
  'CYBER_ORGANISM_ENERGY_DECAY_RATE',
  'HUMANOID_ENERGY_DECAY_RATE',

  // Evolution
  'EVOLUTION_MULTI_CELL',
  'EVOLUTION_CYBER_ORGANISM',
  'EVOLUTION_HUMANOID',
  'EVOLUTION_GODCELL',
  'EVOLUTION_MOLTING_DURATION',

  // Nutrients
  'NUTRIENT_ENERGY_VALUE',
  'NUTRIENT_CAPACITY_INCREASE',
  'NUTRIENT_RESPAWN_TIME',

  // Obstacles
  'OBSTACLE_GRAVITY_STRENGTH',
  'OBSTACLE_GRAVITY_RADIUS',
  'OBSTACLE_EVENT_HORIZON',
  'OBSTACLE_CORE_RADIUS',
  'OBSTACLE_SPARK_RADIUS',
  'OBSTACLE_ENERGY_DRAIN_RATE',

  // Swarms
  'SWARM_SPEED',
  'SWARM_DAMAGE_RATE',
  'SWARM_DETECTION_RADIUS',
  'SWARM_SLOW_EFFECT',

  // Combat
  'CONTACT_DRAIN_RATE',
  'PSEUDOPOD_RANGE',
  'PSEUDOPOD_AOE_RADIUS',
  'PSEUDOPOD_PROJECTILE_SPEED',
  'PSEUDOPOD_DRAIN_RATE',
  'PSEUDOPOD_COOLDOWN',
  'PSEUDOPOD_ENERGY_COST',

  // EMP
  'EMP_COOLDOWN',
  'EMP_RANGE',
  'EMP_DISABLE_DURATION',
  'EMP_ENERGY_COST',

  // Detection
  'MULTI_CELL_DETECTION_RADIUS',
] as const;

export type TunableConfigKey = (typeof DEV_TUNABLE_CONFIGS)[number];

// ============================================
// Game Constants
// ============================================

export const GAME_CONFIG = {
  // Movement (Soup - Stage 1-2)
  PLAYER_SPEED: 403, // Pixels per second
  MOVEMENT_FRICTION: 0.5, // Velocity decay per second (tighter turns)

  // Stage 3 Movement (Cyber-Organism): Grounded hexapod with momentum
  CYBER_ORGANISM_ACCELERATION_MULT: 1.5, // Punchy acceleration (feel the push)
  CYBER_ORGANISM_MAX_SPEED_MULT: 1.56, // 30% faster (zippy)
  CYBER_ORGANISM_FRICTION: 0.25, // Grounded momentum (0.25=quick stop, 0.66=soup, 0.85=heavy glide)
  CYBER_ORGANISM_SPRINT_SPEED_MULT: 1.8, // Sprint burst multiplier
  CYBER_ORGANISM_SPRINT_ENERGY_COST: 0.5, // Energy/sec while sprinting

  // Stage 4 Movement (Humanoid): First-person FPS-style controls
  HUMANOID_ACCELERATION_MULT: 1.2, // Responsive acceleration
  HUMANOID_MAX_SPEED_MULT: 0.8, // Slower than cyber-organism (more deliberate)
  HUMANOID_FRICTION: 0.35, // Quick stop (FPS-style tight control)
  HUMANOID_SPRINT_SPEED_MULT: 1.6, // Sprint burst multiplier
  HUMANOID_SPRINT_ENERGY_COST: 0.8, // Higher energy cost for humanoid sprint
  HUMANOID_CAMERA_HEIGHT: 160, // First-person eye level (game units above ground)

  // Stage 5 Movement (Godcell): 3D flight with Q/E for vertical
  GODCELL_ACCELERATION_MULT: 1.5, // Responsive 3D acceleration
  GODCELL_MAX_SPEED_MULT: 1.0, // Full speed (transcendent movement)
  GODCELL_FRICTION: 0.4, // Smooth glide (floaty, godlike)
  GODCELL_Z_MIN: 0, // Ground level (can't go below)
  GODCELL_Z_MAX: 2000, // Sky ceiling

  // World dimensions - Soup (Stage 1-2 play area)
  WORLD_WIDTH: 4800, // Soup width (backward compat alias)
  WORLD_HEIGHT: 3200, // Soup height (backward compat alias)
  VIEWPORT_WIDTH: 1200, // What you see on screen
  VIEWPORT_HEIGHT: 800,

  // Jungle dimensions (Stage 3+ play area) - 4x larger than soup
  JUNGLE_WIDTH: 19200, // 4x soup width
  JUNGLE_HEIGHT: 12800, // 4x soup height

  // Soup region within jungle (centered)
  // Soup exists as a small region in the middle of the jungle
  SOUP_ORIGIN_X: 7200, // (19200 - 4800) / 2 = 7200
  SOUP_ORIGIN_Y: 4800, // (12800 - 3200) / 2 = 4800
  SOUP_WIDTH: 4800, // Same as WORLD_WIDTH
  SOUP_HEIGHT: 3200, // Same as WORLD_HEIGHT

  // Visual theme - godcell: Digital Primordial Soup
  BACKGROUND_COLOR: 0x0a0a14, // Deep void
  GRID_COLOR: 0x1a1a3e, // Subtle grid lines
  PARTICLE_COLOR: 0x00ff88, // Flowing data particles (cyan)

  // Particle system
  MAX_PARTICLES: 600, // Number of background particles (doubled for more visual density)
  PARTICLE_MIN_SIZE: 1,
  PARTICLE_MAX_SIZE: 3,
  PARTICLE_SPEED_MIN: 10,
  PARTICLE_SPEED_MAX: 40,

  // Cyber-cell colors (neon palette)
  CELL_COLORS: [
    '#00ffff', // Cyan
    '#ff00ff', // Magenta
    '#ffff00', // Yellow
    '#00ff88', // Mint
    '#ff0088', // Hot pink
    '#88ff00', // Lime
    '#0088ff', // Electric blue
  ],

  // Nutrients (data packets)
  NUTRIENT_COUNT: 38, // Initial spawn count (balanced for stage 1-2)
  NUTRIENT_RESPAWN_TIME: 10000, // 10 seconds in milliseconds
  NUTRIENT_SIZE: 12, // Radius (balanced for collection difficulty)
  NUTRIENT_COLOR: 0x00ff00, // Green data crystals (base 1x)
  NUTRIENT_ENERGY_VALUE: 25, // Immediate energy gain
  NUTRIENT_CAPACITY_INCREASE: 10, // Permanent maxEnergy increase

  // Gradient nutrient colors (based on proximity to distortion cores)
  NUTRIENT_2X_COLOR: 0x00ffff, // Cyan (2x value, outer gravity well)
  NUTRIENT_3X_COLOR: 0xffff00, // Gold (3x value, inner gravity well)
  NUTRIENT_5X_COLOR: 0xff00ff, // Magenta (5x value, event horizon edge - extreme risk!)

  // Gravity Obstacles (mini black holes)
  OBSTACLE_COUNT: 12, // Number of distortions to spawn
  OBSTACLE_GRAVITY_RADIUS: 600, // Full gravity influence zone (escapable with effort)
  OBSTACLE_EVENT_HORIZON: 180, // Inescapable zone (magenta filled - 30% of gravity radius)
  OBSTACLE_CORE_RADIUS: 60, // Visual dark void sphere
  OBSTACLE_SPARK_RADIUS: 18, // Lethal inner spark (instant death zone)
  OBSTACLE_GRAVITY_STRENGTH: 1.0, // Force multiplier for inverse-square gravity
  OBSTACLE_ENERGY_DRAIN_RATE: 7.5, // Energy/sec drain rate when inside gravity well (scaled by proximity)
  OBSTACLE_DAMAGE_RATE: 10, // UNUSED - legacy field, energy drain now handled by OBSTACLE_ENERGY_DRAIN_RATE
  OBSTACLE_NUTRIENT_ATTRACTION_SPEED: 50, // Pixels per second that nutrients move toward obstacles
  OBSTACLE_MIN_SEPARATION: 900, // Minimum distance between obstacles (pixels)

  // ============================================
  // Energy-Only System
  // Energy is the sole resource: fuel, life, survival
  // 0 energy = instant death (dilution)
  // ============================================

  // Stage-specific energy pools (combined old health + energy)
  SINGLE_CELL_ENERGY: 100, // Stage 1: 100 energy (harsh, must feed quickly)
  SINGLE_CELL_MAX_ENERGY: 100, // No buffer - evolution is the only way to grow capacity
  MULTI_CELL_ENERGY: 300, // Stage 2: starts at evolution threshold
  MULTI_CELL_MAX_ENERGY: 300,
  CYBER_ORGANISM_ENERGY: 3000, // Stage 3: starts at evolution threshold
  CYBER_ORGANISM_MAX_ENERGY: 3000,
  HUMANOID_ENERGY: 30000, // Stage 4: starts at evolution threshold
  HUMANOID_MAX_ENERGY: 30000,
  GODCELL_ENERGY: 100000, // Stage 5: starts at evolution threshold (transcendent)
  GODCELL_MAX_ENERGY: 100000,

  // Decay rates (units per second) - stage-specific metabolic efficiency
  // These drain energy passively - no damage resistance applies
  SINGLE_CELL_ENERGY_DECAY_RATE: 2.66, // ~37 seconds to starvation from spawn (100 / 2.66 ≈ 37s) - harsh!
  MULTI_CELL_ENERGY_DECAY_RATE: 2.1, // ~190 seconds (400 / 2.1 ≈ 190s ≈ 3 minutes)
  CYBER_ORGANISM_ENERGY_DECAY_RATE: 12.0, // ~250 seconds (3000 / 12.0 ≈ 4.2 minutes) - doubled for urgency
  HUMANOID_ENERGY_DECAY_RATE: 3.3, // ~606 seconds (2000 / 3.3 ≈ 10 minutes)
  GODCELL_ENERGY_DECAY_RATE: 0, // Godcells transcend thermodynamics

  MOVEMENT_ENERGY_COST: 0.005, // Energy cost per pixel moved

  // Evolution thresholds (maxEnergy required)
  EVOLUTION_MULTI_CELL: 300, // Stage 1→2: ~20 nutrients (easy access to EMP)
  EVOLUTION_CYBER_ORGANISM: 3000, // Stage 2→3: Major grind - swarm hunting essential
  EVOLUTION_HUMANOID: 30000, // Stage 3→4: Full jungle ecosystem grind (fruits, bugs, creatures, PvP)
  EVOLUTION_GODCELL: 100000, // Stage 4→5: Transcendence is earned

  // Evolution
  EVOLUTION_MOLTING_DURATION: 2500, // 2.5 seconds invulnerable animation (ms)

  // Health multipliers removed - energy-only system
  // Stage-specific energy pools defined above

  // Stage radii (collision/visual size in pixels)
  SINGLE_CELL_RADIUS: 15, // Tiny single cell
  MULTI_CELL_RADIUS: 100, // Order of magnitude jump - multi-cell organism
  CYBER_ORGANISM_RADIUS: 101, // Jungle scale (similar to multi-cell, different world)
  HUMANOID_RADIUS: 192, // Humanoid scale
  GODCELL_RADIUS: 288, // Transcendent scale

  // Multi-cell detection (chemical sensing)
  MULTI_CELL_DETECTION_RADIUS: 1800, // Can detect entities within 1800px (chemical sensing range)

  // Contact Predation (multi-cell engulfs single-cell)
  CONTACT_DRAIN_RATE: 150, // Energy drained per second on contact (kills in ~1-2s)
  CONTACT_MAXENERGY_GAIN: 0.3, // Gain 30% of victim's maxEnergy on kill
  NUTRIENT_DROP_ON_DEATH: 0.5, // Victim drops 50% of collected nutrients (maxEnergy → nutrient count)

  // Pseudopod Strike (energy whip - medium range AoE attack)
  PSEUDOPOD_MODE: 'strike' as 'hitscan' | 'projectile' | 'strike', // 'strike' = instant AoE at target location
  PSEUDOPOD_RANGE: 250, // Max range in pixels (close quarters energy whip)
  PSEUDOPOD_AOE_RADIUS: 50, // Impact zone radius for AoE damage
  PSEUDOPOD_PROJECTILE_SPEED: 3600, // (legacy) Pixels per second beam travel speed
  PSEUDOPOD_WIDTH: 20, // (legacy) Beam collision width in pixels
  PSEUDOPOD_ENERGY_COST: 30, // Energy cost per strike
  PSEUDOPOD_DRAIN_RATE: 200, // Energy drained per hit (attacker absorbs this)
  PSEUDOPOD_COOLDOWN: 1000, // Milliseconds between strikes
  MULTICELL_KILL_ABSORPTION: 0.8, // Gain 80% of victim's maxEnergy when killing another multi-cell

  // Digital Jungle Trees (Stage 3+ environment obstacles)
  TREE_COUNT: 80, // Number of trees to spawn (~75-100 for medium density)
  TREE_MIN_RADIUS: 80, // Small bush collision radius
  TREE_MAX_RADIUS: 360, // Large ancient tree collision radius
  TREE_MIN_HEIGHT: 200, // Small bush visual height
  TREE_MAX_HEIGHT: 2400, // Large ancient tree visual height
  TREE_MIN_SPACING: 800, // Minimum distance between trees (Poisson disc fills naturally)
  SOUP_POOL_RADIUS: 300, // Visual pool radius in jungle (represents soup world)
  TREE_POOL_BUFFER: 100, // Buffer around soup pool for tree spawning

  // Entropy Swarms (virus enemies)
  SWARM_COUNT: 18, // Number of swarms to spawn (doubled for stage 1 threat)
  SWARM_SIZE: 47, // Radius for collision detection (20% larger, more threatening)
  SWARM_SPEED: 290, // 20% boost to match faster player speed (still slower than players)
  SWARM_SLOW_EFFECT: 0.6, // Speed multiplier when player is in contact with swarm (40% slow)
  SWARM_DETECTION_RADIUS: 700, // How far swarms can detect players - extended pursuit range
  SWARM_DAMAGE_RATE: 60, // Energy drain per second on contact (applies damage resistance)
  SWARM_PATROL_RADIUS: 400, // How far swarms wander from spawn point
  SWARM_PATROL_CHANGE_INTERVAL: 3000, // Time between random patrol direction changes (ms)

  // EMP Ability (Multi-cell defensive/offensive pulse)
  EMP_COOLDOWN: 10000, // 10 seconds between uses (milliseconds)
  EMP_RANGE: 768, // 8x multi-cell radius (8 * 96px = 768px) - AoE pulse range
  EMP_DISABLE_DURATION: 3000, // 3 seconds paralysis for affected entities (milliseconds)
  EMP_ENERGY_COST: 80, // Energy cost to activate
  EMP_MULTI_CELL_ENERGY_DRAIN: 80, // Energy drained from hit multi-cells (applies damage resistance)
  EMP_SINGLE_CELL_ENERGY_DRAIN: 40, // Energy drained from hit single-cells (20% of their pool)

  // Swarm Consumption (EMP-enabled swarm hunting)
  SWARM_CONSUMPTION_RATE: 200, // Energy drained per second during engulfment (0.5 seconds to consume)
  SWARM_ENERGY_GAIN: 150, // Energy gained per swarm consumed (net +70 after 80 cost)
  SWARM_ENERGY: 100, // Swarm energy pool (set when disabled by EMP)
  // Kill rewards: 25% of swarm peak energy for consumption, 10% for beam (see DeathSystem)

  // ============================================
  // Stage 3+ Macro-Resources (Digital Jungle Ecosystem)
  // Energy values are % of Stage 3→4 threshold (30,000 maxEnergy)
  // ============================================

  // DataFruit - passive foraging (2% of 30,000 = 600)
  DATAFRUIT_VALUE: 600, // Energy on collection
  DATAFRUIT_CAPACITY: 600, // maxEnergy increase (evolution progress)
  DATAFRUIT_RIPENESS_TIME: 30000, // 30s to ripen on tree (ms)
  DATAFRUIT_GROUND_LIFETIME: 60000, // 60s before fallen fruit despawns (ms)
  DATAFRUIT_COLLISION_RADIUS: 40, // Collection/visual radius (2x for visibility)
  DATAFRUIT_SPAWN_OFFSET: 60, // Random offset from tree center (legacy, not used)
  DATAFRUIT_TREE_SPAWN_INTERVAL: 45000, // 45s between tree fruit spawns (ms)

  // CyberBug - skittish prey in swarms (5% of 30,000 = 1,500)
  CYBERBUG_VALUE: 1500, // Energy on kill
  CYBERBUG_CAPACITY: 1500, // maxEnergy increase on kill
  CYBERBUG_SWARM_SIZE_MIN: 3, // Minimum bugs per swarm
  CYBERBUG_SWARM_SIZE_MAX: 5, // Maximum bugs per swarm
  CYBERBUG_SWARM_COUNT: 12, // Number of swarms to spawn in jungle
  CYBERBUG_FLEE_TRIGGER_RADIUS: 300, // Start fleeing at this distance from player
  CYBERBUG_FLEE_SPEED: 350, // Fast when scared (px/s)
  CYBERBUG_PATROL_SPEED: 100, // Slow when calm (px/s)
  CYBERBUG_COLLISION_RADIUS: 15, // Hit detection radius
  CYBERBUG_PATROL_RADIUS: 200, // How far bugs wander from home
  CYBERBUG_SWARM_RESPAWN_DELAY: 30000, // 30s before swarm respawns after all bugs killed

  // JungleCreature - larger NPC fauna (10% of 30,000 = 3,000)
  JUNGLE_CREATURE_VALUE: 3000, // Energy on kill
  JUNGLE_CREATURE_CAPACITY: 3000, // maxEnergy increase on kill
  JUNGLE_CREATURE_COUNT: 8, // Number of creatures to spawn
  JUNGLE_CREATURE_PATROL_RADIUS: 500, // How far creatures wander from home
  JUNGLE_CREATURE_AGGRO_RADIUS: 250, // Distance at which stalker/ambusher attacks
  JUNGLE_CREATURE_COLLISION_RADIUS: 40, // Hit detection radius (larger than bugs)
  JUNGLE_CREATURE_SPEED: 180, // Base movement speed (px/s)
  JUNGLE_CREATURE_CHASE_SPEED: 280, // Speed when hunting (stalker/ambusher)
  JUNGLE_CREATURE_DAMAGE_RATE: 80, // Energy drain per second on player contact (stalker/ambusher)
  JUNGLE_CREATURE_RESPAWN_DELAY: 45000, // 45s before creature respawns after killed

  // EntropySerpent - apex jungle predator (SUPER AGGRESSIVE)
  ENTROPY_SERPENT_COUNT: 4, // Number of serpents to spawn
  ENTROPY_SERPENT_BODY_SPHERE_SIZE: 80, // Radius of each body segment sphere
  ENTROPY_SERPENT_HEAD_OFFSET: 768, // Distance from body center to head (6 * 80 * 1.6)
  ENTROPY_SERPENT_SPEED: 420, // Base patrol speed (faster than players!)
  ENTROPY_SERPENT_CHASE_SPEED: 600, // Speed when hunting (faster than sprint!)
  ENTROPY_SERPENT_ATTACK_SPEED: 350, // Speed during attack animation
  ENTROPY_SERPENT_DETECTION_RADIUS: 1200, // How far they can see prey
  ENTROPY_SERPENT_ATTACK_RANGE: 540, // Claw strike range from HEAD (6x original)
  ENTROPY_SERPENT_DAMAGE: 300, // 10% of Stage 3 maxEnergy per hit (10s TTK)
  ENTROPY_SERPENT_ATTACK_COOLDOWN: 1000, // 1s between attacks (fast!)
  ENTROPY_SERPENT_PATROL_RADIUS: 800, // How far they wander from home
  ENTROPY_SERPENT_ENERGY: 2000, // Serpent health pool (can be killed!)
  ENTROPY_SERPENT_RESPAWN_DELAY: 60000, // 60s respawn after killed

  // Projectile - Stage 3 ranged specialization attack
  // Values scaled for jungle view (camera frustum ~4800 wide)
  PROJECTILE_SPEED: 7200, // Pixels per second (2x pseudopod speed)
  PROJECTILE_MAX_DISTANCE: 10800, // ~10,800px range (1.5s * 7200 px/s)
  PROJECTILE_COOLDOWN: 333, // ms between shots (3 shots/sec)
  PROJECTILE_DAMAGE: 150, // 5% of Stage 3 maxEnergy
  PROJECTILE_CAPACITY_STEAL: 0, // No capacity steal from fauna (for now)
  PROJECTILE_COLLISION_RADIUS: 21, // Hit detection radius (30% smaller)
  PROJECTILE_ENERGY_COST: 30, // 1% of Stage 3 maxEnergy
  PROJECTILE_LIFETIME: 1500, // ms before despawn

  // ============================================
  // Stage 3 Combat Specialization System
  // Base values calculated from Stage 3 initial maxEnergy (3000)
  // ============================================

  // Specialization selection
  SPECIALIZATION_SELECTION_DURATION: 5000, // 5 seconds to choose before auto-assign

  // Melee Pathway - close-range swipe and thrust attacks
  // Energy costs: 0.5% of 3000 = 15
  // Damage: 5% of 3000 = 150
  MELEE_SWIPE_RANGE: 512, // Max range (30% smaller)
  MELEE_SWIPE_ARC: 90, // degrees (quarter arc)
  MELEE_SWIPE_DAMAGE: 150, // 5% of Stage 3 maxEnergy
  MELEE_SWIPE_KNOCKBACK: 200, // pixels push distance
  MELEE_SWIPE_ENERGY_COST: 15, // 0.5% of Stage 3 maxEnergy
  MELEE_SWIPE_COOLDOWN: 200, // ms between attacks (very fast)

  MELEE_THRUST_RANGE: 512, // Max range (30% smaller)
  MELEE_THRUST_ARC: 30, // degrees (narrow cone)
  MELEE_THRUST_DAMAGE: 150, // 5% of Stage 3 maxEnergy
  MELEE_THRUST_KNOCKBACK: 200, // pixels push distance
  MELEE_THRUST_ENERGY_COST: 15, // 0.5% of Stage 3 maxEnergy
  MELEE_THRUST_COOLDOWN: 200, // ms between attacks

  MELEE_KNOCKBACK_DECAY_RATE: 2000, // Knockback force decay per second

  // Traps Pathway - disguised mines that stun victims
  // Energy cost: 5% of 3000 = 150
  // Damage: 12.5% of 3000 = 375
  TRAP_MAX_ACTIVE: 5, // Max traps per player
  TRAP_LIFETIME: 120000, // 120 seconds before auto-despawn
  TRAP_TRIGGER_RADIUS: 101, // 30% smaller trigger radius
  TRAP_DAMAGE: 375, // 12.5% of Stage 3 maxEnergy
  TRAP_STUN_DURATION: 1000, // 1 second stun
  TRAP_ENERGY_COST: 150, // 5% of Stage 3 maxEnergy
  TRAP_COOLDOWN: 1000, // 1 second between placements
};
