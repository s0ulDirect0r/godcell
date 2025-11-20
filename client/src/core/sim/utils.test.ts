import { describe, it, expect } from 'vitest';
import {
  lerp,
  lerpPosition,
  clamp,
  distance,
  distanceSquared,
  normalize,
  angleBetween,
  degToRad,
  radToDeg,
  smoothstep,
} from './utils';

describe('Math Utilities', () => {
  describe('lerp', () => {
    it('should interpolate between two numbers', () => {
      expect(lerp(0, 100, 0)).toBe(0);
      expect(lerp(0, 100, 1)).toBe(100);
      expect(lerp(0, 100, 0.5)).toBe(50);
    });

    it('should handle negative numbers', () => {
      expect(lerp(-100, 100, 0.5)).toBe(0);
    });
  });

  describe('lerpPosition', () => {
    it('should interpolate between two positions', () => {
      const start = { x: 0, y: 0 };
      const end = { x: 100, y: 100 };

      const mid = lerpPosition(start, end, 0.5);
      expect(mid.x).toBe(50);
      expect(mid.y).toBe(50);
    });
  });

  describe('clamp', () => {
    it('should clamp values within range', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(150, 0, 100)).toBe(100);
    });
  });

  describe('distance', () => {
    it('should calculate distance between two points', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };

      expect(distance(a, b)).toBe(5); // 3-4-5 triangle
    });

    it('should handle same position', () => {
      const a = { x: 10, y: 20 };
      const b = { x: 10, y: 20 };

      expect(distance(a, b)).toBe(0);
    });
  });

  describe('distanceSquared', () => {
    it('should calculate squared distance', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };

      expect(distanceSquared(a, b)).toBe(25); // 3^2 + 4^2 = 25
    });
  });

  describe('normalize', () => {
    it('should normalize a vector to length 1', () => {
      const result = normalize(3, 4);

      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);

      // Check length is 1
      const length = Math.sqrt(result.x ** 2 + result.y ** 2);
      expect(length).toBeCloseTo(1);
    });

    it('should handle zero vector', () => {
      const result = normalize(0, 0);

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('angleBetween', () => {
    it('should calculate angle between two points', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 1, y: 0 };

      const angle = angleBetween(a, b);
      expect(angle).toBeCloseTo(0); // Pointing right (0 radians)
    });

    it('should handle different angles', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 0, y: 1 };

      const angle = angleBetween(a, b);
      expect(angle).toBeCloseTo(Math.PI / 2); // Pointing down (90 degrees)
    });
  });

  describe('degToRad', () => {
    it('should convert degrees to radians', () => {
      expect(degToRad(0)).toBe(0);
      expect(degToRad(180)).toBeCloseTo(Math.PI);
      expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('radToDeg', () => {
    it('should convert radians to degrees', () => {
      expect(radToDeg(0)).toBe(0);
      expect(radToDeg(Math.PI)).toBeCloseTo(180);
      expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
    });
  });

  describe('smoothstep', () => {
    it('should provide smooth interpolation', () => {
      expect(smoothstep(0, 1, 0)).toBe(0);
      expect(smoothstep(0, 1, 1)).toBe(1);
      expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    });

    it('should clamp values outside range', () => {
      expect(smoothstep(0, 1, -0.5)).toBe(0);
      expect(smoothstep(0, 1, 1.5)).toBe(1);
    });
  });
});
