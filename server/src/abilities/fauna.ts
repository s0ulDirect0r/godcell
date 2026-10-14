import { segmentCircleHit } from '../../../shared/grove';
import type { Server } from 'socket.io';
import {
  Components,
  Tags,
  type World,
  type Position,
  type CyberBugComponent,
  type JungleCreatureComponent,
  type TreeComponent,
  type EntropySerpentComponent,
} from '#shared';
import {
  getPosition,
  getEnergy,
  getEntityBySocketId,
  getStringIdByEntity,
  destroyEntity,
} from '../ecs/factories';
import { scheduleCreatureRespawn, scheduleSwarmRespawn } from '../jungleFauna';

/** Shared hit shapes and rewards keep all three combat pathways useful for hunting. */
export function faunaTargets(world: World) {
  const targets: Array<{
    entity: number;
    id: string;
    position: Position;
    radius: number;
    type: 'cyberbug' | 'creature' | 'serpent';
  }> = [];
  for (const [tag, component, type] of [
    [Tags.CyberBug, Components.CyberBug, 'cyberbug'],
    [Tags.JungleCreature, Components.JungleCreature, 'creature'],
    [Tags.EntropySerpent, Components.EntropySerpent, 'serpent'],
  ] as const) {
    world.forEachWithTag(tag, (entity) => {
      const pos = getPosition(world, entity);
      const data = world.getComponent<
        CyberBugComponent | JungleCreatureComponent | EntropySerpentComponent
      >(entity, component);
      const id = getStringIdByEntity(entity);
      if (!pos || !data || !id) return;
      if (type === 'serpent' && (getEnergy(world, entity)?.current ?? 0) <= 0) return;
      // Serpent head and body are both hittable; reward processing is guarded against duplicate death.
      targets.push({ entity, id, position: { x: pos.x, y: pos.y }, radius: data.size, type });
      if (type === 'serpent') {
        const heading = (data as EntropySerpentComponent).heading;
        for (let segment = 0; segment < 12; segment++) {
          const offset = (6 - segment) * data.size * 1.6;
          targets.push({
            entity,
            id,
            position: {
              x: pos.x + Math.cos(heading) * offset,
              y: pos.y + Math.sin(heading) * offset,
            },
            radius: data.size,
            type,
          });
        }
      }
    });
  }
  return targets;
}

export function damageFauna(
  world: World,
  io: Server,
  entity: number,
  ownerId: string,
  damage: number,
  stunDuration = 0
): boolean {
  const id = getStringIdByEntity(entity);
  const pos = getPosition(world, entity);
  if (!id || !pos || !world.hasEntity(entity)) return false;
  const bug = world.getComponent<CyberBugComponent>(entity, Components.CyberBug);
  const creature = world.getComponent<JungleCreatureComponent>(entity, Components.JungleCreature);
  const serpent = world.getComponent<EntropySerpentComponent>(entity, Components.EntropySerpent);
  if (!bug && !creature && !serpent) return false;
  const position = { x: pos.x, y: pos.y };
  if (creature) {
    creature.health = Math.max(0, (creature.health ?? 600) - damage);
    creature.maxHealth ??= 600;
    creature.hurtUntil = Date.now() + 3500;
    creature.state = 'flee';
    creature.targetEntityId = getEntityBySocketId(ownerId);
    if (stunDuration > 0)
      world.addComponent(entity, Components.Stunned, { until: Date.now() + stunDuration });
    io.emit('jungleCreatureMoved', {
      type: 'jungleCreatureMoved',
      creatureId: id,
      position,
      state: creature.state,
      variant: creature.variant,
      health: creature.health,
      maxHealth: creature.maxHealth,
    });
    if (creature.health > 0) return false;
  }
  if (serpent) {
    const energy = getEnergy(world, entity);
    if (!energy || energy.current <= 0) return false;
    energy.current = Math.max(0, energy.current - damage);
    io.emit('entropySerpentDamaged', {
      type: 'entropySerpentDamaged',
      serpentId: id,
      damage,
      currentEnergy: energy.current,
      attackerId: ownerId,
    });
    if (energy.current > 0) return false;
  }
  const owner = getEntityBySocketId(ownerId);
  const energy = owner !== undefined ? getEnergy(world, owner) : undefined;
  const value = bug?.value ?? creature?.value ?? 4500;
  const capacity = bug?.capacityIncrease ?? creature?.capacityIncrease ?? 4500;
  let gained = 0;
  if (energy && energy.current > 0) {
    energy.max += capacity;
    gained = Math.min(value, energy.max - energy.current);
    energy.current += gained;
  }
  if (serpent) return true; // Serpent AI owns death event and bounded respawn.
  const type = bug ? 'cyberBugKilled' : 'jungleCreatureKilled';
  io.emit(type, {
    type,
    ...(bug ? { bugId: id } : { creatureId: id }),
    killerId: ownerId,
    position,
    energyGained: gained,
    capacityGained: energy && energy.current > 0 ? capacity : 0,
  });
  destroyEntity(world, entity);
  if (creature) scheduleCreatureRespawn(creature.homePosition, creature.variant);
  if (bug) scheduleSwarmRespawn(world, bug.swarmId, bug.homePosition);
  return true;
}

export function blockedByTree(world: World, from: Position, to: Position): boolean {
  let blocked = false;
  world.forEachWithTag(Tags.Tree, (entity) => {
    const pos = getPosition(world, entity),
      tree = world.getComponent<TreeComponent>(entity, Components.Tree);
    if (
      pos &&
      tree &&
      segmentCircleHit(from.x, from.y, to.x, to.y, pos.x, pos.y, tree.radius) !== null
    )
      blocked = true;
  });
  return blocked;
}
