// ============================================
// Evolution Visual Effects
// Handles visual indicators when cells approach evolution
// ============================================

import * as THREE from 'three';
import { EvolutionStage, GAME_CONFIG } from '#shared';

/**
 * Calculate evolution progress (0.0-1.0) based on maxEnergy and stage
 * Returns 0.0 at 30% of next threshold, 1.0 at 100% of next threshold
 * Normalized to map 30-100% progress into 0.0-1.0 range
 */
export function calculateEvolutionProgress(maxEnergy: number, stage: EvolutionStage): number {
  // Get next evolution threshold based on current stage
  let nextThreshold: number;
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      nextThreshold = GAME_CONFIG.EVOLUTION_MULTI_CELL; // 250
      break;
    case EvolutionStage.MULTI_CELL:
      nextThreshold = GAME_CONFIG.EVOLUTION_CYBER_ORGANISM; // 500
      break;
    case EvolutionStage.CYBER_ORGANISM:
      nextThreshold = GAME_CONFIG.EVOLUTION_HUMANOID; // 1000
      break;
    case EvolutionStage.HUMANOID:
      nextThreshold = GAME_CONFIG.EVOLUTION_GODCELL; // 2000
      break;
    case EvolutionStage.GODCELL:
      return 0; // Godcells don't evolve further
    default:
      return 0;
  }

  // Calculate progress toward threshold (0.0-1.0)
  const rawProgress = maxEnergy / nextThreshold;

  // Map 30-100% into 0.0-1.0 range
  // If below 30%, return 0 (no visual effects)
  if (rawProgress < 0.3) return 0;

  // Normalize: (rawProgress - 0.3) / (1.0 - 0.3) = (rawProgress - 0.3) / 0.7
  return Math.min((rawProgress - 0.3) / 0.7, 1.0);
}

/**
 * Update or create orbiting particle corona for evolving cells
 * Particle count scales from 5 (30%) to 15 (100%)
 *
 * @param cellGroup - The cell's THREE.Group to add corona to
 * @param evolutionProgress - Progress value from 0.0-1.0
 */
export function updateEvolutionCorona(cellGroup: THREE.Group, evolutionProgress: number): void {
  const radius = cellGroup.userData.radius as number;
  const colorHex = cellGroup.userData.colorHex || 0x00ff88;
  const orbitRadius = radius * (2.5 - evolutionProgress); // Just outside torus (2.5x → 1.5x)
  const particleSize = radius * 0.15; // Particle size scales with cell (15% of radius)

  // Calculate particle count based on progress (5 at 0, 15 at 1.0)
  const targetCount = Math.floor(5 + evolutionProgress * 10);

  // Get or create corona container
  let corona = cellGroup.userData.evolutionCorona as THREE.Group | undefined;
  if (!corona) {
    corona = new THREE.Group();
    corona.name = 'evolutionCorona';
    // Rotate so particles orbit in XZ plane (camera looks down Y axis)
    corona.rotation.x = -Math.PI / 2;
    cellGroup.add(corona);
    cellGroup.userData.evolutionCorona = corona;
  }

  // Adjust particle count (add particles if needed)
  while (corona.children.length < targetCount) {
    // Create new particle - size scales with cell radius
    const particleGeometry = new THREE.SphereGeometry(particleSize, 8, 8);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.8,
    });
    const particle = new THREE.Mesh(particleGeometry, particleMaterial);

    // Random initial angle
    particle.userData.angle = Math.random() * Math.PI * 2;
    particle.userData.orbitSpeed = 0.5 + Math.random() * 0.5; // 0.5-1.0 rad/s

    corona.add(particle);
  }

  // Remove excess particles if needed
  while (corona.children.length > targetCount) {
    const particle = corona.children[corona.children.length - 1];
    corona.remove(particle);
  }

  // Update particle positions (orbit around cell)
  const time = performance.now() * 0.001; // seconds
  corona.children.forEach((particle) => {
    if (particle instanceof THREE.Mesh) {
      const orbitSpeed = particle.userData.orbitSpeed || 1.0;
      const angle = particle.userData.angle + time * orbitSpeed;

      // Position on circular orbit
      particle.position.x = Math.cos(angle) * orbitRadius;
      particle.position.y = Math.sin(angle) * orbitRadius;
      particle.position.z = 0;

      // Brightness pulses with evolution progress
      const material = particle.material as THREE.MeshBasicMaterial;
      material.opacity = 0.6 + evolutionProgress * 0.4; // 0.6-1.0
    }
  });
}

/**
 * Update or create glowing torus ring for evolving cells
 * Ring shrinks from 2.0x → 1.0x radius, brightens from 0.5 → 3.0 intensity
 *
 * @param cellGroup - The cell's THREE.Group to add ring to
 * @param evolutionProgress - Progress value from 0.0-1.0
 * @param radius - Cell radius for calculating ring size
 */
export function updateEvolutionRing(
  cellGroup: THREE.Group,
  evolutionProgress: number,
  radius: number
): void {
  const colorHex = cellGroup.userData.colorHex || 0x00ff88;

  // Calculate ring size (shrinks as evolution approaches) - scales with cell radius
  const ringRadius = radius * (2.0 - evolutionProgress); // 2.0x → 1.0x
  const tubeRadius = radius * (0.1 + evolutionProgress * 0.1); // 10% → 20% of radius (thickens)

  // Calculate emissive intensity (brightens)
  const emissiveIntensity = 0.5 + evolutionProgress * 2.5; // 0.5 → 3.0

  // Get or create ring
  let ring = cellGroup.userData.evolutionRing as THREE.Mesh | undefined;
  if (!ring) {
    const ringGeometry = new THREE.TorusGeometry(ringRadius, tubeRadius, 16, 32);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: emissiveIntensity,
      transparent: true,
      opacity: 0.0, // Will be set below based on evolutionProgress
    });
    ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.name = 'evolutionRing';
    // Rotate so torus lies flat on XZ plane (camera looks down Y axis)
    ring.rotation.x = -Math.PI / 2;
    cellGroup.add(ring);
    cellGroup.userData.evolutionRing = ring;
  }

  // Update ring geometry and material
  const oldGeometry = ring.geometry;
  ring.geometry = new THREE.TorusGeometry(ringRadius, tubeRadius, 16, 32);
  oldGeometry.dispose(); // Clean up old geometry

  const material = ring.material as THREE.MeshStandardMaterial;
  material.emissiveIntensity = emissiveIntensity;
  // Fade in gradually from 0.0 → 0.8 as evolution approaches
  material.opacity = evolutionProgress * 0.8;

  // Gentle rotation
  const time = performance.now() * 0.0005;
  ring.rotation.z = time;
}

/**
 * Remove evolution visual effects (corona, ring) when not approaching evolution
 *
 * @param cellGroup - The cell's THREE.Group to remove effects from
 */
export function removeEvolutionEffects(cellGroup: THREE.Group): void {
  // Remove corona
  const corona = cellGroup.userData.evolutionCorona as THREE.Group | undefined;
  if (corona) {
    corona.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    cellGroup.remove(corona);
    cellGroup.userData.evolutionCorona = undefined;
  }

  // Remove ring
  const ring = cellGroup.userData.evolutionRing as THREE.Mesh | undefined;
  if (ring) {
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    cellGroup.remove(ring);
    cellGroup.userData.evolutionRing = undefined;
  }
}

/**
 * Apply evolution visual effects (glow pulse, scale) during molting period
 * Used during the actual evolution animation (not the progress indicators)
 *
 * @param cellGroup - The cell's THREE.Group to apply effects to
 * @param stage - Evolution stage name ('single_cell' or 'multi_cell')
 * @param progress - Animation progress from 0.0-1.0
 */
export function applyEvolutionEffects(
  cellGroup: THREE.Group,
  stage: string,
  progress: number
): void {
  // Intense glow that peaks at 50% progress (sine wave) - 75% boost
  const glowIntensity = Math.sin(progress * Math.PI) * 5.0; // 0 → 5 → 0

  // Rapid pulse effect (multiple cycles during evolution) - 150% boost
  const rapidPulse = Math.sin(progress * Math.PI * 8) * 0.2; // ±0.2
  const scalePulse = 1.0 + rapidPulse;

  // Apply effects based on stage (different structures)
  if (stage === 'multi_cell') {
    // Multi-cell: apply to all cell nuclei
    const cellCount = cellGroup.userData.cellCount || 7;
    for (let i = 0; i < cellCount; i++) {
      const cell = cellGroup.children[i] as THREE.Group;
      if (cell && cell.children) {
        const nucleus = cell.children[1] as THREE.Mesh;
        if (nucleus && nucleus.material) {
          const material = nucleus.material as THREE.MeshStandardMaterial;
          // Boost emissive intensity (base + glow, not accumulating)
          material.emissiveIntensity = 1.5 + glowIntensity;
        }
      }
    }

    // Pulse entire group scale
    cellGroup.scale.set(scalePulse, scalePulse, scalePulse);
  } else {
    // Single-cell: apply to nucleus (child 3)
    const nucleus = cellGroup.children[3] as THREE.Mesh;
    if (nucleus && nucleus.material) {
      const nucleusMaterial = nucleus.material as THREE.MeshStandardMaterial;
      // Boost emissive intensity (base + glow, not accumulating)
      nucleusMaterial.emissiveIntensity = 2.0 + glowIntensity;
    }

    // Pulse entire group scale
    cellGroup.scale.set(scalePulse, scalePulse, scalePulse);
  }
}
