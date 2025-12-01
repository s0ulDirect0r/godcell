// ============================================
// Jungle Background - Digital jungle environment for Stage 3+
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';

/**
 * Visual parameters for jungle background
 * These create a distinct aesthetic from the soup - darker, more sparse, data-rain feel
 *
 * Visual vocabulary (from design doc):
 * - Undergrowth: Dense low-level complexity, hiding spots
 * - Terrain variation: Patches of different colors/glows
 * - Ambient jungle life: Firefly-like particles
 */
const JUNGLE_CONFIG = {
  // Grid: darker, more sparse than soup
  GRID_COLOR: 0x0a3030, // Dark teal (vs soup's cyan)
  GRID_SIZE: 200, // Larger cells = more sparse feeling

  // Particles: slower, larger, vertical drift (data rain)
  PARTICLE_COUNT: 200, // Fewer particles = more sparse
  PARTICLE_COLOR: 0x00ff88, // Green-cyan tint
  PARTICLE_MIN_SIZE: 3,
  PARTICLE_MAX_SIZE: 8,
  PARTICLE_SPEED_MIN: 10, // Slower drift
  PARTICLE_SPEED_MAX: 30,
  PARTICLE_OPACITY: 0.4, // More subtle

  // Background: darker than soup
  BACKGROUND_COLOR: 0x000808, // Very dark teal-black

  // First-person sky color (visible when looking up/around)
  FP_SKY_COLOR: 0x102030, // Dark blue-gray cyber sky (brighter for visibility)

  // First-person ground plane (visible floor to walk on)
  FP_GROUND_COLOR: 0x0a1a1a, // Dark teal ground
  FP_GROUND_GRID_COLOR: 0x00ff88, // Bright green grid lines (cyber aesthetic)
  FP_GROUND_GRID_SPACING: 100, // Grid line spacing in game units

  // Soup pool visualization (visible from jungle view)
  // Uses shared GAME_CONFIG.SOUP_POOL_RADIUS for consistency with tree spawning
  SOUP_POOL_FILL_COLOR: 0x001830, // Dark blue-cyan fill
  SOUP_POOL_FILL_OPACITY: 0.6, // More visible
  SOUP_POOL_GLOW_COLOR: 0x00ffff, // Cyan glow
  SOUP_POOL_GLOW_OPACITY: 0.2, // Subtle outer glow
  SOUP_POOL_GLOW_SIZE: 50, // Glow extends this far outside pool

  // Activity dots inside soup pool (mimics microscopic life)
  SOUP_ACTIVITY_DOT_COUNT: 25,
  SOUP_ACTIVITY_DOT_SIZE: 4,
  SOUP_ACTIVITY_DOT_SPEED: 15, // Brownian motion speed
  SOUP_ACTIVITY_COLORS: [
    0x00ff00, // Green (nutrients)
    0x00ffff, // Cyan
    0xff6600, // Orange (swarms)
    0xff00ff, // Magenta
    0xffff00, // Yellow
  ],

  // === UNDERGROWTH (ground-level glowing sprites) ===
  UNDERGROWTH_COUNT: 1500,        // Number of undergrowth particles (denser)
  UNDERGROWTH_HEIGHT: -0.2,       // Height above ground
  UNDERGROWTH_COLORS: [
    0x00ff88, // Green-cyan (most common)
    0x00ffaa, // Lighter green
    0x00ddff, // Cyan-blue
    0x88ff00, // Yellow-green
  ],
  UNDERGROWTH_PULSE_SPEED: 0.3,   // How fast undergrowth pulses (Hz)
  UNDERGROWTH_PULSE_RANGE: 0.4,   // Intensity variation (±40%)

  // === HEX GRID FLOOR PATTERN ===
  HEX_SIZE: 800,                  // Size of each hexagon (10x bigger)
  HEX_LINE_COLOR: 0x004444,       // Dark teal hex edges
  HEX_LINE_OPACITY: 0.4,          // Subtle but visible
  HEX_FILL_COLOR: 0x001515,       // Very dark fill
  HEX_FILL_OPACITY: 0.2,          // Subtle fill
  HEX_HEIGHT: -0.6,               // Below everything

  // === CIRCUIT TRACES FLOOR PATTERN ===
  CIRCUIT_LINE_COUNT: 3000,       // Number of trace lines (dense PCB coverage)
  CIRCUIT_LINE_COLOR: 0x005555,   // Teal circuit traces
  CIRCUIT_LINE_OPACITY: 0.5,      // Visible but not overwhelming
  CIRCUIT_NODE_COLOR: 0x00aaaa,   // Brighter nodes/pads
  CIRCUIT_NODE_COUNT: 1500,       // Number of connection nodes (dense)
  CIRCUIT_HEIGHT: -0.55,          // Below most things

  // === TERRAIN PATCHES (color variation zones) ===
  TERRAIN_PATCH_COUNT: 30,        // Number of terrain patches
  TERRAIN_PATCH_MIN_RADIUS: 200,  // Minimum patch radius
  TERRAIN_PATCH_MAX_RADIUS: 600,  // Maximum patch radius
  TERRAIN_PATCH_OPACITY: 0.15,    // Subtle overlay
  TERRAIN_PATCH_HEIGHT: -0.45,    // Below grid, above base
  TERRAIN_PATCH_COLORS: [
    0x003322, // Dark green tint
    0x002233, // Dark blue tint
    0x102020, // Neutral dark
    0x201510, // Warm dark (rare clearings)
  ],

  // === ROOT NETWORK (glowing lines radiating from center) ===
  ROOT_NETWORK_BRANCHES: 12,      // Number of main root branches
  ROOT_NETWORK_SEGMENTS: 8,       // Segments per branch
  ROOT_NETWORK_COLOR: 0x00ffff,   // Cyan glow
  ROOT_NETWORK_OPACITY: 0.2,      // Subtle
  ROOT_NETWORK_HEIGHT: -0.35,     // Between patches and grid

  // === FIREFLY PARTICLES (floating ambient life) ===
  FIREFLY_COUNT: 80,              // Number of fireflies
  FIREFLY_SIZE: 4,                // Base size
  FIREFLY_HEIGHT_MIN: 20,         // Minimum height above ground
  FIREFLY_HEIGHT_MAX: 150,        // Maximum height above ground
  FIREFLY_SPEED: 8,               // Drift speed
  FIREFLY_PULSE_SPEED: 1.5,       // Fast pulse for firefly effect
  FIREFLY_COLORS: [
    0x00ff88, // Green (most common)
    0xffff00, // Yellow
    0x00ffff, // Cyan
  ],

  // === DIGITAL GRASS FLOOR PATTERN ===
  GRASS_BLADE_COUNT: 120000,      // Dense ground cover (halved)
  GRASS_MIN_HEIGHT: 50,           // Doubled blade height
  GRASS_MAX_HEIGHT: 120,          // Doubled blade height
  GRASS_WIDTH: 24,                // Doubled blade width
  GRASS_COLORS: [
    0x006633, // Dark green-cyan
    0x005522, // Dark green
    0x004418, // Very dark green
    0x006644, // Dark cyan-green
  ],
  GRASS_OPACITY: 0.4,             // Base opacity (subtle glow)
  GRASS_SWAY_SPEED: 0.8,          // How fast grass sways
  GRASS_SWAY_AMOUNT: 5,           // How far grass tips move
  GRASS_HEIGHT: 0,                // At ground level (raised for visibility)
};

// Particle animation data
interface JungleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

// Soup activity dot animation data
interface SoupActivityDot {
  x: number; // Offset from center
  y: number;
  vx: number;
  vy: number;
  color: number;
}

// Undergrowth particle data (static position, animated glow)
interface UndergrowthParticle {
  x: number;
  y: number;
  phase: number; // Animation phase offset
  baseOpacity: number;
}

// Firefly particle data (floating ambient life)
interface FireflyParticle {
  x: number;
  y: number;
  z: number; // Height above ground
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  color: number;
}

/**
 * Create jungle background group containing grid, particles, undergrowth, and terrain features
 * Returns a Group that can be toggled visible/hidden based on player stage
 */
export function createJungleBackground(scene: THREE.Scene): {
  group: THREE.Group;
  particles: THREE.Points;
  particleData: JungleParticle[];
  soupActivityPoints: THREE.Points;
  soupActivityData: SoupActivityDot[];
  undergrowthPoints: THREE.Points;
  undergrowthData: UndergrowthParticle[];
  fireflyPoints: THREE.Points;
  fireflyData: FireflyParticle[];
} {
  const group = new THREE.Group();
  group.name = 'jungleBackground';
  group.visible = false; // Hidden by default (soup is visible initially)

  // Create floor pattern (bottom layer) - uncomment one:
  createHexGridFloor(group);  // Option 1: Hex grid
  // createCircuitTraces(group); // Option 2: Circuit traces
  // createGroundTexture(group); // Option 3: Abstract noise shader (disabled for grass testing)

  // Create dirt/mud ground layer (beneath grass)
  createDirtGround(group);

  // Create stylized grass (above ground texture)
  createStylizedGrass(group);

  // Create terrain patches (below everything else)
  createTerrainPatches(group);

  // Root network is now created by TreeRenderSystem using actual ECS tree positions
  // Grid disabled for cleaner visual - uncomment to re-enable
  // createJungleGrid(group);

  // Create undergrowth particles (ground-level glow)
  const { undergrowthPoints, undergrowthData } = createUndergrowth();
  group.add(undergrowthPoints);

  // Create soup pool visualization (small glowing blob with activity dots)
  const { activityPoints, activityData } = createSoupPool(group);

  // Create jungle particles (data rain effect)
  const { particles, particleData } = createJungleParticles();
  group.add(particles);

  // Create firefly particles (floating ambient life)
  const { fireflyPoints, fireflyData } = createFireflies();
  group.add(fireflyPoints);

  scene.add(group);

  return {
    group,
    particles,
    particleData,
    soupActivityPoints: activityPoints,
    soupActivityData: activityData,
    undergrowthPoints,
    undergrowthData,
    fireflyPoints,
    fireflyData,
  };
}

/**
 * Create jungle grid lines - larger spacing, darker color
 * Grid spans the full JUNGLE dimensions
 * XZ plane: X=game X, Y=height, Z=-game Y
 * NOTE: Currently disabled - uncomment call in createJungleBackground() to re-enable
 */
export function createJungleGrid(group: THREE.Group): void {
  const gridSize = JUNGLE_CONFIG.GRID_SIZE;
  const gridColor = JUNGLE_CONFIG.GRID_COLOR;
  const gridHeight = -0.5; // Below ground level

  // Lines parallel to Z axis (along game Y direction)
  for (let x = 0; x <= GAME_CONFIG.JUNGLE_WIDTH; x += gridSize) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, gridHeight, 0),
      new THREE.Vector3(x, gridHeight, -GAME_CONFIG.JUNGLE_HEIGHT),
    ]);
    const material = new THREE.LineBasicMaterial({ color: gridColor });
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }

  // Lines parallel to X axis (along game X direction)
  for (let gameY = 0; gameY <= GAME_CONFIG.JUNGLE_HEIGHT; gameY += gridSize) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, gridHeight, -gameY),
      new THREE.Vector3(GAME_CONFIG.JUNGLE_WIDTH, gridHeight, -gameY),
    ]);
    const material = new THREE.LineBasicMaterial({ color: gridColor });
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }
}

/**
 * Create circuit traces floor pattern - PCB-style lines across jungle
 * Creates a tech/digital aesthetic ground layer
 */
// Alternative floor pattern - exported for potential future use
export function createCircuitTraces(group: THREE.Group): void {
  const height = JUNGLE_CONFIG.CIRCUIT_HEIGHT;

  // Material for traces
  const lineMaterial = new THREE.LineBasicMaterial({
    color: JUNGLE_CONFIG.CIRCUIT_LINE_COLOR,
    transparent: true,
    opacity: JUNGLE_CONFIG.CIRCUIT_LINE_OPACITY,
  });

  // Material for nodes (brighter)
  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: JUNGLE_CONFIG.CIRCUIT_NODE_COLOR,
    transparent: true,
    opacity: 0.6,
  });

  // Generate random circuit traces
  for (let i = 0; i < JUNGLE_CONFIG.CIRCUIT_LINE_COUNT; i++) {
    const seed = i * 12345;

    // Random starting point
    let x = (seed % 1000) / 1000 * GAME_CONFIG.JUNGLE_WIDTH;
    let y = ((seed * 7) % 1000) / 1000 * GAME_CONFIG.JUNGLE_HEIGHT;

    const points: THREE.Vector3[] = [];
    points.push(new THREE.Vector3(x, height, -y));

    // Create 2-5 segments with 90-degree turns (PCB style)
    const segments = 2 + (seed % 4);
    let direction = (seed % 4); // 0=right, 1=down, 2=left, 3=up

    for (let seg = 0; seg < segments; seg++) {
      // Segment length
      const length = 100 + ((seed * (seg + 1)) % 400);

      // Move in current direction
      switch (direction) {
        case 0: x += length; break; // right
        case 1: y += length; break; // down
        case 2: x -= length; break; // left
        case 3: y -= length; break; // up
      }

      // Clamp to bounds
      x = Math.max(0, Math.min(GAME_CONFIG.JUNGLE_WIDTH, x));
      y = Math.max(0, Math.min(GAME_CONFIG.JUNGLE_HEIGHT, y));

      points.push(new THREE.Vector3(x, height, -y));

      // Turn 90 degrees (alternating left/right turns)
      direction = (direction + (seg % 2 === 0 ? 1 : 3)) % 4;
    }

    // Create trace line
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, lineMaterial);
    group.add(line);
  }

  // Add connection nodes (small circles at random points)
  const nodeGeometry = new THREE.CircleGeometry(8, 8);
  for (let i = 0; i < JUNGLE_CONFIG.CIRCUIT_NODE_COUNT; i++) {
    const seed = i * 54321;
    const x = (seed % 10000) / 10000 * GAME_CONFIG.JUNGLE_WIDTH;
    const y = ((seed * 3) % 10000) / 10000 * GAME_CONFIG.JUNGLE_HEIGHT;

    const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
    node.rotation.x = -Math.PI / 2; // Lie flat
    node.position.set(x, height + 0.01, -y);
    group.add(node);
  }
}

/**
 * Create ground texture - procedural shader on a plane
 *
 * Current: Abstract noise (layered simplex for atmospheric glow)
 * Alternative patterns to try:
 * - Voronoi: Cell-like patches with glowing edges (was too bright/busy)
 * - Flowing veins: Noise-distorted lines for bioluminescent roots
 */
// Alternative floor pattern - exported for potential future use
export function createGroundTexture(group: THREE.Group): void {
  console.log('[JungleBackground] Creating ground texture with noise shader');

  const geometry = new THREE.PlaneGeometry(
    GAME_CONFIG.JUNGLE_WIDTH,
    GAME_CONFIG.JUNGLE_HEIGHT,
    1, 1
  );

  // Abstract noise shader - layered simplex for atmospheric foggy glow
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      scale: { value: 8.0 },            // Noise scale (lower = larger patches)
      glowColor: { value: new THREE.Vector3(0.0, 0.4, 0.2) },    // Dark green
      baseColor: { value: new THREE.Vector3(0.005, 0.015, 0.01) }, // Very dark base
      pulseSpeed: { value: 0.3 },       // Slow atmospheric pulse
      flowSpeed: { value: 0.02 },       // Very slow drift
      glowIntensity: { value: 0.3 },    // Subtle glow
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float scale;
      uniform vec3 glowColor;
      uniform vec3 baseColor;
      uniform float pulseSpeed;
      uniform float flowSpeed;
      uniform float glowIntensity;

      varying vec2 vUv;

      // Simplex noise functions
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      // Fractal Brownian Motion - layered noise
      float fbm(vec2 p, float t) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;

        // Layer multiple octaves of noise
        for (int i = 0; i < 4; i++) {
          value += amplitude * snoise(p * frequency + t);
          frequency *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 scaledUV = vUv * scale;

        // Slow drifting offset
        float drift = time * flowSpeed;

        // Layer 1: Large slow-moving patches
        float noise1 = fbm(scaledUV * 0.5 + vec2(drift, drift * 0.7), drift * 0.5);

        // Layer 2: Medium detail
        float noise2 = fbm(scaledUV * 1.0 + vec2(-drift * 0.5, drift), drift * 0.3);

        // Layer 3: Fine detail
        float noise3 = fbm(scaledUV * 2.0 + vec2(drift * 0.3, -drift * 0.4), drift * 0.2);

        // Combine layers with different weights
        float combined = noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2;

        // Remap from [-1,1] to [0,1] range
        combined = combined * 0.5 + 0.5;

        // Apply threshold for more defined patches
        float glow = smoothstep(0.3, 0.7, combined);

        // Pulse animation
        float pulse = 0.8 + 0.2 * sin(time * pulseSpeed + combined * 3.0);

        // Final color: dark base with glowing patches
        vec3 color = baseColor + glowColor * glow * glowIntensity * pulse;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });

  const groundMesh = new THREE.Mesh(geometry, material);
  groundMesh.name = 'groundTexture';

  // Position: center of jungle, well below entities
  groundMesh.position.set(
    GAME_CONFIG.JUNGLE_WIDTH / 2,
    -3.0,
    -GAME_CONFIG.JUNGLE_HEIGHT / 2
  );
  groundMesh.rotation.x = -Math.PI / 2;

  group.add(groundMesh);

  // Store material reference for animation
  (group as unknown as { groundMaterial: THREE.ShaderMaterial }).groundMaterial = material;

  console.log('[JungleBackground] Ground texture created');
}

/**
 * Create dirt/mud ground layer beneath the grass
 * Simple brown noise texture for organic ground feel
 */
function createDirtGround(group: THREE.Group): void {
  console.log('[JungleBackground] Creating dirt ground layer');

  const geometry = new THREE.PlaneGeometry(
    GAME_CONFIG.JUNGLE_WIDTH,
    GAME_CONFIG.JUNGLE_HEIGHT,
    1,
    1
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x030803) }, // Almost black with hint of green
      highlightColor: { value: new THREE.Color(0x061006) }, // Barely visible dark green
      noiseScale: { value: 0.003 }, // Scale of noise pattern
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 baseColor;
      uniform vec3 highlightColor;
      uniform float noiseScale;
      varying vec2 vUv;

      // Simple noise function
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

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
        // Multi-octave noise for organic variation
        vec2 pos = vUv * ${GAME_CONFIG.JUNGLE_WIDTH.toFixed(1)} * noiseScale;
        float n = noise(pos) * 0.5 + noise(pos * 2.0) * 0.25 + noise(pos * 4.0) * 0.125;
        n = n / 0.875; // Normalize

        // Mix between base and highlight based on noise
        vec3 color = mix(baseColor, highlightColor, n * 0.5);

        // Add subtle darker patches
        float darkPatch = noise(pos * 0.5);
        color *= 0.85 + darkPatch * 0.15;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: false, // Render behind everything
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'dirtGround';
  mesh.rotation.x = -Math.PI / 2; // Lay flat
  mesh.position.set(
    GAME_CONFIG.JUNGLE_WIDTH / 2,
    -5, // Slightly below grass level
    -GAME_CONFIG.JUNGLE_HEIGHT / 2 // Z is negative in 3D coords
  );
  mesh.renderOrder = -200; // Render before grass (-100)

  group.add(mesh);
  console.log('[JungleBackground] Created dirt ground layer', {
    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    size: { width: GAME_CONFIG.JUNGLE_WIDTH, height: GAME_CONFIG.JUNGLE_HEIGHT },
    renderOrder: mesh.renderOrder,
  });
}

/**
 * Create stylized grass using 5-vertex blade geometry
 * Based on: https://smythdesign.com/blog/stylized-grass-webgl/
 *
 * Each blade: 5 vertices (2 bottom, 2 middle, 1 top)
 * Animation: vertex colors control sway intensity (black=still, white=max)
 * Wind: sin(time + position) creates asynchronous gust effects
 */
function createStylizedGrass(group: THREE.Group): THREE.Mesh {
  console.log('[JungleBackground] Creating stylized grass');

  const bladeCount = JUNGLE_CONFIG.GRASS_BLADE_COUNT;

  // Each blade has 5 vertices, forming 3 triangles (triangle strip style)
  // Vertices: 0=bottom-left, 1=bottom-right, 2=mid-left, 3=mid-right, 4=top
  // Triangles: (0,1,2), (1,2,3), (2,3,4)
  const verticesPerBlade = 5;
  const indicesPerBlade = 9; // 3 triangles * 3 indices

  // Allocate buffers
  const positions = new Float32Array(bladeCount * verticesPerBlade * 3);
  const colors = new Float32Array(bladeCount * verticesPerBlade * 3);
  const indices = new Uint32Array(bladeCount * indicesPerBlade);

  // Blade template heights (relative, will be scaled by actual height)
  const heightLevels = [0, 0, 0.4, 0.4, 1.0]; // bottom, bottom, mid, mid, top

  // Color intensities for animation (0=still, 1=max sway)
  // Bottom vertices don't move, middle moves slightly, top moves most
  const animIntensity = [0, 0, 0.3, 0.3, 1.0];

  for (let i = 0; i < bladeCount; i++) {
    // Random position within jungle bounds (using Poisson-like random spread)
    const baseX = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    const baseY = Math.random() * GAME_CONFIG.JUNGLE_HEIGHT;

    // Random blade properties
    const height = JUNGLE_CONFIG.GRASS_MIN_HEIGHT +
      Math.random() * (JUNGLE_CONFIG.GRASS_MAX_HEIGHT - JUNGLE_CONFIG.GRASS_MIN_HEIGHT);
    const width = JUNGLE_CONFIG.GRASS_WIDTH * (0.7 + Math.random() * 0.6);
    const rotation = Math.random() * Math.PI * 2; // Random facing direction

    // Slight random tilt for variety
    const tiltX = (Math.random() - 0.5) * 0.3;
    const tiltZ = (Math.random() - 0.5) * 0.3;

    // Random color from palette
    const colorHex = JUNGLE_CONFIG.GRASS_COLORS[
      Math.floor(Math.random() * JUNGLE_CONFIG.GRASS_COLORS.length)
    ];
    const r = ((colorHex >> 16) & 255) / 255;
    const g = ((colorHex >> 8) & 255) / 255;
    const b = (colorHex & 255) / 255;

    // Pre-calculate rotation
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    // Generate 5 vertices for this blade
    for (let v = 0; v < verticesPerBlade; v++) {
      const idx = (i * verticesPerBlade + v) * 3;

      // Local offset from blade center (before rotation)
      let localX = 0;
      let localZ = 0;

      // Bottom and middle vertices are offset left/right
      if (v === 0 || v === 2) localX = -width / 2; // Left vertices
      if (v === 1 || v === 3) localX = width / 2;  // Right vertices
      // Top vertex stays at center (localX = 0)

      // Apply rotation
      const rotatedX = localX * cosR - localZ * sinR;
      const rotatedZ = localX * sinR + localZ * cosR;

      // Calculate height with tilt
      const h = heightLevels[v] * height;

      // Three.js coords: X = game X, Y = height, Z = -game Y
      positions[idx] = baseX + rotatedX + tiltX * h;
      positions[idx + 1] = JUNGLE_CONFIG.GRASS_HEIGHT + h;
      positions[idx + 2] = -baseY + rotatedZ + tiltZ * h;

      // Vertex color encodes animation intensity in all channels
      // We'll use it in the shader to determine sway amount
      const intensity = animIntensity[v];
      colors[idx] = r * (0.5 + 0.5 * intensity);     // Slightly brighter at top
      colors[idx + 1] = g * (0.5 + 0.5 * intensity);
      colors[idx + 2] = b * (0.5 + 0.5 * intensity);
    }

    // Generate indices for 3 triangles
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
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  // Custom shader material for wind animation
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windSpeed: { value: JUNGLE_CONFIG.GRASS_SWAY_SPEED },
      windStrength: { value: JUNGLE_CONFIG.GRASS_SWAY_AMOUNT },
    },
    vertexShader: `
      uniform float time;
      uniform float windSpeed;
      uniform float windStrength;

      attribute vec3 color;
      varying vec3 vColor;
      varying float vHeight;

      void main() {
        vColor = color;

        // Get position
        vec3 pos = position;

        // Animation intensity based on height (encoded in Y position relative to base)
        // Higher vertices move more
        float heightFactor = pos.y / 120.0; // Normalize by max height (doubled)
        heightFactor = clamp(heightFactor, 0.0, 1.0);

        // Wind effect using sin with position offset for gust variation
        float windPhase = time * windSpeed + pos.x * 0.01 + pos.z * 0.01;
        float windOffset = sin(windPhase) * windStrength * heightFactor * heightFactor;

        // Secondary smaller oscillation for more natural movement
        float windPhase2 = time * windSpeed * 1.3 + pos.x * 0.02 - pos.z * 0.015;
        float windOffset2 = sin(windPhase2) * windStrength * 0.3 * heightFactor;

        pos.x += windOffset + windOffset2;
        pos.z += windOffset * 0.5; // Slight z movement too

        vHeight = heightFactor;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vHeight;

      void main() {
        // Subtle brightness gradient from bottom to top (darker overall)
        vec3 color = vColor * (0.5 + 0.2 * vHeight);

        // Very subtle glow at tips only
        float glow = 0.03 * vHeight;
        color += vec3(0.0, glow, glow * 0.3);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: false, // Don't write to depth buffer - let other objects render on top
  });

  const grassMesh = new THREE.Mesh(geometry, material);
  grassMesh.name = 'stylizedGrass';
  grassMesh.frustumCulled = false; // Grass spans whole scene
  grassMesh.renderOrder = -100; // Render behind all game objects (players, nutrients, etc.)

  group.add(grassMesh);

  // Store material reference for animation
  (group as unknown as { grassMaterial: THREE.ShaderMaterial }).grassMaterial = material;

  console.log('[JungleBackground] Created', bladeCount, 'grass blades');
  return grassMesh;
}

/**
 * Create hex grid floor pattern - honeycomb texture across jungle
 * Creates a cyberpunk/digital aesthetic ground layer
 */
function createHexGridFloor(group: THREE.Group): void {
  const hexSize = JUNGLE_CONFIG.HEX_SIZE;
  const height = JUNGLE_CONFIG.HEX_HEIGHT;

  // Hex geometry math
  const hexWidth = hexSize * 2;
  const hexHeight = Math.sqrt(3) * hexSize;
  const horizSpacing = hexWidth * 0.75;
  const vertSpacing = hexHeight;

  // Material for hex edges
  const lineMaterial = new THREE.LineBasicMaterial({
    color: JUNGLE_CONFIG.HEX_LINE_COLOR,
    transparent: true,
    opacity: JUNGLE_CONFIG.HEX_LINE_OPACITY,
  });

  // Calculate grid dimensions
  const cols = Math.ceil(GAME_CONFIG.JUNGLE_WIDTH / horizSpacing) + 2;
  const rows = Math.ceil(GAME_CONFIG.JUNGLE_HEIGHT / vertSpacing) + 2;

  // Create hex grid
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Offset every other row for honeycomb pattern
      const xOffset = (row % 2) * (horizSpacing / 2);
      const centerX = col * horizSpacing + xOffset;
      const centerY = row * vertSpacing;

      // Skip if outside jungle bounds (with margin)
      if (centerX < -hexSize || centerX > GAME_CONFIG.JUNGLE_WIDTH + hexSize) continue;
      if (centerY < -hexSize || centerY > GAME_CONFIG.JUNGLE_HEIGHT + hexSize) continue;

      // Create hexagon vertices
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6; // Flat-top hexagon
        const x = centerX + hexSize * Math.cos(angle);
        const y = centerY + hexSize * Math.sin(angle);
        points.push(new THREE.Vector3(x, height, -y));
      }

      // Create hex outline
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const hexLine = new THREE.Line(geometry, lineMaterial);
      group.add(hexLine);
    }
  }
}

/**
 * Create terrain patches - semi-transparent colored circles for ground variation
 * Adds visual depth and breaks up the flat grid
 */
function createTerrainPatches(group: THREE.Group): void {
  const patchCount = JUNGLE_CONFIG.TERRAIN_PATCH_COUNT;
  const height = JUNGLE_CONFIG.TERRAIN_PATCH_HEIGHT;

  for (let i = 0; i < patchCount; i++) {
    // Random position within jungle bounds
    const x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    const y = Math.random() * GAME_CONFIG.JUNGLE_HEIGHT;

    // Random radius
    const radius = JUNGLE_CONFIG.TERRAIN_PATCH_MIN_RADIUS +
      Math.random() * (JUNGLE_CONFIG.TERRAIN_PATCH_MAX_RADIUS - JUNGLE_CONFIG.TERRAIN_PATCH_MIN_RADIUS);

    // Random color from palette
    const color = JUNGLE_CONFIG.TERRAIN_PATCH_COLORS[
      Math.floor(Math.random() * JUNGLE_CONFIG.TERRAIN_PATCH_COLORS.length)
    ];

    const geometry = new THREE.CircleGeometry(radius, 24);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: JUNGLE_CONFIG.TERRAIN_PATCH_OPACITY,
    });

    const patch = new THREE.Mesh(geometry, material);
    patch.rotation.x = -Math.PI / 2; // Lie flat
    patch.position.set(x, height, -y);
    patch.name = `terrainPatch_${i}`;
    group.add(patch);
  }
}

/**
 * Create root network from actual tree positions
 * Roots reach toward neighboring trees, creating an interconnected network
 * Returns a Group containing all root tubes
 *
 * @param treePositions - Array of {x, y} positions from ECS tree entities
 */
export function createRootNetworkFromTrees(
  treePositions: Array<{ x: number; y: number }>
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rootNetwork';

  const height = JUNGLE_CONFIG.ROOT_NETWORK_HEIGHT;
  const rootRadius = 9; // Thicc root tubes

  // Use MeshStandardMaterial for emissive glow
  const material = new THREE.MeshStandardMaterial({
    color: JUNGLE_CONFIG.ROOT_NETWORK_COLOR,
    emissive: JUNGLE_CONFIG.ROOT_NETWORK_COLOR,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: JUNGLE_CONFIG.ROOT_NETWORK_OPACITY,
    roughness: 0.3,
    metalness: 0.2,
  });

  // Config for root connections
  const maxConnectionDist = 1500; // Max distance to connect trees
  const connectionsPerTree = 3; // Try to connect to N nearest neighbors
  const curveWiggle = 150; // How much the root curves sideways

  // Track which connections we've made to avoid too many duplicates
  const connections = new Set<string>();

  for (let i = 0; i < treePositions.length; i++) {
    const treePos = treePositions[i];
    const seed = treePos.x * 1000 + treePos.y;

    // Find nearest neighbors
    const neighbors: Array<{ pos: { x: number; y: number }; dist: number; idx: number }> = [];
    for (let j = 0; j < treePositions.length; j++) {
      if (i === j) continue;
      const other = treePositions[j];
      const dx = other.x - treePos.x;
      const dy = other.y - treePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Guard against near-zero distance to prevent NaN in perpendicular calculations
      if (dist > 1e-3 && dist < maxConnectionDist) {
        neighbors.push({ pos: other, dist, idx: j });
      }
    }

    // Sort by distance and take closest N
    neighbors.sort((a, b) => a.dist - b.dist);
    const closestNeighbors = neighbors.slice(0, connectionsPerTree);

    // Create root reaching toward each neighbor
    for (let n = 0; n < closestNeighbors.length; n++) {
      const neighbor = closestNeighbors[n];

      // Create connection key to limit duplicates (allow some for visual density)
      const connKey = i < neighbor.idx ? `${i}-${neighbor.idx}` : `${neighbor.idx}-${i}`;
      if (connections.has(connKey)) continue; // Skip if already connected
      connections.add(connKey);

      // Calculate direction to neighbor
      const dx = neighbor.pos.x - treePos.x;
      const dy = neighbor.pos.y - treePos.y;
      const dist = neighbor.dist;

      // Create curved path with control points
      const points: THREE.Vector3[] = [];

      // Start at tree base
      points.push(new THREE.Vector3(treePos.x, height, -treePos.y));

      // Perpendicular direction for curve wiggle
      const perpX = -dy / dist;
      const perpY = dx / dist;

      // Deterministic wiggle based on seed
      const wiggleDir = ((seed + n) % 2 === 0) ? 1 : -1;
      const wiggleAmount = curveWiggle * (0.5 + ((seed * (n + 1)) % 100) / 200) * wiggleDir;

      // Control point 1 (1/3 of the way, curved to the side)
      const cp1X = treePos.x + dx * 0.33 + perpX * wiggleAmount;
      const cp1Y = treePos.y + dy * 0.33 + perpY * wiggleAmount;
      points.push(new THREE.Vector3(cp1X, height, -cp1Y));

      // Control point 2 (2/3 of the way, curved back)
      const cp2X = treePos.x + dx * 0.66 - perpX * wiggleAmount * 0.5;
      const cp2Y = treePos.y + dy * 0.66 - perpY * wiggleAmount * 0.5;
      points.push(new THREE.Vector3(cp2X, height, -cp2Y));

      // End point - connect directly to neighbor tree!
      points.push(new THREE.Vector3(neighbor.pos.x, height, -neighbor.pos.y));

      // Create smooth tube
      if (points.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(
          curve,
          16,           // tubular segments
          rootRadius,   // radius
          6,            // radial segments
          false         // closed
        );
        const tube = new THREE.Mesh(tubeGeo, material);
        group.add(tube);
      }
    }

    // Also add a couple random tendrils for trees with few neighbors
    if (closestNeighbors.length < 2) {
      for (let t = 0; t < 2; t++) {
        const angle = ((seed + t) % 360) * (Math.PI / 180) * 3;
        const length = 400 + ((seed * (t + 1)) % 100) * 4;

        const points: THREE.Vector3[] = [];
        points.push(new THREE.Vector3(treePos.x, height, -treePos.y));

        const midX = treePos.x + Math.cos(angle) * length * 0.5;
        const midY = treePos.y + Math.sin(angle) * length * 0.5;
        points.push(new THREE.Vector3(midX, height, -midY));

        const endX = treePos.x + Math.cos(angle) * length;
        const endY = treePos.y + Math.sin(angle) * length;
        points.push(new THREE.Vector3(endX, height, -endY));

        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, 8, rootRadius * 0.7, 6, false);
        const tube = new THREE.Mesh(tubeGeo, material);
        group.add(tube);
      }
    }
  }

  return group;
}

/**
 * Update root network animation - pulsing glow effect
 * Call this each frame to animate the roots
 *
 * @param rootNetwork - The root network group from createRootNetworkFromTrees
 * @param dt - Delta time in seconds
 */
export function updateRootNetworkAnimation(rootNetwork: THREE.Group, _dt: number): void {
  const time = performance.now() / 1000;

  // Pulse parameters
  const pulseSpeed = 0.8; // Hz - how fast the pulse travels
  const pulseRange = 0.4; // Intensity variation (±40%)
  const baseIntensity = 0.6;

  // Update each root tube's emissive intensity
  let meshIndex = 0;
  rootNetwork.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity !== undefined) {
        // Each root pulses with a phase offset for traveling wave effect
        const phase = time * pulseSpeed * Math.PI * 2 + meshIndex * 0.3;
        const pulse = Math.sin(phase) * pulseRange;
        mat.emissiveIntensity = baseIntensity + pulse;
      }
      meshIndex++;
    }
  });
}

/**
 * Create undergrowth particles - ground-level glowing sprites
 * Adds density and "hiding spot" feel to the jungle floor
 */
function createUndergrowth(): {
  undergrowthPoints: THREE.Points;
  undergrowthData: UndergrowthParticle[];
} {
  const count = JUNGLE_CONFIG.UNDERGROWTH_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const undergrowthData: UndergrowthParticle[] = [];

  for (let i = 0; i < count; i++) {
    // Random position in jungle
    const x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    const y = Math.random() * GAME_CONFIG.JUNGLE_HEIGHT;

    // Position (XZ plane)
    positions[i * 3] = x;
    positions[i * 3 + 1] = JUNGLE_CONFIG.UNDERGROWTH_HEIGHT;
    positions[i * 3 + 2] = -y;

    // Random color from palette
    const colorHex = JUNGLE_CONFIG.UNDERGROWTH_COLORS[
      Math.floor(Math.random() * JUNGLE_CONFIG.UNDERGROWTH_COLORS.length)
    ];
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    // Animation data
    undergrowthData.push({
      x,
      y,
      phase: Math.random() * Math.PI * 2,
      baseOpacity: 0.5 + Math.random() * 0.3,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 4, // Uniform size (PointsMaterial doesn't support per-vertex sizes)
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: false,
    map: createGlowTexture(),
    alphaTest: 0.2,
  });

  const undergrowthPoints = new THREE.Points(geometry, material);
  undergrowthPoints.name = 'undergrowth';

  return { undergrowthPoints, undergrowthData };
}

/**
 * Create firefly particles - floating ambient life that drifts and pulses
 */
function createFireflies(): {
  fireflyPoints: THREE.Points;
  fireflyData: FireflyParticle[];
} {
  const count = JUNGLE_CONFIG.FIREFLY_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const fireflyData: FireflyParticle[] = [];

  for (let i = 0; i < count; i++) {
    // Random position in jungle
    const x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    const y = Math.random() * GAME_CONFIG.JUNGLE_HEIGHT;
    const z = JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN +
      Math.random() * (JUNGLE_CONFIG.FIREFLY_HEIGHT_MAX - JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN);

    // Position (XZ plane with height)
    positions[i * 3] = x;
    positions[i * 3 + 1] = z; // Height above ground
    positions[i * 3 + 2] = -y;

    // Random color from palette
    const colorHex = JUNGLE_CONFIG.FIREFLY_COLORS[
      Math.floor(Math.random() * JUNGLE_CONFIG.FIREFLY_COLORS.length)
    ];
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    // Random velocity (slow drift in all directions)
    const speed = JUNGLE_CONFIG.FIREFLY_SPEED;
    const angle = Math.random() * Math.PI * 2;
    const vx = Math.cos(angle) * speed * (0.5 + Math.random() * 0.5);
    const vy = Math.sin(angle) * speed * (0.5 + Math.random() * 0.5);
    const vz = (Math.random() - 0.5) * speed * 0.3; // Slight vertical drift

    fireflyData.push({
      x, y, z,
      vx, vy, vz,
      phase: Math.random() * Math.PI * 2,
      color: colorHex,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: JUNGLE_CONFIG.FIREFLY_SIZE,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true, // Fireflies get smaller with distance
    map: createGlowTexture(),
    alphaTest: 0.1,
  });

  const fireflyPoints = new THREE.Points(geometry, material);
  fireflyPoints.name = 'fireflies';

  return { fireflyPoints, fireflyData };
}

/**
 * Create a soft glow texture for particles
 */
function createGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;

  // Radial gradient for soft glow
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create soup pool visualization - a small glowing ellipse with activity dots inside
 * Shows Stage 3+ players where the primordial soup is located
 * Size: ~2x player size (300px radius), centered at soup region center
 * XZ plane: X=game X, Y=height, Z=-game Y
 */
function createSoupPool(group: THREE.Group): {
  activityPoints: THREE.Points;
  activityData: SoupActivityDot[];
} {
  // Center of the soup region
  const centerX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2;
  const centerY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2;
  const poolRadius = GAME_CONFIG.SOUP_POOL_RADIUS;
  const glowSize = JUNGLE_CONFIG.SOUP_POOL_GLOW_SIZE;

  // Height positions: glow below fill, fill below activity dots
  const heightGlow = -0.3;
  const heightFill = -0.2;
  const heightActivity = -0.1;

  // === OUTER GLOW (larger circle behind the pool) ===
  const glowGeometry = new THREE.CircleGeometry(poolRadius + glowSize, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: JUNGLE_CONFIG.SOUP_POOL_GLOW_COLOR,
    transparent: true,
    opacity: JUNGLE_CONFIG.SOUP_POOL_GLOW_OPACITY,
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  // Rotate to lie flat on XZ plane, then position
  glowMesh.rotation.x = -Math.PI / 2;
  glowMesh.position.set(centerX, heightGlow, -centerY);
  glowMesh.name = 'soupPoolGlow';
  group.add(glowMesh);

  // === FILL (semi-transparent pool area) ===
  const fillGeometry = new THREE.CircleGeometry(poolRadius, 32);
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: JUNGLE_CONFIG.SOUP_POOL_FILL_COLOR,
    transparent: true,
    opacity: JUNGLE_CONFIG.SOUP_POOL_FILL_OPACITY,
  });
  const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
  fillMesh.rotation.x = -Math.PI / 2;
  fillMesh.position.set(centerX, heightFill, -centerY);
  fillMesh.name = 'soupPoolFill';
  group.add(fillMesh);

  // === ACTIVITY DOTS (colored dots moving inside, representing life in the soup) ===
  const dotCount = JUNGLE_CONFIG.SOUP_ACTIVITY_DOT_COUNT;
  const positions = new Float32Array(dotCount * 3);
  const colors = new Float32Array(dotCount * 3);
  const activityData: SoupActivityDot[] = [];

  for (let i = 0; i < dotCount; i++) {
    // Random position within pool radius (polar coordinates for even distribution)
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * poolRadius * 0.8; // Stay within 80% of radius
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    // Random velocity (brownian motion)
    const speed = JUNGLE_CONFIG.SOUP_ACTIVITY_DOT_SPEED;
    const vAngle = Math.random() * Math.PI * 2;
    const vx = Math.cos(vAngle) * speed;
    const vy = Math.sin(vAngle) * speed;

    // Random color from activity colors
    const colorHex = JUNGLE_CONFIG.SOUP_ACTIVITY_COLORS[
      Math.floor(Math.random() * JUNGLE_CONFIG.SOUP_ACTIVITY_COLORS.length)
    ];

    // Position (XZ plane: X=centerX+offsetX, Y=height, Z=-(centerY+offsetY))
    positions[i * 3] = centerX + x;
    positions[i * 3 + 1] = heightActivity;
    positions[i * 3 + 2] = -(centerY + y);

    // Color (convert hex to RGB)
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    activityData.push({ x, y, vx, vy, color: colorHex });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: JUNGLE_CONFIG.SOUP_ACTIVITY_DOT_SIZE,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: false,
  });

  const activityPoints = new THREE.Points(geometry, material);
  activityPoints.name = 'soupActivityDots';
  group.add(activityPoints);

  return { activityPoints, activityData };
}

/**
 * Create jungle particles with data-rain aesthetic
 * Particles drift along game Y (which maps to -Z in Three.js)
 * XZ plane: X=game X, Y=height, Z=-game Y
 */
function createJungleParticles(): {
  particles: THREE.Points;
  particleData: JungleParticle[];
} {
  const particleCount = JUNGLE_CONFIG.PARTICLE_COUNT;
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: JungleParticle[] = [];
  const particleHeight = -0.4; // Below ground level

  for (let i = 0; i < particleCount; i++) {
    // Spawn across full jungle area (game coordinates)
    const x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    const y = Math.random() * GAME_CONFIG.JUNGLE_HEIGHT;
    const size =
      JUNGLE_CONFIG.PARTICLE_MIN_SIZE +
      Math.random() * (JUNGLE_CONFIG.PARTICLE_MAX_SIZE - JUNGLE_CONFIG.PARTICLE_MIN_SIZE);

    // Position (XZ plane: X=game X, Y=height, Z=-game Y)
    positions[i * 3] = x;
    positions[i * 3 + 1] = particleHeight;
    positions[i * 3 + 2] = -y;

    // Size
    sizes[i] = size;

    // Velocity: primarily along game Y direction (data rain)
    // Slight horizontal variance for organic feel
    const speed =
      JUNGLE_CONFIG.PARTICLE_SPEED_MIN +
      Math.random() * (JUNGLE_CONFIG.PARTICLE_SPEED_MAX - JUNGLE_CONFIG.PARTICLE_SPEED_MIN);
    const vx = (Math.random() - 0.5) * speed * 0.3; // Slight horizontal drift
    const vy = -speed; // "Downward" in game Y direction

    particleData.push({ x, y, vx, vy, size });
  }

  // Create geometry with position and size attributes
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Create material - green-tinted, more transparent
  const material = new THREE.PointsMaterial({
    color: JUNGLE_CONFIG.PARTICLE_COLOR,
    size: 6, // Base size
    transparent: true,
    opacity: JUNGLE_CONFIG.PARTICLE_OPACITY,
    sizeAttenuation: false,
    map: createJungleParticleTexture(),
    alphaTest: 0.3,
  });

  const particles = new THREE.Points(geometry, material);
  return { particles, particleData };
}

/**
 * Create particle texture for jungle (elongated for data-rain look)
 */
function createJungleParticleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 32; // Taller than wide for rain-streak effect

  const ctx = canvas.getContext('2d')!;

  // Vertical gradient (brighter at top, fading down)
  const gradient = ctx.createLinearGradient(8, 0, 8, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(4, 0, 8, 32); // Centered vertical bar

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Update jungle particle positions (called every frame)
 * Particles drift along game Y and wrap around
 * XZ plane: X=game X, Y=height, Z=-game Y
 */
export function updateJungleParticles(
  particles: THREE.Points,
  particleData: JungleParticle[],
  dt: number
): void {
  const positions = (particles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;

  for (let i = 0; i < particleData.length; i++) {
    const data = particleData[i];

    // Update position (game coordinates)
    data.x += data.vx * dt;
    data.y += data.vy * dt;

    // Wrap around jungle bounds
    if (data.y < 0) {
      data.y = GAME_CONFIG.JUNGLE_HEIGHT;
      data.x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    }
    if (data.x < 0) data.x = GAME_CONFIG.JUNGLE_WIDTH;
    if (data.x > GAME_CONFIG.JUNGLE_WIDTH) data.x = 0;

    // Update buffer (XZ plane: X=game X, Y=height stays same, Z=-game Y)
    positions[i * 3] = data.x;
    // positions[i * 3 + 1] stays at particle height (set during creation)
    positions[i * 3 + 2] = -data.y;
  }

  particles.geometry.attributes.position.needsUpdate = true;
}

/**
 * Update soup activity dots (brownian motion within pool bounds)
 * Creates the effect of "life" inside the soup pool
 * XZ plane: X=game X, Y=height, Z=-game Y
 */
export function updateSoupActivity(
  activityPoints: THREE.Points,
  activityData: SoupActivityDot[],
  dt: number
): void {
  const positions = (activityPoints.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;

  // Center of the soup region
  const centerX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2;
  const centerY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2;
  const poolRadius = GAME_CONFIG.SOUP_POOL_RADIUS;

  for (let i = 0; i < activityData.length; i++) {
    const dot = activityData[i];

    // Update position (brownian motion, game coordinates)
    dot.x += dot.vx * dt;
    dot.y += dot.vy * dt;

    // Bounce off pool boundary (keep within 80% of radius)
    const maxDist = poolRadius * 0.8;
    const dist = Math.sqrt(dot.x * dot.x + dot.y * dot.y);
    if (dist > maxDist) {
      // Reflect velocity to bounce back toward center
      const nx = dot.x / dist;
      const ny = dot.y / dist;
      const dotProduct = dot.vx * nx + dot.vy * ny;
      dot.vx -= 2 * dotProduct * nx;
      dot.vy -= 2 * dotProduct * ny;
      // Push back inside
      dot.x = nx * maxDist * 0.95;
      dot.y = ny * maxDist * 0.95;
    }

    // Occasionally change direction (brownian motion)
    if (Math.random() < 0.02) {
      const speed = JUNGLE_CONFIG.SOUP_ACTIVITY_DOT_SPEED;
      const angle = Math.random() * Math.PI * 2;
      dot.vx = Math.cos(angle) * speed;
      dot.vy = Math.sin(angle) * speed;
    }

    // Update buffer (XZ plane: X=center+offsetX, Y=height stays same, Z=-(center+offsetY))
    positions[i * 3] = centerX + dot.x;
    // positions[i * 3 + 1] stays at activity height (set during creation)
    positions[i * 3 + 2] = -(centerY + dot.y);
  }

  activityPoints.geometry.attributes.position.needsUpdate = true;
}

/**
 * Get the jungle background color for scene background swap
 */
export function getJungleBackgroundColor(): number {
  return JUNGLE_CONFIG.BACKGROUND_COLOR;
}

/**
 * Get soup background color (for restoring when switching back)
 */
export function getSoupBackgroundColor(): number {
  return GAME_CONFIG.BACKGROUND_COLOR;
}

/**
 * Get first-person sky color (for scene background in first-person mode)
 */
export function getFirstPersonSkyColor(): number {
  return JUNGLE_CONFIG.FP_SKY_COLOR;
}

/**
 * Create first-person ground plane with cyber grid
 * Returns a Group containing the ground mesh and grid lines
 * Coordinate mapping: game X = 3D X, game Y = 3D Z (negative), height = 3D Y
 */
export function createFirstPersonGround(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'firstPersonGround';

  // Ground plane dimensions (covers jungle area)
  const width = GAME_CONFIG.JUNGLE_WIDTH;
  const depth = GAME_CONFIG.JUNGLE_HEIGHT;

  // Ground plane at Y=0 (floor level)
  const groundGeometry = new THREE.PlaneGeometry(width, depth);
  const groundMaterial = new THREE.MeshBasicMaterial({
    color: JUNGLE_CONFIG.FP_GROUND_COLOR,
    side: THREE.DoubleSide,
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);

  // Position: center of jungle, rotated to be horizontal (XZ plane)
  // Game coordinates: center at (width/2, height/2)
  // 3D coordinates: X = game X, Y = height (0 for ground), Z = -game Y
  groundMesh.rotation.x = -Math.PI / 2; // Rotate to lie flat
  groundMesh.position.set(width / 2, 0, -depth / 2);
  group.add(groundMesh);

  // Grid lines on ground
  const gridSpacing = JUNGLE_CONFIG.FP_GROUND_GRID_SPACING;
  const gridMaterial = new THREE.LineBasicMaterial({
    color: JUNGLE_CONFIG.FP_GROUND_GRID_COLOR,
    transparent: true,
    opacity: 0.3,
  });

  // Lines parallel to X axis (running along game X)
  for (let gameY = 0; gameY <= depth; gameY += gridSpacing) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.1, -gameY), // Slightly above ground to prevent z-fighting
      new THREE.Vector3(width, 0.1, -gameY),
    ]);
    const line = new THREE.Line(geometry, gridMaterial);
    group.add(line);
  }

  // Lines parallel to Z axis (running along game Y)
  for (let gameX = 0; gameX <= width; gameX += gridSpacing) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(gameX, 0.1, 0),
      new THREE.Vector3(gameX, 0.1, -depth),
    ]);
    const line = new THREE.Line(geometry, gridMaterial);
    group.add(line);
  }

  return group;
}

/**
 * Update undergrowth particles (opacity pulse animation)
 * Creates gentle breathing effect on ground-level glow
 */
export function updateUndergrowth(
  undergrowthPoints: THREE.Points,
  undergrowthData: UndergrowthParticle[],
  _dt: number
): void {
  const time = performance.now() / 1000;
  const material = undergrowthPoints.material as THREE.PointsMaterial;

  // Global pulse effect (all particles breathe together with phase offsets)
  let totalOpacity = 0;
  for (const data of undergrowthData) {
    const pulsePhase = time * JUNGLE_CONFIG.UNDERGROWTH_PULSE_SPEED * Math.PI * 2 + data.phase;
    const pulseFactor = 1 + Math.sin(pulsePhase) * JUNGLE_CONFIG.UNDERGROWTH_PULSE_RANGE;
    totalOpacity += data.baseOpacity * pulseFactor;
  }

  // Set average opacity (simple approach - could do per-vertex colors for more detail)
  material.opacity = (totalOpacity / undergrowthData.length) * 0.8;
}

/**
 * Update firefly particles (position drift + glow pulse)
 * Creates floating ambient life effect
 */
export function updateFireflies(
  fireflyPoints: THREE.Points,
  fireflyData: FireflyParticle[],
  dt: number
): void {
  const positions = (fireflyPoints.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
  const time = performance.now() / 1000;

  for (let i = 0; i < fireflyData.length; i++) {
    const data = fireflyData[i];

    // Update position (slow drift)
    data.x += data.vx * dt;
    data.y += data.vy * dt;
    data.z += data.vz * dt;

    // Wrap around jungle bounds
    if (data.x < 0) data.x = GAME_CONFIG.JUNGLE_WIDTH;
    if (data.x > GAME_CONFIG.JUNGLE_WIDTH) data.x = 0;
    if (data.y < 0) data.y = GAME_CONFIG.JUNGLE_HEIGHT;
    if (data.y > GAME_CONFIG.JUNGLE_HEIGHT) data.y = 0;

    // Bounce height (stay within height range)
    if (data.z < JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN) {
      data.z = JUNGLE_CONFIG.FIREFLY_HEIGHT_MIN;
      data.vz = Math.abs(data.vz);
    }
    if (data.z > JUNGLE_CONFIG.FIREFLY_HEIGHT_MAX) {
      data.z = JUNGLE_CONFIG.FIREFLY_HEIGHT_MAX;
      data.vz = -Math.abs(data.vz);
    }

    // Occasionally change direction (brownian motion)
    if (Math.random() < 0.005) {
      const speed = JUNGLE_CONFIG.FIREFLY_SPEED;
      const angle = Math.random() * Math.PI * 2;
      data.vx = Math.cos(angle) * speed * (0.5 + Math.random() * 0.5);
      data.vy = Math.sin(angle) * speed * (0.5 + Math.random() * 0.5);
      data.vz = (Math.random() - 0.5) * speed * 0.3;
    }

    // Update buffer positions
    positions[i * 3] = data.x;
    positions[i * 3 + 1] = data.z; // Height
    positions[i * 3 + 2] = -data.y;
  }

  fireflyPoints.geometry.attributes.position.needsUpdate = true;

  // Pulse opacity for firefly glow effect
  const material = fireflyPoints.material as THREE.PointsMaterial;
  const pulsePhase = time * JUNGLE_CONFIG.FIREFLY_PULSE_SPEED * Math.PI * 2;
  const pulseFactor = 0.5 + Math.sin(pulsePhase) * 0.3; // 0.2 to 0.8
  material.opacity = pulseFactor;
}

/**
 * Update ground texture animation (pulse + flow)
 * Call this from the render loop with the jungle background group
 */
export function updateGroundTexture(jungleGroup: THREE.Group, _dtSeconds?: number): void {
  const time = performance.now() / 1000;

  // Update ground shader time
  const groundMaterial = (jungleGroup as unknown as { groundMaterial?: THREE.ShaderMaterial }).groundMaterial;
  if (groundMaterial) {
    groundMaterial.uniforms.time.value = time;
  }

  // Update grass shader time for wind animation (only if using ShaderMaterial)
  const grassMaterial = (jungleGroup as unknown as { grassMaterial?: THREE.ShaderMaterial }).grassMaterial;
  if (grassMaterial && grassMaterial.uniforms) {
    grassMaterial.uniforms.time.value = time;
  }
}
