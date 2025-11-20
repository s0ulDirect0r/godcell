// ============================================
// Postprocessing Composer - Bloom/Glow Effects
// ============================================

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number
): EffectComposer {
  const composer = new EffectComposer(renderer);

  // Render pass (base scene)
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom pass (glow effect for neon aesthetic)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.2,  // strength (strong glow for visibility)
    0.8,  // radius (spread of glow)
    0.3   // threshold (lower = more things glow)
  );
  composer.addPass(bloomPass);

  return composer;
}
