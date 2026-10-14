// ============================================
// Swarm Mesh - Single source of truth for entropy swarm visuals
// Creates and animates entropy swarm (virus enemy)
// Outer shell sphere + GPU corona particles (see swarm/CoronaSwarm.ts)
// Used by: SwarmRenderSystem (game), model-viewer.ts (preview)
// ============================================

import * as THREE from 'three';
import { CoronaSwarm } from './swarm/CoronaSwarm';

// ============================================
// VISUAL PARAMETERS
// ============================================
// Shell: color 0xff4400, opacity 0.3 (x corona's shellOpacity), emissive 0.8
// Chase mode: hot red shell, brighter, faster pulse
// Disabled mode: grays, low opacity
// Corona tuning lives in swarm/coronaSim.ts
// ============================================

/**
 * Create a complete entropy swarm visual group: outer shell sphere + corona particles.
 * The corona's compute pass (`fx.computeNode`) must be dispatched by the renderer each frame.
 *
 * @param position - Swarm position {x, y}
 * @param size - Swarm radius
 */
export function createSwarm(
  position: { x: number; y: number },
  size: number
): { group: THREE.Group; fx: CoronaSwarm } {
  const group = new THREE.Group();

  // === OUTER SPHERE (Semi-transparent boundary) ===
  const outerGeometry = new THREE.SphereGeometry(size, 32, 32);
  const outerMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff4400, // Red-orange
    transparent: true,
    opacity: 0.3,
    emissive: 0xff4400,
    emissiveIntensity: 0.8,
    roughness: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false, // Don't write depth (standard for transparent objects)
    depthTest: false, // Bypass depth testing (original fix for obstacle overlap)
  });
  group.add(new THREE.Mesh(outerGeometry, outerMaterial));

  // === CORONA (GPU particles) ===
  const fx = new CoronaSwarm(size);
  group.add(fx.object);

  // XZ plane: X=game X, Y=height, Z=-game Y
  group.position.set(position.x, 0.2, -position.y);
  // Rotate -90° around X so local XY (the corona's simulation plane) maps to world XZ
  group.rotation.x = -Math.PI / 2;

  return { group, fx };
}

/**
 * Update swarm visual state based on swarm behavior state
 *
 * @param group - The swarm THREE.Group
 * @param state - 'patrol' | 'chase' | 'disabled'
 * @param isDisabled - Whether swarm is disabled (hit by EMP)
 * @param fx - The swarm's corona
 */
export function updateSwarmState(
  group: THREE.Group,
  state: string,
  isDisabled: boolean,
  fx: CoronaSwarm
): void {
  const outerMaterial = (group.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
  const opacityScale = fx.shellOpacity; // Shell recedes so the plasma reads over it
  if (isDisabled) {
    outerMaterial.color.setHex(0x444444); // Dark gray
    outerMaterial.emissive.setHex(0x666666); // Dim gray emissive
    outerMaterial.emissiveIntensity = 0.2;
    outerMaterial.opacity = 0.2 * opacityScale;
  } else if (state === 'chase') {
    outerMaterial.color.setHex(0xff0044); // Hot red
    outerMaterial.emissive.setHex(0xff4400);
    outerMaterial.emissiveIntensity = 1.2;
    outerMaterial.opacity = 0.45 * opacityScale;
  } else {
    outerMaterial.color.setHex(0xff4400); // Red-orange
    outerMaterial.emissive.setHex(0xff4400);
    outerMaterial.emissiveIntensity = 0.8;
    outerMaterial.opacity = 0.3 * opacityScale;
  }
  fx.setState(state, isDisabled);
}

/**
 * Update swarm animations: shell pulse/flicker and the corona's per-frame uniforms
 *
 * @param group - The swarm THREE.Group
 * @param swarmState - 'patrol' | 'chase'
 * @param pulsePhase - Random phase offset for pulsing
 * @param dt - Delta time in milliseconds
 * @param energyRatio - 0-1 ratio of absorbed energy (0 = base, 1 = max 500)
 * @param isDisabled - Whether swarm is disabled (hit by EMP) - freezes the shell
 * @param fx - The swarm's corona (its compute pass still needs dispatching)
 */
export function updateSwarmAnimation(
  group: THREE.Group,
  swarmState: string,
  pulsePhase: number,
  dt: number,
  energyRatio: number,
  isDisabled: boolean,
  fx: CoronaSwarm
): void {
  // The corona keeps updating (its clock stops internally while frozen)
  fx.update(dt / 1000, group.getWorldPosition(new THREE.Vector3()));

  // When hit by EMP, the shell freezes (gray colors set by updateSwarmState)
  if (isDisabled) return;

  const time = performance.now() * 0.001; // Time in seconds

  // === COLOR SHIFT ===
  // Gradual shift from orange toward red-orange as energy grows (dialed back)
  // Base orange: 0xff4400, Max: 0xff2200 (not pure red)
  const redShift = Math.floor(0x44 * (1 - energyRatio * 0.5)); // Only shift halfway to red
  const energyColor = 0xff0000 + (redShift << 8); // Shift green channel

  // === PULSING ANIMATION (Outer Sphere) ===
  const outerSphere = group.children[0] as THREE.Mesh;
  const outerMaterial = outerSphere.material as THREE.MeshPhysicalMaterial;

  // Breathing effect: scale oscillates, faster and more intense with energy (dialed back)
  const basePulseSpeed = swarmState === 'chase' ? 3.0 : 2.0;
  const pulseSpeed = basePulseSpeed * (1 + energyRatio * 0.5); // Gentler speed increase
  const pulseAmount = 0.05 + energyRatio * 0.02; // 0.05 to 0.07
  const scale = 1.0 + Math.sin(time * pulseSpeed + pulsePhase) * pulseAmount;
  outerSphere.scale.set(scale, scale, scale);

  // Apply color shift (only when not disabled)
  if (swarmState !== 'disabled') {
    outerMaterial.color.setHex(energyColor);
    outerMaterial.emissive.setHex(energyColor);
  }

  // Flicker emissive intensity for unstable energy feel (dialed back 40%)
  const baseIntensity = swarmState === 'chase' ? 1.2 : 0.8;
  const intensityBoost = energyRatio * 0.3; // Extra glow with energy
  const flickerAmount = 0.15 + energyRatio * 0.15; // 0.15 to 0.3
  outerMaterial.emissiveIntensity =
    baseIntensity +
    intensityBoost +
    Math.sin(time * 4 * (1 + energyRatio * 0.5) + pulsePhase) * flickerAmount;
}

/**
 * Dispose of swarm group resources
 *
 * @param group - The swarm THREE.Group to dispose
 * @param fx - The swarm's corona
 */
export function disposeSwarm(group: THREE.Group, fx: CoronaSwarm): void {
  fx.dispose();
  const shell = group.children[0] as THREE.Mesh;
  shell.geometry.dispose();
  (shell.material as THREE.Material).dispose();
}
