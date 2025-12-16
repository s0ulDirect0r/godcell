// ============================================
// EnvironmentSystem - Manages background environments
// Owns soup/jungle backgrounds, particles, ground plane
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG, isSphereMode } from '#shared';
import {
  createJungleBackground,
  updateJungleParticles,
  updateSoupActivity,
  updateUndergrowth,
  updateFireflies,
  updateGroundTexture,
  getJungleBackgroundColor,
  getSoupBackgroundColor,
  getFirstPersonSkyColor,
  createFirstPersonGround,
} from '../three/JungleBackground';
import {
  createSubdividedLine,
  updateGridLineDistortion,
  updateGravityWellCache,
  clearGravityWellCache,
  getGravityWellCache,
} from '../utils/GravityDistortionUtils';
import { World, Tags, Components } from '../../ecs';

export type RenderMode = 'soup' | 'jungle';

// ============================================
// Surface Flow Shader Configuration
// ============================================

/**
 * Surface Flow Shader Configuration
 *
 * Controls the animated "cosmic liquid" effect on the sphere surface.
 * Two main components:
 * 1. Base Flow: Diagonal waves using noise for organic liquid movement
 * 2. Entity Ripples: Concentric waves emanating from player positions
 */
const SURFACE_FLOW_CONFIG = {
  // === BASE FLOW PARAMETERS ===
  // flowFrequency: Spatial frequency of the noise pattern
  // Lower = larger, smoother waves; Higher = smaller, more detailed waves
  // Range: 0.005 - 0.02, Default: 0.01
  flowFrequency: 0.01,

  // flowSpeed: How fast the flow pattern animates (radians/second)
  // Lower = slow, meditative; Higher = energetic, rushing
  // Range: 0.2 - 1.0, Default: 0.5
  flowSpeed: 0.5,

  // baseAmplitude: Vertex displacement for base waves (world units)
  // Higher = more physical displacement, more "liquid" feel
  // Range: 1 - 5, Default: 2
  baseAmplitude: 2.0,

  // === ENTITY RIPPLE PARAMETERS ===
  // rippleDecay: How quickly ripples fade with distance (exponential decay factor)
  // Lower = ripples travel further; Higher = localized ripples
  // Range: 0.005 - 0.02, Default: 0.01
  rippleDecay: 0.01,

  // rippleAmplitude: Maximum displacement from entity ripples (world units)
  // Set to 0 to disable ripples entirely
  rippleAmplitude: 0.0,

  // maxEntities: Maximum entities to track for ripples (WebGL uniform array limit)
  maxEntities: 30,

  // === VISUAL COLORS ===
  // baseColor: Near-black with subtle digital blue
  baseColor: { r: 0.005, g: 0.008, b: 0.02 },

  // flowColor: Dimmer cyan for subtle digital veins
  flowColor: { r: 0.0, g: 0.4, b: 0.3 },

  // rippleColor: Subdued cyan for ripples
  rippleColor: { r: 0.0, g: 0.5, b: 0.5 },
};

// ============================================
// Surface Flow Vertex Shader
// ============================================
// Animates sphere surface with flowing waves and entity ripples
// Displaces vertices along surface normal for physical "liquid" movement

const SURFACE_FLOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform vec3 uEntityPositions[30];
uniform int uEntityCount;
uniform float uFlowFrequency;
uniform float uFlowSpeed;
uniform float uRippleDecay;
uniform float uRippleAmplitude;
uniform float uBaseAmplitude;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vDisplacement;

// Simple 3D value noise
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // Smoothstep interpolation

  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

// Fractal Brownian Motion for layered noise
float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise3D(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vUv = uv;

  // Surface normal (normalized position for sphere centered at origin)
  vec3 surfaceNormal = normalize(position);
  vNormal = normalMatrix * surfaceNormal;

  // === BASE DIAGONAL WAVES ===
  // Use spherical coordinates for smooth wrapping
  float theta = atan(surfaceNormal.z, surfaceNormal.x); // Longitude
  float phi = acos(surfaceNormal.y);                     // Latitude

  // Diagonal flow: combine theta and phi with time offset
  float diagonalPhase = theta * 2.0 + phi * 1.5 - uTime * uFlowSpeed;

  // Multi-octave noise for organic flow
  vec3 noiseCoord = surfaceNormal * uRadius * uFlowFrequency + vec3(uTime * uFlowSpeed * 0.1);
  float baseWave = fbm(noiseCoord) * 2.0 - 1.0; // -1 to 1

  // Add secondary sine wave for more structure
  baseWave += sin(diagonalPhase) * 0.3;

  float displacement = baseWave * uBaseAmplitude;

  // === ENTITY RIPPLES ===
  // Concentric waves emanating from each entity position
  for (int i = 0; i < 30; i++) {
    if (i >= uEntityCount) break;

    vec3 entityPos = uEntityPositions[i];

    // Geodesic (surface) distance using dot product of normalized positions
    vec3 entityNormal = normalize(entityPos);
    float dotProduct = dot(surfaceNormal, entityNormal);
    float angularDist = acos(clamp(dotProduct, -1.0, 1.0));
    float surfaceDist = angularDist * uRadius;

    // Ripple: outward-moving rings with exponential decay
    // Lower frequency = fewer rings (0.015 is ~70% fewer than 0.05)
    float ripplePhase = surfaceDist * 0.015 - uTime * 2.0;
    float ripple = sin(ripplePhase * 6.283185) * 0.5 + 0.5; // 0 to 1

    // Exponential decay with distance
    float decay = exp(-surfaceDist * uRippleDecay);

    displacement += ripple * decay * uRippleAmplitude;
  }

  vDisplacement = displacement;

  // Apply displacement along surface normal
  vec3 displacedPosition = position + surfaceNormal * displacement;

  // World position for fragment shader
  vec4 worldPos = modelMatrix * vec4(displacedPosition, 1.0);
  vWorldPosition = worldPos.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
}
`;

// ============================================
// Surface Flow Fragment Shader
// ============================================
// Creates cosmic liquid visual with flowing colors and ripple highlights

const SURFACE_FLOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform vec3 uEntityPositions[30];
uniform int uEntityCount;
uniform float uFlowFrequency;
uniform float uFlowSpeed;
uniform vec3 uBaseColor;
uniform vec3 uFlowColor;
uniform vec3 uRippleColor;
uniform float uBaseAmplitude;
uniform float uRippleAmplitude;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vDisplacement;

// Reuse noise functions
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise3D(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 surfaceNormal = normalize(vWorldPosition);

  // === BASE FLOW PATTERN ===
  vec3 noiseCoord = surfaceNormal * uRadius * uFlowFrequency * 2.0;
  noiseCoord += vec3(uTime * uFlowSpeed * 0.15, uTime * uFlowSpeed * 0.1, 0.0);

  float flowNoise = fbm(noiseCoord);
  float flowIntensity = smoothstep(0.35, 0.65, flowNoise);

  // === RIPPLE HIGHLIGHTS ===
  float rippleIntensity = 0.0;
  for (int i = 0; i < 30; i++) {
    if (i >= uEntityCount) break;

    vec3 entityPos = uEntityPositions[i];
    vec3 entityNormal = normalize(entityPos);

    // Angular distance on sphere
    float dotProduct = dot(surfaceNormal, entityNormal);
    float angularDist = acos(clamp(dotProduct, -1.0, 1.0));
    float surfaceDist = angularDist * uRadius;

    // Concentric ring pattern (fewer rings - 70% reduction)
    float ringPhase = surfaceDist * 0.009 - uTime * 1.5;
    float ring = sin(ringPhase * 6.283185);
    ring = smoothstep(0.5, 1.0, ring); // Sharp rings

    // Decay with distance
    float decay = exp(-surfaceDist * 0.008);

    rippleIntensity += ring * decay;
  }
  rippleIntensity = clamp(rippleIntensity, 0.0, 1.0);

  // === DISPLACEMENT-BASED COLORING ===
  float dispNormalized = (vDisplacement / (uBaseAmplitude * 2.0 + uRippleAmplitude)) * 0.5 + 0.5;
  dispNormalized = clamp(dispNormalized, 0.0, 1.0);

  // === COMBINE COLORS ===
  vec3 color = uBaseColor;

  // Cyan veins disabled - just solid dark surface
  // float veinIntensity = smoothstep(0.58, 0.68, flowNoise);
  // veinIntensity = pow(veinIntensity, 0.7);
  // color = mix(color, uFlowColor, veinIntensity * 0.6);

  // Ripple highlights (disabled)
  // color = mix(color, uRippleColor, rippleIntensity * 0.02);

  // Minimal brightness variation
  color *= 0.9 + dispNormalized * 0.08;

  // Very subtle fresnel
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 4.0);
  color += uFlowColor * fresnel * 0.03;

  gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * EnvironmentSystem - Manages all background environments
 *
 * Owns:
 * - Soup background (grid + flowing particles) for Stages 1-2
 * - Jungle background (procedural) for Stage 3+
 * - First-person ground plane for Stage 4+
 * - All background particle animations
 */
export class EnvironmentSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Render mode
  private mode: RenderMode = 'soup';

  // Soup background (Stage 1-2)
  private soupBackgroundGroup!: THREE.Group;
  private dataParticles!: THREE.Points;
  private particleData: Array<{ x: number; y: number; vx: number; vy: number; size: number }> = [];

  // Grid distortion data
  // Each entry: { geometry, originalPositions } for a grid line
  private gridLines: Array<{ geometry: THREE.BufferGeometry; originalPositions: Float32Array }> =
    [];
  private gravityWellCacheUpdated = false;

  // Jungle background (Stage 3+)
  private jungleBackgroundGroup!: THREE.Group;
  private jungleParticles!: THREE.Points;
  private jungleParticleData: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
  }> = [];

  // Soup activity visualization (inside soup pool in jungle view)
  private soupActivityPoints!: THREE.Points;
  private soupActivityData: Array<{ x: number; y: number; vx: number; vy: number; color: number }> =
    [];

  // Undergrowth particles (ground-level glow)
  private undergrowthPoints!: THREE.Points;
  private undergrowthData: Array<{ x: number; y: number; phase: number; baseOpacity: number }> = [];

  // Firefly particles (floating ambient life)
  private fireflyPoints!: THREE.Points;
  private fireflyData: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    phase: number;
    color: number;
  }> = [];

  // First-person ground plane (Stage 4+)
  private firstPersonGround!: THREE.Group;

  // Sphere mode background
  private sphereBackgroundGroup!: THREE.Group;
  private isSphereWorld: boolean = false;
  private sphereParticles!: THREE.Points;
  private surfaceFlowMaterial?: THREE.ShaderMaterial;
  private sphereParticleData: Array<{
    theta: number;  // Longitude angle
    phi: number;    // Latitude angle
    vTheta: number; // Angular velocity in theta
    vPhi: number;   // Angular velocity in phi
    size: number;
  }> = [];

  /**
   * Initialize environment system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
    this.isSphereWorld = isSphereMode();

    // Sphere mode: create sphere-specific environment
    if (this.isSphereWorld) {
      this.createSphereEnvironment();
      scene.background = new THREE.Color(GAME_CONFIG.BACKGROUND_COLOR);
      return; // Skip flat world setup
    }

    // Create soup background group (grid + particles)
    this.soupBackgroundGroup = new THREE.Group();
    this.soupBackgroundGroup.name = 'soupBackground';
    scene.add(this.soupBackgroundGroup);

    // Create soup grid and particles
    this.createGrid();
    this.createDataParticles();

    // Create jungle background (uses JungleBackground helper)
    const jungleResult = createJungleBackground(scene);
    this.jungleBackgroundGroup = jungleResult.group;
    this.jungleParticles = jungleResult.particles;
    this.jungleParticleData = jungleResult.particleData;
    this.soupActivityPoints = jungleResult.soupActivityPoints;
    this.soupActivityData = jungleResult.soupActivityData;
    this.undergrowthPoints = jungleResult.undergrowthPoints;
    this.undergrowthData = jungleResult.undergrowthData;
    this.fireflyPoints = jungleResult.fireflyPoints;
    this.fireflyData = jungleResult.fireflyData;

    // Create first-person ground plane (Stage 4+)
    this.firstPersonGround = createFirstPersonGround();
    this.firstPersonGround.visible = false;
    scene.add(this.firstPersonGround);

    // Set initial background color (soup mode)
    scene.background = new THREE.Color(getSoupBackgroundColor());
  }

  /**
   * Create sphere world environment
   * - Animated surface flow sphere with custom shader
   * - Wireframe grid overlay for visual reference
   * - Flowing data particles on surface
   */
  private createSphereEnvironment(): void {
    this.sphereBackgroundGroup = new THREE.Group();
    this.sphereBackgroundGroup.name = 'sphereBackground';

    const radius = GAME_CONFIG.SPHERE_RADIUS;

    // === LAYER 1: Animated surface sphere with flow shader ===
    // Higher subdivision (5) for smooth vertex displacement
    // Slightly smaller than radius so wireframe sits above it
    const sphereGeometry = new THREE.IcosahedronGeometry(radius - 25, 5);

    // Initialize entity positions array for uniforms
    const entityPositions: THREE.Vector3[] = [];
    for (let i = 0; i < SURFACE_FLOW_CONFIG.maxEntities; i++) {
      entityPositions.push(new THREE.Vector3(0, 0, 0));
    }

    // Create shader material with surface flow effect
    const sphereMaterial = new THREE.ShaderMaterial({
      vertexShader: SURFACE_FLOW_VERTEX,
      fragmentShader: SURFACE_FLOW_FRAGMENT,
      uniforms: {
        uTime: { value: 0.0 },
        uRadius: { value: radius },
        uEntityPositions: { value: entityPositions },
        uEntityCount: { value: 0 },
        uFlowFrequency: { value: SURFACE_FLOW_CONFIG.flowFrequency },
        uFlowSpeed: { value: SURFACE_FLOW_CONFIG.flowSpeed },
        uRippleDecay: { value: SURFACE_FLOW_CONFIG.rippleDecay },
        uRippleAmplitude: { value: SURFACE_FLOW_CONFIG.rippleAmplitude },
        uBaseAmplitude: { value: SURFACE_FLOW_CONFIG.baseAmplitude },
        uBaseColor: {
          value: new THREE.Vector3(
            SURFACE_FLOW_CONFIG.baseColor.r,
            SURFACE_FLOW_CONFIG.baseColor.g,
            SURFACE_FLOW_CONFIG.baseColor.b
          ),
        },
        uFlowColor: {
          value: new THREE.Vector3(
            SURFACE_FLOW_CONFIG.flowColor.r,
            SURFACE_FLOW_CONFIG.flowColor.g,
            SURFACE_FLOW_CONFIG.flowColor.b
          ),
        },
        uRippleColor: {
          value: new THREE.Vector3(
            SURFACE_FLOW_CONFIG.rippleColor.r,
            SURFACE_FLOW_CONFIG.rippleColor.g,
            SURFACE_FLOW_CONFIG.rippleColor.b
          ),
        },
      },
      side: THREE.FrontSide,
      depthWrite: true, // Write depth so far-side entities fail depth test
      depthTest: true,
    });

    const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphereMesh.userData.isSurfaceFlowSphere = true;
    this.sphereBackgroundGroup.add(sphereMesh);

    // Store reference for update
    this.surfaceFlowMaterial = sphereMaterial;

    // === LAYER 2: Glowing wireframe icosahedron ===
    // Additive blending makes it glow like it's emitting light
    // Back to original position
    const wireframeGeometry = new THREE.IcosahedronGeometry(radius + 2, 3);
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffaa, // Bright cyan-green
      wireframe: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false, // Don't occlude things behind it
    });
    const wireframeMesh = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
    this.sphereBackgroundGroup.add(wireframeMesh);

    // === LAYER 3: Equator ring for orientation ===
    const equatorGeometry = new THREE.TorusGeometry(radius + 2, 2, 4, 64);
    const equatorMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.5,
    });
    const equatorMesh = new THREE.Mesh(equatorGeometry, equatorMaterial);
    equatorMesh.rotation.x = Math.PI / 2;
    this.sphereBackgroundGroup.add(equatorMesh);

    // === LAYER 4: Flowing data particles on sphere surface ===
    this.createSphereParticles(radius);

    this.scene.add(this.sphereBackgroundGroup);
  }

  /**
   * Create flowing data particles on sphere surface
   */
  private createSphereParticles(radius: number): void {
    // 150% more particles than flat mode (2.5x total)
    const particleCount = Math.floor(GAME_CONFIG.MAX_PARTICLES * 2.5);
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    // Particles are positioned using spherical coordinates (theta, phi)
    // and flow along the surface
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;  // Longitude: 0 to 2π
      const phi = Math.acos(2 * Math.random() - 1);  // Latitude: 0 to π (uniform distribution)
      const size =
        GAME_CONFIG.PARTICLE_MIN_SIZE +
        Math.random() * (GAME_CONFIG.PARTICLE_MAX_SIZE - GAME_CONFIG.PARTICLE_MIN_SIZE);

      // Convert spherical to Cartesian (slightly above surface)
      const r = radius + 5;  // Lift particles above surface
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      sizes[i] = size;

      // Angular velocity - particles flow diagonally across sphere
      const baseSpeed = 0.02;  // Radians per second
      const variance = (Math.random() - 0.5) * 0.02;
      this.sphereParticleData.push({
        theta,
        phi,
        vTheta: baseSpeed + variance,  // Longitude drift
        vPhi: (Math.random() - 0.5) * 0.01,  // Slight latitude wobble
        size,
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      color: GAME_CONFIG.PARTICLE_COLOR,  // Cyan data particles
      size: 5,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: false,
      map: this.createCircleTexture(),
      alphaTest: 0.5,
      depthTest: true,  // Respect sphere occlusion
      depthWrite: false,
    });

    this.sphereParticles = new THREE.Points(geometry, material);
    this.sphereBackgroundGroup.add(this.sphereParticles);
  }

  // ============================================
  // Mode Switching
  // ============================================

  /**
   * Get current render mode
   */
  getMode(): RenderMode {
    return this.mode;
  }

  /**
   * Set render mode (soup vs jungle)
   * Returns true if mode changed (caller should clear entities when switching to jungle)
   */
  setMode(mode: RenderMode): boolean {
    // Sphere mode: always stay in 'soup' mode, no switching
    if (this.isSphereWorld) return false;

    if (this.mode === mode) return false;

    console.log(`[RenderMode] Switching from ${this.mode} to ${mode}`);

    if (mode === 'jungle') {
      // Transitioning to jungle (Stage 3+)
      // Remove soup background from scene entirely
      if (this.soupBackgroundGroup.parent === this.scene) {
        this.scene.remove(this.soupBackgroundGroup);
      }

      // Show jungle background
      if (this.jungleBackgroundGroup.parent !== this.scene) {
        this.scene.add(this.jungleBackgroundGroup);
      }
      this.jungleBackgroundGroup.visible = true;
      this.scene.background = new THREE.Color(getJungleBackgroundColor());

      // Clear gravity well cache (no obstacles in jungle)
      clearGravityWellCache();
    } else {
      // Transitioning to soup (Stage 1-2, e.g., death respawn)
      // Re-add soup background
      if (this.soupBackgroundGroup.parent !== this.scene) {
        this.scene.add(this.soupBackgroundGroup);
      }
      this.soupBackgroundGroup.visible = true;

      // Hide jungle background
      this.jungleBackgroundGroup.visible = false;
      this.scene.background = new THREE.Color(getSoupBackgroundColor());

      // Reset gravity well cache flag so it gets rebuilt
      this.gravityWellCacheUpdated = false;
    }

    this.mode = mode;
    return true; // Mode changed
  }

  // ============================================
  // First-Person Ground
  // ============================================

  /**
   * Set first-person ground visibility
   * Called when entering/exiting first-person mode
   */
  setFirstPersonGroundVisible(visible: boolean): void {
    this.firstPersonGround.visible = visible;

    // Update background color based on visibility
    if (visible) {
      this.scene.background = new THREE.Color(getFirstPersonSkyColor());
    } else {
      // Restore based on current mode
      if (this.mode === 'jungle') {
        this.scene.background = new THREE.Color(getJungleBackgroundColor());
      } else {
        this.scene.background = new THREE.Color(getSoupBackgroundColor());
      }
    }
  }

  // ============================================
  // Update (called each frame)
  // ============================================

  /**
   * Update background particles and grid distortion based on current mode
   * @param dt - Delta time in milliseconds
   */
  update(dt: number): void {
    // Sphere mode: update particles, surface flow shader, and gravity well cache
    if (this.isSphereWorld) {
      this.updateSphereParticles(dt);
      this.updateSurfaceFlowShader(dt);
      if (!this.gravityWellCacheUpdated && this.world) {
        updateGravityWellCache(this.world);
        if (getGravityWellCache().length > 0) {
          this.gravityWellCacheUpdated = true;
        }
      }
      return;
    }

    if (this.mode === 'soup') {
      this.updateSoupParticles(dt);
      this.updateGridDistortion();
    } else {
      // Jungle mode: update all jungle particles and ambient effects
      const dtSeconds = dt / 1000;
      updateJungleParticles(this.jungleParticles, this.jungleParticleData, dtSeconds);
      updateSoupActivity(this.soupActivityPoints, this.soupActivityData, dtSeconds);
      updateUndergrowth(this.undergrowthPoints, this.undergrowthData, dtSeconds);
      updateFireflies(this.fireflyPoints, this.fireflyData, dtSeconds);
      updateGroundTexture(this.jungleBackgroundGroup, dtSeconds);
    }
  }

  /**
   * Update grid line distortion toward gravity wells
   * Called each frame in soup mode
   */
  private updateGridDistortion(): void {
    // Update gravity well cache on first frame (obstacles are static, so only need once)
    // We check each frame until we have obstacles, in case they load after init
    if (!this.gravityWellCacheUpdated && this.world) {
      updateGravityWellCache(this.world);
      // Only mark as updated if we actually found obstacles in the cache
      // (they may not be loaded yet on first frames)
      if (getGravityWellCache().length > 0) {
        this.gravityWellCacheUpdated = true;
      }
    }

    // Apply distortion to each grid line
    for (const { geometry, originalPositions } of this.gridLines) {
      updateGridLineDistortion(geometry, originalPositions);
    }
  }

  /**
   * Force refresh of gravity well cache
   * Call this after obstacles are synced from server
   */
  refreshGravityWellCache(): void {
    // Enable gravity well cache for entity warping (even in sphere mode)
    // Note: Grid distortion is skipped in sphere mode since we don't have a 2D grid
    if (this.world) {
      updateGravityWellCache(this.world);
      this.gravityWellCacheUpdated = true;
    }
  }

  // ============================================
  // Soup Background Creation
  // ============================================

  private createGrid(): void {
    const gridSize = 100; // Grid cell size
    const gridColor = GAME_CONFIG.GRID_COLOR;
    const gridHeight = -1; // Height (below entities)

    // Number of segments per grid line for smooth distortion curves
    // Higher = smoother curves but more vertices. 20-30 is a good balance.
    const segmentsPerLine = 25;

    // Soup grid spans the soup region within the jungle coordinate space
    const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X;
    const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH;
    const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y;
    const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT;

    const material = new THREE.LineBasicMaterial({ color: gridColor });

    // Create lines parallel to Z axis (along game Y direction)
    // XZ plane: X=game X, Y=height, Z=-game Y
    for (let x = soupMinX; x <= soupMaxX; x += gridSize) {
      const { geometry, originalPositions } = createSubdividedLine(
        x,
        -soupMinY, // Start: Three.js coords (X, Z)
        x,
        -soupMaxY, // End: Three.js coords
        segmentsPerLine,
        gridHeight
      );
      const line = new THREE.Line(geometry, material);
      this.soupBackgroundGroup.add(line);
      this.gridLines.push({ geometry, originalPositions });
    }

    // Create lines parallel to X axis (along game X direction)
    for (let gameY = soupMinY; gameY <= soupMaxY; gameY += gridSize) {
      const { geometry, originalPositions } = createSubdividedLine(
        soupMinX,
        -gameY, // Start: Three.js coords
        soupMaxX,
        -gameY, // End: Three.js coords
        segmentsPerLine,
        gridHeight
      );
      const line = new THREE.Line(geometry, material);
      this.soupBackgroundGroup.add(line);
      this.gridLines.push({ geometry, originalPositions });
    }
  }

  private createDataParticles(): void {
    const particleCount = GAME_CONFIG.MAX_PARTICLES;

    // Create positions and sizes arrays
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    // Soup particles spawn within soup region
    const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X;
    const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y;

    for (let i = 0; i < particleCount; i++) {
      const x = soupMinX + Math.random() * GAME_CONFIG.SOUP_WIDTH;
      const y = soupMinY + Math.random() * GAME_CONFIG.SOUP_HEIGHT;
      const size =
        GAME_CONFIG.PARTICLE_MIN_SIZE +
        Math.random() * (GAME_CONFIG.PARTICLE_MAX_SIZE - GAME_CONFIG.PARTICLE_MIN_SIZE);

      // Position (XZ plane: X=game X, Y=height, Z=-game Y)
      positions[i * 3] = x;
      positions[i * 3 + 1] = -0.8; // Height (below entities)
      positions[i * 3 + 2] = -y;

      // Size
      sizes[i] = size;

      // Calculate velocity (diagonal flow)
      const baseAngle = Math.PI / 4; // 45 degrees
      const variance = ((Math.random() - 0.5) * Math.PI) / 2;
      const angle = baseAngle + variance;
      const speed =
        GAME_CONFIG.PARTICLE_SPEED_MIN +
        Math.random() * (GAME_CONFIG.PARTICLE_SPEED_MAX - GAME_CONFIG.PARTICLE_SPEED_MIN);

      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      // Store particle data for updates
      this.particleData.push({ x, y, vx, vy, size });
    }

    // Create BufferGeometry with position and size attributes
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Create PointsMaterial with transparent circles
    const material = new THREE.PointsMaterial({
      color: GAME_CONFIG.PARTICLE_COLOR,
      size: 5, // Base size (will be multiplied by size attribute)
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: false, // Keep consistent size regardless of camera distance
      map: this.createCircleTexture(),
      alphaTest: 0.5,
    });

    // Create Points mesh
    this.dataParticles = new THREE.Points(geometry, material);
    this.soupBackgroundGroup.add(this.dataParticles);
  }

  private createCircleTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;

    // Draw circle with soft edges
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private updateSoupParticles(dt: number): void {
    const deltaSeconds = dt / 1000;
    const positions = this.dataParticles.geometry.attributes.position.array as Float32Array;

    // Soup region bounds for wrapping
    const soupMinX = GAME_CONFIG.SOUP_ORIGIN_X;
    const soupMaxX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH;
    const soupMinY = GAME_CONFIG.SOUP_ORIGIN_Y;
    const soupMaxY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT;

    for (let i = 0; i < this.particleData.length; i++) {
      const particle = this.particleData[i];

      // Update particle position
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;

      // Wrap around soup bounds
      if (particle.x > soupMaxX + 10) particle.x = soupMinX - 10;
      if (particle.y > soupMaxY + 10) particle.y = soupMinY - 10;
      if (particle.x < soupMinX - 10) particle.x = soupMaxX + 10;
      if (particle.y < soupMinY - 10) particle.y = soupMaxY + 10;

      // Update BufferGeometry positions (XZ plane: X=game X, Y=height, Z=-game Y)
      positions[i * 3] = particle.x;
      // positions[i * 3 + 1] stays at height (-0.8)
      positions[i * 3 + 2] = -particle.y;
    }

    // Mark positions as needing update
    this.dataParticles.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Update sphere particles - flow across sphere surface
   */
  private updateSphereParticles(dt: number): void {
    if (!this.sphereParticles) return;

    const deltaSeconds = dt / 1000;
    const radius = GAME_CONFIG.SPHERE_RADIUS + 5;  // Same offset as creation
    const positions = this.sphereParticles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < this.sphereParticleData.length; i++) {
      const particle = this.sphereParticleData[i];

      // Update angular positions
      particle.theta += particle.vTheta * deltaSeconds;
      particle.phi += particle.vPhi * deltaSeconds;

      // Wrap theta (longitude) around 0 to 2π
      if (particle.theta > Math.PI * 2) particle.theta -= Math.PI * 2;
      if (particle.theta < 0) particle.theta += Math.PI * 2;

      // Bounce phi (latitude) at poles to keep particles on visible hemisphere
      if (particle.phi < 0.1) {
        particle.phi = 0.1;
        particle.vPhi = Math.abs(particle.vPhi);
      }
      if (particle.phi > Math.PI - 0.1) {
        particle.phi = Math.PI - 0.1;
        particle.vPhi = -Math.abs(particle.vPhi);
      }

      // Convert spherical to Cartesian
      positions[i * 3] = radius * Math.sin(particle.phi) * Math.cos(particle.theta);
      positions[i * 3 + 1] = radius * Math.cos(particle.phi);
      positions[i * 3 + 2] = radius * Math.sin(particle.phi) * Math.sin(particle.theta);
    }

    this.sphereParticles.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Update surface flow shader uniforms with current time and entity positions
   * Called each frame in sphere mode to animate the "cosmic liquid" surface
   */
  private updateSurfaceFlowShader(dt: number): void {
    if (!this.surfaceFlowMaterial) return;

    const uniforms = this.surfaceFlowMaterial.uniforms;

    // Update time (convert ms to seconds for shader)
    uniforms.uTime.value += dt / 1000;

    // Collect entity positions from ECS (players and bots)
    const positions: THREE.Vector3[] = [];

    this.world.forEachWithTag(Tags.Player, (entity) => {
      if (positions.length >= SURFACE_FLOW_CONFIG.maxEntities) return;

      const pos = this.world.getComponent(entity, Components.Position);
      if (pos) {
        positions.push(new THREE.Vector3(pos.x, pos.y, pos.z ?? 0));
      }
    });

    // Update entity count uniform
    uniforms.uEntityCount.value = positions.length;

    // Update positions array (existing Vector3 objects are mutated in place)
    const uniformPositions = uniforms.uEntityPositions.value as THREE.Vector3[];
    for (let i = 0; i < SURFACE_FLOW_CONFIG.maxEntities; i++) {
      if (i < positions.length) {
        uniformPositions[i].copy(positions[i]);
      } else {
        // Zero out unused slots (won't affect shader due to uEntityCount check)
        uniformPositions[i].set(0, 0, 0);
      }
    }
  }
}
