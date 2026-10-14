import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import {
  Components,
  EvolutionStage,
  GAME_CONFIG,
  Tags,
  type JungleCreatureComponent,
  type EntropySerpentComponent,
} from '#shared';
import {
  createWorld,
  clearLookups,
  createPlayer,
  createJungleCreature,
  createEntropySerpent,
  createProjectile,
  createTrap,
  createTree,
  getEnergy,
  getPosition,
} from '../../factories';
import { fireMeleeAttack } from '../../../abilities/melee';
import { damageFauna } from '../../../abilities/fauna';
import { ProjectileSystem } from '../ProjectileSystem';
import { TrapSystem } from '../TrapSystem';
import { EntropySerpentAISystem } from '../EntropySerpentAISystem';
import { JungleCreatureAISystem } from '../JungleCreatureAISystem';
import { HUNTING_GROVE, segmentCircleHit } from '../../../../../shared/grove';
import { initializeHuntingGrove } from '../../../huntingGrove';

let world: ReturnType<typeof createWorld>;
let owner: number;
const emit = vi.fn();
const io = { emit } as unknown as Server;
const position = { x: 11000, y: 6400 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  clearLookups();
  world = createWorld();
  emit.mockClear();
  owner = createPlayer(
    world,
    'hunter',
    'hunter',
    '#88ffdd',
    position,
    EvolutionStage.CYBER_ORGANISM
  );
  world.addComponent(owner, Components.CombatSpecialization, {
    specialization: 'melee',
    selectionPending: false,
    selectionDeadline: 0,
  });
});
afterEach(() => {
  vi.useRealTimers();
  clearLookups();
});
const grazer = () =>
  createJungleCreature(
    world,
    'grazer',
    'grazer',
    { x: 11300, y: 6400 },
    { x: 11300, y: 6400 },
    3000,
    3000
  );

describe('hunting grove combat', () => {
  it('melee wounds the grazer, then awards its capacity once on the fourth hit', () => {
    const target = grazer();
    fireMeleeAttack(world, io, owner, 'hunter', 'swipe', 11300, 6400);
    expect(
      world.getComponent<JungleCreatureComponent>(target, Components.JungleCreature)?.health
    ).toBe(450);
    expect(getEnergy(world, owner)?.max).toBe(3000);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(500);
      fireMeleeAttack(world, io, owner, 'hunter', 'swipe', 11300, 6400);
    }
    expect(world.hasEntity(target)).toBe(false);
    expect(getEnergy(world, owner)?.max).toBe(6000);
    damageFauna(world, io, target, 'hunter', 999);
    expect(getEnergy(world, owner)?.max).toBe(6000);
    expect(emit.mock.calls.filter(([event]) => event === 'jungleCreatureKilled')).toHaveLength(1);
  });
  it('sweeps fast shots across a grazer between ticks', () => {
    const target = grazer();
    createProjectile(world, 'shot', owner, 'hunter', position, { x: 12000, y: 6400 }, '#fff');
    new ProjectileSystem().update(world, 0.1, io);
    expect(
      world.getComponent<JungleCreatureComponent>(target, Components.JungleCreature)?.health
    ).toBe(450);
    expect(world.getEntitiesWithTag(Tags.Projectile)).toHaveLength(0);
  });
  it('a trunk stops a shot before it reaches prey and blocks melee', () => {
    const target = grazer();
    createTree(world, 'cover', { x: 11150, y: 6400 }, 60, 500, 0.5);
    createProjectile(world, 'shot', owner, 'hunter', position, { x: 12000, y: 6400 }, '#fff');
    new ProjectileSystem().update(world, 0.1, io);
    fireMeleeAttack(world, io, owner, 'hunter', 'swipe', 11300, 6400);
    expect(
      world.getComponent<JungleCreatureComponent>(target, Components.JungleCreature)?.health
    ).toBe(600);
  });
  it('traps wound and stun a grazer; a second trap completes the hunt', () => {
    const target = grazer();
    const system = new TrapSystem();
    createTrap(world, 'mine1', owner, 'hunter', { x: 11300, y: 6400 }, '#fff');
    system.update(world, 0.016, io);
    expect(
      world.getComponent<JungleCreatureComponent>(target, Components.JungleCreature)?.health
    ).toBe(225);
    expect(world.hasComponent(target, Components.Stunned)).toBe(true);
    createTrap(world, 'mine2', owner, 'hunter', { x: 11300, y: 6400 }, '#fff');
    system.update(world, 0.016, io);
    expect(world.hasEntity(target)).toBe(false);
    expect(getEnergy(world, owner)?.max).toBe(6000);
    expect(world.getEntitiesWithTag(Tags.Trap)).toHaveLength(0);
  });
  it('wounded grazers flee with real movement and stop while stunned', () => {
    const target = grazer();
    damageFauna(world, io, target, 'hunter', 150);
    const system = new JungleCreatureAISystem();
    system.update(world, 0.1, io);
    expect(getPosition(world, target)!.x).toBeGreaterThan(11300);
    world.addComponent(target, Components.Stunned, { until: 101000 });
    const x = getPosition(world, target)!.x;
    system.update(world, 0.1, io);
    expect(getPosition(world, target)!.x).toBe(x);
  });
  it('melee can hit the serpent head and cannot award its kill twice', () => {
    const target = createEntropySerpent(
      world,
      'serpent',
      { x: 10000, y: 6400 },
      { x: 10000, y: 6400 }
    );
    world.getComponent<EntropySerpentComponent>(target, Components.EntropySerpent)!.heading = 0;
    fireMeleeAttack(world, io, owner, 'hunter', 'swipe', 10768, 6400);
    expect(getEnergy(world, target)?.current).toBe(GAME_CONFIG.ENTROPY_SERPENT_ENERGY - 150);
    damageFauna(world, io, target, 'hunter', 10000);
    damageFauna(world, io, target, 'hunter', 10000);
    expect(getEnergy(world, owner)?.max).toBe(7500);
  });
});

describe('serpent attack contract', () => {
  it('locks its warning, allows a dodge, and has a recovery window', () => {
    const target = createEntropySerpent(
      world,
      'serpent',
      { x: 10000, y: 6400 },
      { x: 10000, y: 6400 }
    );
    const serpent = world.getComponent<EntropySerpentComponent>(target, Components.EntropySerpent)!;
    serpent.heading = 0;
    const system = new EntropySerpentAISystem();
    system.update(world, 0.016, io);
    expect(serpent.state).toBe('windup');
    expect(getEnergy(world, owner)?.current).toBe(3000);
    const origin = { ...getPosition(world, target)! };
    getPosition(world, owner)!.y += 800;
    vi.advanceTimersByTime(450);
    system.update(world, 0.016, io);
    expect(getPosition(world, target)).toEqual(origin);
    expect(serpent.heading).toBe(0);
    vi.advanceTimersByTime(450);
    system.update(world, 0.016, io);
    expect(serpent.state).toBe('attack');
    expect(getEnergy(world, owner)?.current).toBe(3000);
    vi.advanceTimersByTime(180);
    system.update(world, 0.016, io);
    expect(serpent.state).toBe('recover');
    vi.advanceTimersByTime(1000);
    system.update(world, 0.016, io);
    expect(serpent.state).toBe('recover');
  });
  it('damages a player who stays in the warned sector, once per strike', () => {
    const target = createEntropySerpent(
      world,
      'serpent',
      { x: 10000, y: 6400 },
      { x: 10000, y: 6400 }
    );
    world.getComponent<EntropySerpentComponent>(target, Components.EntropySerpent)!.heading = 0;
    const system = new EntropySerpentAISystem();
    system.update(world, 0.016, io);
    vi.advanceTimersByTime(900);
    system.update(world, 0.016, io);
    system.update(world, 0.016, io);
    expect(getEnergy(world, owner)?.current).toBe(2700);
  });
});

it('the grove has one grazer, one serpent and a player-width route through the authored trunks', () => {
  initializeHuntingGrove(world);
  expect(world.getEntitiesWithTag(Tags.JungleCreature)).toHaveLength(1);
  expect(world.getEntitiesWithTag(Tags.EntropySerpent)).toHaveLength(1);
  for (const [x, y, r] of HUNTING_GROVE.trees)
    expect(
      segmentCircleHit(10300, 6400, 14500, 6400, x, y, r + GAME_CONFIG.CYBER_ORGANISM_RADIUS)
    ).toBeNull();
});
