// ============================================
// AbilityIntentSystem Unit Tests (TDD)
// ============================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EvolutionStage,
  Components,
  type World,
  type AbilityIntentComponent,
  type StunnedComponent,
} from '#shared';
import {
  createTestWorld,
  createTestPlayer,
  createMockIO,
  clearLookups,
  SOUP_CENTER,
} from './testUtils';
import { AbilityIntentSystem } from '../AbilityIntentSystem';
import { getEnergy, getStage, getCooldowns } from '../../factories';

// ============================================
// Test Utilities
// ============================================

/**
 * Create a multi-cell player (can use EMP, pseudopod)
 */
function createMultiCellPlayer(
  world: World,
  socketId: string,
  options: { x?: number; y?: number; energy?: number } = {}
): number {
  const { x = SOUP_CENTER.x, y = SOUP_CENTER.y, energy = 100 } = options;
  const entity = createTestPlayer(world, {
    socketId,
    x,
    y,
    stage: EvolutionStage.MULTI_CELL,
  });

  // Set energy if specified
  if (energy !== 100) {
    const energyComp = getEnergy(world, entity);
    if (energyComp) energyComp.current = energy;
  }

  return entity;
}

/**
 * Add ability intent to an entity
 * Spread default first, then intent overrides to ensure proper discriminated union behavior
 */
function addAbilityIntent(
  world: World,
  entity: number,
  intent: Partial<AbilityIntentComponent>
): void {
  world.addComponent<AbilityIntentComponent>(entity, Components.AbilityIntent, {
    abilityType: 'emp',
    ...intent,
  } as AbilityIntentComponent);
}

/**
 * Check if entity has ability intent component
 */
function hasAbilityIntent(world: World, entity: number): boolean {
  return world.hasComponent(entity, Components.AbilityIntent);
}

// ============================================
// AbilityIntentSystem Tests
// ============================================

describe('AbilityIntentSystem', () => {
  let world: World;
  let mockIO: ReturnType<typeof createMockIO>;
  let system: AbilityIntentSystem;

  beforeEach(() => {
    world = createTestWorld();
    mockIO = createMockIO();
    system = new AbilityIntentSystem();
  });

  afterEach(() => {
    clearLookups();
  });

  // ============================================
  // Intent Processing Tests
  // ============================================

  describe('intent processing', () => {
    it('should process EMP intent and fire ability', () => {
      const entity = createMultiCellPlayer(world, 'player-1');
      const initialEnergy = getEnergy(world, entity)!.current;
      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Verify EMP was fired (energy deducted)
      const finalEnergy = getEnergy(world, entity)!.current;
      expect(finalEnergy).toBeLessThan(initialEnergy);

      // Verify event emitted
      expect(mockIO.emittedEvents.some((e) => e.event === 'empActivated')).toBe(true);

      // Verify intent removed
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should process pseudopod intent and fire strike ability', () => {
      const entity = createMultiCellPlayer(world, 'player-1');
      addAbilityIntent(world, entity, {
        abilityType: 'pseudopod',
        targetX: SOUP_CENTER.x + 100,
        targetY: SOUP_CENTER.y,
      });

      system.update(world, 16, mockIO);

      // Verify pseudopod strike event (PSEUDOPOD_MODE is 'strike')
      expect(mockIO.emittedEvents.some((e) => e.event === 'pseudopodStrike')).toBe(true);

      // Verify intent removed
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should remove intent after successful processing', () => {
      const entity = createMultiCellPlayer(world, 'player-1');
      addAbilityIntent(world, entity, { abilityType: 'emp' });

      expect(hasAbilityIntent(world, entity)).toBe(true);

      system.update(world, 16, mockIO);

      expect(hasAbilityIntent(world, entity)).toBe(false);
    });
  });

  // ============================================
  // Validation Tests
  // ============================================

  describe('validation', () => {
    it('should skip intent if player has insufficient energy', () => {
      const entity = createMultiCellPlayer(world, 'player-1', { energy: 0 });
      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Verify EMP was NOT fired (no event)
      expect(mockIO.emittedEvents.some((e) => e.event === 'empActivated')).toBe(false);

      // Verify intent still removed (consumed even on failure)
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should skip intent if ability on cooldown', () => {
      const entity = createMultiCellPlayer(world, 'player-1');

      // Set EMP on cooldown
      const cooldowns = getCooldowns(world, entity);
      if (cooldowns) {
        cooldowns.lastEMPTime = Date.now(); // Just used
      }

      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Verify EMP was NOT fired
      expect(mockIO.emittedEvents.some((e) => e.event === 'empActivated')).toBe(false);

      // Verify intent removed
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should skip intent if player is stunned', () => {
      const entity = createMultiCellPlayer(world, 'player-1');

      // Stun the player
      world.addComponent<StunnedComponent>(entity, Components.Stunned, {
        until: Date.now() + 10000, // Stunned for 10 seconds
      });

      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Verify EMP was NOT fired
      expect(mockIO.emittedEvents.some((e) => e.event === 'empActivated')).toBe(false);

      // Verify intent removed
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should skip intent if player stage is wrong for ability', () => {
      // Create single-cell player (can't use EMP)
      const entity = createTestPlayer(world, {
        socketId: 'player-1',
        stage: EvolutionStage.SINGLE_CELL,
      });

      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Verify EMP was NOT fired
      expect(mockIO.emittedEvents.some((e) => e.event === 'empActivated')).toBe(false);

      // Verify intent removed
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should skip intent if player is evolving', () => {
      const entity = createMultiCellPlayer(world, 'player-1');

      // Set player to evolving state
      const stageComp = getStage(world, entity);
      if (stageComp) {
        stageComp.isEvolving = true;
        stageComp.evolvingUntil = Date.now() + 5000;
      }

      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Verify EMP was NOT fired
      expect(mockIO.emittedEvents.some((e) => e.event === 'empActivated')).toBe(false);

      // Verify intent removed
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });
  });

  // ============================================
  // Intent Cleanup Tests
  // ============================================

  describe('intent cleanup', () => {
    it('should remove intent component after processing (success)', () => {
      const entity = createMultiCellPlayer(world, 'player-1');
      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      expect(hasAbilityIntent(world, entity)).toBe(false);
    });

    it('should remove intent component after processing (validation failure)', () => {
      const entity = createMultiCellPlayer(world, 'player-1', { energy: 0 });
      addAbilityIntent(world, entity, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Intent should be removed even though ability didn't fire
      expect(hasAbilityIntent(world, entity)).toBe(false);
    });
  });

  // ============================================
  // PendingExpiration Tests
  // ============================================

  describe('PendingExpiration processing', () => {
    it('should destroy entity when expiresAt is reached', () => {
      // Create an entity with PendingExpiration
      const entity = world.createEntity();
      world.addComponent(entity, Components.PendingExpiration, {
        expiresAt: Date.now() - 100, // Already expired
      });

      // Verify entity exists
      expect(world.hasEntity(entity)).toBe(true);

      system.update(world, 16, mockIO);

      // Verify entity destroyed
      expect(world.hasEntity(entity)).toBe(false);
    });

    it('should not destroy entity before expiresAt', () => {
      // Create an entity with PendingExpiration in the future
      const entity = world.createEntity();
      world.addComponent(entity, Components.PendingExpiration, {
        expiresAt: Date.now() + 10000, // 10 seconds in the future
      });

      system.update(world, 16, mockIO);

      // Verify entity still exists
      expect(world.hasEntity(entity)).toBe(true);
    });
  });

  // ============================================
  // Multiple Intents Tests
  // ============================================

  describe('multiple entities with intents', () => {
    it('should process intents for multiple entities in same tick', () => {
      // Place players far apart (EMP_RANGE is 768px) so they don't stun each other
      const entity1 = createMultiCellPlayer(world, 'player-1', { x: SOUP_CENTER.x - 1000 });
      const entity2 = createMultiCellPlayer(world, 'player-2', { x: SOUP_CENTER.x + 1000 });

      addAbilityIntent(world, entity1, { abilityType: 'emp' });
      addAbilityIntent(world, entity2, { abilityType: 'emp' });

      system.update(world, 16, mockIO);

      // Both should have fired
      const empEvents = mockIO.emittedEvents.filter((e) => e.event === 'empActivated');
      expect(empEvents.length).toBe(2);

      // Both intents should be removed
      expect(hasAbilityIntent(world, entity1)).toBe(false);
      expect(hasAbilityIntent(world, entity2)).toBe(false);
    });
  });
});
