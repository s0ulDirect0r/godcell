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

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0.2; // Above everything else

    sizes[i] = 3 + Math.random() * 4;

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

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0.2; // Above everything else

    sizes[i] = 2 + Math.random() * 3; // Slightly smaller than death particles

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

    positions[i * 3] = x + Math.cos(angle) * startRadius;
    positions[i * 3 + 1] = y + Math.sin(angle) * startRadius;
    positions[i * 3 + 2] = 0.2; // Above everything else

    sizes[i] = 2 + Math.random() * 2;

    // Particle will orbit outward then inward (controlled by update function)
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

    positions[i * 3] = x + Math.cos(angle) * initialRadius;
    positions[i * 3 + 1] = y + Math.sin(angle) * initialRadius;
    positions[i * 3 + 2] = 0.3; // Above everything else (higher than evolution particles)

    sizes[i] = 3 + Math.random() * 2;

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

    positions[i * 3] = startX;
    positions[i * 3 + 1] = startY;
    // z=0.15: Render below entities (z=0.2) so particles appear to converge "under" the spawning entity
    positions[i * 3 + 2] = 0.15;

    // Particle size: 2-5 pixels, small enough to not obscure entity but visible enough to notice
    sizes[i] = 2 + Math.random() * 3;

    // Velocity toward center: speed calculated so particles reach center exactly when animation ends
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

    // Initial position at center
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0.2; // Same layer as swarms

    // Random sizes (mix of large and small)
    sizes[i] = 2 + Math.random() * 6;

    // Explosion velocity - fast outward burst
    const speed = 150 + Math.random() * 250; // 150-400 pixels per second
    const vx = speed * Math.sin(phi) * Math.cos(theta);
    const vy = speed * Math.sin(phi) * Math.sin(theta);
    const vz = speed * Math.cos(phi);

    particleData.push({
      x, y, z: 0.2,
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
  }>;
  startTime: number;
  duration: number;
  targetId: string; // Who is receiving energy (for aura trigger)
}

/**
 * Spawn energy transfer particles - fly from source to target
 * Used when collecting nutrients or draining enemies
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
  particleCount: number = 15
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

    positions[i * 3] = startX;
    positions[i * 3 + 1] = startY;
    positions[i * 3 + 2] = 0.25; // Above entities

    sizes[i] = 3 + Math.random() * 2;

    // Stagger particle speeds for wave effect (faster particles arrive first)
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
  };
}
