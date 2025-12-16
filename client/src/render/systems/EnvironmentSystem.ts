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
import { World } from '../../ecs';

export type RenderMode = 'soup' | 'jungle';

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
   * - Opaque sphere for far-side occlusion
   * - Wireframe grid overlay for visual reference
   * - Flowing data particles on surface
   */
  private createSphereEnvironment(): void {
    this.sphereBackgroundGroup = new THREE.Group();
    this.sphereBackgroundGroup.name = 'sphereBackground';

    const radius = GAME_CONFIG.SPHERE_RADIUS;

    // === LAYER 1: Solid sphere for far-side occlusion ===
    // FrontSide renders outside faces - camera is outside sphere, so this occludes far side
    const sphereGeometry = new THREE.IcosahedronGeometry(radius, 3);
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: GAME_CONFIG.BACKGROUND_COLOR,
      side: THREE.FrontSide,
      depthWrite: true,  // Write depth so far-side entities fail depth test
    });
    const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
    this.sphereBackgroundGroup.add(sphereMesh);

    // === LAYER 2: Wireframe grid overlay ===
    // Slightly larger radius so it renders on top of solid sphere
    const wireframeGeometry = new THREE.IcosahedronGeometry(radius + 1, 3);
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: GAME_CONFIG.GRID_COLOR,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
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
    const particleCount = GAME_CONFIG.MAX_PARTICLES;
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
    // Sphere mode: update particles and gravity well cache
    if (this.isSphereWorld) {
      this.updateSphereParticles(dt);
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
}
