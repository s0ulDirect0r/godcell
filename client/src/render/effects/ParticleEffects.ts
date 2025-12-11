// ============================================
// Particle Effects
// Spawns various particle systems for visual effects
// ============================================

import * as THREE from 'three';

/**
 * Animation data for death/hit particles
 */
export interface DeathAnimation {
  particles: THREE.Points;
  particleData: Array<{ x: number; y: number; vx: number; vy: number; life: number }>;
  startTime: number;
  duration: number;
}

/**
 * Animation data for evolution particles (spiral orbit)
 */
export interface EvolutionAnimation {
  particles: THREE.Points;
  particleData: Array<{
    angle: number;
    radius: number;
    radiusVelocity: number;
    angleVelocity: number;
    centerX: number;
    centerY: number;
  }>;
  startTime: number;
  duration: number;
  colorHex: number;
}

/**
 * Animation data for EMP pulse effect
 */
export interface EMPEffect {
  particles: THREE.Points;
  particleData: Array<{
    angle: number;
    radius: number;
    initialRadius: number;
    life: number;
  }>;
  startTime: number;
  duration: number;
  centerX: number;
  centerY: number;
}

/**
 * Animation data for swarm death explosion (3D burst)
 */
export interface SwarmDeathAnimation {
  particles: THREE.Points;
  particleData: Array<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }>;
  startTime: number;
  duration: number;
}

/**
 * Spawn death particles - radial burst when entity dies
 * @returns Animation object to track (caller should add to scene and tracking array)
 */
export function spawnDeathParticles(
  scene: THREE.Scene,
  x: number,
  y: number,
  colorHex: number
): DeathAnimation {
  const particleCount = 30;
  const duration = 800; // 0.8 seconds

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: DeathAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Random angle for radial burst
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 200; // pixels per second

    // XZ plane: X=game X, Y=height, Z=-game Y
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0.2; // Height (above ground)
    positions[i * 3 + 2] = -y;

    sizes[i] = 3 + Math.random() * 4;

    // Store game coordinates in particleData (AnimationUpdater converts to XZ)
    particleData.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0, // Start at full life
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: colorHex,
    size: 4,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    particles,
    particleData,
    startTime: Date.now(),
    duration,
  };
}

/**
 * Spawn hit sparks when pseudopod beam strikes a target
 * Red particle burst with higher velocity than death particles
 * @returns Animation object to track (uses deathAnimations array)
 */
export function spawnHitSparks(
  scene: THREE.Scene,
  x: number,
  y: number
): DeathAnimation {
  const particleCount = 40; // More particles than death for intense effect
  const duration = 500; // 0.5 seconds - quick and punchy

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: DeathAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Random angle for radial burst
    const angle = Math.random() * Math.PI * 2;
    const speed = 200 + Math.random() * 400; // Higher speed than death particles (more explosive)

    // XZ plane: X=game X, Y=height, Z=-game Y
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0.2; // Height (above ground)
    positions[i * 3 + 2] = -y;

    sizes[i] = 2 + Math.random() * 3; // Slightly smaller than death particles

    // Store game coordinates in particleData (AnimationUpdater converts to XZ)
    particleData.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0, // Start at full life
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0xff0000, // Red color for damage indication
    size: 3,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    particles,
    particleData,
    startTime: Date.now(),
    duration,
  };
}

/**
 * Spawn evolution particles that orbit outward then spiral back inward
 * @returns Animation object to track
 */
export function spawnEvolutionParticles(
  scene: THREE.Scene,
  x: number,
  y: number,
  colorHex: number,
  duration: number
): EvolutionAnimation {
  const particleCount = 60; // More particles than death for dramatic effect

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: EvolutionAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Evenly distribute particles in a circle
    const angle = (i / particleCount) * Math.PI * 2;
    const startRadius = 10; // Start close to cell

    // XZ plane: X=game X, Y=height, Z=-game Y
    positions[i * 3] = x + Math.cos(angle) * startRadius;
    positions[i * 3 + 1] = 0.2; // Height (above ground)
    positions[i * 3 + 2] = -(y + Math.sin(angle) * startRadius);

    sizes[i] = 2 + Math.random() * 2;

    // Particle will orbit outward then inward (controlled by update function)
    // Store game coordinates (AnimationUpdater converts to XZ)
    particleData.push({
      angle,
      radius: startRadius,
      radiusVelocity: 80, // pixels per second outward
      angleVelocity: 2.0 + Math.random(), // radians per second (rotation speed)
      centerX: x,
      centerY: y,
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: colorHex,
    size: 3,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending, // Additive blending for energy feel
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    particles,
    particleData,
    startTime: Date.now(),
    duration,
    colorHex,
  };
}

/**
 * Spawn EMP pulse - expanding blue/white electromagnetic ring
 * @returns Animation object to track
 */
export function spawnEMPPulse(
  scene: THREE.Scene,
  x: number,
  y: number
): EMPEffect {
  const particleCount = 80; // Dense ring of particles
  const duration = 600; // 0.6 seconds to expand and fade
  const initialRadius = 20; // Start small

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: EMPEffect['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Evenly distribute particles in a circle
    const angle = (i / particleCount) * Math.PI * 2;

    // XZ plane: X=game X, Y=height, Z=-game Y
    positions[i * 3] = x + Math.cos(angle) * initialRadius;
    positions[i * 3 + 1] = 0.3; // Height (above evolution particles)
    positions[i * 3 + 2] = -(y + Math.sin(angle) * initialRadius);

    sizes[i] = 3 + Math.random() * 2;

    // Store game coordinates (AnimationUpdater converts to XZ)
    particleData.push({
      angle,
      radius: initialRadius,
      initialRadius,
      life: 1.0, // Full life at start
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0x66ccff, // Blue-white electromagnetic color
    size: 4,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending, // Additive blending for energy pulse
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    particles,
    particleData,
    startTime: Date.now(),
    duration,
    centerX: x,
    centerY: y,
  };
}

/**
 * Animation data for spawn materialization effect (particles converge inward)
 */
export interface SpawnAnimation {
  entityId: string;
  entityType: 'player' | 'nutrient' | 'swarm';
  particles: THREE.Points;
  particleData: Array<{ x: number; y: number; vx: number; vy: number; life: number }>;
  startTime: number;
  duration: number;
  targetX: number;
  targetY: number;
}

/**
 * Spawn materialization particles - converge inward to entity position
 * Creates "digital assembly" effect as entity appears
 * @returns Animation object to track
 */
export function spawnMaterializeParticles(
  scene: THREE.Scene,
  entityId: string,
  entityType: 'player' | 'nutrient' | 'swarm',
  x: number,
  y: number,
  colorHex: number,
  radius: number = 40
): SpawnAnimation {
  // Particle count scales with entity visual importance:
  // - swarm: 50 (dense, chaotic feel)
  // - player: 35 (prominent spawn effect)
  // - nutrient: 20 (subtle materialization)
  const particleCount = entityType === 'swarm' ? 50 : entityType === 'player' ? 35 : 20;
  // Duration: 600ms provides enough time for particles to converge while keeping spawn snappy
  const duration = 600;

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: SpawnAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Start particles in a ring around the spawn point
    const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.5;
    const startRadius = radius + Math.random() * 20;
    const startX = x + Math.cos(angle) * startRadius;
    const startY = y + Math.sin(angle) * startRadius;

    // XZ plane: X=game X, Y=height, Z=-game Y
    positions[i * 3] = startX;
    positions[i * 3 + 1] = 0.15; // Height (below entities at 0.2)
    positions[i * 3 + 2] = -startY;

    // Particle size: 2-5 pixels, small enough to not obscure entity but visible enough to notice
    sizes[i] = 2 + Math.random() * 3;

    // Velocity toward center: speed calculated so particles reach center exactly when animation ends
    // Store game coordinates (AnimationUpdater converts to XZ)
    const speed = startRadius / (duration / 1000);
    particleData.push({
      x: startX,
      y: startY,
      vx: -Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      life: 1.0,
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: colorHex,
    size: 4,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending, // Additive for energy feel
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    entityId,
    entityType,
    particles,
    particleData,
    startTime: Date.now(),
    duration,
    targetX: x,
    targetY: y,
  };
}

/**
 * Spawn swarm death explosion - all particles burst outward and fade
 * @returns Animation object to track
 */
export function spawnSwarmDeathExplosion(
  scene: THREE.Scene,
  x: number,
  y: number
): SwarmDeathAnimation {
  const particleCount = 200; // Lots of particles for dramatic effect (orbiting + internal)
  const duration = 1200; // 1.2 seconds

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: SwarmDeathAnimation['particleData'] = [];

  // Create explosion particles radiating outward in all directions (3D sphere)
  for (let i = 0; i < particleCount; i++) {
    // Random direction in 3D space
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;

    // XZ plane: X=game X, Y=height, Z=-game Y
    // Initial position at center
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0.2; // Height (same layer as swarms)
    positions[i * 3 + 2] = -y;

    // Random sizes (mix of large and small)
    sizes[i] = 2 + Math.random() * 6;

    // Explosion velocity - fast outward burst in 3D
    // Note: vx/vy/vz here are in Three.js space (XZ plane with Y=height)
    const speed = 150 + Math.random() * 250; // 150-400 pixels per second
    const vx = speed * Math.sin(phi) * Math.cos(theta);
    const vy = speed * Math.cos(phi); // Y velocity = up/down
    const vz = speed * Math.sin(phi) * Math.sin(theta);

    // Store in Three.js coordinates since velocities are in Three.js space
    particleData.push({
      x,          // Three.js X (= game X)
      y: 0.2,     // Three.js Y (height)
      z: -y,      // Three.js Z (= -game Y)
      vx, vy, vz,
      life: 1.0, // Full life at start
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Orange/red swarm colors for death particles
  const material = new THREE.PointsMaterial({
    color: 0xff6600, // Bright orange
    size: 4,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending, // Additive for energy burst
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    particles,
    particleData,
    startTime: Date.now(),
    duration,
  };
}

/**
 * Animation data for energy transfer particles (source → target)
 */
export interface EnergyTransferAnimation {
  particles: THREE.Points;
  particleData: Array<{
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    progress: number;
    speed: number;
    wobbleOffset: number; // Random phase offset for wobble
  }>;
  startTime: number;
  duration: number;
  targetId: string; // Who is receiving energy (for aura trigger)
  gravityPull: boolean; // If true, use accelerating ease-in + wobble (for gravity drain)
}

/**
 * Spawn energy transfer particles - fly from source to target
 * Used when collecting nutrients or draining enemies
 * @param gravityPull - If true, particles accelerate toward target with wobble (for gravity drain)
 * @returns Animation object to track
 */
export function spawnEnergyTransferParticles(
  scene: THREE.Scene,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  targetId: string,
  // Cyan (0x00ffff) matches the gain aura color for visual consistency
  colorHex: number = 0x00ffff,
  // 15 particles creates visible stream without overwhelming the scene (range: 10-40)
  particleCount: number = 15,
  // Gravity pull mode: accelerating ease-in + erratic wobble (for gravity drain effect)
  gravityPull: boolean = false
): EnergyTransferAnimation {
  // 400ms duration: fast enough to feel responsive, slow enough to see the transfer
  const duration = 400;

  // Calculate distance for speed calculation
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Create particle geometry and material
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: EnergyTransferAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Start particles scattered around source with random offset
    const startOffset = 10 + Math.random() * 15;
    const startAngle = Math.random() * Math.PI * 2;
    const startX = sourceX + Math.cos(startAngle) * startOffset;
    const startY = sourceY + Math.sin(startAngle) * startOffset;

    // XZ plane: X=game X, Y=height, Z=-game Y
    positions[i * 3] = startX;
    positions[i * 3 + 1] = 0.25; // Height (above entities)
    positions[i * 3 + 2] = -startY;

    sizes[i] = 5 + Math.random() * 2;  // 5-7px for all energy transfer particles

    // Stagger particle speeds for wave effect (faster particles arrive first)
    // Store game coordinates (AnimationUpdater converts to XZ)
    const baseSpeed = distance / (duration / 1000);
    const speedVariation = 0.8 + Math.random() * 0.4; // 80%-120% of base speed

    particleData.push({
      x: startX,
      y: startY,
      // Slight spread (±10px) at target prevents particles from all hitting the exact same point
      targetX: targetX + (Math.random() - 0.5) * 20,
      targetY: targetY + (Math.random() - 0.5) * 20,
      // Negative progress (-0.2 to 0): particles with negative progress "wait" before moving,
      // creating a wave effect where faster particles lead and slower ones follow
      progress: -Math.random() * 0.2,
      speed: baseSpeed * speedVariation,
      wobbleOffset: Math.random() * Math.PI * 2, // Random phase for wobble
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: colorHex,
    size: 4,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending, // Additive for energy glow
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  return {
    particles,
    particleData,
    startTime: Date.now(),
    duration,
    targetId,
    gravityPull,
  };
}

/**
 * Animation data for melee arc attack effect
 * Intense visual with solid arc mesh, particles, trails, and sparks
 */
export interface MeleeArcAnimation {
  particles: THREE.Points;           // Main arc particles
  trailParticles: THREE.Points;      // Trailing particles behind the arc
  sparkParticles: THREE.Points;      // Spark particles that fly off
  arcMesh: THREE.Mesh;               // Solid arc sweep mesh
  hitboxMesh?: THREE.Line;           // Debug visualization of actual hitbox
  particleData: Array<{
    angle: number;      // Current angle in arc
    radius: number;     // Distance from center
    radiusSpeed: number; // How fast it expands outward
    life: number;       // Remaining life (1.0 → 0.0)
  }>;
  trailData: Array<{
    angle: number;
    radius: number;
    radiusSpeed: number;
    life: number;
  }>;
  sparkData: Array<{
    x: number;
    y: number;
    vx: number;         // Velocity X
    vy: number;         // Velocity Y
    life: number;
  }>;
  startTime: number;
  duration: number;
  centerX: number;
  centerY: number;
  baseAngle: number;   // Direction player is facing
  arcAngle: number;    // Width of arc (swipe = 90°, thrust = 30°)
  colorHex: number;    // Store color for updates
}

/**
 * Spawn melee arc attack effect - intense visual with multiple layers
 * Swipe: 90° arc, Thrust: 30° narrow cone
 * Features: solid arc mesh, bright particles, trails, sparks
 */
/**
 * Animation data for claw slash trail effect
 * Used for entropy serpent attack visual
 */
export interface ClawSlashAnimation {
  arcLine: THREE.Line;           // Arc-shaped slash trail
  sparkParticles: THREE.Points;  // Sparks flying off the slash
  sparkData: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
  }>;
  startTime: number;
  duration: number;
  centerX: number;
  centerY: number;
  baseAngle: number;
}

/**
 * Spawn claw slash trail effect - arc sweep at attack position
 * Creates dramatic claw swipe visual with trailing sparks
 * @param x - Center X position (serpent location)
 * @param y - Center Y position (serpent location)
 * @param direction - Attack direction (radians)
 * @param colorHex - Slash color (default orange-red)
 */
export function spawnClawSlash(
  scene: THREE.Scene,
  x: number,
  y: number,
  direction: number,
  colorHex: number = 0xff6600
): ClawSlashAnimation {
  // Effect duration: 250ms for quick, punchy claw swipe
  const duration = 250;
  // Arc parameters: 60° swipe arc, 80px reach (matches serpent arm length)
  const arcAngle = Math.PI / 3;  // 60 degrees
  const radius = 80;             // Slash reach
  const segments = 16;           // Arc smoothness

  // ============================================
  // 1. ARC LINE - The main slash trail
  // ============================================
  const arcPoints: THREE.Vector3[] = [];
  const halfArc = arcAngle / 2;
  const startAngle = direction - halfArc;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * arcAngle;
    // XZ plane: X=game X, Y=height, Z=-game Y
    arcPoints.push(new THREE.Vector3(
      x + Math.cos(angle) * radius,
      45,  // Height: at serpent arm level (Y=40 + arm offset)
      -(y + Math.sin(angle) * radius)
    ));
  }

  const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const arcMaterial = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 1.0,
    linewidth: 2,
  });
  const arcLine = new THREE.Line(arcGeometry, arcMaterial);
  scene.add(arcLine);

  // ============================================
  // 2. SPARK PARTICLES - Flying off the slash
  // ============================================
  const sparkCount = 12;
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkSizes = new Float32Array(sparkCount);
  const sparkData: ClawSlashAnimation['sparkData'] = [];

  for (let i = 0; i < sparkCount; i++) {
    // Spawn along the arc
    const arcT = Math.random();
    const angle = startAngle + arcT * arcAngle;
    const sparkX = x + Math.cos(angle) * radius;
    const sparkY = y + Math.sin(angle) * radius;

    sparkPositions[i * 3] = sparkX;
    sparkPositions[i * 3 + 1] = 45 + Math.random() * 5;  // Slight height variation
    sparkPositions[i * 3 + 2] = -sparkY;

    sparkSizes[i] = 4 + Math.random() * 4;

    // Velocity: fly outward from arc with some randomness
    const speed = 150 + Math.random() * 150;
    sparkData.push({
      x: sparkX,
      y: sparkY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 80,
      vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 80,
      life: 1.0,
    });
  }

  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('size', new THREE.BufferAttribute(sparkSizes, 1));

  // Brighter orange for sparks
  const brightColor = 0xffaa00;
  const sparkMaterial = new THREE.PointsMaterial({
    color: brightColor,
    size: 5,
    transparent: true,
    opacity: 1.0,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });

  const sparkParticles = new THREE.Points(sparkGeometry, sparkMaterial);
  scene.add(sparkParticles);

  return {
    arcLine,
    sparkParticles,
    sparkData,
    startTime: Date.now(),
    duration,
    centerX: x,
    centerY: y,
    baseAngle: direction,
  };
}

/**
 * Animation data for energy whip strike effect (lightning bolt + AoE impact)
 * Used for multi-cell pseudopod attack
 */
export interface EnergyWhipAnimation {
  boltLine: THREE.Line;              // Main lightning bolt line
  impactParticles: THREE.Points;     // AoE explosion particles at target
  boltParticles: THREE.Points;       // Particles along the bolt
  particleData: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
  }>;
  boltData: Array<{
    baseX: number;                   // Original position on bolt
    baseY: number;
    offsetX: number;                 // Current jitter offset
    offsetY: number;
  }>;
  startTime: number;
  duration: number;
  strikerX: number;
  strikerY: number;
  targetX: number;
  targetY: number;
  aoeRadius: number;
  colorHex: number;
}

/**
 * Spawn energy whip strike - lightning bolt from striker to target with AoE impact
 * Creates dramatic visual: jagged bolt + explosive impact particles
 * @param totalDrained - Amount of energy drained (scales effect intensity)
 */
export function spawnEnergyWhipStrike(
  scene: THREE.Scene,
  strikerX: number,
  strikerY: number,
  targetX: number,
  targetY: number,
  aoeRadius: number,
  colorHex: number,
  totalDrained: number
): EnergyWhipAnimation {
  // Effect duration: 400ms for quick, punchy feel
  const duration = 400;
  // Scale particle count based on energy drained (more dramatic when more energy stolen)
  const baseParticleCount = 40;
  const particleCount = Math.min(80, baseParticleCount + Math.floor(totalDrained / 5));

  // Calculate bolt direction
  const dx = targetX - strikerX;
  const dy = targetY - strikerY;

  // ============================================
  // 1. LIGHTNING BOLT LINE - jagged path from striker to target
  // ============================================
  const boltSegments = 12; // Number of segments in bolt (more = more jagged)
  const boltPoints: THREE.Vector3[] = [];
  const boltData: EnergyWhipAnimation['boltData'] = [];

  for (let i = 0; i <= boltSegments; i++) {
    const t = i / boltSegments;
    // Base position along line
    const baseX = strikerX + dx * t;
    const baseY = strikerY + dy * t;

    // Perpendicular offset for jaggedness (less at endpoints, more in middle)
    // Max offset: 20px creates visible zigzag without being chaotic
    const offsetScale = Math.sin(t * Math.PI) * 20;
    const offsetX = (i === 0 || i === boltSegments) ? 0 : (Math.random() - 0.5) * offsetScale * 2;
    const offsetY = (i === 0 || i === boltSegments) ? 0 : (Math.random() - 0.5) * offsetScale * 2;

    // XZ plane: X=game X, Y=height, Z=-game Y
    boltPoints.push(new THREE.Vector3(
      baseX + offsetX,
      0.4, // Height above ground
      -(baseY + offsetY)
    ));

    boltData.push({ baseX, baseY, offsetX, offsetY });
  }

  const boltGeometry = new THREE.BufferGeometry().setFromPoints(boltPoints);
  const boltMaterial = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 1.0,
    linewidth: 3, // Note: linewidth > 1 only works on some systems
  });
  const boltLine = new THREE.Line(boltGeometry, boltMaterial);
  scene.add(boltLine);

  // ============================================
  // 2. BOLT PARTICLES - sparks along the lightning
  // ============================================
  const boltParticleCount = 20;
  const boltParticleGeometry = new THREE.BufferGeometry();
  const boltPositions = new Float32Array(boltParticleCount * 3);
  const boltSizes = new Float32Array(boltParticleCount);

  for (let i = 0; i < boltParticleCount; i++) {
    // Random position along bolt
    const t = Math.random();
    const px = strikerX + dx * t + (Math.random() - 0.5) * 15;
    const py = strikerY + dy * t + (Math.random() - 0.5) * 15;

    boltPositions[i * 3] = px;
    boltPositions[i * 3 + 1] = 0.5; // Height
    boltPositions[i * 3 + 2] = -py;

    boltSizes[i] = 4 + Math.random() * 4;
  }

  boltParticleGeometry.setAttribute('position', new THREE.BufferAttribute(boltPositions, 3));
  boltParticleGeometry.setAttribute('size', new THREE.BufferAttribute(boltSizes, 1));

  const boltParticleMaterial = new THREE.PointsMaterial({
    color: colorHex,
    size: 5,
    transparent: true,
    opacity: 1.0,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });

  const boltParticles = new THREE.Points(boltParticleGeometry, boltParticleMaterial);
  scene.add(boltParticles);

  // ============================================
  // 3. IMPACT PARTICLES - explosion at target location
  // ============================================
  const impactGeometry = new THREE.BufferGeometry();
  const impactPositions = new Float32Array(particleCount * 3);
  const impactSizes = new Float32Array(particleCount);
  const particleData: EnergyWhipAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    // Start at impact point
    impactPositions[i * 3] = targetX;
    impactPositions[i * 3 + 1] = 0.3; // Height
    impactPositions[i * 3 + 2] = -targetY;

    impactSizes[i] = 4 + Math.random() * 6;

    // Radial burst velocity - spread within AoE radius
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 200; // px/sec

    particleData.push({
      x: targetX,
      y: targetY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
    });
  }

  impactGeometry.setAttribute('position', new THREE.BufferAttribute(impactPositions, 3));
  impactGeometry.setAttribute('size', new THREE.BufferAttribute(impactSizes, 1));

  // Brighter version of color for impact
  const r = Math.min(255, ((colorHex >> 16) & 0xff) + 50);
  const g = Math.min(255, ((colorHex >> 8) & 0xff) + 50);
  const b = Math.min(255, (colorHex & 0xff) + 50);
  const brightColor = (r << 16) | (g << 8) | b;

  const impactMaterial = new THREE.PointsMaterial({
    color: brightColor,
    size: 6,
    transparent: true,
    opacity: 1.0,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });

  const impactParticles = new THREE.Points(impactGeometry, impactMaterial);
  scene.add(impactParticles);

  return {
    boltLine,
    impactParticles,
    boltParticles,
    particleData,
    boltData,
    startTime: Date.now(),
    duration,
    strikerX,
    strikerY,
    targetX,
    targetY,
    aoeRadius,
    colorHex,
  };
}

export function spawnMeleeArc(
  scene: THREE.Scene,
  x: number,
  y: number,
  attackType: 'swipe' | 'thrust',
  directionX: number,
  directionY: number,
  colorHex: number = 0xff6666
): MeleeArcAnimation {
  // Much more particles for intense effect
  const particleCount = attackType === 'swipe' ? 150 : 80;
  const trailCount = attackType === 'swipe' ? 100 : 50;
  const sparkCount = attackType === 'swipe' ? 40 : 20;
  const duration = 300; // Slightly longer for visual impact
  const initialRadius = 210;  // Min range (starts outside player edge)
  const maxRadius = 512;      // Max range (30% smaller)

  // Calculate arc parameters
  const arcAngle = attackType === 'swipe' ? (Math.PI / 2) : (Math.PI / 6);
  const baseAngle = Math.atan2(directionY, directionX);
  const halfArc = arcAngle / 2;

  // Extract RGB components for color variations
  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;
  // Brighter version of the color
  const brightColor = ((Math.min(255, r + 100) << 16) | (Math.min(255, g + 100) << 8) | Math.min(255, b + 100));

  // ============================================
  // 1. SOLID ARC MESH - The main visual impact
  // ============================================
  const arcShape = new THREE.Shape();
  const segments = 32;

  // Start at inner arc
  const startAngle = baseAngle - halfArc;
  arcShape.moveTo(
    Math.cos(startAngle) * initialRadius,
    Math.sin(startAngle) * initialRadius
  );

  // Draw inner arc
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * arcAngle;
    arcShape.lineTo(
      Math.cos(angle) * initialRadius,
      Math.sin(angle) * initialRadius
    );
  }

  // Draw outer arc (reverse)
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const angle = startAngle + t * arcAngle;
    arcShape.lineTo(
      Math.cos(angle) * maxRadius,
      Math.sin(angle) * maxRadius
    );
  }

  arcShape.closePath();

  const arcGeometry = new THREE.ShapeGeometry(arcShape);
  const arcMaterial = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const arcMesh = new THREE.Mesh(arcGeometry, arcMaterial);
  // Rotate to XZ plane and position
  arcMesh.rotation.x = -Math.PI / 2;
  arcMesh.position.set(x, 1, -y);
  scene.add(arcMesh);

  // ============================================
  // 2. MAIN PARTICLES - Bright edge particles
  // ============================================
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: MeleeArcAnimation['particleData'] = [];

  for (let i = 0; i < particleCount; i++) {
    const arcProgress = (i / (particleCount - 1)) - 0.5;
    const angle = baseAngle + arcProgress * arcAngle;
    // Distribute along the arc width (inner to outer)
    const radiusOffset = Math.random();
    const startRadius = initialRadius + radiusOffset * (maxRadius - initialRadius);

    positions[i * 3] = x + Math.cos(angle) * startRadius;
    positions[i * 3 + 1] = 0.5 + Math.random() * 2; // Vary height
    positions[i * 3 + 2] = -(y + Math.sin(angle) * startRadius);

    // Color variation - mix between base and bright
    const colorMix = Math.random();
    colors[i * 3] = (r / 255) * (1 - colorMix) + (Math.min(255, r + 100) / 255) * colorMix;
    colors[i * 3 + 1] = (g / 255) * (1 - colorMix) + (Math.min(255, g + 100) / 255) * colorMix;
    colors[i * 3 + 2] = (b / 255) * (1 - colorMix) + (Math.min(255, b + 100) / 255) * colorMix;

    sizes[i] = 8 + Math.random() * 8; // Larger particles

    const radiusSpeed = (maxRadius - initialRadius) / (duration / 1000) * (0.8 + Math.random() * 0.4);

    particleData.push({
      angle,
      radius: startRadius,
      radiusSpeed,
      life: 1.0,
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 10,
    transparent: true,
    opacity: 1,
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // ============================================
  // 3. TRAIL PARTICLES - Follow behind the arc
  // ============================================
  const trailGeometry = new THREE.BufferGeometry();
  const trailPositions = new Float32Array(trailCount * 3);
  const trailColors = new Float32Array(trailCount * 3);
  const trailSizes = new Float32Array(trailCount);
  const trailData: MeleeArcAnimation['trailData'] = [];

  for (let i = 0; i < trailCount; i++) {
    const arcProgress = (i / (trailCount - 1)) - 0.5;
    const angle = baseAngle + arcProgress * arcAngle;
    // Start behind the main arc (smaller radius)
    const startRadius = initialRadius * 0.7 + Math.random() * initialRadius * 0.3;

    trailPositions[i * 3] = x + Math.cos(angle) * startRadius;
    trailPositions[i * 3 + 1] = 0.3 + Math.random();
    trailPositions[i * 3 + 2] = -(y + Math.sin(angle) * startRadius);

    // Dimmer color for trails
    trailColors[i * 3] = r / 255 * 0.6;
    trailColors[i * 3 + 1] = g / 255 * 0.6;
    trailColors[i * 3 + 2] = b / 255 * 0.6;

    trailSizes[i] = 4 + Math.random() * 4;

    trailData.push({
      angle,
      radius: startRadius,
      radiusSpeed: (maxRadius - startRadius) / (duration / 1000) * (0.6 + Math.random() * 0.4),
      life: 1.0,
    });
  }

  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  trailGeometry.setAttribute('size', new THREE.BufferAttribute(trailSizes, 1));

  const trailMaterial = new THREE.PointsMaterial({
    size: 6,
    transparent: true,
    opacity: 0.6,
    vertexColors: true,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });

  const trailParticles = new THREE.Points(trailGeometry, trailMaterial);
  scene.add(trailParticles);

  // ============================================
  // 4. SPARK PARTICLES - Fly off the arc edges
  // ============================================
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkSizes = new Float32Array(sparkCount);
  const sparkData: MeleeArcAnimation['sparkData'] = [];

  for (let i = 0; i < sparkCount; i++) {
    // Spawn at random points along the outer edge
    const arcProgress = Math.random() - 0.5;
    const angle = baseAngle + arcProgress * arcAngle;
    const radius = maxRadius + Math.random() * 20;

    const sparkX = x + Math.cos(angle) * radius;
    const sparkY = y + Math.sin(angle) * radius;

    sparkPositions[i * 3] = sparkX;
    sparkPositions[i * 3 + 1] = 1 + Math.random() * 3;
    sparkPositions[i * 3 + 2] = -sparkY;

    sparkSizes[i] = 3 + Math.random() * 5;

    // Velocity - fly outward and slightly random
    const speed = 300 + Math.random() * 200;
    sparkData.push({
      x: sparkX,
      y: sparkY,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 100,
      vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 100,
      life: 1.0,
    });
  }

  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('size', new THREE.BufferAttribute(sparkSizes, 1));

  const sparkMaterial = new THREE.PointsMaterial({
    color: brightColor,
    size: 6,
    transparent: true,
    opacity: 1,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
  });

  const sparkParticles = new THREE.Points(sparkGeometry, sparkMaterial);
  scene.add(sparkParticles);

  // ============================================
  // 5. DEBUG HITBOX (green outline)
  // ============================================
  const hitboxPoints: THREE.Vector3[] = [];
  const minRange = 400;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = baseAngle - halfArc + t * arcAngle;
    hitboxPoints.push(new THREE.Vector3(
      x + Math.cos(angle) * minRange,
      0.5,
      -(y + Math.sin(angle) * minRange)
    ));
  }

  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const angle = baseAngle - halfArc + t * arcAngle;
    hitboxPoints.push(new THREE.Vector3(
      x + Math.cos(angle) * maxRadius,
      0.5,
      -(y + Math.sin(angle) * maxRadius)
    ));
  }

  hitboxPoints.push(hitboxPoints[0].clone());

  const hitboxGeometry = new THREE.BufferGeometry().setFromPoints(hitboxPoints);
  const hitboxMaterial = new THREE.LineBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
  });
  const hitboxMesh = new THREE.Line(hitboxGeometry, hitboxMaterial);
  scene.add(hitboxMesh);

  return {
    particles,
    trailParticles,
    sparkParticles,
    arcMesh,
    hitboxMesh,
    particleData,
    trailData,
    sparkData,
    startTime: Date.now(),
    duration,
    centerX: x,
    centerY: y,
    baseAngle,
    arcAngle,
    colorHex,
  };
}
