import { describe, it, expect } from 'vitest';
import { EDGE_FOREST, distanceOutside, layoutEdgeForest } from '../EdgeForest';

const W = 19200;
const H = 12800;
const CANOPY_RADIUS_RATIO = 2; // DataTreeForest canopy radius / trunk radius

describe('distanceOutside', () => {
  it('is 0 inside and the distance to the nearest edge or corner outside', () => {
    expect(distanceOutside(100, 100, W, H)).toBe(0);
    expect(distanceOutside(-30, 500, W, H)).toBe(30);
    expect(distanceOutside(500, H + 40, W, H)).toBe(40);
    expect(distanceOutside(W + 3, H + 4, W, H)).toBe(5);
  });
});

describe('layoutEdgeForest', () => {
  const trees = layoutEdgeForest(W, H);

  it('is the same every time (every client sees the same forest)', () => {
    expect(layoutEdgeForest(W, H)).toEqual(trees);
    expect(layoutEdgeForest(W, H, 7)).not.toEqual(trees);
  });

  it('plants a forest-sized band', () => {
    expect(trees.length).toBeGreaterThan(600);
    expect(trees.length).toBeLessThan(1600);
  });

  it('keeps every trunk and canopy outside the play area, within the band', () => {
    for (const t of trees) {
      const depth = distanceOutside(t.x, t.y, W, H);
      expect(depth).toBeGreaterThanOrEqual(t.radius * CANOPY_RADIUS_RATIO);
      expect(depth).toBeLessThanOrEqual(EDGE_FOREST.DEPTH);
    }
  });

  it('surrounds all four sides', () => {
    expect(trees.some((t) => t.x < 0)).toBe(true);
    expect(trees.some((t) => t.x > W)).toBe(true);
    expect(trees.some((t) => t.y < 0)).toBe(true);
    expect(trees.some((t) => t.y > H)).toBe(true);
  });

  it('grows larger and dimmer deeper into the forest', () => {
    const near = trees.filter((t) => distanceOutside(t.x, t.y, W, H) < 900);
    const deep = trees.filter((t) => distanceOutside(t.x, t.y, W, H) > 2000);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(deep.map((t) => t.radius))).toBeGreaterThan(mean(near.map((t) => t.radius)));
    expect(mean(deep.map((t) => t.glow!))).toBeLessThan(mean(near.map((t) => t.glow!)));
  });
});
