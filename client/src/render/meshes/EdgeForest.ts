// ============================================
// Edge Forest - decorative tree wall around the jungle's edges
// ============================================
//
// A band of data trees just outside the playable jungle, so the world ends in deep
// forest instead of void. Purely visual: no ECS entities, no collision (they stand
// outside the play area, and no canopy reaches into it). Layout is seeded, so every
// client sees the same forest.
//
// The band is split into chunks, each its own DataTreeForest, so off-screen chunks
// are frustum culled (6 draw calls per visible chunk).

import * as THREE from 'three/webgpu';
import { color, length, max, mix, positionWorld, smoothstep, vec2 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DataTreeForest, type TreeInstance } from './DataTreeForest';

export const EDGE_FOREST = {
  SEED: 20261014,
  DEPTH: 2800, // Px the band reaches past the edge (camera shows ~2560 px sideways at Stage 3 zoom)
  CELL: 440, // Px jittered-grid spacing (lower = denser; ~1000 trees at 440)
  JITTER: 0.8, // Fraction of a cell each tree may wander (breaks up the grid)
  EDGE_GAP: 2.1, // Trunk centers stay this many radii outside the edge (canopy radius is 2)
  EDGE_DENSITY: 0.45, // Chance a cell is planted right at the edge...
  FULL_DENSITY_AT: 900, // ...rising to 1 this many px out (ragged tree line)
  RADIUS: [110, 360], // Trunk radius range, edge -> deep (older trees further in)
  HEIGHT: [1100, 2900], // Height range, edge -> deep
  SIZE_JITTER: 0.25, // ± fraction of random size variation
  GLOW: [0.85, 0.2], // Brightness edge -> deep (deep forest recedes into the dark)
  CHUNK: 6400, // Px chunk size for frustum culling
  FLOOR_COLOR: 0x050d07, // Forest floor at the edge (a touch lighter than the jungle dirt)
  FLOOR_HEIGHT: -5, // Same level as the jungle dirt layer
};

/** Mulberry32: tiny seeded PRNG returning [0, 1) */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Px from (x, y) to the nearest point of the [0, width] x [0, height] rectangle (0 inside) */
export function distanceOutside(x: number, y: number, width: number, height: number): number {
  const dx = Math.max(-x, x - width, 0);
  const dy = Math.max(-y, y - height, 0);
  return Math.hypot(dx, dy);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Trees in a band around the [0, width] x [0, height] play area, in game coordinates */
export function layoutEdgeForest(
  width: number,
  height: number,
  seed = EDGE_FOREST.SEED
): TreeInstance[] {
  const E = EDGE_FOREST;
  const random = seededRandom(seed);
  const trees: TreeInstance[] = [];
  for (let cy = -E.DEPTH; cy < height + E.DEPTH; cy += E.CELL) {
    for (let cx = -E.DEPTH; cx < width + E.DEPTH; cx += E.CELL) {
      // Draw every random number up front so the layout doesn't depend on which cells are skipped
      const [jx, jy, plant, size, variant] = [random(), random(), random(), random(), random()];
      const x = cx + E.CELL / 2 + (jx - 0.5) * E.JITTER * E.CELL;
      const y = cy + E.CELL / 2 + (jy - 0.5) * E.JITTER * E.CELL;
      const depth = distanceOutside(x, y, width, height);
      if (depth === 0 || depth > E.DEPTH) continue;

      const density = lerp(E.EDGE_DENSITY, 1, smooth(depth / E.FULL_DENSITY_AT));
      if (plant > density) continue;

      const t = smooth(depth / E.DEPTH);
      const sizeScale = 1 + (size - 0.5) * 2 * E.SIZE_JITTER;
      const radius = lerp(E.RADIUS[0], E.RADIUS[1], t) * sizeScale;
      if (depth < radius * E.EDGE_GAP) continue; // Keep canopies out of the play area
      trees.push({
        x,
        y,
        radius,
        height: lerp(E.HEIGHT[0], E.HEIGHT[1], t) * sizeScale,
        variant,
        glow: lerp(E.GLOW[0], E.GLOW[1], t),
      });
    }
  }
  return trees;
}

/** Dark forest floor under the band, fading into the background with depth */
function createForestFloor(width: number, height: number, background: number): THREE.Mesh {
  const E = EDGE_FOREST;
  const D = E.DEPTH;
  // Four strips around the play rectangle (game coords: x, y, w, h)
  const strips = [
    [-D, -D, width + 2 * D, D], // Bottom
    [-D, height, width + 2 * D, D], // Top
    [-D, 0, D, height], // Left
    [width, 0, D, height], // Right
  ];
  const parts = strips.map(([x, y, w, h]) => {
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x + w / 2, E.FLOOR_HEIGHT, -(y + h / 2)); // Three Z = -game Y
    return geo;
  });
  const geometry = mergeGeometries(parts)!;
  for (const geo of parts) geo.dispose();

  const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  // Distance outside the play rectangle, from world position (game y = -Z)
  const gx = positionWorld.x;
  const gy = positionWorld.z.negate();
  const outside = length(
    vec2(max(max(gx.negate(), gx.sub(width)), 0), max(max(gy.negate(), gy.sub(height)), 0))
  );
  material.colorNode = mix(color(E.FLOOR_COLOR), color(background), smoothstep(0, D, outside));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'edgeForestFloor';
  mesh.renderOrder = -200; // With the jungle dirt, before grass
  return mesh;
}

/** The edge forest and its floor, ready to add to the jungle background */
export function createEdgeForest(width: number, height: number, background: number): THREE.Group {
  const E = EDGE_FOREST;
  const group = new THREE.Group();
  group.name = 'edgeForest';
  group.add(createForestFloor(width, height, background));

  const chunks = new Map<string, TreeInstance[]>();
  for (const tree of layoutEdgeForest(width, height)) {
    const key = `${Math.floor(tree.x / E.CHUNK)},${Math.floor(tree.y / E.CHUNK)}`;
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = []));
    chunk.push(tree);
  }
  for (const trees of chunks.values()) group.add(new DataTreeForest(trees).group);
  return group;
}
