// ============================================
// GravityDistortionMesh - Gravity Well (Black Hole) Mesh
// Single source of truth for gravity distortion visuals
// Used by: ObstacleRenderSystem, model-viewer
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '#shared';

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

/** Event horizon sphere - visual danger zone with distortion shader */
const EVENT_HORIZON = {
  // Base colors (will cycle through hues)
  edgeColor: { r: 1.0, g: 0.0, b: 0.53 },    // Magenta edge glow (base)
  innerColor: { r: 0.1, g: 0.0, b: 0.1 },    // Dark purple center
  // Fresnel (edge glow)
  fresnelPower: 3.0,       // Higher = sharper edge falloff
  fresnelIntensity: 1.5,   // Edge glow brightness
  // Ripple distortion
  rippleSpeed: 0.8,        // How fast ripples animate
  rippleFrequency: 8.0,    // Number of concentric rings
  rippleAmplitude: 0.15,   // How much ripples distort (0-1)
  // Color cycling
  colorCycleSpeed: 0.15,   // How fast colors shift (cycles per second)
  // Overall
  baseOpacity: 0.15,        // Base transparency
  edgeOpacity: 0.4,        // Edge transparency (via fresnel)
};

/** Swirling energy bands - rotating rings around event horizon */
const ENERGY_BANDS = {
  count: 3,                // Number of rings
  color: 0xff00ff,         // Base color (will also cycle)
  opacity: 0.6,
  thickness: 2,            // Tube radius
  // Each ring has different tilt and speed
  rings: [
    { tiltX: 0.3, tiltZ: 0.1, speed: 0.4 },     // Slightly tilted, medium speed
    { tiltX: -0.2, tiltZ: 0.4, speed: -0.3 },   // Opposite tilt, reverse
    { tiltX: 0.5, tiltZ: -0.2, speed: 0.25 },   // More tilted, slower
  ],
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
// Shaders
// ============================================

/** Vertex shader for event horizon distortion effect */
const EVENT_HORIZON_VERTEX = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Fragment shader for event horizon distortion effect */
const EVENT_HORIZON_FRAGMENT = `
uniform float uTime;
uniform vec3 uEdgeColor;
uniform vec3 uInnerColor;
uniform float uFresnelPower;
uniform float uFresnelIntensity;
uniform float uRippleSpeed;
uniform float uRippleFrequency;
uniform float uRippleAmplitude;
uniform float uBaseOpacity;
uniform float uEdgeOpacity;
uniform float uColorCycleSpeed;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewPosition;

// HSV to RGB conversion for smooth color cycling
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // Fresnel effect - glow at edges where surface is perpendicular to view
  vec3 viewDir = normalize(vViewPosition);
  float fresnel = 1.0 - abs(dot(viewDir, vNormal));
  fresnel = pow(fresnel, uFresnelPower) * uFresnelIntensity;

  // Radial distance from center (0 at center, 1 at edge)
  vec2 centered = vUv - 0.5;
  float dist = length(centered) * 2.0;

  // Animated concentric ripples
  float ripplePhase = dist * uRippleFrequency - uTime * uRippleSpeed;
  float ripple = sin(ripplePhase * 3.14159 * 2.0) * 0.5 + 0.5;

  // Secondary ripple at different frequency for complexity
  float ripple2 = sin(ripplePhase * 3.14159 * 2.0 * 1.7 + 1.0) * 0.5 + 0.5;
  ripple = mix(ripple, ripple2, 0.3);

  // Distortion effect - shift the color based on ripple
  float distortion = ripple * uRippleAmplitude;

  // === COLOR CYCLING ===
  // Shift hue over time (magenta -> cyan -> magenta cycle)
  float hueShift = uTime * uColorCycleSpeed;
  // Base hue is ~0.83 (magenta), cycle through cyan (~0.5) and back
  float baseHue = 0.83 + sin(hueShift * 3.14159 * 2.0) * 0.17;
  vec3 cycledEdgeColor = hsv2rgb(vec3(baseHue, 0.9, 1.0));
  vec3 cycledInnerColor = hsv2rgb(vec3(baseHue, 0.8, 0.15));

  // Color gradient from inner to edge, modulated by ripple
  float colorMix = smoothstep(0.0, 1.0, dist + distortion * 0.5);
  vec3 baseColor = mix(cycledInnerColor, cycledEdgeColor, colorMix);

  // Add ripple brightness variation
  vec3 color = baseColor * (1.0 + ripple * 0.3);

  // Add fresnel edge glow (also color-cycled)
  color += cycledEdgeColor * fresnel;

  // Opacity: more opaque at edges (fresnel) and where ripples are bright
  float alpha = mix(uBaseOpacity, uEdgeOpacity, fresnel);
  alpha += ripple * 0.1 * (1.0 - dist); // Subtle ripple in opacity

  // Fade out at very center for the "void" look
  alpha *= smoothstep(0.0, 0.3, dist);

  gl_FragColor = vec4(color, alpha);
}
`;

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

  // === LAYER 3: EVENT HORIZON SPHERE (with distortion shader) ===
  const horizonGeometry = new THREE.SphereGeometry(
    GAME_CONFIG.OBSTACLE_EVENT_HORIZON,
    64, // Higher segments for smoother distortion
    64
  );
  const horizonMaterial = new THREE.ShaderMaterial({
    vertexShader: EVENT_HORIZON_VERTEX,
    fragmentShader: EVENT_HORIZON_FRAGMENT,
    uniforms: {
      uTime: { value: 0.0 },
      uEdgeColor: { value: new THREE.Vector3(EVENT_HORIZON.edgeColor.r, EVENT_HORIZON.edgeColor.g, EVENT_HORIZON.edgeColor.b) },
      uInnerColor: { value: new THREE.Vector3(EVENT_HORIZON.innerColor.r, EVENT_HORIZON.innerColor.g, EVENT_HORIZON.innerColor.b) },
      uFresnelPower: { value: EVENT_HORIZON.fresnelPower },
      uFresnelIntensity: { value: EVENT_HORIZON.fresnelIntensity },
      uRippleSpeed: { value: EVENT_HORIZON.rippleSpeed },
      uRippleFrequency: { value: EVENT_HORIZON.rippleFrequency },
      uRippleAmplitude: { value: EVENT_HORIZON.rippleAmplitude },
      uBaseOpacity: { value: EVENT_HORIZON.baseOpacity },
      uEdgeOpacity: { value: EVENT_HORIZON.edgeOpacity },
      uColorCycleSpeed: { value: EVENT_HORIZON.colorCycleSpeed },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending, // Glow effect
  });
  const horizonSphere = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizonSphere.position.z = 0.05;
  horizonSphere.userData.isEventHorizon = true;
  group.add(horizonSphere);

  // === LAYER 3.5: SWIRLING ENERGY BANDS ===
  // Torus rings at different tilts that rotate around the event horizon
  const bandRadius = GAME_CONFIG.OBSTACLE_EVENT_HORIZON * 1.1; // Slightly larger than horizon
  for (let i = 0; i < ENERGY_BANDS.rings.length; i++) {
    const ringConfig = ENERGY_BANDS.rings[i];
    const torusGeometry = new THREE.TorusGeometry(
      bandRadius,               // Ring radius
      ENERGY_BANDS.thickness,   // Tube radius
      8,                        // Radial segments (tube cross-section)
      64                        // Tubular segments (around the ring)
    );
    const torusMaterial = new THREE.MeshBasicMaterial({
      color: ENERGY_BANDS.color,
      transparent: true,
      opacity: ENERGY_BANDS.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const torus = new THREE.Mesh(torusGeometry, torusMaterial);
    // Apply initial tilt
    torus.rotation.x = ringConfig.tiltX;
    torus.rotation.z = ringConfig.tiltZ;
    torus.position.z = 0.07; // In front of horizon sphere
    torus.userData.isEnergyBand = true;
    torus.userData.bandIndex = i;
    torus.userData.bandSpeed = ringConfig.speed;
    group.add(torus);
  }

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

  // Calculate color cycle hue for syncing energy bands
  const hueShift = time * EVENT_HORIZON.colorCycleSpeed;
  const currentHue = 0.83 + Math.sin(hueShift * Math.PI * 2) * 0.17;

  // === EVENT HORIZON DISTORTION SHADER ===
  const horizonSphere = group.children[2] as THREE.Mesh;
  if (horizonSphere?.userData.isEventHorizon) {
    const horizonMaterial = horizonSphere.material as THREE.ShaderMaterial;
    if (horizonMaterial.uniforms?.uTime) {
      // Update time uniform for ripple animation (add phase offset for variety)
      horizonMaterial.uniforms.uTime.value = time + pulsePhase;
    }
  }

  // === ENERGY BAND ROTATION & COLOR SYNC ===
  // Bands are at indices 3, 4, 5 (after horizon sphere)
  for (let i = 0; i < ENERGY_BANDS.rings.length; i++) {
    const band = group.children[3 + i] as THREE.Mesh;
    if (band?.userData.isEnergyBand) {
      // Rotate around Y axis (which is actually "up" in our rotated coordinate system)
      const speed = band.userData.bandSpeed || 0.3;
      band.rotation.y += speed * deltaSeconds;

      // Sync color with the event horizon color cycle
      const bandMaterial = band.material as THREE.MeshBasicMaterial;
      // Convert HSV to RGB for the band color
      const h = currentHue;
      const s = 0.9;
      const v = 1.0;
      // HSV to RGB inline
      const hi = Math.floor(h * 6) % 6;
      const f = h * 6 - Math.floor(h * 6);
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      let r = 0, g = 0, b = 0;
      switch (hi) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
      }
      bandMaterial.color.setRGB(r, g, b);
    }
  }

  // === VORTEX ROTATION ===
  // Indices shifted by 3 due to energy bands (now at 6, 7)
  const vortexParticles = group.children[6] as THREE.Points;
  const vortexLine = group.children[7] as THREE.Line;

  if (vortexParticles?.userData.isVortex) {
    const speed = vortexParticles.userData.vortexSpeed || 0.5;
    vortexParticles.rotation.z += speed * deltaSeconds;
  }
  if (vortexLine?.userData.isVortex) {
    const speed = vortexLine.userData.vortexSpeed || 0.5;
    vortexLine.rotation.z += speed * deltaSeconds;
  }

  // === SINGULARITY CORE PULSING ===
  // Index shifted (now at 8)
  const coreSphere = group.children[8] as THREE.Mesh;
  if (coreSphere?.userData.isSingularityCore) {
    const coreMaterial = coreSphere.material as THREE.MeshStandardMaterial;
    coreMaterial.emissiveIntensity = SINGULARITY_CORE.emissiveIntensity +
      Math.sin(time * SINGULARITY_CORE.pulseSpeed + pulsePhase) * SINGULARITY_CORE.emissiveRange;
  }

  // === INNER SPARK FLICKERING ===
  // Index shifted (now at 9)
  const sparkSphere = group.children[9] as THREE.Mesh;
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
  // Index shifted (now at 10)
  const particleSystem = group.children[10] as THREE.Points;
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
