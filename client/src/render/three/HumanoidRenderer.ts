// ============================================
// Humanoid Renderer (Stage 4)
// Loads Xbot.glb GLTF model with idle/walk/run animations
// ============================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Animation state for blending between idle/walk/run
export interface HumanoidAnimationState {
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  currentAction: string;
}

// Cached GLTF to avoid reloading
// Single GLTF is loaded once and cloned per-instance to save memory/network.
// Animations are also cloned per-instance since AnimationMixer state is per-model.
let cachedGLTF: {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
} | null = null;

const loader = new GLTFLoader();

/**
 * Load and create a humanoid model
 * Returns the model group, animation mixer, and available actions
 */
export async function createHumanoidModel(
  colorHex: number
): Promise<{ model: THREE.Group; animState: HumanoidAnimationState }> {
  // Load GLTF if not cached
  if (!cachedGLTF) {
    cachedGLTF = await loadXbotGLTF();
  }

  // Clone the scene for this instance
  const model = cachedGLTF.scene.clone();
  model.name = 'humanoid';

  // Scale to reasonable game size (Xbot is ~1.8 units tall, we want ~200 game units)
  const targetHeight = 200;
  const xbotHeight = 1.8;
  const scale = targetHeight / xbotHeight;
  model.scale.set(scale, scale, scale);

  // Apply cyber-glow material overlay to match game aesthetic
  applyCyberGlowMaterials(model, colorHex);

  // Set up animation mixer and actions
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();

  // Create actions for each animation clip
  for (const clip of cachedGLTF.animations) {
    const action = mixer.clipAction(clip.clone());
    actions.set(clip.name.toLowerCase(), action);
  }

  // Start with idle animation
  const idleAction = actions.get('idle');
  if (idleAction) {
    idleAction.play();
  } else {
    console.warn('HumanoidRenderer: Xbot.glb missing idle animation');
  }

  const animState: HumanoidAnimationState = {
    mixer,
    actions,
    currentAction: 'idle',
  };

  // Store animation state on model for easy access
  model.userData.animState = animState;
  model.userData.colorHex = colorHex;

  return { model, animState };
}

/**
 * Load the Xbot GLTF model
 */
async function loadXbotGLTF(): Promise<{
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}> {
  return new Promise((resolve, reject) => {
    loader.load(
      '/models/Xbot.glb',
      (gltf) => {
        resolve({
          scene: gltf.scene,
          animations: gltf.animations,
        });
      },
      undefined,
      (error) => {
        console.error('Failed to load Xbot.glb:', error);
        reject(error);
      }
    );
  });
}

/**
 * Apply cyber-glow emissive materials to the humanoid
 * Replaces existing materials with game-aesthetic versions
 */
function applyCyberGlowMaterials(model: THREE.Group, colorHex: number): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Create new cyber-glow material
      const cyberMat = new THREE.MeshStandardMaterial({
        color: 0x222222, // Dark base color - provides contrast for emissive glow
        roughness: 0.3, // Low roughness (0-1) for shiny metallic look
        metalness: 0.7, // High metalness (0-1) for cybernetic appearance
        emissive: colorHex,
        emissiveIntensity: 0.3, // Subtle body glow (0-1 range, scaled by energy in updateHumanoidEnergy)
      });

      // Apply to mesh (handle both single and array materials)
      if (Array.isArray(child.material)) {
        child.material = child.material.map(() => cyberMat.clone());
      } else {
        child.material = cyberMat;
      }
    }
  });

  // Add point light at head position for glow effect
  const headLight = new THREE.PointLight(colorHex, 2, 150);
  headLight.position.set(0, 1.6, 0); // Approximate head height in Xbot coords (pre-scale)
  headLight.name = 'headLight';
  model.add(headLight);
}

/**
 * Update humanoid animation based on movement state
 * Blends between idle, walk, and run based on speed
 */
export function updateHumanoidAnimation(
  animState: HumanoidAnimationState,
  delta: number,
  isMoving: boolean,
  speed: number = 0
): void {
  // Update mixer
  animState.mixer.update(delta);

  // Speed threshold for walk vs run animation (game units per second)
  // Below this: walk animation, above this: run animation
  const WALK_RUN_THRESHOLD = 200;

  // Determine target animation based on movement
  let targetAction = 'idle';
  if (isMoving) {
    targetAction = speed > WALK_RUN_THRESHOLD ? 'run' : 'walk';
  }

  // Crossfade to new animation if changed
  if (targetAction !== animState.currentAction) {
    const current = animState.actions.get(animState.currentAction);
    const next = animState.actions.get(targetAction);

    if (current && next) {
      // Smooth crossfade over 0.3 seconds
      current.fadeOut(0.3);
      next.reset().fadeIn(0.3).play();
    } else if (next) {
      // No current action, just play next
      next.reset().play();
    }

    animState.currentAction = targetAction;
  }
}

/**
 * Update humanoid energy visualization (glow intensity)
 */
export function updateHumanoidEnergy(model: THREE.Group, energyRatio: number): void {
  const ratio = Math.max(0, Math.min(1, energyRatio));

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity = 0.1 + 0.4 * ratio; // Range: 0.1 (low energy) to 0.5 (full energy)
      }
    }
    if (child instanceof THREE.PointLight) {
      child.intensity = 1 + 3 * ratio; // Range: 1 (low energy) to 4 (full energy)
    }
  });
}

/**
 * Dispose humanoid resources
 */
export function disposeHumanoid(model: THREE.Group): void {
  // Stop animations
  const animState = model.userData.animState as HumanoidAnimationState | undefined;
  if (animState) {
    animState.mixer.stopAllAction();
  }

  // Dispose geometries and materials
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

/**
 * Set humanoid facing direction (yaw rotation)
 * Used to rotate model to match camera/movement direction
 */
export function setHumanoidRotation(model: THREE.Group, yaw: number): void {
  model.rotation.y = yaw;
}
