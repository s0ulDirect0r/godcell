// ============================================
// Animation Updater
// Updates and cleans up particle animations
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';
import type { DeathAnimation, EvolutionAnimation, EMPEffect, SwarmDeathAnimation } from './ParticleEffects';

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

      // Move particle
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;

      // Update geometry position
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;

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

      // Calculate new position based on polar coordinates
      const x = p.centerX + Math.cos(p.angle) * p.radius;
      const y = p.centerY + Math.sin(p.angle) * p.radius;

      // Update geometry position
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0.2;
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

      // Calculate new position based on polar coordinates
      const x = anim.centerX + Math.cos(p.angle) * p.radius;
      const y = anim.centerY + Math.sin(p.angle) * p.radius;

      // Update geometry position
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0.3;
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

      // Move particle based on velocity
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;
      p.z += p.vz * deltaSeconds;

      // Update geometry position
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
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
