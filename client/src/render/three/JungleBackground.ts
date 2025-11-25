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
};

// Particle animation data
interface JungleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

/**
 * Create jungle background group containing grid and particles
 * Returns a Group that can be toggled visible/hidden based on player stage
 */
export function createJungleBackground(scene: THREE.Scene): {
  group: THREE.Group;
  particles: THREE.Points;
  particleData: JungleParticle[];
} {
  const group = new THREE.Group();
  group.name = 'jungleBackground';
  group.visible = false; // Hidden by default (soup is visible initially)

  // Create jungle grid spanning full jungle dimensions
  createJungleGrid(group);

  // Create jungle particles (data rain effect)
  const { particles, particleData } = createJungleParticles();
  group.add(particles);

  scene.add(group);

  return { group, particles, particleData };
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
