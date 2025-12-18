// ============================================
// Postprocessing Composer - Bloom/Glow Effects
// ============================================
// Simple single-pass bloom pipeline
// All objects receive bloom - use material brightness to control glow
// (values > threshold 0.3 will glow, darker values won't)

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as THREE from 'three';

export interface ComposerResult {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloomPass: UnrealBloomPass;
  // Kept for API compatibility but no longer used
  noBloomRenderPass: RenderPass;
}

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number
): ComposerResult {
  const composer = new EffectComposer(renderer);

  // Render pass - renders the scene
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom pass (glow effect for neon aesthetic)
  // Objects with brightness > threshold will glow
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.9, // strength: intensity of glow
    0.8, // radius: spread of glow effect (0.8 = moderate spread)
    0.3 // threshold: brightness cutoff (0.3 = fairly selective, bright things glow)
  );
  composer.addPass(bloomPass);

  // Output pass for proper color space handling (sRGB)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Create a dummy render pass for API compatibility
  // This is not added to the composer - just returned to satisfy the interface
  const noBloomRenderPass = new RenderPass(scene, camera);

  return { composer, renderPass, bloomPass, noBloomRenderPass };
}
