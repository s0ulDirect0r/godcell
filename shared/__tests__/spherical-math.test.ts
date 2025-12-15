// ============================================
// Spherical Math Unit Tests
// Tests for sphere projection and tangent velocity functions
// ============================================

import { describe, it, expect } from 'vitest';
import {
  projectToSphere,
  tangentVelocity,
  getSurfaceNormal,
  magnitude,
  normalize,
} from '../math';

// Test constants
const PLANET_RADIUS = 9600;

describe('spherical math utilities', () => {
  describe('magnitude', () => {
    it('calculates 3D vector magnitude', () => {
      expect(magnitude({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 5);
      expect(magnitude({ x: 1, y: 1, z: 1 })).toBeCloseTo(Math.sqrt(3), 5);
      expect(magnitude({ x: 0, y: 0, z: 0 })).toBe(0);
    });

    it('handles large values', () => {
      expect(magnitude({ x: PLANET_RADIUS, y: 0, z: 0 })).toBe(PLANET_RADIUS);
    });
  });

  describe('normalize', () => {
    it('returns unit vector', () => {
      const n = normalize({ x: 100, y: 0, z: 0 });
      expect(magnitude(n)).toBeCloseTo(1, 5);
      expect(n.x).toBeCloseTo(1, 5);
      expect(n.y).toBeCloseTo(0, 5);
      expect(n.z).toBeCloseTo(0, 5);
    });

    it('normalizes diagonal vector', () => {
      const n = normalize({ x: 1, y: 1, z: 1 });
      expect(magnitude(n)).toBeCloseTo(1, 5);
      const expected = 1 / Math.sqrt(3);
      expect(n.x).toBeCloseTo(expected, 5);
      expect(n.y).toBeCloseTo(expected, 5);
      expect(n.z).toBeCloseTo(expected, 5);
    });

    it('handles zero vector gracefully', () => {
      const n = normalize({ x: 0, y: 0, z: 0 });
      // Should return something sensible, not NaN
      expect(Number.isNaN(n.x)).toBe(false);
    });
  });

  describe('projectToSphere', () => {
    it('snaps inside point to surface', () => {
      const p = projectToSphere({ x: 100, y: 0, z: 0 }, PLANET_RADIUS);
      expect(magnitude(p)).toBeCloseTo(PLANET_RADIUS, 5);
      expect(p.x).toBeCloseTo(PLANET_RADIUS, 5);
      expect(p.y).toBeCloseTo(0, 5);
      expect(p.z).toBeCloseTo(0, 5);
    });

    it('snaps outside point to surface', () => {
      const p = projectToSphere({ x: 20000, y: 0, z: 0 }, PLANET_RADIUS);
      expect(magnitude(p)).toBeCloseTo(PLANET_RADIUS, 5);
      expect(p.x).toBeCloseTo(PLANET_RADIUS, 5);
    });

    it('preserves direction', () => {
      const p = projectToSphere({ x: 100, y: 100, z: 100 }, PLANET_RADIUS);
      const dir = normalize(p);
      // All components should be equal for (1,1,1) direction
      expect(dir.x).toBeCloseTo(dir.y, 5);
      expect(dir.y).toBeCloseTo(dir.z, 5);
    });

    it('handles negative coordinates', () => {
      const p = projectToSphere({ x: -500, y: 200, z: -300 }, PLANET_RADIUS);
      expect(magnitude(p)).toBeCloseTo(PLANET_RADIUS, 5);
      expect(p.x).toBeLessThan(0);
      expect(p.z).toBeLessThan(0);
    });

    it('handles point at origin', () => {
      const p = projectToSphere({ x: 0, y: 0, z: 0 }, PLANET_RADIUS);
      // Should return a valid point on sphere surface (default: +X axis)
      expect(magnitude(p)).toBeCloseTo(PLANET_RADIUS, 5);
    });

    it('leaves point already on surface unchanged (within tolerance)', () => {
      const original = { x: PLANET_RADIUS, y: 0, z: 0 };
      const p = projectToSphere(original, PLANET_RADIUS);
      expect(p.x).toBeCloseTo(original.x, 5);
      expect(p.y).toBeCloseTo(original.y, 5);
      expect(p.z).toBeCloseTo(original.z, 5);
    });

    it('works with various radii', () => {
      const smallRadius = 100;
      const p = projectToSphere({ x: 50, y: 50, z: 50 }, smallRadius);
      expect(magnitude(p)).toBeCloseTo(smallRadius, 5);
    });
  });

  describe('tangentVelocity', () => {
    it('removes radial component from velocity', () => {
      // Position on +X axis, velocity pointing outward (+X) and tangent (+Y, +Z)
      const pos = { x: PLANET_RADIUS, y: 0, z: 0 };
      const vel = { x: 10, y: 5, z: 3 };
      const result = tangentVelocity(pos, vel);

      // Radial component (x=10) should be removed
      expect(result.x).toBeCloseTo(0, 5);
      // Tangent components should be preserved
      expect(result.y).toBeCloseTo(5, 5);
      expect(result.z).toBeCloseTo(3, 5);
    });

    it('preserves purely tangent velocity', () => {
      // Position on +X axis, velocity purely in Y-Z plane (tangent)
      const pos = { x: PLANET_RADIUS, y: 0, z: 0 };
      const vel = { x: 0, y: 100, z: 50 };
      const result = tangentVelocity(pos, vel);

      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(100, 5);
      expect(result.z).toBeCloseTo(50, 5);
    });

    it('zeros purely radial velocity', () => {
      // Position on +X axis, velocity pointing directly outward
      const pos = { x: PLANET_RADIUS, y: 0, z: 0 };
      const vel = { x: 100, y: 0, z: 0 };
      const result = tangentVelocity(pos, vel);

      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(0, 5);
    });

    it('works at arbitrary position on sphere', () => {
      // Position at 45° on XY plane
      const angle = Math.PI / 4;
      const pos = {
        x: PLANET_RADIUS * Math.cos(angle),
        y: PLANET_RADIUS * Math.sin(angle),
        z: 0,
      };
      // Velocity pointing radially outward (same direction as position)
      const vel = { x: Math.cos(angle) * 50, y: Math.sin(angle) * 50, z: 0 };
      const result = tangentVelocity(pos, vel);

      // Result should be near zero (was purely radial)
      expect(magnitude(result)).toBeCloseTo(0, 3);
    });

    it('handles position at origin gracefully', () => {
      const pos = { x: 0, y: 0, z: 0 };
      const vel = { x: 10, y: 5, z: 3 };
      const result = tangentVelocity(pos, vel);

      // Should return velocity unchanged when position is origin
      expect(result.x).toBeCloseTo(10, 5);
      expect(result.y).toBeCloseTo(5, 5);
      expect(result.z).toBeCloseTo(3, 5);
    });

    it('result is perpendicular to position vector', () => {
      const pos = { x: 500, y: 700, z: 300 };
      const vel = { x: 10, y: 20, z: 30 };
      const result = tangentVelocity(pos, vel);

      // Dot product of result with position normal should be ~0
      const normal = getSurfaceNormal(pos);
      const dot = result.x * normal.x + result.y * normal.y + result.z * normal.z;
      expect(dot).toBeCloseTo(0, 5);
    });
  });

  describe('getSurfaceNormal', () => {
    it('returns unit vector pointing outward', () => {
      const pos = { x: PLANET_RADIUS, y: 0, z: 0 };
      const normal = getSurfaceNormal(pos);

      expect(magnitude(normal)).toBeCloseTo(1, 5);
      expect(normal.x).toBeCloseTo(1, 5);
      expect(normal.y).toBeCloseTo(0, 5);
      expect(normal.z).toBeCloseTo(0, 5);
    });

    it('works at arbitrary position', () => {
      const pos = { x: 100, y: 200, z: 300 };
      const normal = getSurfaceNormal(pos);

      expect(magnitude(normal)).toBeCloseTo(1, 5);
      // Normal should point in same direction as position
      const posNorm = normalize(pos);
      expect(normal.x).toBeCloseTo(posNorm.x, 5);
      expect(normal.y).toBeCloseTo(posNorm.y, 5);
      expect(normal.z).toBeCloseTo(posNorm.z, 5);
    });

    it('handles origin with default direction', () => {
      const normal = getSurfaceNormal({ x: 0, y: 0, z: 0 });
      expect(magnitude(normal)).toBeCloseTo(1, 5);
      // Default: +X axis
      expect(normal.x).toBeCloseTo(1, 5);
    });

    it('handles negative positions', () => {
      const pos = { x: -500, y: -500, z: 0 };
      const normal = getSurfaceNormal(pos);

      expect(magnitude(normal)).toBeCloseTo(1, 5);
      expect(normal.x).toBeLessThan(0);
      expect(normal.y).toBeLessThan(0);
    });
  });
});
