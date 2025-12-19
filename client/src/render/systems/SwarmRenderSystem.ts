// ============================================
// SwarmRenderSystem - Manages entropy swarm rendering
// Owns swarm meshes (outer sphere, internal storm, orbiting particles)
// Queries ECS World directly for swarm entities
// ============================================

import * as THREE from 'three';
import {
  createSwarm,
  updateSwarmState,
  updateSwarmAnimation,
  disposeSwarm,
  type SwarmInternalParticle,
  type SwarmOrbitingParticle,
} from '../meshes/SwarmMesh';
import { frameLerp } from '../../utils/math';
import {
  World,
  Tags,
  Components,
  getStringIdByEntity,
  type PositionComponent,
  type SwarmComponent,
  type InterpolationTargetComponent,
  type EnergyComponent,
  GAME_CONFIG,
} from '../../ecs';
import type { RenderMode } from './EnvironmentSystem';

/**
 * SwarmRenderSystem - Manages entropy swarm rendering
 *
 * Owns:
 * - Swarm meshes (outer sphere + internal storm + orbiting particles)
 * - Particle animation data (internal and orbiting)
 * - Interpolation targets for smooth movement
 * - Pulse phase offsets for desynchronized animation
 */
export class SwarmRenderSystem {
  private scene!: THREE.Scene;
  private world!: World;

  // Swarm meshes (Groups containing sphere + particles)
  private swarmMeshes: Map<string, THREE.Group> = new Map();

  // Orbiting particle animation data
  private swarmParticleData: Map<string, SwarmOrbitingParticle[]> = new Map();

  // Internal storm particle animation data
  private swarmInternalParticles: Map<string, SwarmInternalParticle[]> = new Map();

  // Phase offset for pulsing animation (so swarms don't pulse in sync)
  private swarmPulsePhase: Map<string, number> = new Map();

  // Interpolation targets for smooth movement
  // In sphere mode: 3D coordinates (x, y, z)
  // In flat mode: 2D coordinates (x, y where y = game Y)
  private swarmTargets: Map<string, { x: number; y: number; z?: number }> = new Map();

  // Cache swarm state for animation (avoids re-querying each frame)
  private swarmStates: Map<string, string> = new Map();

  // Cache disabled state for animation freeze
  private swarmDisabled: Map<string, boolean> = new Map();

  // Aura ring meshes (orange glow around charged swarms)
  private swarmAuras: Map<string, THREE.Mesh> = new Map();

  // Aura orbiting particles (count grows with energy)
  private swarmAuraParticles: Map<string, THREE.Points> = new Map();

  // Cache swarm base size for aura scaling
  private swarmBaseSizes: Map<string, number> = new Map();

  // Cache energy scale for spawn animation integration
  private swarmEnergyScales: Map<string, number> = new Map();

  // Cache energy ratio (0-1) for animation intensity
  private swarmEnergyRatios: Map<string, number> = new Map();

  // Delta time for frame-rate independent interpolation (ms)
  private dt: number = 16.67;

  // Base energy (swarms start at 100)
  private readonly BASE_ENERGY = GAME_CONFIG.SWARM_ENERGY;

  // Reusable Vector3 objects to avoid per-frame allocations
  private readonly _normal = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();
  private readonly _bitangent = new THREE.Vector3();
  private readonly _liftedCenter = new THREE.Vector3();
  private readonly _worldUp = new THREE.Vector3(0, 1, 0);

  /**
   * Initialize swarm system with scene and world references
   */
  init(scene: THREE.Scene, world: World): void {
    this.scene = scene;
    this.world = world;
  }

  /**
   * Sync swarms by querying ECS World directly
   * Creates new meshes for new swarms, removes meshes for despawned swarms
   * @param renderMode - Current render mode (soup vs jungle)
   */
  sync(renderMode: RenderMode): void {
    // Skip entirely in jungle mode - soup entities don't exist in jungle world
    if (renderMode === 'jungle') return;

    // Track which swarms exist in ECS
    const currentSwarmIds = new Set<string>();

    // Query ECS World for all swarms
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      const swarmId = getStringIdByEntity(entity);
      if (!swarmId) return;

      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const swarm = this.world.getComponent<SwarmComponent>(entity, Components.Swarm);
      const interp = this.world.getComponent<InterpolationTargetComponent>(
        entity,
        Components.InterpolationTarget
      );
      if (!pos || !swarm) return;

      currentSwarmIds.add(swarmId);

      let group = this.swarmMeshes.get(swarmId);

      if (!group) {
        // Create swarm visual using helper
        const result = createSwarm({ x: pos.x, y: pos.y }, swarm.size);
        group = result.group;

        // Store particle animation data
        this.swarmInternalParticles.set(swarmId, result.internalParticles);
        this.swarmParticleData.set(swarmId, result.orbitingParticles);

        // Random phase offset for pulsing (so swarms don't pulse in sync)
        this.swarmPulsePhase.set(swarmId, Math.random() * Math.PI * 2);

        // Sphere mode: use 3D coordinates directly
        group.position.set(pos.x, pos.y, pos.z ?? 0);
        group.userData.isSphere = true;

        this.scene.add(group);
        this.swarmMeshes.set(swarmId, group);
        this.swarmTargets.set(swarmId, { x: pos.x, y: pos.y, z: pos.z ?? 0 });
      }

      // Update target position for interpolation (use interp target if available)
      const targetX = interp ? interp.targetX : pos.x;
      const targetY = interp ? interp.targetY : pos.y;
      const targetZ = pos.z ?? 0;
      this.swarmTargets.set(swarmId, { x: targetX, y: targetY, z: targetZ });

      // Cache state for animation
      this.swarmStates.set(swarmId, swarm.state);

      // Update colors and intensity based on state
      const now = Date.now();
      const isDisabled = !!(swarm.disabledUntil && now < swarm.disabledUntil);
      this.swarmDisabled.set(swarmId, isDisabled); // Cache for animation freeze
      updateSwarmState(group, swarm.state, isDisabled);

      // === Energy-based effects (size stays constant) ===
      // Swarms no longer grow in size when absorbing energy
      // Energy still affects: aura intensity, particle count, animation speed
      const energyComp = this.world.getComponent<EnergyComponent>(entity, Components.Energy);
      const energy = energyComp?.current ?? this.BASE_ENERGY;
      const MAX_SCALE = 1.5; // For aura/particle calculations only
      const MAX_ENERGY = 500;
      const energyRatio = Math.min(
        (energy - this.BASE_ENERGY) / (MAX_ENERGY - this.BASE_ENERGY),
        1
      );
      const energyScale = 1 + energyRatio * (MAX_SCALE - 1); // Used for aura calculations
      // No size scaling: group.scale stays at 1
      this.swarmEnergyScales.set(swarmId, 1.0); // Fixed scale for spawn animation
      this.swarmEnergyRatios.set(swarmId, energyRatio); // Cache for animation intensity

      // Store base size for aura calculations (from original swarm.size)
      if (!this.swarmBaseSizes.has(swarmId)) {
        this.swarmBaseSizes.set(swarmId, swarm.size);
      }

      // Update internal particle count based on energy
      // Base: 200 particles, grows by 1 particle per 2 energy absorbed
      const baseParticleCount = 200;
      const absorbedEnergy = Math.max(0, energy - this.BASE_ENERGY);
      const targetParticleCount = baseParticleCount + Math.floor(absorbedEnergy / 2);
      this.updateInternalParticleCount(swarmId, group, swarm.size, targetParticleCount);

      // Update aura visuals (ring + orbiting particles)
      this.updateSwarmAura(swarmId, group, energy, energyScale);
    });

    // Remove swarms that no longer exist in ECS
    this.swarmMeshes.forEach((group, id) => {
      if (!currentSwarmIds.has(id)) {
        this.scene.remove(group);
        disposeSwarm(group);
        this.swarmMeshes.delete(id);
        this.swarmTargets.delete(id);
        this.swarmParticleData.delete(id);
        this.swarmInternalParticles.delete(id);
        this.swarmPulsePhase.delete(id);
        this.swarmStates.delete(id);
        this.swarmDisabled.delete(id);
        this.swarmBaseSizes.delete(id);
        this.swarmEnergyScales.delete(id);
        this.swarmEnergyRatios.delete(id);

        // Clean up aura visuals
        const aura = this.swarmAuras.get(id);
        if (aura) {
          this.scene.remove(aura);
          aura.geometry.dispose();
          (aura.material as THREE.Material).dispose();
          this.swarmAuras.delete(id);
        }
        const auraParticles = this.swarmAuraParticles.get(id);
        if (auraParticles) {
          this.scene.remove(auraParticles);
          auraParticles.geometry.dispose();
          (auraParticles.material as THREE.Material).dispose();
          this.swarmAuraParticles.delete(id);
        }
      }
    });
  }

  /**
   * Interpolate swarm positions for smooth movement
   * @param dt Delta time in milliseconds for frame-rate independent interpolation
   */
  interpolate(dt: number = 16.67): void {
    const lerpFactor = frameLerp(0.3, dt);

    this.swarmMeshes.forEach((group, id) => {
      const target = this.swarmTargets.get(id);
      if (target) {
        // Sphere mode: interpolate in 3D space directly
        group.position.x += (target.x - group.position.x) * lerpFactor;
        group.position.y += (target.y - group.position.y) * lerpFactor;
        group.position.z += ((target.z ?? 0) - group.position.z) * lerpFactor;
      }
    });
  }

  /**
   * Update swarm particle animations (pulsing, internal storm, orbiting)
   * @param dt - Delta time in milliseconds
   */
  updateAnimations(dt: number): void {
    this.swarmMeshes.forEach((group, id) => {
      const swarmState = this.swarmStates.get(id) || 'patrol';
      const pulsePhase = this.swarmPulsePhase.get(id) || 0;
      const internalParticles = this.swarmInternalParticles.get(id);
      const orbitingParticles = this.swarmParticleData.get(id);
      const energyRatio = this.swarmEnergyRatios.get(id) ?? 0;
      const isDisabled = this.swarmDisabled.get(id) ?? false;

      if (internalParticles && orbitingParticles) {
        updateSwarmAnimation(
          group,
          internalParticles,
          orbitingParticles,
          swarmState,
          pulsePhase,
          dt,
          energyRatio,
          isDisabled
        );
      }
    });
  }

  /**
   * Apply spawn animation (scale/opacity) to swarms
   * @param spawnProgress - Map of entity ID to spawn progress (0-1)
   */
  applySpawnAnimations(spawnProgress: Map<string, number>): void {
    spawnProgress.forEach((progress, entityId) => {
      const group = this.swarmMeshes.get(entityId);
      if (!group) return;

      // Ease-out curve for smoother scale-up
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const spawnScale = 0.1 + easeOut * 0.9;
      const opacity = 0.3 + easeOut * 0.7;

      // Multiply spawn scale by energy scale (so growing swarms still animate on spawn)
      const energyScale = this.swarmEnergyScales.get(entityId) ?? 1.0;
      group.scale.setScalar(spawnScale * energyScale);
      this.setGroupOpacity(group, opacity);
    });
  }

  /**
   * Get swarm mesh for external access (e.g., for aura system)
   */
  getSwarmMesh(swarmId: string): THREE.Group | undefined {
    return this.swarmMeshes.get(swarmId);
  }

  /**
   * Get all swarm meshes (for aura system)
   */
  getSwarmMeshes(): Map<string, THREE.Group> {
    return this.swarmMeshes;
  }

  /**
   * Get swarm position from mesh (for effects when swarm is consumed)
   * Returns game coordinates (converts from XZ plane in flat mode, direct in sphere mode)
   */
  getSwarmPosition(swarmId: string): { x: number; y: number; z?: number } | undefined {
    const group = this.swarmMeshes.get(swarmId);
    if (!group) return undefined;
    if (group.userData.isSphere) {
      // Sphere mode: return 3D coordinates directly
      return { x: group.position.x, y: group.position.y, z: group.position.z };
    }
    // Flat mode: XZ plane (X=game X, Z=-game Y)
    return { x: group.position.x, y: -group.position.z };
  }

  /**
   * Clear all swarm meshes
   * Called when transitioning from soup to jungle mode
   */
  clearAll(): void {
    this.swarmMeshes.forEach((group) => {
      this.scene.remove(group);
      disposeSwarm(group);
    });
    this.swarmMeshes.clear();
    this.swarmTargets.clear();
    this.swarmParticleData.clear();
    this.swarmInternalParticles.clear();
    this.swarmPulsePhase.clear();
    this.swarmStates.clear();
    this.swarmDisabled.clear();
    this.swarmBaseSizes.clear();
    this.swarmEnergyScales.clear();
    this.swarmEnergyRatios.clear();

    // Clean up all auras
    this.swarmAuras.forEach((aura) => {
      this.scene.remove(aura);
      aura.geometry.dispose();
      (aura.material as THREE.Material).dispose();
    });
    this.swarmAuras.clear();

    this.swarmAuraParticles.forEach((particles) => {
      this.scene.remove(particles);
      particles.geometry.dispose();
      (particles.material as THREE.Material).dispose();
    });
    this.swarmAuraParticles.clear();
  }

  /**
   * Get count of swarm meshes (for debug logging)
   */
  getMeshCount(): number {
    return this.swarmMeshes.size;
  }

  /**
   * Set opacity for all materials in a group
   */
  private setGroupOpacity(group: THREE.Group, opacity: number): void {
    group.children.forEach((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        const material = child.material as THREE.Material;
        if ('opacity' in material) {
          (material as THREE.MeshPhysicalMaterial | THREE.PointsMaterial).opacity = opacity;
        }
      }
    });
  }

  /**
   * Update aura visuals (ring + orbiting particles) based on swarm energy
   * Aura only appears when swarm has absorbed energy (energy > BASE_ENERGY)
   *
   * @param swarmId - Swarm entity ID
   * @param group - Swarm mesh group (for position syncing)
   * @param energy - Current energy (100 = base, grows as swarm drains players)
   * @param energyScale - Scale factor (energy / 100)
   */
  private updateInternalParticleCount(
    swarmId: string,
    group: THREE.Group,
    swarmSize: number,
    targetCount: number
  ): void {
    const currentParticles = this.swarmInternalParticles.get(swarmId);
    if (!currentParticles) return;

    const currentCount = currentParticles.length;
    // Only update if count changed significantly (by 20+ particles)
    if (Math.abs(targetCount - currentCount) < 20) return;

    // Get the internal storm mesh (second child of group)
    const internalStorm = group.children[1] as THREE.Points;
    if (!internalStorm) return;

    // Get pre-allocated buffer arrays
    const posAttr = internalStorm.geometry.attributes.position as THREE.BufferAttribute;
    const sizeAttr = internalStorm.geometry.attributes.size as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;

    // Cap to max pre-allocated size (600)
    const MAX_INTERNAL_PARTICLES = 600;
    const safeTargetCount = Math.min(targetCount, MAX_INTERNAL_PARTICLES);

    // Create new particle data array
    const newParticles: SwarmInternalParticle[] = [];

    // Copy existing particles up to the target count
    const copyCount = Math.min(currentCount, safeTargetCount);
    for (let i = 0; i < copyCount; i++) {
      const p = currentParticles[i];
      newParticles.push({ ...p });
      // Positions are already in buffer from animation updates
    }

    // Add new particles if growing
    for (let i = copyCount; i < safeTargetCount; i++) {
      // Random point inside sphere (uniform distribution)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = Math.cbrt(Math.random()) * swarmSize * 0.9;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      sizes[i] = 1 + Math.random() * 1.5;

      // Random velocity
      const speed = 60 + Math.random() * 80;
      const vTheta = Math.random() * Math.PI * 2;
      const vPhi = Math.random() * Math.PI;

      newParticles.push({
        x,
        y,
        z,
        vx: speed * Math.sin(vPhi) * Math.cos(vTheta),
        vy: speed * Math.sin(vPhi) * Math.sin(vTheta),
        vz: speed * Math.cos(vPhi),
      });
    }

    // Mark buffers for GPU upload and update draw range
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    internalStorm.geometry.setDrawRange(0, safeTargetCount);

    // Update particle data
    this.swarmInternalParticles.set(swarmId, newParticles);
  }

  /**
   * Update aura visuals (ring + orbiting particles)
   *
   * @param swarmId - Swarm identifier
   * @param group - Swarm THREE.Group
   * @param energy - Current energy (100 = base, grows as swarm drains players)
   * @param energyScale - Scale factor (energy / 100)
   */
  private updateSwarmAura(
    swarmId: string,
    group: THREE.Group,
    energy: number,
    _energyScale: number
  ): void {
    const baseSize = this.swarmBaseSizes.get(swarmId) ?? 30;
    const absorbedEnergy = energy - this.BASE_ENERGY;

    // No aura if swarm hasn't absorbed any energy
    if (absorbedEnergy <= 0) {
      // Remove aura if it exists
      const existingAura = this.swarmAuras.get(swarmId);
      if (existingAura) {
        this.scene.remove(existingAura);
        existingAura.geometry.dispose();
        (existingAura.material as THREE.Material).dispose();
        this.swarmAuras.delete(swarmId);
      }
      const existingParticles = this.swarmAuraParticles.get(swarmId);
      if (existingParticles) {
        this.scene.remove(existingParticles);
        existingParticles.geometry.dispose();
        (existingParticles.material as THREE.Material).dispose();
        this.swarmAuraParticles.delete(swarmId);
      }
      return;
    }

    // === AURA INTENSITY ===
    // Opacity/emissivity increases with absorbed energy
    // At 100 absorbed: ~0.3 opacity, at 400 absorbed: ~0.7 opacity
    const intensityFactor = Math.min(absorbedEnergy / 400, 1.0);
    const auraOpacity = 0.15 + intensityFactor * 0.55; // 0.15 to 0.7
    const emissiveIntensity = 0.5 + intensityFactor * 1.5; // 0.5 to 2.0

    // === AURA RING ===
    // Ring sits outside swarm body with some spacing
    // Body no longer scales with energy, so aura uses base size
    const scaledBodyRadius = baseSize;
    const time = performance.now() * 0.001;

    // Pulsing ring thickness: base 10% of body, pulses gently at max energy (dialed back)
    // Pulse frequency increases with energy (1.5Hz base, up to 2.5Hz at max)
    const basePulseFreq = 1.5;
    const pulseFreq = basePulseFreq * (1 + intensityFactor * 0.6); // 1.5-2.4 Hz (was 2-4 Hz)
    const pulsePhase = this.swarmPulsePhase.get(swarmId) ?? 0;
    const pulseWave = Math.sin(time * pulseFreq * Math.PI * 2 + pulsePhase);

    // Ring thickness oscillates: 10% base, +3% pulse at max energy (was +5%)
    const baseThickness = 0.1; // 10% of body radius
    const pulseAmplitude = 0.03 * intensityFactor; // Up to 3% extra at max energy
    const ringThickness = baseThickness + pulseWave * pulseAmplitude;

    // Create ring at base size and use scale for pulsing animation
    const baseRingInner = scaledBodyRadius * 1.15;
    const baseRingOuter = baseRingInner + scaledBodyRadius * baseThickness;

    let auraRing = this.swarmAuras.get(swarmId);
    if (!auraRing) {
      // Create new aura ring at base size (scale will animate pulsing)
      const ringGeometry = new THREE.RingGeometry(baseRingInner, baseRingOuter, 64);
      const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0xff6600, // Orange
        emissive: 0xff6600,
        emissiveIntensity: emissiveIntensity,
        transparent: true,
        opacity: auraOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      auraRing = new THREE.Mesh(ringGeometry, ringMaterial);
      this.scene.add(auraRing);
      this.swarmAuras.set(swarmId, auraRing);
    } else {
      // Animate ring via scale instead of recreating geometry
      const pulseScale = 1 + (pulseWave * pulseAmplitude) / baseThickness;
      auraRing.scale.setScalar(pulseScale);
      // Update material properties
      const material = auraRing.material as THREE.MeshStandardMaterial;
      material.opacity = auraOpacity;
      material.emissiveIntensity = emissiveIntensity;
    }
    // Sync position with swarm (slightly elevated) - using reusable vectors
    this._normal.copy(group.position).normalize();
    auraRing.position.copy(group.position).addScaledVector(this._normal, 0.5);
    // Orient ring to face along surface normal (ring lies in tangent plane)
    auraRing.quaternion.setFromUnitVectors(this._worldUp.set(0, 0, 1), this._normal);

    // === AURA PARTICLES ===
    // Particle count grows with absorbed energy (1 particle per 50 energy absorbed, min 3)
    const particleCount = Math.max(3, Math.floor(absorbedEnergy / 50));
    const orbitRadius = scaledBodyRadius * 1.1; // Just outside the ring
    const MAX_AURA_PARTICLES = 20; // Pre-allocate for max possible

    let auraParticles = this.swarmAuraParticles.get(swarmId);

    // Compute particle positions using reusable vectors
    const computeParticlePositions = (positions: Float32Array, count: number, t: number): void => {
      // Sphere mode: orbit in tangent plane around swarm position (using reusable vectors)
      this._normal.copy(group.position).normalize();
      // Build tangent basis vectors
      this._tangent.crossVectors(this._worldUp.set(0, 1, 0), this._normal);
      if (this._tangent.lengthSq() < 0.0001) {
        this._tangent.set(1, 0, 0).crossVectors(this._tangent, this._normal);
      }
      this._tangent.normalize();
      this._bitangent.crossVectors(this._normal, this._tangent).normalize();
      // Lift position slightly above surface
      this._liftedCenter.copy(group.position).addScaledVector(this._normal, 0.5);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + t * 0.5;
        const cosA = Math.cos(angle) * orbitRadius;
        const sinA = Math.sin(angle) * orbitRadius;
        positions[i * 3] = this._liftedCenter.x + cosA * this._tangent.x + sinA * this._bitangent.x;
        positions[i * 3 + 1] = this._liftedCenter.y + cosA * this._tangent.y + sinA * this._bitangent.y;
        positions[i * 3 + 2] = this._liftedCenter.z + cosA * this._tangent.z + sinA * this._bitangent.z;
      }
    };

    if (!auraParticles) {
      // Create new particle system with pre-allocated buffer
      const positions = new Float32Array(MAX_AURA_PARTICLES * 3);
      computeParticlePositions(positions, particleCount, time);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: 0xff8800, // Bright orange
        size: 4 + intensityFactor * 4, // 4-8 based on intensity
        transparent: true,
        opacity: auraOpacity,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      auraParticles = new THREE.Points(geometry, material);
      this.scene.add(auraParticles);
      this.swarmAuraParticles.set(swarmId, auraParticles);
    }

    // Update positions in pre-allocated buffer
    const posAttr = auraParticles.geometry.attributes.position as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    computeParticlePositions(positions, particleCount, time);
    posAttr.needsUpdate = true;
    auraParticles.geometry.setDrawRange(0, particleCount);

    // Update material
    const material = auraParticles.material as THREE.PointsMaterial;
    material.opacity = auraOpacity;
    material.size = 4 + intensityFactor * 4;

    // Sphere mode: positions are already world coords
    auraParticles.position.set(0, 0, 0);
  }

  /**
   * Dispose all swarm resources
   */
  dispose(): void {
    this.clearAll();
  }
}
