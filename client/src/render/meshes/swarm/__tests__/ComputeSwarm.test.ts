import { describe, it, expect } from 'vitest';
import { COMPUTE_SWARM_STYLES, parseSwarmStyle } from '../ComputeSwarm';

describe('parseSwarmStyle', () => {
  it('accepts each compute style', () => {
    for (const style of COMPUTE_SWARM_STYLES) expect(parseSwarmStyle(style)).toBe(style);
  });

  it('falls back to classic for missing or unknown values', () => {
    expect(parseSwarmStyle(null)).toBe('classic');
    expect(parseSwarmStyle(undefined)).toBe('classic');
    expect(parseSwarmStyle('nebula')).toBe('classic');
    expect(parseSwarmStyle('classic')).toBe('classic');
  });
});
