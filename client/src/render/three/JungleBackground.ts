// ============================================
// Jungle Background - Digital jungle environment for Stage 3+
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';

/**
 * Visual parameters for jungle background
 * These create a distinct aesthetic from the soup - darker, more sparse, data-rain feel
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
  // User wants this SMALL - about 2x player size, not full soup dimensions
  SOUP_POOL_RADIUS: 300, // ~2x cyber-organism radius (144)
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

/**
 * Create jungle background group containing grid, particles, and soup pool visualization
 * Returns a Group that can be toggled visible/hidden based on player stage
 */
export function createJungleBackground(scene: THREE.Scene): {
  group: THREE.Group;
  particles: THREE.Points;
  particleData: JungleParticle[];
  soupActivityPoints: THREE.Points;
  soupActivityData: SoupActivityDot[];
} {
  const group = new THREE.Group();
  group.name = 'jungleBackground';
  group.visible = false; // Hidden by default (soup is visible initially)

  // Create jungle grid spanning full jungle dimensions
  createJungleGrid(group);

  // Create soup pool visualization (small glowing blob with activity dots)
  const { activityPoints, activityData } = createSoupPool(group);

  // Create jungle particles (data rain effect)
  const { particles, particleData } = createJungleParticles();
  group.add(particles);

  scene.add(group);

  return {
    group,
    particles,
    particleData,
    soupActivityPoints: activityPoints,
    soupActivityData: activityData,
  };
}

/**
 * Create jungle grid lines - larger spacing, darker color
 * Grid spans the full JUNGLE dimensions
 */
function createJungleGrid(group: THREE.Group): void {
  const gridSize = JUNGLE_CONFIG.GRID_SIZE;
  const gridColor = JUNGLE_CONFIG.GRID_COLOR;

  // Vertical lines across full jungle width
  for (let x = 0; x <= GAME_CONFIG.JUNGLE_WIDTH; x += gridSize) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, -1.5), // Behind soup grid (z=-1)
      new THREE.Vector3(x, GAME_CONFIG.JUNGLE_HEIGHT, -1.5),
    ]);
    const material = new THREE.LineBasicMaterial({ color: gridColor });
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }

  // Horizontal lines across full jungle height
  for (let y = 0; y <= GAME_CONFIG.JUNGLE_HEIGHT; y += gridSize) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, y, -1.5),
      new THREE.Vector3(GAME_CONFIG.JUNGLE_WIDTH, y, -1.5),
    ]);
    const material = new THREE.LineBasicMaterial({ color: gridColor });
    const line = new THREE.Line(geometry, material);
    group.add(line);
  }
}

/**
 * Create soup pool visualization - a small glowing ellipse with activity dots inside
 * Shows Stage 3+ players where the primordial soup is located
 * Size: ~2x player size (300px radius), centered at soup region center
 */
function createSoupPool(group: THREE.Group): {
  activityPoints: THREE.Points;
  activityData: SoupActivityDot[];
} {
  // Center of the soup region
  const centerX = GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2;
  const centerY = GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2;
  const poolRadius = JUNGLE_CONFIG.SOUP_POOL_RADIUS;
  const glowSize = JUNGLE_CONFIG.SOUP_POOL_GLOW_SIZE;

  // Z positions: glow behind fill, fill behind activity dots
  const zGlow = -1.3;
  const zFill = -1.2;
  const zActivity = -1.1;

  // === OUTER GLOW (larger circle behind the pool) ===
  const glowGeometry = new THREE.CircleGeometry(poolRadius + glowSize, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: JUNGLE_CONFIG.SOUP_POOL_GLOW_COLOR,
    transparent: true,
    opacity: JUNGLE_CONFIG.SOUP_POOL_GLOW_OPACITY,
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.position.set(centerX, centerY, zGlow);
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
  fillMesh.position.set(centerX, centerY, zFill);
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

    // Position (offset from center)
    positions[i * 3] = centerX + x;
    positions[i * 3 + 1] = centerY + y;
    positions[i * 3 + 2] = zActivity;

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
 * Particles drift downward (vertical) instead of diagonal
 */
function createJungleParticles(): {
  particles: THREE.Points;
  particleData: JungleParticle[];
} {
  const particleCount = JUNGLE_CONFIG.PARTICLE_COUNT;
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const particleData: JungleParticle[] = [];

  for (let i = 0; i < particleCount; i++) {
    // Spawn across full jungle area
    const x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    const y = Math.random() * GAME_CONFIG.JUNGLE_HEIGHT;
    const size =
      JUNGLE_CONFIG.PARTICLE_MIN_SIZE +
      Math.random() * (JUNGLE_CONFIG.PARTICLE_MAX_SIZE - JUNGLE_CONFIG.PARTICLE_MIN_SIZE);

    // Position
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = -1.4; // Behind jungle grid, in front of nothing

    // Size
    sizes[i] = size;

    // Velocity: primarily downward drift (data rain)
    // Slight horizontal variance for organic feel
    const speed =
      JUNGLE_CONFIG.PARTICLE_SPEED_MIN +
      Math.random() * (JUNGLE_CONFIG.PARTICLE_SPEED_MAX - JUNGLE_CONFIG.PARTICLE_SPEED_MIN);
    const vx = (Math.random() - 0.5) * speed * 0.3; // Slight horizontal drift
    const vy = -speed; // Downward (negative Y)

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
 * Particles drift downward and wrap around
 */
export function updateJungleParticles(
  particles: THREE.Points,
  particleData: JungleParticle[],
  dt: number
): void {
  const positions = (particles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;

  for (let i = 0; i < particleData.length; i++) {
    const data = particleData[i];

    // Update position
    data.x += data.vx * dt;
    data.y += data.vy * dt;

    // Wrap around jungle bounds
    if (data.y < 0) {
      data.y = GAME_CONFIG.JUNGLE_HEIGHT;
      data.x = Math.random() * GAME_CONFIG.JUNGLE_WIDTH;
    }
    if (data.x < 0) data.x = GAME_CONFIG.JUNGLE_WIDTH;
    if (data.x > GAME_CONFIG.JUNGLE_WIDTH) data.x = 0;

    // Update buffer
    positions[i * 3] = data.x;
    positions[i * 3 + 1] = data.y;
  }

  particles.geometry.attributes.position.needsUpdate = true;
}

/**
 * Update soup activity dots (brownian motion within pool bounds)
 * Creates the effect of "life" inside the soup pool
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
  const poolRadius = JUNGLE_CONFIG.SOUP_POOL_RADIUS;

  for (let i = 0; i < activityData.length; i++) {
    const dot = activityData[i];

    // Update position (brownian motion)
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

    // Update buffer (absolute position = center + offset)
    positions[i * 3] = centerX + dot.x;
    positions[i * 3 + 1] = centerY + dot.y;
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
