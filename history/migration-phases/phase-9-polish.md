# Phase 9: Polish

**Estimated Time:** 2-3 hours
**Dependencies:** Phase 8 (Remove Phaser) must be complete

## Overview

Add Three.js-specific visual improvements and performance optimizations. The migration is complete - now make it look and perform better than the Phaser version.

## Goals

1. Add bloom/glow postprocessing
2. Improve particle systems
3. Add camera effects (smooth motion, shake)
4. Custom materials/shaders
5. Performance optimizations
6. Resource management

## Enhancements

### 1. Bloom/Glow Postprocessing (~1h)

Add glow effects to nutrients, players, and obstacles.

#### Install postprocessing library:
```bash
npm install postprocessing
```

#### Create `client/src/render/three/postprocessing/composer.ts`:

```typescript
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
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

  // Bloom pass (glow effect)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.5,  // strength
    0.4,  // radius
    0.85  // threshold
  );
  composer.addPass(bloomPass);

  return composer;
}
```

#### Modify `ThreeRenderer.ts`:
```typescript
import { createComposer } from './postprocessing/composer';

private composer!: EffectComposer;

init(container, width, height): void {
  // ... existing code

  // Create composer
  this.composer = createComposer(this.renderer, this.scene, this.camera, width, height);
}

render(state, dt): void {
  // ... sync entities

  // Render with postprocessing
  this.composer.render();
}
```

### 2. Camera Effects (~30min)

#### Smooth camera motion:
```typescript
private cameraTarget = { x: 0, y: 0 };

render(state, dt): void {
  const myPlayer = state.getMyPlayer();
  if (myPlayer) {
    // Lerp camera toward player (smooth follow)
    this.cameraTarget.x += (myPlayer.x - this.cameraTarget.x) * 0.1;
    this.cameraTarget.y += (myPlayer.y - this.cameraTarget.y) * 0.1;
    this.camera.position.set(this.cameraTarget.x, this.cameraTarget.y, 10);
  }

  // ... rest of render
}
```

#### Camera shake on death:
```typescript
private cameraShake = 0;

// On death event:
eventBus.on('player:died', (data) => {
  if (data.playerId === this.myPlayerId) {
    this.cameraShake = 10; // Shake intensity
  }
});

render(state, dt): void {
  // Apply shake
  if (this.cameraShake > 0) {
    const offsetX = (Math.random() - 0.5) * this.cameraShake;
    const offsetY = (Math.random() - 0.5) * this.cameraShake;
    this.camera.position.x += offsetX;
    this.camera.position.y += offsetY;
    this.cameraShake *= 0.9; // Decay
  }

  // ... rest of render
}
```

### 3. Improved Materials (~30min)

#### Emissive materials for glow:
```typescript
// For nutrients (glowing data packets)
const material = new THREE.MeshStandardMaterial({
  color: 0x00ffaa,
  emissive: 0x00ffaa,
  emissiveIntensity: 0.5,
});

// For players
const material = new THREE.MeshStandardMaterial({
  color: playerColor,
  emissive: playerColor,
  emissiveIntensity: 0.3,
});
```

#### Material caching (performance):
```typescript
private materialCache: Map<string, THREE.Material> = new Map();

private getMaterial(key: string, factory: () => THREE.Material): THREE.Material {
  if (!this.materialCache.has(key)) {
    this.materialCache.set(key, factory());
  }
  return this.materialCache.get(key)!;
}

// Usage:
const material = this.getMaterial(`player-${player.color}`, () =>
  new THREE.MeshStandardMaterial({ color: playerColor, emissive: playerColor })
);
```

### 4. Particle System (~1h)

Replace background particles with THREE.Points.

```typescript
private createAmbientParticles(): void {
  const particleCount = 500;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 5000;     // x
    positions[i + 1] = (Math.random() - 0.5) * 5000; // y
    positions[i + 2] = 0;                             // z
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x00ffaa,
    size: 2,
    transparent: true,
    opacity: 0.6,
  });

  const particles = new THREE.Points(geometry, material);
  this.scene.add(particles);
}
```

### 5. Performance Optimizations (~30min)

#### Geometry pooling:
```typescript
private geometryPool: Map<string, THREE.BufferGeometry> = new Map();

private getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (!this.geometryPool.has(key)) {
    this.geometryPool.set(key, factory());
  }
  return this.geometryPool.get(key)!;
}

// Usage:
const geometry = this.getGeometry('circle-20', () =>
  new THREE.CircleGeometry(20, 32)
);
```

#### Dispose resources properly:
```typescript
dispose(): void {
  // Dispose meshes
  this.playerMeshes.forEach(mesh => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  // Dispose cached geometries
  this.geometryPool.forEach(geo => geo.dispose());

  // Dispose cached materials
  this.materialCache.forEach(mat => mat.dispose());

  // Dispose composer
  this.composer.dispose();

  // Dispose renderer
  this.renderer.dispose();
  this.container.removeChild(this.renderer.domElement);
}
```

## Test Cases

### Visual Quality Test

```bash
npm run dev
# Open: http://localhost:8080

# Verify:
# - Glow effects on nutrients (bloom)
# - Players have subtle glow
# - Camera follows smoothly (not jerky)
# - Camera shakes on death
# - Ambient particles floating
# - Looks better than Phaser version
```

### Performance Test

```bash
# Open with debug overlay:
http://localhost:8080?debug

# Play for 5 minutes
# Check:
# - FPS stable at 55-60
# - Memory not climbing (no leaks)
# - GPU usage reasonable

# Compare to Phase 0 baseline
```

## Acceptance Criteria

- [ ] Bloom/glow postprocessing works
- [ ] Camera effects smooth and polished
- [ ] Emissive materials on entities
- [ ] Ambient particles render
- [ ] FPS near baseline (within 5fps)
- [ ] No memory leaks over 10 minutes
- [ ] Visually better than Phaser version
- [ ] Game feels polished

## Implementation Notes

**Gotchas:**
- Postprocessing can tank FPS on low-end GPUs (make configurable?)
- Emissive materials need proper lighting to look good
- Camera shake intensity should be tunable
- Test on different screen sizes/DPR

**Optional enhancements:**
- Vignette effect when low health
- Color grading
- Chromatic aberration
- God rays
- Custom shaders for obstacles

**Performance:**
- Profile with Chrome DevTools (Performance tab)
- Check draw calls (should be <100)
- Monitor texture memory
- Consider LOD (level of detail) if needed

## Rollback Instructions

If polish causes performance issues:
```bash
# Revert specific features:
# - Remove bloom pass from composer
# - Disable camera shake
# - Reduce particle count
# - Use BasicMaterial instead of StandardMaterial

# Or full rollback:
git revert HEAD
```

## Migration Complete!

Congratulations! The Three.js migration is now fully complete and polished.

### Final Checklist

- [ ] All 10 phases complete (0-9)
- [ ] Game works identically to Phaser version (or better)
- [ ] All features functional
- [ ] Performance acceptable
- [ ] Code is clean and maintainable
- [ ] Documentation updated

### What's Next?

Now that rendering is decoupled:
- Easy to add 3D camera modes (orbit, TPS, FPS) for later evolution stages
- Can add advanced visual effects without touching game logic
- Core systems are testable independently
- Ready for future features (Stage 2+, multiplayer improvements, etc.)

**Ship it!** 🚀
