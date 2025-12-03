// ============================================
// Animation Updater
// Updates and cleans up particle animations
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';
import type { DeathAnimation, EvolutionAnimation, EMPEffect, SwarmDeathAnimation, SpawnAnimation, EnergyTransferAnimation, MeleeArcAnimation } from '../effects/ParticleEffects';

/**
 * Update death particle animations (radial burst that fades)
 * Mutates the animations array in place, removing finished animations
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of death animations (mutated in place)
 * @param dt - Delta time in milliseconds
 */
export function updateDeathAnimations(
  scene: THREE.Scene,
  animations: DeathAnimation[],
  dt: number
): void {
  const deltaSeconds = dt / 1000;
  const now = Date.now();
  const finishedAnimations: number[] = [];

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      return;
    }

    // Update particle positions and fade
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];

      // Move particle (game coordinates)
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;

      // Update geometry position (XZ plane: X=game X, Y=height, Z=-game Y)
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = 0.2; // Height (constant)
      positions[i * 3 + 2] = -p.y;

      // Fade out life
      p.life = 1 - progress;
    }

    anim.particles.geometry.attributes.position.needsUpdate = true;

    // Update material opacity for fade out
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = 1 - progress;
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    animations.splice(index, 1);
  }
}

/**
 * Update evolution particle animations (orbit outward then spiral back)
 * Mutates the animations array in place, removing finished animations
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of evolution animations (mutated in place)
 * @param dt - Delta time in milliseconds
 */
export function updateEvolutionAnimations(
  scene: THREE.Scene,
  animations: EvolutionAnimation[],
  dt: number
): void {
  const deltaSeconds = dt / 1000;
  const now = Date.now();
  const finishedAnimations: number[] = [];

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      return;
    }

    // Update particle positions
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];

      // Orbit: update angle
      p.angle += p.angleVelocity * deltaSeconds;

      // Radius: expand to 0.5, then contract back to center
      // Use smooth sine wave: out -> in
      const radiusProgress = Math.sin(progress * Math.PI); // 0 -> 1 -> 0
      const maxRadius = 100;
      p.radius = 10 + radiusProgress * maxRadius;

      // Calculate new position based on polar coordinates (game space)
      const x = p.centerX + Math.cos(p.angle) * p.radius;
      const y = p.centerY + Math.sin(p.angle) * p.radius;

      // Update geometry position (XZ plane: X=game X, Y=height, Z=-game Y)
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0.2; // Height
      positions[i * 3 + 2] = -y;
    }

    anim.particles.geometry.attributes.position.needsUpdate = true;

    // Fade out near end
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = progress < 0.8 ? 1.0 : (1.0 - (progress - 0.8) / 0.2);
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    animations.splice(index, 1);
  }
}

/**
 * Update EMP pulse animations (expanding ring that fades out)
 * Mutates the animations array in place, removing finished animations
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of EMP effects (mutated in place)
 */
export function updateEMPEffects(
  scene: THREE.Scene,
  animations: EMPEffect[]
): void {
  const now = Date.now();
  const finishedAnimations: number[] = [];

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      return;
    }

    // Update particle positions - expand from initial radius to EMP_RANGE
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;
    const maxRadius = GAME_CONFIG.EMP_RANGE; // 384 units

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];

      // Expand radius linearly
      p.radius = p.initialRadius + (maxRadius - p.initialRadius) * progress;

      // Calculate new position based on polar coordinates (game space)
      const x = anim.centerX + Math.cos(p.angle) * p.radius;
      const y = anim.centerY + Math.sin(p.angle) * p.radius;

      // Update geometry position (XZ plane: X=game X, Y=height, Z=-game Y)
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0.3; // Height (above evolution particles)
      positions[i * 3 + 2] = -y;
    }

    anim.particles.geometry.attributes.position.needsUpdate = true;

    // Fade out as it expands (starts fading at 40% progress)
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = progress < 0.4 ? 1.0 : (1.0 - (progress - 0.4) / 0.6);
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    animations.splice(index, 1);
  }
}

/**
 * Update swarm death explosion animations (particles burst outward and fade)
 * Mutates the animations array in place, removing finished animations
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of swarm death animations (mutated in place)
 * @param dt - Delta time in milliseconds
 */
export function updateSwarmDeathAnimations(
  scene: THREE.Scene,
  animations: SwarmDeathAnimation[],
  dt: number
): void {
  const deltaSeconds = dt / 1000;
  const now = Date.now();
  const finishedAnimations: number[] = [];

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      return;
    }

    // Update particle positions - explode outward
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];

      // Move particle based on velocity (all in Three.js XZ space)
      // vx = X velocity, vy = Y (height) velocity, vz = Z velocity
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds; // Height movement
      p.z += p.vz * deltaSeconds;

      // Update geometry position (already in Three.js coordinates)
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y; // Y = height
      positions[i * 3 + 2] = p.z;
    }

    anim.particles.geometry.attributes.position.needsUpdate = true;

    // Fade out over entire duration
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = 1.0 - progress; // Linear fade
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    animations.splice(index, 1);
  }
}

/**
 * Update spawn materialization animations (particles converge inward, entity scales up)
 * Returns a map of entityIds to their current animation progress (0-1) for scale/opacity
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of spawn animations (mutated in place)
 * @param dt - Delta time in milliseconds
 * @returns Map of entityId -> animation progress (0-1)
 */
export function updateSpawnAnimations(
  scene: THREE.Scene,
  animations: SpawnAnimation[],
  dt: number
): Map<string, number> {
  const deltaSeconds = dt / 1000;
  const now = Date.now();
  const finishedAnimations: number[] = [];
  const progressMap = new Map<string, number>();

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    // Store progress for entity scale/opacity updates
    progressMap.set(anim.entityId, progress);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      return;
    }

    // Update particle positions - converge inward
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];

      // Move particle toward center (game coordinates)
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;

      // Update geometry position (XZ plane: X=game X, Y=height, Z=-game Y)
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = 0.15; // Height (below entities)
      positions[i * 3 + 2] = -p.y;
    }

    anim.particles.geometry.attributes.position.needsUpdate = true;

    // Fade out as particles converge (more visible at start)
    // Opacity: 1.0 → 0.3 (not fully transparent) so particles remain slightly visible
    // at the moment of convergence, reinforcing the "assembly" visual
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = 1.0 - progress * 0.7;
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    animations.splice(index, 1);
  }

  return progressMap;
}

/**
 * Update energy transfer particle animations (particles fly from source to target)
 * Mutates the animations array in place, removing finished animations
 * Returns set of targetIds that have particles arriving (for triggering gain aura)
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of energy transfer animations (mutated in place)
 * @param dt - Delta time in milliseconds
 * @returns Set of targetIds receiving energy this frame
 */
export function updateEnergyTransferAnimations(
  scene: THREE.Scene,
  animations: EnergyTransferAnimation[],
  dt: number
): Set<string> {
  const deltaSeconds = dt / 1000;
  const now = Date.now();
  const finishedAnimations: number[] = [];
  const receivingEnergy = new Set<string>();

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      // Trigger gain aura on target when particles arrive
      receivingEnergy.add(anim.targetId);
      return;
    }

    // Update particle positions - interpolate toward targets
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;
    let arrivedCount = 0;

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];

      // Update individual particle progress (staggered start)
      p.progress += deltaSeconds * (p.speed / 100); // Normalize speed to progress rate

      if (p.progress >= 1) {
        arrivedCount++;
        continue;
      }

      if (p.progress > 0) {
        // Ease-in-out interpolation for smooth acceleration/deceleration
        const t = p.progress;
        const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        // Interpolate position from start (p.x/y) toward target (game coordinates)
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;

        const currentX = p.x + dx * easeT;
        const currentY = p.y + dy * easeT;

        // Update geometry position (XZ plane: X=game X, Y=height, Z=-game Y)
        positions[i * 3] = currentX;
        positions[i * 3 + 1] = 0.25; // Height (above entities)
        positions[i * 3 + 2] = -currentY;
      }
    }

    anim.particles.geometry.attributes.position.needsUpdate = true;

    // Fade as particles converge (full opacity at start, fading near end)
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = progress < 0.6 ? 1.0 : (1.0 - (progress - 0.6) / 0.4);

    // If most particles have arrived, mark as receiving
    if (arrivedCount > anim.particleData.length * 0.7) {
      receivingEnergy.add(anim.targetId);
    }
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    animations.splice(index, 1);
  }

  return receivingEnergy;
}

/**
 * Update melee arc attack animations (particles expand outward in arc)
 * Mutates the animations array in place, removing finished animations
 *
 * @param scene - Three.js scene (for removing finished particles)
 * @param animations - Array of melee arc animations (mutated in place)
 * @param dt - Delta time in milliseconds
 */
export function updateMeleeArcAnimations(
  scene: THREE.Scene,
  animations: MeleeArcAnimation[],
  dt: number
): void {
  const deltaSeconds = dt / 1000;
  const now = Date.now();
  const finishedAnimations: number[] = [];

  animations.forEach((anim, index) => {
    const elapsed = now - anim.startTime;
    const progress = Math.min(elapsed / anim.duration, 1);

    if (progress >= 1) {
      // Animation finished - mark for removal
      finishedAnimations.push(index);
      return;
    }

    // ============================================
    // Update main particles (expand outward)
    // ============================================
    const positions = anim.particles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.particleData.length; i++) {
      const p = anim.particleData[i];
      p.radius += p.radiusSpeed * deltaSeconds;

      const newX = anim.centerX + Math.cos(p.angle) * p.radius;
      const newY = anim.centerY + Math.sin(p.angle) * p.radius;

      positions[i * 3] = newX;
      positions[i * 3 + 1] = 0.5 + Math.random() * 0.5; // Slight height variation
      positions[i * 3 + 2] = -newY;
    }
    anim.particles.geometry.attributes.position.needsUpdate = true;

    // ============================================
    // Update trail particles
    // ============================================
    const trailPositions = anim.trailParticles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.trailData.length; i++) {
      const t = anim.trailData[i];
      t.radius += t.radiusSpeed * deltaSeconds;

      const newX = anim.centerX + Math.cos(t.angle) * t.radius;
      const newY = anim.centerY + Math.sin(t.angle) * t.radius;

      trailPositions[i * 3] = newX;
      trailPositions[i * 3 + 1] = 0.3;
      trailPositions[i * 3 + 2] = -newY;
    }
    anim.trailParticles.geometry.attributes.position.needsUpdate = true;

    // ============================================
    // Update spark particles (fly outward with velocity)
    // ============================================
    const sparkPositions = anim.sparkParticles.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < anim.sparkData.length; i++) {
      const s = anim.sparkData[i];
      s.x += s.vx * deltaSeconds;
      s.y += s.vy * deltaSeconds;
      s.life -= deltaSeconds * 3; // Sparks fade faster

      sparkPositions[i * 3] = s.x;
      sparkPositions[i * 3 + 1] = 1 + Math.random() * 2;
      sparkPositions[i * 3 + 2] = -s.y;
    }
    anim.sparkParticles.geometry.attributes.position.needsUpdate = true;

    // ============================================
    // Fade out all elements near end
    // ============================================
    const fadeStart = 0.4;
    const opacity = progress < fadeStart ? 1.0 : (1.0 - (progress - fadeStart) / (1 - fadeStart));

    // Main particles
    const material = anim.particles.material as THREE.PointsMaterial;
    material.opacity = opacity;

    // Trail particles (fade slightly faster)
    const trailMaterial = anim.trailParticles.material as THREE.PointsMaterial;
    trailMaterial.opacity = opacity * 0.6;

    // Spark particles
    const sparkMaterial = anim.sparkParticles.material as THREE.PointsMaterial;
    sparkMaterial.opacity = opacity;

    // Arc mesh
    const arcMaterial = anim.arcMesh.material as THREE.MeshBasicMaterial;
    arcMaterial.opacity = opacity * 0.7;

    // Hitbox debug mesh
    if (anim.hitboxMesh) {
      const hitboxMaterial = anim.hitboxMesh.material as THREE.LineBasicMaterial;
      hitboxMaterial.opacity = opacity * 0.8;
    }
  });

  // Clean up finished animations (reverse order to avoid index shifting)
  for (let i = finishedAnimations.length - 1; i >= 0; i--) {
    const index = finishedAnimations[i];
    const anim = animations[index];

    // Clean up main particles
    scene.remove(anim.particles);
    anim.particles.geometry.dispose();
    (anim.particles.material as THREE.Material).dispose();

    // Clean up trail particles
    scene.remove(anim.trailParticles);
    anim.trailParticles.geometry.dispose();
    (anim.trailParticles.material as THREE.Material).dispose();

    // Clean up spark particles
    scene.remove(anim.sparkParticles);
    anim.sparkParticles.geometry.dispose();
    (anim.sparkParticles.material as THREE.Material).dispose();

    // Clean up arc mesh
    scene.remove(anim.arcMesh);
    anim.arcMesh.geometry.dispose();
    (anim.arcMesh.material as THREE.Material).dispose();

    // Clean up hitbox debug mesh if present
    if (anim.hitboxMesh) {
      scene.remove(anim.hitboxMesh);
      anim.hitboxMesh.geometry.dispose();
      (anim.hitboxMesh.material as THREE.Material).dispose();
    }

    animations.splice(index, 1);
  }
}
