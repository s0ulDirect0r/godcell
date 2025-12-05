// ============================================
// GravityDistortionMesh - Gravity Well (Black Hole) Mesh
// Single source of truth for gravity distortion visuals
// Used by: ObstacleRenderSystem, model-viewer
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';

// ============================================
// Visual Parameters - TUNE THESE
// ============================================

/** Outer influence ring - marks gravity zone boundary */
const OUTER_RING = {
  color: 0x6644ff,      // Purple
  opacity: 0.5,
  width: 3,             // Ring thickness in pixels
};

/** Middle ring - marks 3x nutrient spawn zone at 60% radius */
const MIDDLE_RING = {
  color: 0x00ffff,      // Cyan
  opacity: 0.6,
  radiusFactor: 0.6,    // Percentage of outer radius
};

/** Event horizon sphere - visual danger zone */
const EVENT_HORIZON = {
  color: 0xff0088,      // Magenta
  opacity: 0.08,        // Very transparent to see core
  emissive: 0xff0088,
  emissiveIntensity: 0.4,
  roughness: 0.8,
};

/** Vortex spiral - rotating particle effect */
const VORTEX = {
  particleCount: 100,
  color: 0xff00ff,      // Bright magenta
  opacity: 0.7,
  size: 4.0,
  spiralTurns: 3,       // Full rotations from edge to center
  minSpeedMultiplier: 0.3,
  maxSpeedMultiplier: 0.6,
};

/** Singularity core - instant death zone */
const SINGULARITY_CORE = {
  baseColor: 0x1a0011,  // Very dark magenta-black
  emissive: 0xff00ff,   // Magenta glow
  emissiveIntensity: -0.5, // Negative = absorbs light, creates void effect
  roughness: 0.3,
  // Animation disabled - inner spark provides visual interest
  pulseSpeed: 0,
  emissiveRange: 0,
};

/** Inner spark - burning red light at singularity center (LETHAL ZONE) */
const INNER_SPARK = {
  color: 0xff2200,        // Deep red-orange
  emissive: 0xff4400,     // Bright orange-red glow
  baseEmissiveIntensity: 2.5,  // Base brightness (very bright)
  maxEmissiveIntensity: 5.0,   // Peak brightness during flicker
  // Radius controlled by GAME_CONFIG.OBSTACLE_SPARK_RADIUS (shared with server death check)
  roughness: 0.1,         // Smooth/shiny for glow
  // Animation - chaotic flicker like a burning ember
  flickerSpeed: 8.0,      // Fast flicker Hz
  flickerSpeed2: 13.0,    // Secondary flicker (creates chaos)
  flickerSpeed3: 21.0,    // Tertiary flicker (more chaos)
};

/** Accretion disk - particles spiraling inward */
const ACCRETION_DISK = {
  particleCount: 150,
  size: 3.0,
  opacity: 0.8,
  // Color gradient (outer to inner)
  outerColor: { r: 0.4, g: 0.27, b: 1.0 },   // Blue-purple
  middleColor: { r: 1.0, g: 0.0, b: 1.0 },   // Magenta
  innerColor: { r: 1.0, g: 0.8, b: 1.0 },    // White-hot
  // Particle lifetime
  maxLife: 5.0,         // Seconds to reach core
};

// ============================================
// Types
// ============================================

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
 * Result from createGravityDistortion - includes animation data
 */
export interface GravityDistortionResult {
  group: THREE.Group;
  particles: AccretionParticle[];
  vortexSpeed: number;
}

// ============================================
// Mesh Creation
// ============================================

/**
 * Create a complete gravity distortion visual
 *
 * Layers (outer to inner):
 * 1. Outer influence ring - purple boundary
 * 2. Middle ring - cyan 3x nutrient zone
 * 3. Event horizon sphere - magenta danger zone
 * 4. Vortex particles + line - spinning spiral
 * 5. Singularity core - dark/glowing death zone
 * 6. Inner spark - burning red light at center
 * 7. Accretion disk - particles spiraling inward
 *
 * @param position - World position {x, y}
 * @param radius - Outer influence radius
 * @returns Group, particle data, and vortex speed for animation
 */
export function createGravityDistortion(
  position: { x: number; y: number },
  radius: number
): GravityDistortionResult {
  const group = new THREE.Group();

  // Position in 3D space (XZ plane: X=game X, Y=height, Z=-game Y)
  group.position.set(position.x, -0.4, -position.y);

  // Rotate so flat elements lie on XZ plane when viewed from above
  group.rotation.x = -Math.PI / 2;

  // === LAYER 1: OUTER INFLUENCE RING ===
  const outerGeometry = new THREE.RingGeometry(
    radius - OUTER_RING.width,
    radius,
    64
  );
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: OUTER_RING.color,
    transparent: true,
    opacity: OUTER_RING.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
  outerRing.position.z = 0;
  group.add(outerRing);

  // === LAYER 2: MIDDLE RING (3x nutrient zone) ===
  const middleRadius = radius * MIDDLE_RING.radiusFactor;
  const middleGeometry = new THREE.RingGeometry(
    middleRadius - OUTER_RING.width,
    middleRadius,
    64
  );
  const middleMaterial = new THREE.MeshBasicMaterial({
    color: MIDDLE_RING.color,
    transparent: true,
    opacity: MIDDLE_RING.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const middleRing = new THREE.Mesh(middleGeometry, middleMaterial);
  middleRing.position.z = 0;
  group.add(middleRing);

  // === LAYER 3: EVENT HORIZON SPHERE ===
  const horizonGeometry = new THREE.SphereGeometry(
    GAME_CONFIG.OBSTACLE_EVENT_HORIZON,
    32,
    32
  );
  const horizonMaterial = new THREE.MeshPhysicalMaterial({
    color: EVENT_HORIZON.color,
    transparent: true,
    opacity: EVENT_HORIZON.opacity,
    emissive: EVENT_HORIZON.emissive,
    emissiveIntensity: EVENT_HORIZON.emissiveIntensity,
    roughness: EVENT_HORIZON.roughness,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const horizonSphere = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizonSphere.position.z = 0.05;
  horizonSphere.userData.isEventHorizon = true;
  group.add(horizonSphere);

  // === LAYER 4: VORTEX SPIRAL ===
  const vortexGeometry = new THREE.BufferGeometry();
  const vortexPositions = new Float32Array(VORTEX.particleCount * 3);
  const vortexSizes = new Float32Array(VORTEX.particleCount);

  for (let i = 0; i < VORTEX.particleCount; i++) {
    const progress = i / VORTEX.particleCount;
    // Spiral inward: 95% -> 35% radius
    const vortexRadius = GAME_CONFIG.OBSTACLE_EVENT_HORIZON * (0.95 - progress * 0.6);
    const angle = progress * VORTEX.spiralTurns * Math.PI * 2;

    vortexPositions[i * 3] = Math.cos(angle) * vortexRadius;
    vortexPositions[i * 3 + 1] = Math.sin(angle) * vortexRadius;
    vortexPositions[i * 3 + 2] = 0;

    // Particles grow as they spiral inward
    vortexSizes[i] = 2.0 + progress * 3.0;
  }

  vortexGeometry.setAttribute('position', new THREE.BufferAttribute(vortexPositions, 3));
  vortexGeometry.setAttribute('size', new THREE.BufferAttribute(vortexSizes, 1));

  const vortexMaterial = new THREE.PointsMaterial({
    color: VORTEX.color,
    size: VORTEX.size,
    transparent: true,
    opacity: VORTEX.opacity,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const vortexSpeed = VORTEX.minSpeedMultiplier +
    Math.random() * (VORTEX.maxSpeedMultiplier - VORTEX.minSpeedMultiplier);

  const vortexParticles = new THREE.Points(vortexGeometry, vortexMaterial);
  vortexParticles.position.z = 0.06;
  vortexParticles.userData.isVortex = true;
  vortexParticles.userData.vortexSpeed = vortexSpeed;
  group.add(vortexParticles);

  // Vortex spiral line (connects particles)
  const vortexLineGeometry = new THREE.BufferGeometry();
  vortexLineGeometry.setAttribute('position', new THREE.BufferAttribute(vortexPositions, 3));
  const vortexLineMaterial = new THREE.LineBasicMaterial({
    color: VORTEX.color,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const vortexLine = new THREE.Line(vortexLineGeometry, vortexLineMaterial);
  vortexLine.position.z = 0.06;
  vortexLine.userData.isVortex = true;
  vortexLine.userData.vortexSpeed = vortexSpeed;
  group.add(vortexLine);

  // === LAYER 5: SINGULARITY CORE ===
  const coreGeometry = new THREE.SphereGeometry(
    GAME_CONFIG.OBSTACLE_CORE_RADIUS,
    32,
    32
  );
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: SINGULARITY_CORE.baseColor,
    emissive: SINGULARITY_CORE.emissive,
    emissiveIntensity: SINGULARITY_CORE.emissiveIntensity,
    roughness: SINGULARITY_CORE.roughness,
    depthWrite: false,
    depthTest: true,
  });
  const coreSphere = new THREE.Mesh(coreGeometry, coreMaterial);
  coreSphere.position.z = 0.1;
  coreSphere.userData.isSingularityCore = true;
  group.add(coreSphere);

  // === LAYER 6: INNER SPARK (burning red light at center - LETHAL ZONE) ===
  const sparkGeometry = new THREE.SphereGeometry(
    GAME_CONFIG.OBSTACLE_SPARK_RADIUS,
    16,
    16
  );
  const sparkMaterial = new THREE.MeshStandardMaterial({
    color: INNER_SPARK.color,
    emissive: INNER_SPARK.emissive,
    emissiveIntensity: INNER_SPARK.baseEmissiveIntensity,
    roughness: INNER_SPARK.roughness,
    depthWrite: false,
    depthTest: true,
  });
  const sparkSphere = new THREE.Mesh(sparkGeometry, sparkMaterial);
  sparkSphere.position.z = 0.12; // Slightly in front of core
  sparkSphere.userData.isInnerSpark = true;
  group.add(sparkSphere);

  // === LAYER 7: ACCRETION DISK PARTICLES ===
  const particleCount = ACCRETION_DISK.particleCount;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  const particles: AccretionParticle[] = [];

  for (let i = 0; i < particleCount; i++) {
    // Random point in spherical shell (outer 30%)
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = radius * 0.7 + Math.random() * radius * 0.3;

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi) * 0.3; // Flatten to disk

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Initial color (outer edge)
    colors[i * 3] = ACCRETION_DISK.outerColor.r;
    colors[i * 3 + 1] = ACCRETION_DISK.outerColor.g;
    colors[i * 3 + 2] = ACCRETION_DISK.outerColor.b;

    sizes[i] = 2.0 + Math.random() * 2.0;

    // Tangential + inward velocity
    const speed = 20 + Math.random() * 30;
    particles.push({
      x, y, z,
      vx: -y / r * speed * 0.3,
      vy: x / r * speed * 0.3,
      vz: 0,
      life: Math.random() * ACCRETION_DISK.maxLife,
      maxLife: ACCRETION_DISK.maxLife,
    });
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particleMaterial = new THREE.PointsMaterial({
    size: ACCRETION_DISK.size,
    sizeAttenuation: false,
    transparent: true,
    opacity: ACCRETION_DISK.opacity,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    depthWrite: false,
  });

  const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  particleSystem.position.z = 0;
  group.add(particleSystem);

  return { group, particles, vortexSpeed };
}

// ============================================
// Animation
// ============================================

/**
 * Update gravity distortion animations (call each frame)
 *
 * Animates:
 * - Event horizon breathing
 * - Vortex rotation
 * - Core pulsing
 * - Inner spark flickering (chaotic red burning light)
 * - Accretion disk particle movement
 *
 * @param group - The gravity distortion THREE.Group
 * @param particleData - Accretion particle state
 * @param radius - Radius for respawn calculations
 * @param pulsePhase - Random offset for desync
 * @param dt - Delta time in milliseconds
 */
export function updateGravityDistortionAnimation(
  group: THREE.Group,
  particleData: AccretionParticle[],
  obstacleRadius: number,
  pulsePhase: number,
  dt: number
): void {
  const deltaSeconds = dt / 1000;
  const time = performance.now() * 0.001;

  // === EVENT HORIZON BREATHING ===
  const horizonSphere = group.children[2] as THREE.Mesh;
  if (horizonSphere?.userData.isEventHorizon) {
    const pulseSpeed = 2.0;
    const pulseAmount = 0.02;
    const scale = 1.0 + Math.sin(time * pulseSpeed + pulsePhase) * pulseAmount;
    horizonSphere.scale.set(scale, scale, scale);
  }

  // === VORTEX ROTATION ===
  const vortexParticles = group.children[3] as THREE.Points;
  const vortexLine = group.children[4] as THREE.Line;

  if (vortexParticles?.userData.isVortex) {
    const speed = vortexParticles.userData.vortexSpeed || 0.5;
    vortexParticles.rotation.z += speed * deltaSeconds;
  }
  if (vortexLine?.userData.isVortex) {
    const speed = vortexLine.userData.vortexSpeed || 0.5;
    vortexLine.rotation.z += speed * deltaSeconds;
  }

  // === SINGULARITY CORE PULSING ===
  const coreSphere = group.children[5] as THREE.Mesh;
  if (coreSphere?.userData.isSingularityCore) {
    const coreMaterial = coreSphere.material as THREE.MeshStandardMaterial;
    coreMaterial.emissiveIntensity = SINGULARITY_CORE.emissiveIntensity +
      Math.sin(time * SINGULARITY_CORE.pulseSpeed + pulsePhase) * SINGULARITY_CORE.emissiveRange;
  }

  // === INNER SPARK FLICKERING ===
  const sparkSphere = group.children[6] as THREE.Mesh;
  if (sparkSphere?.userData.isInnerSpark) {
    const sparkMaterial = sparkSphere.material as THREE.MeshStandardMaterial;
    // Combine multiple sine waves at different frequencies for chaotic flicker
    const flicker1 = Math.sin(time * INNER_SPARK.flickerSpeed + pulsePhase);
    const flicker2 = Math.sin(time * INNER_SPARK.flickerSpeed2 + pulsePhase * 1.7);
    const flicker3 = Math.sin(time * INNER_SPARK.flickerSpeed3 + pulsePhase * 2.3);
    // Combine and normalize to 0-1 range, then map to intensity range
    const combinedFlicker = (flicker1 + flicker2 * 0.5 + flicker3 * 0.3) / 1.8;
    const normalizedFlicker = (combinedFlicker + 1) / 2; // 0-1
    sparkMaterial.emissiveIntensity = INNER_SPARK.baseEmissiveIntensity +
      normalizedFlicker * (INNER_SPARK.maxEmissiveIntensity - INNER_SPARK.baseEmissiveIntensity);
  }

  // === ACCRETION DISK PARTICLES ===
  const particleSystem = group.children[7] as THREE.Points;
  if (particleSystem && particleData) {
    const positions = particleSystem.geometry.attributes.position.array as Float32Array;
    const colors = particleSystem.geometry.attributes.color.array as Float32Array;
    const sizes = particleSystem.geometry.attributes.size.array as Float32Array;

    for (let i = 0; i < particleData.length; i++) {
      const p = particleData[i];
      p.life += deltaSeconds;

      let dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);

      // Spiral inward with gravity
      if (dist > 0.001) {
        const gravityStrength = 200;
        const speedFactor = 1.0 + (1.0 - dist / obstacleRadius) * 3.0;
        const dx = -p.x / dist;
        const dy = -p.y / dist;
        const dz = -p.z / dist;

        p.vx += dx * gravityStrength * speedFactor * deltaSeconds;
        p.vy += dy * gravityStrength * speedFactor * deltaSeconds;
        p.vz += dz * gravityStrength * speedFactor * deltaSeconds;
      }

      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;
      p.z += p.vz * deltaSeconds;

      // Respawn at edge when reaching inner spark (lethal center)
      if (dist < GAME_CONFIG.OBSTACLE_SPARK_RADIUS || p.life > p.maxLife) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const r = obstacleRadius * 0.7 + Math.random() * obstacleRadius * 0.3;

        p.x = r * Math.sin(phi) * Math.cos(theta);
        p.y = r * Math.sin(phi) * Math.sin(theta);
        p.z = r * Math.cos(phi) * 0.3;

        const speed = 20 + Math.random() * 30;
        const invR = r > 0.001 ? 1 / r : 0;
        p.vx = -p.y * invR * speed * 0.3;
        p.vy = p.x * invR * speed * 0.3;
        p.vz = 0;
        p.life = 0;
        // Update dist after respawn for correct color
        dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      }

      // Color gradient based on distance (outer -> middle -> inner)
      const distRatio = dist / obstacleRadius;
      if (distRatio > 0.5) {
        // Outer band: pure outer color
        colors[i * 3] = ACCRETION_DISK.outerColor.r;
        colors[i * 3 + 1] = ACCRETION_DISK.outerColor.g;
        colors[i * 3 + 2] = ACCRETION_DISK.outerColor.b;
      } else if (distRatio > 0.15) {
        // Mid band: blend outer -> middle
        const blend = (0.5 - distRatio) / 0.35;
        colors[i * 3] = ACCRETION_DISK.outerColor.r + blend * (ACCRETION_DISK.middleColor.r - ACCRETION_DISK.outerColor.r);
        colors[i * 3 + 1] = ACCRETION_DISK.outerColor.g + blend * (ACCRETION_DISK.middleColor.g - ACCRETION_DISK.outerColor.g);
        colors[i * 3 + 2] = ACCRETION_DISK.outerColor.b + blend * (ACCRETION_DISK.middleColor.b - ACCRETION_DISK.outerColor.b);
      } else {
        // Inner band: blend middle -> inner (white-hot core)
        const blend = (0.15 - distRatio) / 0.15;
        colors[i * 3] = ACCRETION_DISK.middleColor.r + blend * (ACCRETION_DISK.innerColor.r - ACCRETION_DISK.middleColor.r);
        colors[i * 3 + 1] = ACCRETION_DISK.middleColor.g + blend * (ACCRETION_DISK.innerColor.g - ACCRETION_DISK.middleColor.g);
        colors[i * 3 + 2] = ACCRETION_DISK.middleColor.b + blend * (ACCRETION_DISK.innerColor.b - ACCRETION_DISK.middleColor.b);
      }

      sizes[i] = 2.0 + (1.0 - distRatio) * 3.0;

      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.geometry.attributes.color.needsUpdate = true;
    particleSystem.geometry.attributes.size.needsUpdate = true;
  }
}

// ============================================
// Disposal
// ============================================

/**
 * Dispose gravity distortion resources (geometry + materials)
 */
export function disposeGravityDistortion(group: THREE.Group): void {
  group.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        (child.material as THREE.Material).dispose();
      }
    }
  });
}
