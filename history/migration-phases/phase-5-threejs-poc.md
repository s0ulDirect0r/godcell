# Phase 5: Three.js Proof-of-Concept

**Estimated Time:** 2-3 hours
**Dependencies:** Phase 4 (Renderer Contract + Phaser Adapter) must be complete

## Overview

Add Three.js as an alternative renderer and render nutrients only. Use the renderer flag to toggle between Phaser (everything) and Three.js (just nutrients for now). This validates Three.js integration and tests performance before committing to full migration.

## Goals

1. Add Three.js dependencies
2. Create `ThreeRenderer` implementing Renderer interface
3. Render nutrients with Three.js (just this one entity type as proof-of-concept)
4. Toggle between `phaser-only` and `three-only` via flag
5. Validate performance and visual quality

## Files to Create

### `client/src/render/three/ThreeRenderer.ts`

```typescript
import * as THREE from 'three';
import type { Renderer, CameraCapabilities } from '../Renderer';
import type { GameState } from '../../core/state/GameState';
import { GAME_CONFIG } from '@godcell/shared';

export class ThreeRenderer implements Renderer {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private container!: HTMLElement;

  // Entity meshes
  private nutrientMeshes: Map<string, THREE.Mesh> = new Map();

  init(container: HTMLElement, width: number, height: number): void {
    this.container = container;

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(GAME_CONFIG.BACKGROUND_COLOR);

    // Create orthographic camera (top-down 2D)
    const aspect = width / height;
    const frustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    this.camera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    // Basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(5, 10, 7.5);
    this.scene.add(keyLight);
  }

  render(state: GameState, dt: number): void {
    // Sync nutrients (only entity type we're rendering for now)
    this.syncNutrients(state);

    // Update camera to follow player (if local player exists)
    const myPlayer = state.getMyPlayer();
    if (myPlayer) {
      this.camera.position.set(myPlayer.x, myPlayer.y, 10);
    }

    // Render scene
    this.renderer.render(this.scene, this.camera);
  }

  private syncNutrients(state: GameState): void {
    // Remove nutrients that no longer exist
    this.nutrientMeshes.forEach((mesh, id) => {
      if (!state.nutrients.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.nutrientMeshes.delete(id);
      }
    });

    // Add or update nutrients
    state.nutrients.forEach((nutrient, id) => {
      let mesh = this.nutrientMeshes.get(id);

      if (!mesh) {
        // Create new nutrient mesh (hexagon shape)
        const geometry = new THREE.CircleGeometry(nutrient.radius, 6);
        const material = new THREE.MeshBasicMaterial({
          color: nutrient.valueMultiplier > 1 ? 0xffaa00 : 0x00ffaa,
        });
        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.nutrientMeshes.set(id, mesh);
      }

      // Update position
      mesh.position.set(nutrient.x, nutrient.y, 0);
    });
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const frustumSize = GAME_CONFIG.VIEWPORT_HEIGHT;
    this.camera.left = (frustumSize * aspect) / -2;
    this.camera.right = (frustumSize * aspect) / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = frustumSize / -2;
    this.camera.updateProjectionMatrix();
  }

  getCameraCapabilities(): CameraCapabilities {
    return {
      mode: 'topdown',
      supports3D: true, // Will support 3D later
    };
  }

  getCameraProjection() {
    // Simple screen ↔ world for orthographic camera
    return {
      screenToWorld: (screenX: number, screenY: number) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = ((screenX - rect.left) / rect.width) * 2 - 1;
        const y = -((screenY - rect.top) / rect.height) * 2 + 1;

        const vector = new THREE.Vector3(x, y, 0);
        vector.unproject(this.camera);

        return { x: vector.x, y: vector.y };
      },
      worldToScreen: (worldX: number, worldY: number) => {
        const vector = new THREE.Vector3(worldX, worldY, 0);
        vector.project(this.camera);

        const rect = this.renderer.domElement.getBoundingClientRect();
        return {
          x: ((vector.x + 1) / 2) * rect.width + rect.left,
          y: ((-vector.y + 1) / 2) * rect.height + rect.top,
        };
      },
    };
  }

  dispose(): void {
    // Clean up geometries/materials
    this.nutrientMeshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
```

## Files to Modify

### `client/package.json`
Add Three.js dependencies.

```json
{
  "dependencies": {
    "@godcell/shared": "*",
    "phaser": "^3.80.1",
    "socket.io-client": "^4.7.2",
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0",
    // ... existing devDeps
  }
}
```

### `client/src/main.ts`
Choose renderer based on flag.

```typescript
import { PhaserRenderer } from './render/phaser/PhaserRenderer';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import type { Renderer } from './render/Renderer';

// ... existing imports

// Choose renderer based on flag
let renderer: Renderer;
if (flags.mode === 'three-only') {
  console.log('[Init] Using Three.js renderer (nutrients only for now)');
  renderer = new ThreeRenderer();
} else {
  console.log('[Init] Using Phaser renderer');
  renderer = new PhaserRenderer();
}

// ... rest of bootstrap unchanged
```

### `client/src/config/renderer-flags.ts`
Update renderer mode type (remove 'hybrid').

```typescript
export type RendererMode = 'phaser-only' | 'three-only';

// ... rest unchanged
```

## Test Cases

### Manual Testing

**Test Three.js (nutrients only):**
```bash
npm install
npm run dev
# Open: http://localhost:8080?renderer=three-only

# You should see:
# - ONLY nutrients (hexagons)
# - No players, no obstacles, no swarms
# - Camera follows where your player WOULD be
# - Can collect nutrients (they disappear)
# - Black screen with nutrients floating

# Note: This is expected! We're only rendering nutrients as proof-of-concept.
```

**Test Phaser still works:**
```bash
# Open: http://localhost:8080?renderer=phaser-only
# Should be identical to Phase 4 - full game
```

**Compare:**
- Nutrients look similar in both?
- FPS good in three-only mode?
- Collection mechanics work?

## Acceptance Criteria

- [ ] Three.js dependencies installed
- [ ] ThreeRenderer implements Renderer interface
- [ ] Nutrients render with Three.js
- [ ] Camera follows player (even though player sprite not visible)
- [ ] Nutrient collection works
- [ ] Can toggle between renderers via flag
- [ ] FPS is acceptable (55-60) in three-only mode
- [ ] No memory leaks (check over 5 minutes)
- [ ] Phaser mode still works perfectly

## Implementation Notes

**Gotchas:**
- Three.js coordinate system: Y-up vs Phaser Y-down (handle in projection)
- OrthographicCamera frustum sizing for correct world scale
- Dispose geometries/materials to prevent memory leaks
- Test on different screen sizes (DPR scaling)

**Visual notes:**
- In `three-only` mode, you'll only see nutrients - this is expected
- It's a proof-of-concept to validate Three.js works
- Phase 6 will add all the other entity types

**Decision point:**
After this phase, evaluate:
- Does Three.js integration work?
- Performance acceptable?
- Screen ↔ world projection correct (nutrient collection works)?

If yes → proceed to Phase 6 (migrate other entities).
If no → revert and either fix issues or stay with Phaser.

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Remove three/@types/three from package.json
# 2. Delete client/src/render/three/ThreeRenderer.ts
# 3. Revert client/src/main.ts
# 4. Revert client/src/config/renderer-flags.ts
# 5. npm install
```

## Next Phase

Once this phase is approved, proceed to **Phase 6: Entity Migrations**.
