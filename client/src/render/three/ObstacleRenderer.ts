// ============================================
// Obstacle Renderer
// Creates and animates gravity well visuals
// Includes influence rings, event horizon, vortex, and accretion disk
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';

/**
 * Particle data for accretion disk animation
 */
export interface AccretionParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

/**
 * Create a complete gravity well obstacle visual group
 * Includes: outer influence ring, middle ring (3x nutrient zone), event horizon sphere,
 * vortex particles/line, singularity core, and accretion disk particles
 *
 * @param position - Obstacle position {x, y}
 * @param radius - Outer influence radius
 * @returns Object containing the group and particle data for animation
 */
export function createObstacle(
  position: { x: number; y: number },
  radius: number
): { group: THREE.Group; particles: AccretionParticle[]; vortexSpeed: number } {
  const group = new THREE.Group();
  group.position.set(position.x, position.y, -0.4);

  // === LAYER 1: OUTER INFLUENCE ZONE (safe-ish, shows gravity) ===
  const ringWidth = 3; // Thin ring width in pixels
  const outerGeometry = new THREE.RingGeometry(radius - ringWidth, radius, 64);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x6644ff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true, // Enable depth testing so rings get occluded properly
  });
  const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
  outerRing.position.z = 0; // Relative to group
  group.add(outerRing);

  // === LAYER 2: MIDDLE RING (marks 3x gold nutrient spawn zone at 60% radius) ===
  const middleRadius = radius * 0.6;
  const middleGeometry = new THREE.RingGeometry(middleRadius - ringWidth, middleRadius, 64);
  const middleMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff, // Cyan to match nutrient indicators
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true, // Enable depth testing so rings get occluded properly
  });
  const middleRing = new THREE.Mesh(middleGeometry, middleMaterial);
  middleRing.position.z = 0; // Same plane as outer
  group.add(middleRing);

  // === LAYER 3: EVENT HORIZON (danger zone, inescapable) ===
  const horizonGeometry = new THREE.SphereGeometry(GAME_CONFIG.OBSTACLE_EVENT_HORIZON, 32, 32);
  const horizonMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff0088,
    transparent: true,
    opacity: 0.2, // Reduced from 0.35
    emissive: 0xff0088,
    emissiveIntensity: 0.6,
    roughness: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false, // Revert to false to prevent rendering under grid
  });
  const horizonSphere = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizonSphere.position.z = 0.05; // Slightly forward
  horizonSphere.userData.isEventHorizon = true; // Tag for pulsing animation
  group.add(horizonSphere);

  // === VORTEX EFFECT: Spiral swirl inward ===
  const vortexParticleCount = 100; // Total particles in spiral
  const vortexGeometry = new THREE.BufferGeometry();
  const vortexPositions = new Float32Array(vortexParticleCount * 3);
  const vortexSizes = new Float32Array(vortexParticleCount);

  // Create spiral vortex pattern
  for (let i = 0; i < vortexParticleCount; i++) {
    const progress = i / vortexParticleCount; // 0 to 1 (outer to inner)

    // Spiral inward: radius decreases as we progress (start at 95%, end at 35%)
    const vortexRadius = GAME_CONFIG.OBSTACLE_EVENT_HORIZON * (0.95 - progress * 0.6); // 95% -> 35% radius

    // Angle increases as we spiral inward (creates the swirl)
    const spiralTurns = 3; // Number of full rotations from edge to center
    const angle = progress * spiralTurns * Math.PI * 2;

    vortexPositions[i * 3] = Math.cos(angle) * vortexRadius;
    vortexPositions[i * 3 + 1] = Math.sin(angle) * vortexRadius;
    vortexPositions[i * 3 + 2] = 0; // Flat on horizon plane

    // Particles get larger as they spiral inward (visual emphasis)
    vortexSizes[i] = 2.0 + progress * 3.0; // 2px -> 5px
  }

  vortexGeometry.setAttribute('position', new THREE.BufferAttribute(vortexPositions, 3));
  vortexGeometry.setAttribute('size', new THREE.BufferAttribute(vortexSizes, 1));

  const vortexMaterial = new THREE.PointsMaterial({
    color: 0xff00ff, // Bright magenta
    size: 4.0,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const vortexSpeed = 0.3 + Math.random() * 0.3; // Random rotation speed per obstacle

  const vortexParticles = new THREE.Points(vortexGeometry, vortexMaterial);
  vortexParticles.position.z = 0.06; // Just in front of horizon sphere
  vortexParticles.userData.isVortex = true; // Tag for rotation animation
  vortexParticles.userData.vortexSpeed = vortexSpeed;
  group.add(vortexParticles);

  // === VORTEX LINE: Connect particles with continuous spiral line ===
  const vortexLineGeometry = new THREE.BufferGeometry();
  vortexLineGeometry.setAttribute('position', new THREE.BufferAttribute(vortexPositions, 3)); // Reuse same positions

  const vortexLineMaterial = new THREE.LineBasicMaterial({
    color: 0xff00ff, // Bright magenta
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const vortexLine = new THREE.Line(vortexLineGeometry, vortexLineMaterial);
  vortexLine.position.z = 0.06; // Same depth as particles
  vortexLine.userData.isVortex = true; // Tag for rotation animation
  vortexLine.userData.vortexSpeed = vortexSpeed; // Same rotation speed
  group.add(vortexLine);

  // === LAYER 4: SINGULARITY CORE (INSTANT DEATH) ===
  const coreGeometry = new THREE.SphereGeometry(GAME_CONFIG.OBSTACLE_CORE_RADIUS, 32, 32);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a0011,
    emissive: 0xff00ff,
    emissiveIntensity: 3.0,
    roughness: 0.3,
    depthWrite: false,
    depthTest: true, // Enable depth testing for proper occlusion
  });
  const coreSphere = new THREE.Mesh(coreGeometry, coreMaterial);
  coreSphere.position.z = 0.1; // Most forward
  coreSphere.userData.isSingularityCore = true; // Tag for rapid pulsing
  group.add(coreSphere);

  // === PARTICLE SYSTEM: ACCRETION DISK (spiraling inward) ===
  const particleCount = 150;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  const particles: AccretionParticle[] = [];

  for (let i = 0; i < particleCount; i++) {
    // Random point in spherical shell (uniform distribution)
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = radius * 0.7 + Math.random() * radius * 0.3; // Start in outer 30%

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi) * 0.3; // Flatten z to create disk shape

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Initial color: blue-purple (outer edge)
    colors[i * 3] = 0.4; // R
    colors[i * 3 + 1] = 0.27; // G
    colors[i * 3 + 2] = 1.0; // B

    sizes[i] = 2.0 + Math.random() * 2.0;

    // Random initial velocity (slight tangential + inward)
    const speed = 20 + Math.random() * 30; // pixels per second
    particles.push({
      x,
      y,
      z,
      vx: -y / r * speed * 0.3, // Tangential (perpendicular to radius)
      vy: x / r * speed * 0.3,
      vz: 0,
      life: Math.random() * 5, // Stagger particles
      maxLife: 5.0, // 5 seconds to reach core
    });
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particleMaterial = new THREE.PointsMaterial({
    size: 3.0,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    depthWrite: false,
  });

  const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  particleSystem.position.z = 0; // Same depth as outer sphere
  group.add(particleSystem);

  return { group, particles, vortexSpeed };
}

/**
 * Update obstacle visual animations (pulsing, vortex rotation, accretion disk)
 *
 * @param group - The obstacle THREE.Group
 * @param particleData - Array of accretion particle data
 * @param obstacleRadius - Radius of the obstacle
 * @param pulsePhase - Random phase offset for pulsing
 * @param dt - Delta time in milliseconds
 */
export function updateObstacleAnimation(
  group: THREE.Group,
  particleData: AccretionParticle[],
  obstacleRadius: number,
  pulsePhase: number,
  dt: number
): void {
  const deltaSeconds = dt / 1000;
  const time = Date.now() * 0.001; // Time in seconds

  // === PULSING ANIMATION ===

  // Event Horizon (Layer 3): Gentle breathing
  const horizonSphere = group.children[2] as THREE.Mesh;
  if (horizonSphere && horizonSphere.userData.isEventHorizon) {
    const horizonPulseSpeed = 2.0; // Slow, ominous breathing
    const horizonPulseAmount = 0.02; // Very subtle scale change (0.98-1.02)
    const horizonScale = 1.0 + Math.sin(time * horizonPulseSpeed + pulsePhase) * horizonPulseAmount;
    horizonSphere.scale.set(horizonScale, horizonScale, horizonScale);
  }

  // Vortex Particles & Line (Layer 3.5): Rotate to create whirlpool effect
  const vortexParticles = group.children[3] as THREE.Points;
  const vortexLine = group.children[4] as THREE.Line;
  if (vortexParticles && vortexParticles.userData.isVortex) {
    const rotationSpeed = vortexParticles.userData.vortexSpeed || 0.5;
    vortexParticles.rotation.z += rotationSpeed * deltaSeconds; // Continuous rotation
  }
  if (vortexLine && vortexLine.userData.isVortex) {
    const rotationSpeed = vortexLine.userData.vortexSpeed || 0.5;
    vortexLine.rotation.z += rotationSpeed * deltaSeconds; // Continuous rotation (same as particles)
  }

  // Singularity Core (Layer 4): Rapid pulsing
  const coreSphere = group.children[5] as THREE.Mesh;
  if (coreSphere && coreSphere.userData.isSingularityCore) {
    const corePulseSpeed = 3.5; // Fast, menacing heartbeat
    const coreEmissiveBase = 3.0;
    const coreEmissiveRange = 0.5; // Oscillate 2.5-3.5
    const coreMaterial = coreSphere.material as THREE.MeshStandardMaterial;
    coreMaterial.emissiveIntensity = coreEmissiveBase + Math.sin(time * corePulseSpeed + pulsePhase) * coreEmissiveRange;
  }

  // === ACCRETION DISK PARTICLES ===
  const particleSystem = group.children[6] as THREE.Points;
  if (particleSystem && particleData) {
    const positions = particleSystem.geometry.attributes.position.array as Float32Array;
    const colors = particleSystem.geometry.attributes.color.array as Float32Array;
    const sizes = particleSystem.geometry.attributes.size.array as Float32Array;

    // Update each particle
    for (let i = 0; i < particleData.length; i++) {
      const p = particleData[i];

      // Age the particle
      p.life += deltaSeconds;

      // Distance from center
      const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);

      // Spiral inward (gravity acceleration toward core)
      // Speed increases as distance decreases (inverse relationship)
      const gravityStrength = 200; // Base acceleration toward core
      const speedFactor = 1.0 + (1.0 - dist / obstacleRadius) * 3.0; // 1x at edge, 4x near core
      const dx = -p.x / dist;
      const dy = -p.y / dist;
      const dz = -p.z / dist;

      p.vx += dx * gravityStrength * speedFactor * deltaSeconds;
      p.vy += dy * gravityStrength * speedFactor * deltaSeconds;
      p.vz += dz * gravityStrength * speedFactor * deltaSeconds;

      // Apply velocity
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;
      p.z += p.vz * deltaSeconds;

      // Particle reached singularity core - respawn at outer edge
      if (dist < GAME_CONFIG.OBSTACLE_CORE_RADIUS || p.life > p.maxLife) {
        // Respawn at random point in outer shell
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = obstacleRadius * 0.7 + Math.random() * obstacleRadius * 0.3;

        p.x = r * Math.sin(phi) * Math.cos(theta);
        p.y = r * Math.sin(phi) * Math.sin(theta);
        p.z = r * Math.cos(phi) * 0.3; // Flatten to disk

        // Reset velocity (tangential motion)
        const speed = 20 + Math.random() * 30;
        p.vx = -p.y / r * speed * 0.3;
        p.vy = p.x / r * speed * 0.3;
        p.vz = 0;

        p.life = 0;
      }

      // Update color based on distance to core (gradient: blue -> magenta -> white-hot)
      const distRatio = dist / obstacleRadius;
      if (distRatio > 0.5) {
        // Outer region: Blue-purple (0.4, 0.27, 1.0)
        colors[i * 3] = 0.4;
        colors[i * 3 + 1] = 0.27;
        colors[i * 3 + 2] = 1.0;
      } else if (distRatio > 0.15) {
        // Middle region: Magenta (1.0, 0.0, 1.0)
        const blend = (0.5 - distRatio) / 0.35; // 0 at outer, 1 at inner
        colors[i * 3] = 0.4 + blend * 0.6; // 0.4 -> 1.0
        colors[i * 3 + 1] = 0.27 - blend * 0.27; // 0.27 -> 0.0
        colors[i * 3 + 2] = 1.0; // Stay at 1.0
      } else {
        // Inner region (near core): White-hot (1.0, 0.8, 1.0)
        const blend = (0.15 - distRatio) / 0.15; // 0 at middle, 1 at core
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = blend * 0.8; // 0.0 -> 0.8
        colors[i * 3 + 2] = 1.0;
      }

      // Size increases as it approaches core (visual emphasis on danger)
      sizes[i] = 2.0 + (1.0 - distRatio) * 3.0; // 2px at edge, 5px at core

      // Update geometry
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    // Mark attributes as needing update
    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.geometry.attributes.color.needsUpdate = true;
    particleSystem.geometry.attributes.size.needsUpdate = true;
  }
}

/**
 * Dispose of obstacle group resources
 *
 * @param group - The obstacle THREE.Group to dispose
 */
export function disposeObstacle(group: THREE.Group): void {
  group.children.forEach(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    } else if (child instanceof THREE.Points) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    } else if (child instanceof THREE.Line) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}
