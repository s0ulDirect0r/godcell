import { HUNTING_GROVE } from '../../shared/grove';
import { GAME_CONFIG, type World } from '#shared';
import {
  createTree,
  createJungleCreature,
  createEntropySerpent,
  createDataFruitOnGround,
} from './ecs/factories';

export function initializeHuntingGrove(world: World): void {
  HUNTING_GROVE.trees.forEach(([x, y, radius, height], i) =>
    createTree(world, `grove-tree-${i}`, { x, y }, radius, height, i / 12)
  );
  createJungleCreature(
    world,
    'grove-grazer',
    'grazer',
    HUNTING_GROVE.feeding,
    HUNTING_GROVE.feeding,
    GAME_CONFIG.JUNGLE_CREATURE_VALUE,
    GAME_CONFIG.JUNGLE_CREATURE_CAPACITY
  );
  createEntropySerpent(world, 'grove-serpent', HUNTING_GROVE.den, HUNTING_GROVE.den);
  for (const [i, x, y] of [
    [0, 10900, 6100],
    [1, 11600, 6100],
    [2, 11750, 6750],
    [3, 13000, 6750],
  ])
    createDataFruitOnGround(world, `grove-fruit-${i}`, { x, y });
}
