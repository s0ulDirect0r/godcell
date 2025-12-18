// ============================================
// Sphere Jungle Background - Digital jungle wrapped onto sphere surface
// For Stage 3-4 players on the outer surface of the Jungle Sphere
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG, slerp, type Vec3 } from '#shared';

/**
 * Visual parameters for sphere jungle - adapted from flat JungleBackground
 * Players walk on OUTER surface of sphere (like a planet)
 * Grass grows OUTWARD from surface
 */
const SPHERE_JUNGLE_CONFIG = {
  // Sphere radius (from GAME_CONFIG, but stored here for reference)
  SPHERE_RADIUS: GAME_CONFIG.JUNGLE_SPHERE_RADIUS, // 9792

  // === GEODESIC GRID (replaces hex grid) ===
  GRID_SUBDIVISION: 4, // Icosahedron subdivision level
  GRID_LINE_COLOR: 0x004444, // Dark teal
  GRID_LINE_OPACITY: 0.4,
  GRID_OFFSET: 5, // Slightly smaller radius than grass

  // === STYLIZED GRASS ===
  GRASS_BLADE_COUNT: 120000, // Full density
  GRASS_MIN_HEIGHT: 100,
  GRASS_MAX_HEIGHT: 240,
  GRASS_WIDTH: 24,
  GRASS_COLORS: [
    0x006633, // Dark green-cyan
    0x005522, // Dark green
    0x004418, // Very dark green
    0x006644, // Dark cyan-green
  ],
  GRASS_OPACITY: 0.4,
  GRASS_SWAY_SPEED: 0.8,
  GRASS_SWAY_AMOUNT: 5,

  // === DIRT/MUD GROUND ===
  DIRT_OFFSET: 10, // Slightly smaller radius than grass
  DIRT_BASE_COLOR: 0x1a0f05, // Dark brown
  DIRT_HIGHLIGHT_COLOR: 0x2a1f15, // Lighter brown
  DIRT_NOISE_SCALE: 0.001, // Scale for 3D noise

  // === UNDERGROWTH PARTICLES ===
  UNDERGROWTH_COUNT: 1500,
  UNDERGROWTH_COLORS: [
    0x00ff88, // Green-cyan
    0x00ffaa, // Lighter green
    0x00ddff, // Cyan-blue
    0x88ff00, // Yellow-green
  ],
  UNDERGROWTH_PULSE_SPEED: 0.3,
  UNDERGROWTH_PULSE_RANGE: 0.4,
  UNDERGROWTH_HEIGHT_OFFSET: 5, // Slightly above surface

  // === FIREFLY PARTICLES ===
  FIREFLY_COUNT: 80,
  FIREFLY_SIZE: 4,
  FIREFLY_HEIGHT_MIN: 20, // Above surface
  FIREFLY_HEIGHT_MAX: 150,
  FIREFLY_SPEED: 8,
  FIREFLY_PULSE_SPEED: 1.5,
  FIREFLY_COLORS: [
    0x00ff88, // Green
    0xffff00, // Yellow
    0x00ffff, // Cyan
  ],

  // === TERRAIN PATCHES ===
  TERRAIN_PATCH_COUNT: 30,
  TERRAIN_PATCH_MIN_RADIUS: 200,
  TERRAIN_PATCH_MAX_RADIUS: 600,
  TERRAIN_PATCH_OPACITY: 0.15,
  TERRAIN_PATCH_COLORS: [
    0x003322, // Dark green tint
    0x002233, // Dark blue tint
    0x102020, // Neutral dark
    0x201510, // Warm dark
  ],

  // === ROOT NETWORK ===
  ROOT_COLOR: 0x00ffaa, // Cyan-green glow
  ROOT_OPACITY: 0.7,
  ROOT_RADIUS: 12, // Tube thickness
  ROOT_HEIGHT_OFFSET: 15, // Distance above sphere surface
  ROOT_MAX_CONNECTION_DIST: 2500, // Max distance to connect trees (sphere arc distance)
  ROOT_CONNECTIONS_PER_TREE: 3, // Max neighbors to connect to
  ROOT_CURVE_SEGMENTS: 16, // Smoothness of tube curves
  ROOT_PULSE_SPEED: 0.4, // Animation speed
  ROOT_PULSE_RANGE: 0.3, // Intensity variation
};

// Animation data interfaces
interface SphereUndergrowthParticle {
  theta: number; // Longitude
  phi: number; // Latitude
  phase: number; // Animation phase offset
  baseOpacity: number;
}

interface SphereFireflyParticle {
  theta: number;
  phi: number;
  heightOffset: number; // Distance above surface
  vTheta: number; // Angular velocity
  vPhi: number;
  vHeight: number;
  phase: number;
  color: number;
}

// Return type for the create function
export interface SphereJungleComponents {
  group: THREE.Group;
  grassMesh: THREE.Mesh;
  gridLines: THREE.LineSegments;
  dirtSphere: THREE.Mesh;
  undergrowthPoints: THREE.Points;
  undergrowthData: SphereUndergrowthParticle[];
  fireflyPoints: THREE.Points;
  fireflyData: SphereFireflyParticle[];
  update: (time: number, delta: number) => void;
}

/**
 * Create sphere jungle background with all components
 * @param scene - Three.js scene to add to
 * @param radius - Sphere radius (default: JUNGLE_SPHERE_RADIUS)
 */
export function createSphereJungleBackground(
  scene: THREE.Scene,
  radius: number = SPHERE_JUNGLE_CONFIG.SPHERE_RADIUS
): SphereJungleComponents {
  const group = new THREE.Group();
  group.name = 'sphereJungleBackground';
  group.visible = true;

  // Create components from bottom to top (render order)
  const dirtSphere = createSphereDirtGround(radius - SPHERE_JUNGLE_CONFIG.DIRT_OFFSET);
  group.add(dirtSphere);

  const gridLines = createGeodesicGrid(radius - SPHERE_JUNGLE_CONFIG.GRID_OFFSET);
  group.add(gridLines);

  const grassMesh = createSphereGrass(radius);
  group.add(grassMesh);

  const { points: undergrowthPoints, data: undergrowthData } = createSphereUndergrowth(
    radius + SPHERE_JUNGLE_CONFIG.UNDERGROWTH_HEIGHT_OFFSET
  );
  group.add(undergrowthPoints);

  const { points: fireflyPoints, data: fireflyData } = createSphereFireflies(radius);
  group.add(fireflyPoints);

  scene.add(group);

  // Update function for animations
  const update = (time: number, delta: number) => {
    // Update grass shader time
    const grassMaterial = grassMesh.material as THREE.ShaderMaterial;
    if (grassMaterial.uniforms) {
      grassMaterial.uniforms.uTime.value = time;
    }

    // Update undergrowth pulse
    updateSphereUndergrowth(
      undergrowthPoints,
      undergrowthData,
      time,
      radius + SPHERE_JUNGLE_CONFIG.UNDERGROWTH_HEIGHT_OFFSET
    );

    // Update fireflies
    updateSphereFireflies(fireflyPoints, fireflyData, time, delta, radius);
  };

  return {
    group,
    grassMesh,
    gridLines,
    dirtSphere,
    undergrowthPoints,
    undergrowthData,
    fireflyPoints,
    fireflyData,
    update,
  };
}

/**
 * Create geodesic grid floor using icosahedron edges
 * Replaces hex grid (which doesn't tile on spheres)
 */
function createGeodesicGrid(radius: number): THREE.LineSegments {
  const gridGeom = new THREE.IcosahedronGeometry(radius, SPHERE_JUNGLE_CONFIG.GRID_SUBDIVISION);
  const edges = new THREE.EdgesGeometry(gridGeom);

  const material = new THREE.LineBasicMaterial({
    color: SPHERE_JUNGLE_CONFIG.GRID_LINE_COLOR,
    transparent: true,
    opacity: SPHERE_JUNGLE_CONFIG.GRID_LINE_OPACITY,
  });

  const gridLines = new THREE.LineSegments(edges, material);
  gridLines.name = 'sphereJungleGrid';

  return gridLines;
}

/**
 * Create dirt/mud ground layer as a sphere with noise-based coloring
 */
function createSphereDirtGround(radius: number): THREE.Mesh {
  const geometry = new THREE.IcosahedronGeometry(radius, 5);

  // Simple shader for dirt with position-based color variation
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: {
        value: new THREE.Color(SPHERE_JUNGLE_CONFIG.DIRT_BASE_COLOR),
      },
      uHighlightColor: {
        value: new THREE.Color(SPHERE_JUNGLE_CONFIG.DIRT_HIGHLIGHT_COLOR),
      },
      uNoiseScale: { value: SPHERE_JUNGLE_CONFIG.DIRT_NOISE_SCALE },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vNormal;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uBaseColor;
      uniform vec3 uHighlightColor;
      uniform float uNoiseScale;

      varying vec3 vWorldPosition;
      varying vec3 vNormal;

      // Simple 3D noise approximation using sin
      float noise3D(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 45.543))) * 43758.5453);
      }

      void main() {
        // Sample noise at world position
        vec3 noisePos = vWorldPosition * uNoiseScale;
        float n = noise3D(noisePos);
        n += noise3D(noisePos * 2.0) * 0.5;
        n += noise3D(noisePos * 4.0) * 0.25;
        n = n / 1.75; // Normalize

        // Mix colors based on noise
        vec3 color = mix(uBaseColor, uHighlightColor, n * 0.5);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sphereJungleDirt';

  return mesh;
}

/**
 * Create stylized grass covering the sphere surface
 * Uses Fibonacci sphere distribution for uniform coverage
 */
function createSphereGrass(radius: number): THREE.Mesh {
  const bladeCount = SPHERE_JUNGLE_CONFIG.GRASS_BLADE_COUNT;
  const verticesPerBlade = 5;
  const indicesPerBlade = 9;

  // Allocate buffers
  const positions = new Float32Array(bladeCount * verticesPerBlade * 3);
  const colors = new Float32Array(bladeCount * verticesPerBlade * 3);
  const animIntensities = new Float32Array(bladeCount * verticesPerBlade);
  const indices = new Uint32Array(bladeCount * indicesPerBlade);

  // Height levels for 5 vertices: bottom-left, bottom-right, mid-left, mid-right, top
  const heightLevels = [0, 0, 0.4, 0.4, 1.0];
  // Animation intensity: 0 at base, higher at tip
  const animLevels = [0, 0, 0.3, 0.3, 1.0];

  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const grassColors = SPHERE_JUNGLE_CONFIG.GRASS_COLORS;

  for (let i = 0; i < bladeCount; i++) {
    // Fibonacci sphere distribution for blade base position
    const theta = (2 * Math.PI * i) / goldenRatio; // Longitude
    const phi = Math.acos(1 - (2 * (i + 0.5)) / bladeCount); // Latitude

    // Convert to Cartesian (base on sphere surface)
    const baseX = radius * Math.sin(phi) * Math.cos(theta);
    const baseY = radius * Math.cos(phi);
    const baseZ = radius * Math.sin(phi) * Math.sin(theta);

    // Surface normal (outward from center)
    const nx = baseX / radius;
    const ny = baseY / radius;
    const nz = baseZ / radius;

    // Tangent vector for blade width direction
    // Use derivative of theta direction (perpendicular to radial)
    const tx = -Math.sin(theta);
    const ty = 0;
    const tz = Math.cos(theta);

    // Random blade properties
    const height =
      SPHERE_JUNGLE_CONFIG.GRASS_MIN_HEIGHT +
      Math.random() *
        (SPHERE_JUNGLE_CONFIG.GRASS_MAX_HEIGHT - SPHERE_JUNGLE_CONFIG.GRASS_MIN_HEIGHT);
    const width = SPHERE_JUNGLE_CONFIG.GRASS_WIDTH * (0.7 + Math.random() * 0.6);

    // Random color from palette
    const colorHex = grassColors[Math.floor(Math.random() * grassColors.length)];
    const r = ((colorHex >> 16) & 255) / 255;
    const g = ((colorHex >> 8) & 255) / 255;
    const b = (colorHex & 255) / 255;

    // Generate 5 vertices for this blade
    for (let v = 0; v < verticesPerBlade; v++) {
      const idx = (i * verticesPerBlade + v) * 3;

      // Width offset along tangent
      let widthOffset = 0;
      if (v === 0 || v === 2) widthOffset = -width / 2; // Left vertices
      if (v === 1 || v === 3) widthOffset = width / 2; // Right vertices
      // Top vertex (v=4) stays at center

      // Height along normal
      const h = heightLevels[v] * height;

      // Position = base + normal * h + tangent * widthOffset
      positions[idx] = baseX + nx * h + tx * widthOffset;
      positions[idx + 1] = baseY + ny * h + ty * widthOffset;
      positions[idx + 2] = baseZ + nz * h + tz * widthOffset;

      // Color with height-based brightness variation
      const intensity = animLevels[v];
      colors[idx] = r * (0.5 + 0.5 * intensity);
      colors[idx + 1] = g * (0.5 + 0.5 * intensity);
      colors[idx + 2] = b * (0.5 + 0.5 * intensity);

      // Store animation intensity for shader
      animIntensities[i * verticesPerBlade + v] = intensity;
    }

    // Generate indices for 3 triangles per blade
    const baseVertex = i * verticesPerBlade;
    const baseIndex = i * indicesPerBlade;

    // Triangle 1: bottom-left, bottom-right, mid-left
    indices[baseIndex] = baseVertex;
    indices[baseIndex + 1] = baseVertex + 1;
    indices[baseIndex + 2] = baseVertex + 2;

    // Triangle 2: bottom-right, mid-right, mid-left
    indices[baseIndex + 3] = baseVertex + 1;
    indices[baseIndex + 4] = baseVertex + 3;
    indices[baseIndex + 5] = baseVertex + 2;

    // Triangle 3: mid-left, mid-right, top
    indices[baseIndex + 6] = baseVertex + 2;
    indices[baseIndex + 7] = baseVertex + 3;
    indices[baseIndex + 8] = baseVertex + 4;
  }

  // Create geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aAnimIntensity', new THREE.BufferAttribute(animIntensities, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  // Shader material for wind animation
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWindSpeed: { value: SPHERE_JUNGLE_CONFIG.GRASS_SWAY_SPEED },
      uWindStrength: { value: SPHERE_JUNGLE_CONFIG.GRASS_SWAY_AMOUNT },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;

      attribute float aAnimIntensity;
      attribute vec3 color;

      varying vec3 vColor;
      varying float vHeight;

      void main() {
        vColor = color;
        vHeight = aAnimIntensity;

        // Surface normal points outward from sphere center
        vec3 normal = normalize(position);

        // Tangent vectors for wind direction (perpendicular to normal)
        vec3 worldUp = vec3(0.0, 1.0, 0.0);
        vec3 tangentU = normalize(cross(worldUp, normal));

        // Handle poles where cross product with up fails
        if (length(tangentU) < 0.001) {
          tangentU = vec3(1.0, 0.0, 0.0);
        }

        // Wind phase based on position on sphere
        float windPhase = uTime * uWindSpeed + position.x * 0.001 + position.z * 0.001;
        float windOffset = sin(windPhase) * uWindStrength * aAnimIntensity * aAnimIntensity;

        // Secondary oscillation for more natural movement
        float windPhase2 = uTime * uWindSpeed * 1.3 + position.x * 0.002 - position.z * 0.0015;
        float windOffset2 = sin(windPhase2) * uWindStrength * 0.3 * aAnimIntensity;

        // Apply wind sway along tangent direction
        vec3 pos = position + tangentU * (windOffset + windOffset2);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vHeight;

      void main() {
        // Slight glow effect - brighter at tips
        float glow = 0.3 + 0.7 * vHeight;
        vec3 finalColor = vColor * glow;

        // Semi-transparent for depth effect
        float alpha = 0.4 + 0.4 * vHeight;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sphereJungleGrass';
  mesh.frustumCulled = false; // Large object, always render

  return mesh;
}

/**
 * Create undergrowth particles on sphere surface
 */
function createSphereUndergrowth(radius: number): {
  points: THREE.Points;
  data: SphereUndergrowthParticle[];
} {
  const count = SPHERE_JUNGLE_CONFIG.UNDERGROWTH_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const data: SphereUndergrowthParticle[] = [];

  const undergrowthColors = SPHERE_JUNGLE_CONFIG.UNDERGROWTH_COLORS;

  for (let i = 0; i < count; i++) {
    // Random spherical coordinates
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());

    // Convert to Cartesian
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Random color
    const colorHex = undergrowthColors[Math.floor(Math.random() * undergrowthColors.length)];
    colors[i * 3] = ((colorHex >> 16) & 255) / 255;
    colors[i * 3 + 1] = ((colorHex >> 8) & 255) / 255;
    colors[i * 3 + 2] = (colorHex & 255) / 255;

    // Random size
    sizes[i] = 3 + Math.random() * 5;

    // Store animation data
    data.push({
      theta,
      phi,
      phase: Math.random() * Math.PI * 2,
      baseOpacity: 0.3 + Math.random() * 0.4,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 8,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'sphereJungleUndergrowth';

  return { points, data };
}

/**
 * Update undergrowth particle animation
 */
function updateSphereUndergrowth(
  points: THREE.Points,
  data: SphereUndergrowthParticle[],
  time: number,
  radius: number
): void {
  const positions = points.geometry.attributes.position.array as Float32Array;

  for (let i = 0; i < data.length; i++) {
    const particle = data[i];

    // Recalculate position (in case radius changed, though typically static)
    const x = radius * Math.sin(particle.phi) * Math.cos(particle.theta);
    const y = radius * Math.cos(particle.phi);
    const z = radius * Math.sin(particle.phi) * Math.sin(particle.theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  points.geometry.attributes.position.needsUpdate = true;

  // Animate opacity with pulsing
  const pulseSpeed = SPHERE_JUNGLE_CONFIG.UNDERGROWTH_PULSE_SPEED;
  const pulseRange = SPHERE_JUNGLE_CONFIG.UNDERGROWTH_PULSE_RANGE;
  const basePulse = Math.sin(time * pulseSpeed * Math.PI * 2) * pulseRange;
  (points.material as THREE.PointsMaterial).opacity = 0.5 + basePulse * 0.2;
}

/**
 * Create firefly particles floating above sphere surface
 */
function createSphereFireflies(radius: number): {
  points: THREE.Points;
  data: SphereFireflyParticle[];
} {
  const count = SPHERE_JUNGLE_CONFIG.FIREFLY_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const data: SphereFireflyParticle[] = [];

  const fireflyColors = SPHERE_JUNGLE_CONFIG.FIREFLY_COLORS;

  for (let i = 0; i < count; i++) {
    // Random spherical coordinates
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - 2 * Math.random());

    // Height above surface
    const heightOffset =
      SPHERE_JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN +
      Math.random() *
        (SPHERE_JUNGLE_CONFIG.FIREFLY_HEIGHT_MAX - SPHERE_JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN);

    // Convert to Cartesian at elevated radius
    const r = radius + heightOffset;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Random color
    const colorHex = fireflyColors[Math.floor(Math.random() * fireflyColors.length)];
    colors[i * 3] = ((colorHex >> 16) & 255) / 255;
    colors[i * 3 + 1] = ((colorHex >> 8) & 255) / 255;
    colors[i * 3 + 2] = (colorHex & 255) / 255;

    // Size
    sizes[i] = SPHERE_JUNGLE_CONFIG.FIREFLY_SIZE * (0.8 + Math.random() * 0.4);

    // Store animation data
    data.push({
      theta,
      phi,
      heightOffset,
      vTheta: (Math.random() - 0.5) * 0.0001, // Angular velocity
      vPhi: (Math.random() - 0.5) * 0.00005,
      vHeight: (Math.random() - 0.5) * 0.5,
      phase: Math.random() * Math.PI * 2,
      color: colorHex,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: SPHERE_JUNGLE_CONFIG.FIREFLY_SIZE,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'sphereJungleFireflies';

  return { points, data };
}

/**
 * Update firefly particle animation
 */
function updateSphereFireflies(
  points: THREE.Points,
  data: SphereFireflyParticle[],
  time: number,
  delta: number,
  radius: number
): void {
  const positions = points.geometry.attributes.position.array as Float32Array;
  const speed = SPHERE_JUNGLE_CONFIG.FIREFLY_SPEED;

  for (let i = 0; i < data.length; i++) {
    const firefly = data[i];

    // Update spherical position with drift
    firefly.theta += firefly.vTheta * speed * delta;
    firefly.phi += firefly.vPhi * speed * delta;

    // Clamp phi to valid range (0 to PI)
    if (firefly.phi < 0.1 || firefly.phi > Math.PI - 0.1) {
      firefly.vPhi *= -1;
    }

    // Update height with bobbing motion
    firefly.heightOffset += firefly.vHeight * delta;
    if (
      firefly.heightOffset < SPHERE_JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN ||
      firefly.heightOffset > SPHERE_JUNGLE_CONFIG.FIREFLY_HEIGHT_MAX
    ) {
      firefly.vHeight *= -1;
    }

    // Random direction changes
    if (Math.random() < 0.01) {
      firefly.vTheta = (Math.random() - 0.5) * 0.0001;
      firefly.vPhi = (Math.random() - 0.5) * 0.00005;
    }

    // Convert to Cartesian
    const r = radius + firefly.heightOffset;
    positions[i * 3] = r * Math.sin(firefly.phi) * Math.cos(firefly.theta);
    positions[i * 3 + 1] = r * Math.cos(firefly.phi);
    positions[i * 3 + 2] = r * Math.sin(firefly.phi) * Math.sin(firefly.theta);
  }

  points.geometry.attributes.position.needsUpdate = true;

  // Pulsing glow effect
  const pulse = Math.sin(time * SPHERE_JUNGLE_CONFIG.FIREFLY_PULSE_SPEED * Math.PI * 2);
  (points.material as THREE.PointsMaterial).opacity = 0.5 + pulse * 0.3;
}

/**
 * Convenience function to update visibility based on player stage
 */
export function setSphereJungleVisible(components: SphereJungleComponents, visible: boolean): void {
  components.group.visible = visible;
}

// ============================================
// SPHERE ROOT NETWORK
// Glowing tubes connecting trees along great circle arcs
// ============================================

/**
 * Create root network between trees on sphere surface
 * Roots follow great circle arcs (shortest path on sphere)
 *
 * @param treePositions - Array of 3D positions on sphere surface
 * @param radius - Sphere radius
 */
export function createSphereRootNetwork(
  treePositions: Array<{ x: number; y: number; z: number }>,
  radius: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sphereRootNetwork';

  const config = SPHERE_JUNGLE_CONFIG;

  // Material for glowing roots
  const material = new THREE.MeshStandardMaterial({
    color: config.ROOT_COLOR,
    emissive: config.ROOT_COLOR,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: config.ROOT_OPACITY,
    roughness: 0.3,
    metalness: 0.2,
  });

  // Track connections to avoid duplicates
  const connections = new Set<string>();

  for (let i = 0; i < treePositions.length; i++) {
    const treePos = treePositions[i];

    // Find nearest neighbors using 3D distance
    const neighbors: Array<{ pos: Vec3; dist: number; idx: number }> = [];
    for (let j = 0; j < treePositions.length; j++) {
      if (i === j) continue;
      const other = treePositions[j];
      const dx = other.x - treePos.x;
      const dy = other.y - treePos.y;
      const dz = other.z - treePos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 1e-3 && dist < config.ROOT_MAX_CONNECTION_DIST) {
        neighbors.push({ pos: other, dist, idx: j });
      }
    }

    // Sort by distance and take closest N
    neighbors.sort((a, b) => a.dist - b.dist);
    const closestNeighbors = neighbors.slice(0, config.ROOT_CONNECTIONS_PER_TREE);

    // Create root tube to each neighbor
    for (const neighbor of closestNeighbors) {
      // Skip if already connected
      const connKey = i < neighbor.idx ? `${i}-${neighbor.idx}` : `${neighbor.idx}-${i}`;
      if (connections.has(connKey)) continue;
      connections.add(connKey);

      // Create great circle arc using slerp
      const points: THREE.Vector3[] = [];
      const segments = config.ROOT_CURVE_SEGMENTS;

      // Normalize positions to unit sphere for slerp
      const fromNorm: Vec3 = {
        x: treePos.x / radius,
        y: treePos.y / radius,
        z: treePos.z / radius,
      };
      const toNorm: Vec3 = {
        x: neighbor.pos.x / radius,
        y: neighbor.pos.y / radius,
        z: neighbor.pos.z / radius,
      };

      // Create points along the arc
      for (let t = 0; t <= segments; t++) {
        const frac = t / segments;
        const p = slerp(fromNorm, toNorm, frac);

        // Scale back to sphere surface + height offset
        const r = radius + config.ROOT_HEIGHT_OFFSET;
        points.push(new THREE.Vector3(p.x * r, p.y * r, p.z * r));
      }

      // Create tube geometry along the curve
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeometry = new THREE.TubeGeometry(
        curve,
        segments,
        config.ROOT_RADIUS,
        8, // Radial segments
        false // Not closed
      );

      const tube = new THREE.Mesh(tubeGeometry, material.clone());
      tube.name = `root_${i}_${neighbor.idx}`;
      group.add(tube);
    }
  }

  return group;
}

/**
 * Update sphere root network animation - pulsing glow
 */
export function updateSphereRootAnimation(rootNetwork: THREE.Group, time: number): void {
  const config = SPHERE_JUNGLE_CONFIG;
  const basePulse = Math.sin(time * config.ROOT_PULSE_SPEED * Math.PI * 2);

  let meshIndex = 0;
  rootNetwork.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity !== undefined) {
        // Each root pulses with slight phase offset for wave effect
        const phase = meshIndex * 0.3;
        const pulse = Math.sin(time * config.ROOT_PULSE_SPEED * Math.PI * 2 + phase);
        mat.emissiveIntensity = 0.6 + pulse * config.ROOT_PULSE_RANGE;
        meshIndex++;
      }
    }
  });
}
