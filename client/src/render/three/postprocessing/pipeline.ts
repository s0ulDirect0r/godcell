// ============================================
// Postprocessing Pipeline - Bloom/Glow Effects
// ============================================

import * as THREE from 'three/webgpu';
import { pass, renderOutput } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface PipelineResult {
  pipeline: THREE.RenderPipeline;
  scenePass: ReturnType<typeof pass>; // Stored to update camera on mode switch
  setBloomEnabled: (enabled: boolean) => void;
}

export function createPipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): PipelineResult {
  // Scene pass (base scene rendered to an offscreen target)
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');

  // Bloom (glow effect for neon aesthetic), added on top of the scene
  const bloomNode = bloom(
    sceneColor,
    1.2, // strength (strong glow for visibility)
    0.8, // radius (spread of glow)
    0.3 // threshold (lower = more things glow)
  );

  // Match the old EffectComposer + UnrealBloomPass output: the scene was tone mapped and
  // converted to sRGB on its way to the screen, then bloom was added as raw linear values.
  // Letting the pipeline convert (scene + bloom) instead brightens bloom's faint tails into
  // a haze, so convert the scene ourselves and add bloom afterwards.
  const sceneOutput = renderOutput(sceneColor);
  const withBloom = sceneOutput.add(bloomNode);

  const pipeline = new THREE.RenderPipeline(renderer, withBloom);
  pipeline.outputColorTransform = false; // Done above, before bloom is added

  const setBloomEnabled = (enabled: boolean) => {
    pipeline.outputNode = enabled ? withBloom : sceneOutput;
    pipeline.needsUpdate = true;
  };

  return { pipeline, scenePass, setBloomEnabled };
}
