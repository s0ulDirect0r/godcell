// ============================================
// EnvironmentSystem - Manages background environments
// Owns soup/jungle backgrounds, particles, ground plane
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '#shared';
// Note: Flat mode JungleBackground imports removed - game is sphere-only now
import {
  createSphereJungleBackground,
  SphereJungleComponents,
} from '../three/SphereJungleBackground';
import {
  updateGravityWellCache,
  getGravityWellCache,
  updateGridLineDistortion,
  createSubdividedLine,
} from '../utils/GravityDistortionUtils';
import { World, Tags, Components, type PositionComponent } from '../../ecs';

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

  // === CAUSTIC PARAMETERS ===
  // causticIntensity: How bright the caustic highlights are
  // Range: 0.0 - 0.3, Default: 0.05 (very subtle)
  causticIntensity: 0.05,

  // causticScale: Size of the caustic pattern (higher = smaller patterns)
  // Range: 0.0005 - 0.03, Default: 0.02
  causticScale: 0.02,

  // causticSpeed: How fast the patterns drift
  // Range: 0.5 - 3.0, Default: 1.5
  causticSpeed: 1.5,

  // causticColor: Dark blue for subtle caustic highlights
  causticColor: { r: 0.0, g: 0.15, b: 0.35 },
};

// ============================================
// Void Temple Shader for God Sphere
// ============================================
// Dark void surface with glowing golden sacred geometry patterns
// Evangelion Angel / AT Field aesthetic - "Be not afraid"
// Dark base stays below bloom threshold, golden lines glow through bloom

/**
 * Void Temple Shader Configuration
 *
 * Controls the god sphere's otherworldly appearance:
 * - Near-black void base that absorbs light
 * - Golden geometric patterns that pulse with divine energy
 * - Sacred geometry lines emanating from icosahedron structure
 */
const VOID_TEMPLE_CONFIG = {
  // === BASE VOID PARAMETERS ===
  // voidColor: Near-black base - must stay below bloom threshold (0.3)
  // Very dark with subtle deep blue undertone for depth
  voidColor: { r: 0.02, g: 0.02, b: 0.04 },

  // === GOLDEN GLOW PARAMETERS ===
  // glowColor: Divine gold - bright enough to trigger bloom
  // RGB values > 0.3 will glow; 0.8+ creates strong bloom
  glowColor: { r: 1.0, g: 0.85, b: 0.3 },

  // glowIntensity: Multiplier for glow brightness
  // Range: 0.1 - 1.0, Default: 0.3 (subtle glow, not blinding)
  glowIntensity: 0.3,

  // === SACRED GEOMETRY PARAMETERS ===
  // lineFrequency: Controls density of geometric patterns
  // Higher = more intricate patterns; Lower = bolder, simpler lines
  // Range: 0.0002 - 0.001, Default: 0.0004
  lineFrequency: 0.0004,

  // lineSharpness: How sharp vs soft the line edges are
  // Higher = crisp lines; Lower = soft glow gradient
  // Range: 10 - 100, Default: 40
  lineSharpness: 40.0,

  // === ANIMATION PARAMETERS ===
  // pulseSpeed: Breathing animation frequency (radians/second)
  // 0.3 = slow divine pulse; 1.0 = rapid heartbeat
  // Range: 0.1 - 1.0, Default: 0.3
  pulseSpeed: 0.3,

  // pulseDepth: How much the glow intensity varies during pulse
  // 0.0 = no pulse; 0.5 = 50% variation
  // Range: 0.0 - 0.5, Default: 0.2
  pulseDepth: 0.2,
};

const VOID_TEMPLE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  vPosition = position;
  vNormal = normal;
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VOID_TEMPLE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uVoidColor;
uniform vec3 uGlowColor;
uniform float uGlowIntensity;
uniform float uLineFrequency;
uniform float uLineSharpness;
uniform float uPulseSpeed;
uniform float uPulseDepth;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

// Hash function for pseudo-random values
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// 3D Value noise
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

// Sacred geometry pattern - creates interlocking triangular/hexagonal lines
// Based on distance to nearest edge in a tessellated pattern
float sacredGeometry(vec3 p) {
  // Scale position for pattern density
  vec3 q = p * uLineFrequency;

  // Multiple overlapping geometric patterns at different scales
  // Creates the "divine architecture" feel

  // Primary pattern: large-scale icosahedron-like divisions
  float pattern1 = 0.0;
  // Use spherical coordinates for clean sphere-surface patterns
  float r = length(p);
  float theta = atan(p.z, p.x);
  float phi = acos(p.y / r);

  // Create latitude/longitude grid with golden ratio proportions
  // Golden ratio (phi) appears in icosahedron geometry
  float goldenAngle = 2.39996; // ~137.5 degrees in radians

  // Longitudinal lines (meridians) - 20 divisions like icosahedron faces
  float lonLines = abs(sin(theta * 10.0));

  // Latitudinal lines (parallels) - 6 divisions
  float latLines = abs(sin(phi * 6.0));

  // Diagonal sacred geometry lines - creates triangular tessellation
  float diagLines1 = abs(sin((theta + phi) * 8.0));
  float diagLines2 = abs(sin((theta - phi) * 8.0));

  // Combine patterns - take minimum distance to any line
  float lines = min(lonLines, latLines);
  lines = min(lines, diagLines1);
  lines = min(lines, diagLines2);

  // Convert to sharp lines using smoothstep
  // lines close to 0 = on a line, close to 1 = between lines
  float lineGlow = 1.0 - smoothstep(0.0, 0.15, lines);

  // Add secondary finer pattern for complexity
  float fineTheta = abs(sin(theta * 30.0));
  float finePhi = abs(sin(phi * 15.0));
  float fineLines = min(fineTheta, finePhi);
  float fineGlow = 1.0 - smoothstep(0.0, 0.1, fineLines);

  // Combine: primary lines at full intensity, fine lines at reduced
  return lineGlow + fineGlow * 0.3;
}

// Hexagonal pattern for additional sacred geometry feel
float hexPattern(vec3 p) {
  vec3 q = p * uLineFrequency * 2.0;

  // Project onto sphere surface and create hex grid
  float r = length(p);
  vec2 uv = vec2(atan(p.z, p.x), acos(p.y / r));
  uv *= 10.0; // Scale for hex size

  // Hex grid math
  vec2 hexUV = uv;
  hexUV.x *= 1.1547; // 2/sqrt(3)
  hexUV.y += mod(floor(hexUV.x), 2.0) * 0.5;
  hexUV = fract(hexUV) - 0.5;

  // Distance to hex edge
  float hexDist = max(abs(hexUV.x), abs(hexUV.y) * 0.866 + abs(hexUV.x) * 0.5);

  // Sharp hex edges
  return 1.0 - smoothstep(0.4, 0.5, hexDist);
}

void main() {
  // Base void color - near black, won't trigger bloom
  vec3 color = uVoidColor;

  // Calculate sacred geometry pattern intensity
  float geometry = sacredGeometry(vPosition);

  // Add hexagonal overlay for extra complexity
  float hex = hexPattern(vPosition) * 0.4;
  geometry = max(geometry, hex);

  // Animated pulse - slow divine breathing
  float pulse = 1.0 - uPulseDepth + uPulseDepth * sin(uTime * uPulseSpeed);

  // Apply golden glow to geometric patterns
  // Glow color is bright enough to trigger bloom (values > 0.3)
  vec3 glow = uGlowColor * geometry * uGlowIntensity * pulse;

  // Add subtle noise variation to prevent banding
  float noiseVar = noise3D(vPosition * 0.001) * 0.1;
  glow *= (1.0 + noiseVar);

  // Fresnel effect - edges glow brighter (rim lighting)
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = 1.0 - abs(dot(normalize(vNormal), viewDir));
  fresnel = pow(fresnel, 2.0);

  // Add subtle golden fresnel rim
  glow += uGlowColor * fresnel * 0.3 * pulse;

  // Final color: void base + glowing patterns
  color += glow;

  // Full opacity - solid divine barrier
  gl_FragColor = vec4(color, 1.0);
}
`;

// Legacy marble shader constants (kept for reference, no longer used)
const MARBLE_VERTEX_SHADER = /* glsl */ `
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vPosition = position;
  vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MARBLE_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vPosition;
varying vec3 vNormal;

// Hash function for pseudo-random values
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// 3D Value noise
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

// Fractal Brownian Motion for layered veining
float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise3D(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// Calacatta marble pattern - golden/amber veins on cream base
float marble(vec3 p) {
  // Scale for marble vein size on large sphere
  // Lower = larger, more spread out veins
  float scale = 0.0004;
  vec3 q = p * scale;

  // Multiple noise octaves for organic, flowing veins
  float n = fbm(q);
  n += 0.5 * fbm(q * 2.0 + vec3(1.7, 9.2, 8.3));
  n += 0.25 * fbm(q * 4.0 + vec3(8.3, 2.8, 4.1));

  // Create vein pattern - sine creates characteristic marble flow
  float vein = sin((q.x + q.y * 0.7 + q.z * 0.5) * 2.5 + n * 10.0);

  // Map to 0-1 and sharpen for bold veins
  vein = (vein + 1.0) * 0.5;
  // Lower power = bolder, more prominent veins
  vein = pow(vein, 0.5);

  return vein;
}

void main() {
  // Calacatta marble colors - bright and realistic
  // Warm cream/off-white base
  vec3 creamBase = vec3(0.95, 0.93, 0.88);

  // Golden/amber vein color (matches gold icosahedron lines)
  vec3 goldVein = vec3(0.76, 0.55, 0.25);

  // Secondary darker accent for depth
  vec3 brownAccent = vec3(0.45, 0.32, 0.18);

  // Get marble pattern
  float pattern = marble(vPosition);

  // Secondary pattern offset for color variation
  float pattern2 = marble(vPosition + vec3(1000.0, 500.0, 750.0));

  // Mix gold and brown for vein color variation
  vec3 veinColor = mix(goldVein, brownAccent, pattern2 * 0.4);

  // Mix between cream base and vein color
  // pattern close to 1 = cream, close to 0 = vein
  vec3 color = mix(veinColor, creamBase, pattern);

  // Subtle lighting for depth (hemisphere light)
  float light = dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)) * 0.12 + 0.88;
  color *= light;

  // Full opacity for solid marble feel
  gl_FragColor = vec4(color, 1.0);
}
`;

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
uniform float uCausticIntensity;
uniform float uCausticScale;
uniform float uCausticSpeed;
uniform vec3 uCausticColor;

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

// Caustic pattern - overlapping sine waves at different angles
// Creates that classic "light through water" dancing pattern
float caustic(vec3 p, float time) {
  float scale = uCausticScale * 100.0; // Scale up for visible patterns
  float speed = uCausticSpeed;

  // Multiple overlapping waves at different angles
  float c = 0.0;
  c += sin(p.x * scale + time * speed + sin(p.y * scale * 0.5 + time * speed * 0.7));
  c += sin(p.y * scale * 0.8 - time * speed * 0.6 + sin(p.z * scale * 0.6 + time * speed * 0.4));
  c += sin(p.z * scale * 0.9 + time * speed * 0.8 + sin(p.x * scale * 0.7 - time * speed * 0.5));
  c += sin((p.x + p.y) * scale * 0.7 + time * speed * 0.9);
  c += sin((p.y + p.z) * scale * 0.6 - time * speed * 0.5);

  c = c / 5.0; // Average
  c = c * 0.5 + 0.5; // Normalize to 0-1

  // Threshold to get bright caustic lines (soft wavy luminance)
  c = smoothstep(0.55, 0.85, c);

  return c;
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

  // === CAUSTICS ===
  // Soft wavy luminance pattern on the dark surface
  float causticPattern = caustic(surfaceNormal * uRadius, uTime);
  color += uCausticColor * causticPattern * uCausticIntensity;

  // Very subtle fresnel
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 4.0);
  color += uFlowColor * fresnel * 0.03;

  // Barely transparent surface
  gl_FragColor = vec4(color, 0.92);
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
  // God sphere fresnel shader (outer surface)
  private godSphereMaterial?: THREE.ShaderMaterial;
  // God sphere inner digital night sky shader
  private godSphereInnerMaterial?: THREE.ShaderMaterial;
  // Flower of Life tube shader
  private flowerOfLifeMaterial?: THREE.ShaderMaterial;
  private sphereParticleData: Array<{
    theta: number;  // Longitude angle
    phi: number;    // Latitude angle
    vTheta: number; // Angular velocity in theta
    vPhi: number;   // Angular velocity in phi
    size: number;
  }> = [];

  // Sphere jungle (Stage 3-4 outer surface with grass, particles, etc.)
  private sphereJungle?: SphereJungleComponents;
  private sphereJungleTime: number = 0;

  /**
   * Initialize environment system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
    this.isSphereWorld = true; // Game is now sphere-only

    // Create sphere-specific environment
    this.createSphereEnvironment();
    scene.background = new THREE.Color(GAME_CONFIG.BACKGROUND_COLOR);
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
    // Mark as environment so it's not affected by sphere visibility culling
    this.sphereBackgroundGroup.userData.isEnvironment = true;

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
        uCausticIntensity: { value: SURFACE_FLOW_CONFIG.causticIntensity },
        uCausticScale: { value: SURFACE_FLOW_CONFIG.causticScale },
        uCausticSpeed: { value: SURFACE_FLOW_CONFIG.causticSpeed },
        uCausticColor: {
          value: new THREE.Vector3(
            SURFACE_FLOW_CONFIG.causticColor.r,
            SURFACE_FLOW_CONFIG.causticColor.g,
            SURFACE_FLOW_CONFIG.causticColor.b
          ),
        },
      },
      side: THREE.FrontSide,
      transparent: false, // TEMP: disabled for testing
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
      color: 0x00aa88, // Dimmer cyan-green
      wireframe: true,
      transparent: true,
      opacity: 0.25,
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

    // === LAYER 5: Jungle Sphere (inner surface, 4x radius) ===
    // Players on Stage 3+ stand on the INSIDE of this sphere, looking down at soup
    // BackSide renders the inner surface visible from inside
    const jungleRadius = GAME_CONFIG.JUNGLE_SPHERE_RADIUS;
    const jungleGeometry = new THREE.IcosahedronGeometry(jungleRadius, 4);
    const jungleMaterial = new THREE.MeshBasicMaterial({
      color: 0x002211, // Dark forest green
      side: THREE.BackSide, // Render inner surface (visible from inside)
      transparent: true,
      opacity: 0.3, // Semi-transparent so we can see soup through it
      depthWrite: false,
    });
    const jungleMesh = new THREE.Mesh(jungleGeometry, jungleMaterial);
    jungleMesh.name = 'jungleSphere';
    this.sphereBackgroundGroup.add(jungleMesh);

    // Jungle wireframe (inner surface reference)
    const jungleWireframeGeometry = new THREE.IcosahedronGeometry(jungleRadius - 10, 3);
    const jungleWireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff44, // Bright green wireframe
      wireframe: true,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const jungleWireframeMesh = new THREE.Mesh(jungleWireframeGeometry, jungleWireframeMaterial);
    this.sphereBackgroundGroup.add(jungleWireframeMesh);

    // === LAYER 6: God Sphere (outermost boundary) ===
    // Dark stone surface with prominent golden icosahedron wireframe
    // Eva Angel / AT Field vibes - "Be not afraid"
    const godRadius = GAME_CONFIG.GOD_SPHERE_RADIUS;

    // Fresnel sphere - black center, warm edge glow visible from OUTSIDE only
    const godSurfaceRadius = godRadius - 50;
    const godGeometry = new THREE.IcosahedronGeometry(godSurfaceRadius, 4);

    this.godSphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          // Transform normal to world space (not view space)
          vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
          fresnel = pow(fresnel, 2.5);
          float pulse = 1.0 + sin(uTime * 0.3) * 0.03;
          vec3 glowColor = vec3(0.95, 0.75, 0.45) * fresnel * 0.9 * pulse;
          gl_FragColor = vec4(glowColor, 1.0);
        }
      `,
      side: THREE.FrontSide, // Only visible from outside
      depthWrite: true,
    });

    const godMesh = new THREE.Mesh(godGeometry, this.godSphereMaterial);
    godMesh.name = 'godSphere';
    this.sphereBackgroundGroup.add(godMesh);

    // Inner surface - digital night sky visible from INSIDE (junglesphere players looking up)
    const godInnerGeometry = new THREE.IcosahedronGeometry(godSurfaceRadius - 500, 5);
    const godInnerMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vPosition;

        // Hash for pseudo-random
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // Smooth noise
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          // Spherical UV from position
          vec3 n = normalize(vPosition);
          vec2 uv = vec2(atan(n.z, n.x), asin(n.y)) * 2.0;

          // Subtle wisp - just one layer, very faint
          float time = uTime * 0.01;
          float wisp = noise(uv * 1.5 + time);
          wisp = wisp * 0.08;

          // Star points - distance from cell center
          vec2 starUv = uv * 15.0;
          vec2 cellId = floor(starUv);
          vec2 cellUv = fract(starUv) - 0.5;
          float starRand = hash(cellId);
          float star = 0.0;
          if (starRand > 0.92) {
            // Distance from center of cell
            float d = length(cellUv);
            star = smoothstep(0.15, 0.0, d) * 0.5;
          }

          // Light blue tint - very subtle
          vec3 wispColor = vec3(0.05, 0.08, 0.1) * wisp;
          vec3 starColor = vec3(0.5, 0.7, 0.9) * star;

          // Nearly black base
          vec3 color = vec3(0.0, 0.0, 0.01) + wispColor + starColor;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    const godInnerMesh = new THREE.Mesh(godInnerGeometry, godInnerMaterial);
    godInnerMesh.name = 'godSphereInner';
    this.sphereBackgroundGroup.add(godInnerMesh);

    // Store for time updates
    this.godSphereInnerMaterial = godInnerMaterial;

    // Flower of Life pattern - overlapping circles on sphere surface
    const flowerGroup = new THREE.Group();
    flowerGroup.name = 'godSphereFlowerOfLife';

    // Tube shader - very slow, subtle warm pulse
    const tubeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
      },
      vertexShader: `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        void main() {
          float pulse = 0.65 + sin(uTime * 0.7) * 0.15;
          vec3 gold = vec3(0.72, 0.53, 0.04) * pulse;
          gl_FragColor = vec4(gold, 0.7);
        }
      `,
      transparent: true,
    });
    this.flowerOfLifeMaterial = tubeMaterial;

    // Circle radius - controls pattern density
    // In Flower of Life, center-to-center distance equals circle radius
    const circleRadius = godRadius * 0.28;
    const circleSegments = 48; // Points around each circle
    const tubeRadius = 40; // Thickness of the tube (world units)
    const tubeSegments = 6; // Radial segments for tube cross-section

    // Create a tube circle on the sphere surface
    const createCircleOnSphere = (theta: number, phi: number) => {
      const points: THREE.Vector3[] = [];

      // Position on sphere surface
      const centerX = godRadius * Math.sin(phi) * Math.cos(theta);
      const centerY = godRadius * Math.cos(phi);
      const centerZ = godRadius * Math.sin(phi) * Math.sin(theta);
      const center = new THREE.Vector3(centerX, centerY, centerZ);

      // Normal at this point (points outward from sphere center)
      const normal = center.clone().normalize();

      // Create two perpendicular vectors on the tangent plane
      const up = new THREE.Vector3(0, 1, 0);
      let tangent1 = new THREE.Vector3().crossVectors(up, normal).normalize();
      if (tangent1.length() < 0.1) {
        tangent1 = new THREE.Vector3(1, 0, 0);
      }
      const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();

      // Create circle points projected onto sphere surface (geodesic circle)
      for (let i = 0; i <= circleSegments; i++) {
        const angle = (i / circleSegments) * Math.PI * 2;
        const point = center.clone()
          .addScaledVector(tangent1, Math.cos(angle) * circleRadius)
          .addScaledVector(tangent2, Math.sin(angle) * circleRadius);
        // Project onto sphere surface
        point.normalize().multiplyScalar(godRadius);
        points.push(point);
      }

      // Create a smooth curve from the points and make a tube
      const curve = new THREE.CatmullRomCurve3(points, true); // true = closed loop
      const tubeGeometry = new THREE.TubeGeometry(curve, circleSegments, tubeRadius, tubeSegments, true);
      return new THREE.Mesh(tubeGeometry, this.flowerOfLifeMaterial);
    };

    // Generate Flower of Life pattern across sphere using hexagonal packing
    // KEY: In Flower of Life, each circle's CENTER lies ON the CIRCUMFERENCE of neighbors
    // This means center-to-center distance = radius (NOT diameter)
    // Creates 50% overlap and the characteristic "petal" vesica piscis shapes
    const angularRadius = circleRadius / godRadius; // Convert to angular units
    const rowSpacing = angularRadius * Math.sqrt(3) / 2; // Hex packing vertical: r * sqrt(3)/2
    const colSpacing = angularRadius; // Center-to-center = radius for 50% overlap

    // Number of latitude rows to cover sphere
    const numRows = Math.ceil(Math.PI / rowSpacing);

    for (let row = 0; row <= numRows; row++) {
      const phi = row * rowSpacing; // Latitude from 0 to PI
      if (phi > Math.PI) continue;

      // Circumference at this latitude determines number of circles
      const circumference = Math.sin(phi) * 2 * Math.PI;
      const numCircles = Math.max(1, Math.round(circumference / colSpacing));

      for (let col = 0; col < numCircles; col++) {
        // Offset every other row by half spacing for hexagonal packing
        const offset = (row % 2 === 0) ? 0 : colSpacing / 2;
        const theta = (col / numCircles) * Math.PI * 2 + offset;
        flowerGroup.add(createCircleOnSphere(theta, phi));
      }
    }

    this.sphereBackgroundGroup.add(flowerGroup);

    this.scene.add(this.sphereBackgroundGroup);

    // === LAYER 7: Sphere Jungle (outer surface with grass, particles) ===
    // Full jungle aesthetic wrapped onto the jungle sphere outer surface
    // Players walk on this surface like a planet
    this.sphereJungle = createSphereJungleBackground(this.scene, jungleRadius);
  }

  /**
   * Create flowing data particles on sphere surface
   */
  private createSphereParticles(radius: number): void {
    // 5x particles for dense data field
    const particleCount = Math.floor(GAME_CONFIG.MAX_PARTICLES * 5);
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

      // Convert spherical to Cartesian (above wireframe)
      const r = radius + 15;  // Lift particles above surface and wireframe
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
   * Note: In sphere mode, always returns false (no mode switching)
   */
  setMode(_mode: RenderMode): boolean {
    // Sphere mode: always stay in 'soup' mode, no switching
    return false;
  }

  // ============================================
  // First-Person Ground
  // ============================================

  /**
   * Set first-person ground visibility
   * Called when entering/exiting first-person mode
   * Note: In sphere mode, this is a no-op (no first-person ground plane)
   */
  setFirstPersonGroundVisible(_visible: boolean): void {
    // No-op in sphere mode - there's no first-person ground plane
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
    this.updateSphereParticles(dt);
    this.updateSurfaceFlowShader(dt);
    if (!this.gravityWellCacheUpdated && this.world) {
      updateGravityWellCache(this.world);
      if (getGravityWellCache().length > 0) {
        this.gravityWellCacheUpdated = true;
      }
    }

    // Update sphere jungle animations (grass wind, fireflies, undergrowth)
    if (this.sphereJungle) {
      this.sphereJungleTime += dt / 1000; // Convert to seconds
      this.sphereJungle.update(this.sphereJungleTime, dt / 1000);
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
    const radius = GAME_CONFIG.SPHERE_RADIUS + 15;  // Same offset as creation
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
    // Update god sphere shaders time
    if (this.godSphereMaterial) {
      this.godSphereMaterial.uniforms.uTime.value += dt / 1000;
    }
    if (this.godSphereInnerMaterial) {
      this.godSphereInnerMaterial.uniforms.uTime.value += dt / 1000;
    }
    if (this.flowerOfLifeMaterial) {
      this.flowerOfLifeMaterial.uniforms.uTime.value += dt / 1000;
    }

    if (!this.surfaceFlowMaterial) return;

    const uniforms = this.surfaceFlowMaterial.uniforms;

    // Update time (convert ms to seconds for shader)
    uniforms.uTime.value += dt / 1000;

    // Collect entity positions from ECS (players and bots)
    const positions: THREE.Vector3[] = [];

    this.world.forEachWithTag(Tags.Player, (entity) => {
      if (positions.length >= SURFACE_FLOW_CONFIG.maxEntities) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
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
