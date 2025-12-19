// ============================================
// Swarm Mesh - Single source of truth for entropy swarm visuals
// Creates and animates entropy swarm (virus enemy)
// Includes outer sphere, internal particle storm, and orbiting particles
// Used by: SwarmRenderSystem (game), model-viewer.ts (preview)
// ============================================

import * as THREE from 'three';

// ============================================
// VISUAL PARAMETERS
// Note: Currently using hardcoded values below.
// Future tuning pass can wire these constants into the code.
// ============================================
// Outer sphere: color 0xff4400, opacity 0.3, emissive 0.8
// Internal particles: 200 count, color 0xffaa00, opacity 0.8
// Orbiting particles: 6 count, color 0xff0088, size 8
// Chase mode: brighter reds, 1.5x speed
// Disabled mode: grays, low opacity
// ============================================

/**
 * Internal particle data for turbulent storm animation
 */
export interface SwarmInternalParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Orbiting particle animation data
 */
export interface SwarmOrbitingParticle {
  angle: number;
  radius: number;
  speed: number;
}

/**
 * Create a complete entropy swarm visual group
 * Includes: outer sphere boundary, internal particle storm, orbiting particles
 *
 * @param position - Swarm position {x, y}
 * @param size - Swarm radius
 * @returns Object containing the group and particle data for animation
 */
export function createSwarm(
  position: { x: number; y: number },
  size: number
): {
  group: THREE.Group;
  internalParticles: SwarmInternalParticle[];
  orbitingParticles: SwarmOrbitingParticle[];
} {
  const group = new THREE.Group();

  // === OUTER SPHERE (Semi-transparent boundary) ===
  const outerGeometry = new THREE.SphereGeometry(size, 32, 32);
  const outerMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff4400, // Red-orange
    transparent: true,
    opacity: 0.3,
    emissive: 0xff4400,
    emissiveIntensity: 0.8,
    roughness: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false, // Don't write depth (standard for transparent objects)
    depthTest: true, // Allow sphere surface to occlude swarms
  });
  const outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
  group.add(outerSphere);

  // === INTERNAL PARTICLE STORM ===
  const internalParticleCount = 200; // Initial 200 particles per swarm
  const MAX_INTERNAL_PARTICLES = 600; // Pre-allocate for max (grows with absorbed energy)
  const internalGeometry = new THREE.BufferGeometry();
  // Pre-allocate for max particles to avoid geometry recreation
  const internalPositions = new Float32Array(MAX_INTERNAL_PARTICLES * 3);
  const internalSizes = new Float32Array(MAX_INTERNAL_PARTICLES);

  // Random positions inside sphere with random velocities
  const internalParticleData: SwarmInternalParticle[] = [];

  for (let i = 0; i < internalParticleCount; i++) {
    // Random point inside sphere (uniform distribution)
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = Math.cbrt(Math.random()) * size * 0.9; // Cbrt for uniform volume distribution

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    internalPositions[i * 3] = x;
    internalPositions[i * 3 + 1] = y;
    internalPositions[i * 3 + 2] = z;

    internalSizes[i] = 1 + Math.random() * 1.5;

    // Random turbulent velocity (higher speeds for visible chaos)
    const speed = 60 + Math.random() * 80; // 60-140 pixels per second
    const vTheta = Math.random() * Math.PI * 2;
    const vPhi = Math.random() * Math.PI;

    internalParticleData.push({
      x,
      y,
      z,
      vx: speed * Math.sin(vPhi) * Math.cos(vTheta),
      vy: speed * Math.sin(vPhi) * Math.sin(vTheta),
      vz: speed * Math.cos(vPhi),
    });
  }

  internalGeometry.setAttribute('position', new THREE.BufferAttribute(internalPositions, 3));
  internalGeometry.setAttribute('size', new THREE.BufferAttribute(internalSizes, 1));
  // Set initial draw range to actual particle count
  internalGeometry.setDrawRange(0, internalParticleCount);

  const internalMaterial = new THREE.PointsMaterial({
    color: 0xffaa00, // Bright orange/yellow
    size: 2,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending, // Additive for energy feel
    depthWrite: false,
  });

  const internalStorm = new THREE.Points(internalGeometry, internalMaterial);
  group.add(internalStorm);

  // === ORBITING PARTICLES (Keep existing system but reduce count) ===
  const orbitingCount = 6; // Reduced from 30
  const orbitingGeometry = new THREE.BufferGeometry();
  const orbitingPositions = new Float32Array(orbitingCount * 3);

  // Store animation data for each orbiting particle (angle, radius, rotation speed)
  const orbitingAnimData: SwarmOrbitingParticle[] = [];

  // Scatter particles around swarm with animation data
  for (let i = 0; i < orbitingCount; i++) {
    const angle = (i / orbitingCount) * Math.PI * 2; // Evenly spaced
    const radius = size * 1.1; // Just outside sphere
    const speed = (Math.random() - 0.5) * 2; // Random rotation speed (-1 to 1 rad/s)

    orbitingPositions[i * 3] = Math.cos(angle) * radius;
    orbitingPositions[i * 3 + 1] = Math.sin(angle) * radius;
    orbitingPositions[i * 3 + 2] = 0;

    orbitingAnimData.push({ angle, radius, speed });
  }

  orbitingGeometry.setAttribute('position', new THREE.BufferAttribute(orbitingPositions, 3));

  const orbitingMaterial = new THREE.PointsMaterial({
    color: 0xff0088,
    size: 8, // Larger particles for orbiting
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: false,
    depthWrite: false,
  });

  const orbitingParticles = new THREE.Points(orbitingGeometry, orbitingMaterial);
  group.add(orbitingParticles);

  // XZ plane: X=game X, Y=height, Z=-game Y
  group.position.set(position.x, 0.2, -position.y);

  // Rotate group so orbiting particles orbit in XZ plane when viewed from above
  // Camera looks down Y axis, so rotate -90° around X to flip local XY to world XZ
  group.rotation.x = -Math.PI / 2;

  return {
    group,
    internalParticles: internalParticleData,
    orbitingParticles: orbitingAnimData,
  };
}

/**
 * Update swarm visual state based on swarm behavior state
 *
 * @param group - The swarm THREE.Group
 * @param state - 'patrol' | 'chase' | 'disabled'
 * @param isDisabled - Whether swarm is disabled (hit by EMP)
 */
export function updateSwarmState(group: THREE.Group, state: string, isDisabled: boolean): void {
  const outerSphere = group.children[0] as THREE.Mesh;
  const outerMaterial = outerSphere.material as THREE.MeshPhysicalMaterial;
  const internalStorm = group.children[1] as THREE.Points;
  const internalMaterial = internalStorm.material as THREE.PointsMaterial;
  const orbitingParticles = group.children[2] as THREE.Points;
  const orbitingMaterial = orbitingParticles.material as THREE.PointsMaterial;

  if (isDisabled) {
    // Disabled: gray/static appearance (paralyzed)
    outerMaterial.color.setHex(0x444444); // Dark gray
    outerMaterial.emissive.setHex(0x666666); // Dim gray emissive
    outerMaterial.emissiveIntensity = 0.2;
    outerMaterial.opacity = 0.2;
    internalMaterial.color.setHex(0x888888); // Mid gray
    internalMaterial.opacity = 0.3; // Very dim
    orbitingMaterial.color.setHex(0x555555); // Dark gray
    orbitingMaterial.opacity = 0.4;
  } else if (state === 'chase') {
    // Chase mode: brighter, more aggressive
    outerMaterial.color.setHex(0xff0044); // Hot red
    outerMaterial.emissive.setHex(0xff4400); // Reset emissive color
    outerMaterial.emissiveIntensity = 1.2;
    outerMaterial.opacity = 0.45;
    internalMaterial.color.setHex(0xff6600); // Bright orange-red
    internalMaterial.opacity = 0.8; // Full opacity
    orbitingMaterial.color.setHex(0xff0044);
    orbitingMaterial.opacity = 0.9; // Full opacity
  } else {
    // Patrol mode: dimmer, calmer
    outerMaterial.color.setHex(0xff4400); // Red-orange
    outerMaterial.emissive.setHex(0xff4400); // Reset emissive color
    outerMaterial.emissiveIntensity = 0.8;
    outerMaterial.opacity = 0.3;
    internalMaterial.color.setHex(0xffaa00); // Orange-yellow
    internalMaterial.opacity = 0.8; // Full opacity
    orbitingMaterial.color.setHex(0xff0088);
    orbitingMaterial.opacity = 0.9; // Full opacity
  }
}

/**
 * Update swarm particle animations (pulsing, internal storm, orbiting)
 *
 * @param group - The swarm THREE.Group
 * @param internalParticles - Array of internal particle data
 * @param orbitingParticles - Array of orbiting particle animation data
 * @param swarmState - 'patrol' | 'chase'
 * @param pulsePhase - Random phase offset for pulsing
 * @param dt - Delta time in milliseconds
 * @param energyRatio - 0-1 ratio of absorbed energy (0 = base, 1 = max 500)
 * @param isDisabled - Whether swarm is disabled (hit by EMP) - freezes all animations
 */
export function updateSwarmAnimation(
  group: THREE.Group,
  internalParticles: SwarmInternalParticle[],
  orbitingParticles: SwarmOrbitingParticle[],
  swarmState: string,
  pulsePhase: number,
  dt: number,
  energyRatio: number = 0,
  isDisabled: boolean = false
): void {
  // === DISABLED STATE: FREEZE ALL ANIMATIONS ===
  // When hit by EMP, swarm becomes completely frozen (gray colors set by updateSwarmState)
  if (isDisabled) {
    return; // Skip all animation updates - particles stay where they are
  }

  const deltaSeconds = dt / 1000;
  const time = performance.now() * 0.001; // Time in seconds

  // === ENERGY-BASED MODIFIERS ===
  // Fat swarms have faster, more chaotic animations (dialed back 40%)
  const energySpeedBoost = 1 + energyRatio * 0.9; // 1x to 1.9x speed at max energy (was 2.5x)
  const energyTurbulenceBoost = 1 + energyRatio * 1.2; // 1x to 2.2x turbulence (was 3x)

  // === COLOR SHIFT ===
  // Gradual shift from orange toward red-orange as energy grows (dialed back)
  // Base orange: 0xff4400, Max: 0xff2200 (not pure red)
  const redShift = Math.floor(0x44 * (1 - energyRatio * 0.5)); // Only shift halfway to red
  const energyColor = 0xff0000 + (redShift << 8); // Shift green channel

  // === PULSING ANIMATION (Outer Sphere) ===
  const outerSphere = group.children[0] as THREE.Mesh;
  const outerMaterial = outerSphere.material as THREE.MeshPhysicalMaterial;

  // Breathing effect: scale oscillates, faster and more intense with energy (dialed back)
  const basePulseSpeed = swarmState === 'chase' ? 3.0 : 2.0;
  const pulseSpeed = basePulseSpeed * (1 + energyRatio * 0.5); // Gentler speed increase (was energySpeedBoost)
  const pulseAmount = 0.05 + energyRatio * 0.02; // 0.05 to 0.07 (was 0.08)
  const scale = 1.0 + Math.sin(time * pulseSpeed + pulsePhase) * pulseAmount;
  outerSphere.scale.set(scale, scale, scale);

  // Apply color shift (only when not disabled)
  if (swarmState !== 'disabled') {
    outerMaterial.color.setHex(energyColor);
    outerMaterial.emissive.setHex(energyColor);
  }

  // Flicker emissive intensity for unstable energy feel (dialed back 40%)
  const baseIntensity = swarmState === 'chase' ? 1.2 : 0.8;
  const intensityBoost = energyRatio * 0.3; // Extra glow with energy (was 0.5)
  const flickerAmount = 0.15 + energyRatio * 0.15; // 0.15 to 0.3 (was 0.2 to 0.5)
  outerMaterial.emissiveIntensity =
    baseIntensity +
    intensityBoost +
    Math.sin(time * 4 * (1 + energyRatio * 0.5) + pulsePhase) * flickerAmount;

  // === INTERNAL PARTICLE STORM ===
  const internalStorm = group.children[1] as THREE.Points;
  if (internalStorm && internalParticles) {
    const positions = internalStorm.geometry.attributes.position.array as Float32Array;

    // Get swarm size from outer sphere geometry
    const swarmSize = (outerSphere.geometry as THREE.SphereGeometry).parameters.radius;
    const baseSpeedMultiplier = swarmState === 'chase' ? 1.5 : 1.0;
    // Energy boost stacks with chase mode for increasingly frantic particle storm
    const speedMultiplier = baseSpeedMultiplier * energySpeedBoost;

    // Update each internal particle with turbulent motion
    for (let i = 0; i < internalParticles.length; i++) {
      const p = internalParticles[i];

      // Apply velocity (boosted by energy)
      p.x += p.vx * deltaSeconds * speedMultiplier;
      p.y += p.vy * deltaSeconds * speedMultiplier;
      p.z += p.vz * deltaSeconds * speedMultiplier;

      // Distance from center
      const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);

      // Bounce particles inside sphere (elastic collision with boundary)
      if (dist > swarmSize * 0.85) {
        // Reflect velocity (bounce off boundary)
        const nx = p.x / dist;
        const ny = p.y / dist;
        const nz = p.z / dist;

        // Dot product of velocity and normal
        const dot = p.vx * nx + p.vy * ny + p.vz * nz;

        // Reflect velocity
        p.vx -= 2 * dot * nx;
        p.vy -= 2 * dot * ny;
        p.vz -= 2 * dot * nz;

        // Push particle back inside
        const pushBack = swarmSize * 0.85;
        p.x = nx * pushBack;
        p.y = ny * pushBack;
        p.z = nz * pushBack;
      }

      // Add turbulence (random acceleration for chaotic motion)
      // Energy turbulence boost makes fat swarms more erratic and chaotic
      const turbulence = 150 * speedMultiplier * energyTurbulenceBoost;
      p.vx += (Math.random() - 0.5) * turbulence * deltaSeconds;
      p.vy += (Math.random() - 0.5) * turbulence * deltaSeconds;
      p.vz += (Math.random() - 0.5) * turbulence * deltaSeconds;

      // Damping to prevent runaway speeds but keep it energetic
      // Frame-rate independent: 0.99^60 ≈ 0.55 retained after 1 second at 60fps
      const dampingPerSecond = 0.55; // Velocity retained after 1 second
      const damping = Math.pow(dampingPerSecond, deltaSeconds);
      p.vx *= damping;
      p.vy *= damping;
      p.vz *= damping;

      // Update geometry positions
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    // Mark positions as needing update
    internalStorm.geometry.attributes.position.needsUpdate = true;
  }

  // === ORBITING PARTICLES ===
  const orbitingParticlesMesh = group.children[2] as THREE.Points;
  if (orbitingParticlesMesh && orbitingParticles) {
    const positions = orbitingParticlesMesh.geometry.attributes.position.array as Float32Array;

    // Update each orbiting particle position based on rotation
    for (let i = 0; i < orbitingParticles.length; i++) {
      const data = orbitingParticles[i];

      // Rotate the particle around the swarm center
      // Fat swarms spin their orbiting particles faster
      const baseRotationSpeed = swarmState === 'chase' ? 1.5 : 1.0;
      const rotationSpeed = baseRotationSpeed * energySpeedBoost;
      data.angle += data.speed * deltaSeconds * rotationSpeed;

      // Update position based on new angle
      positions[i * 3] = Math.cos(data.angle) * data.radius;
      positions[i * 3 + 1] = Math.sin(data.angle) * data.radius;
    }

    // Mark positions as needing update
    orbitingParticlesMesh.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * Dispose of swarm group resources
 *
 * @param group - The swarm THREE.Group to dispose
 */
export function disposeSwarm(group: THREE.Group): void {
  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}
