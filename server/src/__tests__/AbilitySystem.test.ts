// ============================================
// Ability Functions Unit Tests
// ============================================
//
// Tests for standalone ability functions.
// These are called by AbilityIntentSystem during game tick.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'socket.io';
import { EvolutionStage, Components, GAME_CONFIG } from '#shared';
import type { CombatSpecialization, CombatSpecializationComponent, World } from '#shared';
import {
  fireEMP,
  canFireEMP,
  firePseudopod,
  canFirePseudopod,
  fireProjectile,
  canFireProjectile,
  fireMeleeAttack,
  placeTrap,
  canPlaceTrap,
} from '../abilities';
import {
  createWorld,
  createPlayer,
  clearLookups,
  getEnergy,
  getStage,
  getCooldowns,
  getStunned,
} from '../ecs/factories';

// ============================================
// Test Constants
// ============================================

const SOUP_CENTER = {
  x: GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH / 2,
  y: GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT / 2,
};

const JUNGLE_CENTER = {
  x: GAME_CONFIG.JUNGLE_WIDTH / 2,
  y: GAME_CONFIG.JUNGLE_HEIGHT / 2,
};

// ============================================
// Test Utilities
// ============================================

function createMockIO(): Server & { emittedEvents: Array<{ event: string; data: unknown }> } {
  const emittedEvents: Array<{ event: string; data: unknown }> = [];

  const mockIO = {
    emittedEvents,
    emit: (event: string, data: unknown) => {
      emittedEvents.push({ event, data });
      return true;
    },
    to: () => mockIO,
    in: () => mockIO,
  } as unknown as Server & { emittedEvents: Array<{ event: string; data: unknown }> };

  return mockIO;
}

function createMultiCellPlayer(
  world: World,
  socketId: string,
  options: { x?: number; y?: number; energy?: number } = {}
): number {
  const { x = SOUP_CENTER.x, y = SOUP_CENTER.y, energy = 100 } = options;
  const entity = createPlayer(
    world,
    socketId,
    'TestPlayer',
    '#00ff00',
    { x, y },
    EvolutionStage.MULTI_CELL
  );

  // Set energy if specified
  if (energy !== 100) {
    const energyComp = getEnergy(world, entity);
    if (energyComp) energyComp.current = energy;
  }

  return entity;
}

function createCyberOrganism(
  world: World,
  socketId: string,
  specialization: CombatSpecialization,
  options: { x?: number; y?: number; energy?: number } = {}
): number {
  const { x = JUNGLE_CENTER.x, y = JUNGLE_CENTER.y, energy = 500 } = options;
  const entity = createPlayer(
    world,
    socketId,
    'TestPlayer',
    '#00ff00',
    { x, y },
    EvolutionStage.CYBER_ORGANISM
  );

  // Add combat specialization
  world.addComponent<CombatSpecializationComponent>(entity, Components.CombatSpecialization, {
    specialization,
  });

  // Set energy if specified
  const energyComp = getEnergy(world, entity);
  if (energyComp) energyComp.current = energy;

  return entity;
}

// ============================================
// EMP Tests
// ============================================

describe('Ability Functions', () => {
  let world: World;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    clearLookups();
    world = createWorld();
    io = createMockIO();
  });

  afterEach(() => {
    clearLookups();
  });

  describe('EMP', () => {
    describe('fireEMP', () => {
      it('fires EMP successfully for multi-cell player', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(true);
        expect(io.emittedEvents).toHaveLength(1);
        expect(io.emittedEvents[0].event).toBe('empActivated');
      });

      it('deducts energy on success', () => {
        const entity = createMultiCellPlayer(world, 'player-1', { energy: 100 });
        const initialEnergy = getEnergy(world, entity)!.current;

        fireEMP(world, io,entity, 'player-1');

        const newEnergy = getEnergy(world, entity)!.current;
        expect(newEnergy).toBe(initialEnergy - GAME_CONFIG.EMP_ENERGY_COST);
      });

      it('sets cooldown after firing', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        fireEMP(world, io,entity, 'player-1');

        const cooldowns = getCooldowns(world, entity);
        expect(cooldowns?.lastEMPTime).toBeGreaterThan(0);
      });

      it('fails for single-cell player (wrong stage)', () => {
        const entity = createPlayer(
          world,
          'player-1',
          'TestPlayer',
          '#00ff00',
          { x: SOUP_CENTER.x, y: SOUP_CENTER.y },
          EvolutionStage.SINGLE_CELL
        );

        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(false);
        expect(io.emittedEvents).toHaveLength(0);
      });

      it('fails when on cooldown', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        // Fire once to set cooldown
        fireEMP(world, io,entity, 'player-1');

        // Try to fire again immediately
        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(false);
        expect(io.emittedEvents).toHaveLength(1); // Only first fire
      });

      it('fails when insufficient energy', () => {
        const entity = createMultiCellPlayer(world, 'player-1', { energy: 1 });

        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(false);
        expect(io.emittedEvents).toHaveLength(0);
      });

      it('fails when player is dead', () => {
        const entity = createMultiCellPlayer(world, 'player-1', { energy: 0 });

        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('fails when player is evolving', () => {
        const entity = createMultiCellPlayer(world, 'player-1');
        const stage = getStage(world, entity);
        if (stage) stage.isEvolving = true;

        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('fails when player is stunned', () => {
        const entity = createMultiCellPlayer(world, 'player-1');
        world.addComponent(entity, Components.Stunned, {
          until: Date.now() + 10000,
        });

        const result = fireEMP(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('stuns nearby enemy players', () => {
        const attacker = createMultiCellPlayer(world, 'attacker');
        const victim = createMultiCellPlayer(world, 'victim'); // Same position = in range

        fireEMP(world, io,attacker, 'attacker');

        const stunnedComp = getStunned(world, victim);
        expect(stunnedComp).toBeDefined();
        expect(stunnedComp!.until).toBeGreaterThan(Date.now());
      });

      it('does not stun players outside range', () => {
        const attacker = createMultiCellPlayer(world, 'attacker');
        const farPlayer = createMultiCellPlayer(world, 'far', {
          x: SOUP_CENTER.x + GAME_CONFIG.EMP_RANGE + 100,
        });

        fireEMP(world, io,attacker, 'attacker');

        // Check that stun is not active (component may exist with until=0)
        const stunnedComp = getStunned(world, farPlayer);
        const isStunned = stunnedComp && stunnedComp.until > Date.now();
        expect(isStunned).toBeFalsy();
      });
    });

    describe('canFireEMP', () => {
      it('returns true when conditions are met', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        expect(canFireEMP(world,entity)).toBe(true);
      });

      it('returns false on cooldown', () => {
        const entity = createMultiCellPlayer(world, 'player-1');
        fireEMP(world, io,entity, 'player-1');

        expect(canFireEMP(world,entity)).toBe(false);
      });

      it('returns false for wrong stage', () => {
        const entity = createPlayer(
          world,
          'player-1',
          'TestPlayer',
          '#00ff00',
          { x: SOUP_CENTER.x, y: SOUP_CENTER.y },
          EvolutionStage.SINGLE_CELL
        );

        expect(canFireEMP(world,entity)).toBe(false);
      });
    });
  });

  describe('Pseudopod', () => {
    describe('firePseudopod', () => {
      it('fires pseudopod successfully for multi-cell player', () => {
        const entity = createMultiCellPlayer(world, 'player-1');
        const targetX = SOUP_CENTER.x + 100;
        const targetY = SOUP_CENTER.y;

        const result = firePseudopod(world, io,entity, 'player-1', targetX, targetY);

        expect(result).toBe(true);
        // Should emit either pseudopodSpawned or pseudopodStrike depending on mode
        expect(io.emittedEvents.length).toBeGreaterThan(0);
      });

      it('deducts energy on success', () => {
        const entity = createMultiCellPlayer(world, 'player-1', { energy: 100 });
        const initialEnergy = getEnergy(world, entity)!.current;

        firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);

        const newEnergy = getEnergy(world, entity)!.current;
        expect(newEnergy).toBe(initialEnergy - GAME_CONFIG.PSEUDOPOD_ENERGY_COST);
      });

      it('sets cooldown after firing', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);

        const cooldowns = getCooldowns(world, entity);
        expect(cooldowns?.lastPseudopodTime).toBeGreaterThan(0);
      });

      it('fails for single-cell player', () => {
        const entity = createPlayer(
          world,
          'player-1',
          'TestPlayer',
          '#00ff00',
          { x: SOUP_CENTER.x, y: SOUP_CENTER.y },
          EvolutionStage.SINGLE_CELL
        );

        const result = firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails when on cooldown', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);
        const result = firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails when target is at same position (no direction)', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        const result = firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x, SOUP_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails when player is stunned', () => {
        const entity = createMultiCellPlayer(world, 'player-1');
        world.addComponent(entity, Components.Stunned, {
          until: Date.now() + 10000,
        });

        const result = firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);

        expect(result).toBe(false);
      });
    });

    describe('canFirePseudopod', () => {
      it('returns true when conditions are met', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        expect(canFirePseudopod(world,entity)).toBe(true);
      });

      it('returns false on cooldown', () => {
        const entity = createMultiCellPlayer(world, 'player-1');
        firePseudopod(world, io,entity, 'player-1', SOUP_CENTER.x + 100, SOUP_CENTER.y);

        expect(canFirePseudopod(world,entity)).toBe(false);
      });
    });
  });

  describe('Projectile', () => {
    describe('fireProjectile', () => {
      it('fires projectile for ranged cyber-organism', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged');
        const targetX = JUNGLE_CENTER.x + 200;
        const targetY = JUNGLE_CENTER.y;

        const result = fireProjectile(world, io,entity, 'player-1', targetX, targetY);

        expect(result).toBe(true);
        expect(io.emittedEvents.some(e => e.event === 'projectileSpawned')).toBe(true);
      });

      it('deducts energy on success', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged', { energy: 500 });
        const initialEnergy = getEnergy(world, entity)!.current;

        fireProjectile(world, io,entity, 'player-1', JUNGLE_CENTER.x + 200, JUNGLE_CENTER.y);

        const newEnergy = getEnergy(world, entity)!.current;
        expect(newEnergy).toBe(initialEnergy - GAME_CONFIG.PROJECTILE_ENERGY_COST);
      });

      it('fails for melee specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');

        const result = fireProjectile(world, io,entity, 'player-1', JUNGLE_CENTER.x + 200, JUNGLE_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails for traps specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps');

        const result = fireProjectile(world, io,entity, 'player-1', JUNGLE_CENTER.x + 200, JUNGLE_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails for multi-cell player (wrong stage)', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        const result = fireProjectile(world, io,entity, 'player-1', SOUP_CENTER.x + 200, SOUP_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails when on cooldown', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged');

        fireProjectile(world, io,entity, 'player-1', JUNGLE_CENTER.x + 200, JUNGLE_CENTER.y);
        const result = fireProjectile(world, io,entity, 'player-1', JUNGLE_CENTER.x + 200, JUNGLE_CENTER.y);

        expect(result).toBe(false);
      });
    });

    describe('canFireProjectile', () => {
      it('returns true for ranged specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged');

        expect(canFireProjectile(world,entity)).toBe(true);
      });

      it('returns false for wrong specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');

        expect(canFireProjectile(world,entity)).toBe(false);
      });
    });
  });

  describe('Melee', () => {
    describe('fireMeleeAttack', () => {
      it('fires swipe attack for melee cyber-organism', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');
        const targetX = JUNGLE_CENTER.x + 300;
        const targetY = JUNGLE_CENTER.y;

        const result = fireMeleeAttack(world, io,entity, 'player-1', 'swipe', targetX, targetY);

        expect(result).toBe(true);
        expect(io.emittedEvents.some(e => e.event === 'meleeAttackExecuted')).toBe(true);
      });

      it('fires thrust attack for melee cyber-organism', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');
        const targetX = JUNGLE_CENTER.x + 400;
        const targetY = JUNGLE_CENTER.y;

        const result = fireMeleeAttack(world, io,entity, 'player-1', 'thrust', targetX, targetY);

        expect(result).toBe(true);
        expect(io.emittedEvents.some(e => e.event === 'meleeAttackExecuted')).toBe(true);
      });

      it('deducts energy on swipe', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee', { energy: 500 });
        const initialEnergy = getEnergy(world, entity)!.current;

        fireMeleeAttack(world, io,entity, 'player-1', 'swipe', JUNGLE_CENTER.x + 300, JUNGLE_CENTER.y);

        const newEnergy = getEnergy(world, entity)!.current;
        expect(newEnergy).toBe(initialEnergy - GAME_CONFIG.MELEE_SWIPE_ENERGY_COST);
      });

      it('deducts energy on thrust', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee', { energy: 500 });
        const initialEnergy = getEnergy(world, entity)!.current;

        fireMeleeAttack(world, io,entity, 'player-1', 'thrust', JUNGLE_CENTER.x + 400, JUNGLE_CENTER.y);

        const newEnergy = getEnergy(world, entity)!.current;
        expect(newEnergy).toBe(initialEnergy - GAME_CONFIG.MELEE_THRUST_ENERGY_COST);
      });

      it('fails for ranged specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged');

        const result = fireMeleeAttack(world, io,entity, 'player-1', 'swipe', JUNGLE_CENTER.x + 300, JUNGLE_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails for multi-cell player (wrong stage)', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        const result = fireMeleeAttack(world, io,entity, 'player-1', 'swipe', SOUP_CENTER.x + 300, SOUP_CENTER.y);

        expect(result).toBe(false);
      });

      it('fails when on cooldown', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');

        fireMeleeAttack(world, io,entity, 'player-1', 'swipe', JUNGLE_CENTER.x + 300, JUNGLE_CENTER.y);
        const result = fireMeleeAttack(world, io,entity, 'player-1', 'swipe', JUNGLE_CENTER.x + 300, JUNGLE_CENTER.y);

        expect(result).toBe(false);
      });

      it('allows different attack types on separate cooldowns', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');

        fireMeleeAttack(world, io,entity, 'player-1', 'swipe', JUNGLE_CENTER.x + 300, JUNGLE_CENTER.y);
        // Thrust should work even though swipe is on cooldown
        const result = fireMeleeAttack(world, io,entity, 'player-1', 'thrust', JUNGLE_CENTER.x + 400, JUNGLE_CENTER.y);

        expect(result).toBe(true);
      });
    });
  });

  describe('Trap', () => {
    describe('placeTrap', () => {
      it('places trap for traps cyber-organism', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps');

        const result = placeTrap(world, io,entity, 'player-1');

        expect(result).toBe(true);
        expect(io.emittedEvents.some(e => e.event === 'trapPlaced')).toBe(true);
      });

      it('deducts energy on success', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps', { energy: 500 });
        const initialEnergy = getEnergy(world, entity)!.current;

        placeTrap(world, io,entity, 'player-1');

        const newEnergy = getEnergy(world, entity)!.current;
        expect(newEnergy).toBe(initialEnergy - GAME_CONFIG.TRAP_ENERGY_COST);
      });

      it('sets cooldown after placing', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps');

        placeTrap(world, io,entity, 'player-1');

        const cooldowns = getCooldowns(world, entity);
        expect(cooldowns?.lastTrapPlaceTime).toBeGreaterThan(0);
      });

      it('fails for ranged specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged');

        const result = placeTrap(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('fails for melee specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'melee');

        const result = placeTrap(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('fails for multi-cell player (wrong stage)', () => {
        const entity = createMultiCellPlayer(world, 'player-1');

        const result = placeTrap(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('fails when on cooldown', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps');

        placeTrap(world, io,entity, 'player-1');
        const result = placeTrap(world, io,entity, 'player-1');

        expect(result).toBe(false);
      });

      it('fails when max traps reached', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps', { energy: 5000 });

        // Place max traps (reset cooldown each time by manipulating the cooldowns)
        for (let i = 0; i < GAME_CONFIG.TRAP_MAX_ACTIVE; i++) {
          const cooldowns = getCooldowns(world, entity);
          if (cooldowns) cooldowns.lastTrapPlaceTime = 0; // Reset cooldown
          placeTrap(world, io,entity, 'player-1');
        }

        // Reset cooldown for final attempt
        const cooldowns = getCooldowns(world, entity);
        if (cooldowns) cooldowns.lastTrapPlaceTime = 0;

        const result = placeTrap(world, io,entity, 'player-1');
        expect(result).toBe(false);
      });
    });

    describe('canPlaceTrap', () => {
      it('returns true for traps specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps');

        expect(canPlaceTrap(world,entity, 'player-1')).toBe(true);
      });

      it('returns false for wrong specialization', () => {
        const entity = createCyberOrganism(world, 'player-1', 'ranged');

        expect(canPlaceTrap(world,entity, 'player-1')).toBe(false);
      });

      it('returns false on cooldown', () => {
        const entity = createCyberOrganism(world, 'player-1', 'traps');
        placeTrap(world, io,entity, 'player-1');

        expect(canPlaceTrap(world,entity, 'player-1')).toBe(false);
      });
    });
  });
});
