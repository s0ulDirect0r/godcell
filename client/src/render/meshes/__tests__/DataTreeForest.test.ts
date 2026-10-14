import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { DataTreeForest, type TreeInstance } from '../DataTreeForest';

const tree = (x: number, y: number, radius = 100, height = 1000, variant = 0.5): TreeInstance => ({
  x,
  y,
  radius,
  height,
  variant,
});

function mesh(forest: DataTreeForest, name: string): THREE.InstancedMesh {
  return forest.group.getObjectByName(name) as THREE.InstancedMesh;
}

function instancePosition(m: THREE.InstancedMesh, i: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  m.getMatrixAt(i, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

describe('DataTreeForest', () => {
  it('draws any number of trees in the same six calls', () => {
    const one = new DataTreeForest([tree(0, 0)]);
    const many = new DataTreeForest(Array.from({ length: 2000 }, (_, i) => tree(i * 10, i)));
    expect(one.drawCalls).toBe(6);
    expect(many.drawCalls).toBe(6);
    for (const name of ['trunk', 'fibers', 'canopy_0', 'canopy_1', 'canopy_2', 'roots'])
      expect(mesh(many, name).count).toBe(2000);
    one.dispose();
    many.dispose();
  });

  it('shares one material set across forests (no extra shader builds per forest)', () => {
    const a = new DataTreeForest([tree(0, 0)]);
    const b = new DataTreeForest([tree(100, 100)]);
    for (const name of ['trunk', 'fibers', 'canopy_0', 'canopy_1', 'canopy_2', 'roots'])
      expect(mesh(a, name).material).toBe(mesh(b, name).material);
    a.dispose();
    b.dispose();
  });

  it('places trees at game coordinates (Three Z = -game Y) with the canopy above the trunk', () => {
    const forest = new DataTreeForest([tree(500, 300, 100, 1000)]);
    expect(instancePosition(mesh(forest, 'trunk'), 0).toArray()).toEqual([500, 0, -300]);
    // Trunk height 0.55 x 1000; canopy radius 2 x 100, lifted 0.6 canopy radii
    expect(instancePosition(mesh(forest, 'canopy_2'), 0).y).toBeCloseTo(550 + 120, 6);
    forest.dispose();
  });

  it('scales the trunk to the tree size, base on the ground', () => {
    const forest = new DataTreeForest([tree(0, 0, 80, 2000)]);
    const trunk = mesh(forest, 'trunk');
    const box = new THREE.Box3().setFromBufferAttribute(
      trunk.geometry.getAttribute('position') as THREE.BufferAttribute
    );
    const matrix = new THREE.Matrix4();
    trunk.getMatrixAt(0, matrix);
    box.applyMatrix4(matrix);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1100, 6);
    expect(box.max.x).toBeCloseTo(80, 6);
    forest.dispose();
  });

  it('points roots outward from the trunk', () => {
    const forest = new DataTreeForest([tree(0, 0, 1, 10, 0)]);
    const pos = mesh(forest, 'roots').geometry.getAttribute('position');
    // Roots run radially from the trunk edge (0.8) out to 0.8 + length 0.6.
    // Sideways (tangential) roots would all sit near r = 1.1.
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    expect(minR).toBeLessThan(0.85);
    expect(maxR).toBeGreaterThan(1.35);
    forest.dispose();
  });
});
