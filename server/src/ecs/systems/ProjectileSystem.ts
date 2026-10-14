import type { Server } from 'socket.io';
import {
  GAME_CONFIG,
  Tags,
  Components,
  type World,
  type PositionComponent,
  type VelocityComponent,
  type ProjectileComponent,
  type TreeComponent,
} from '#shared';
import { segmentCircleHit } from '../../../../shared/grove';
import { faunaTargets, damageFauna } from '../../abilities/fauna';
import {
  getStringIdByEntity,
  destroyEntity,
  forEachPlayer,
  getPosition,
  getStage,
  getEnergy,
  subtractEnergy,
} from '../factories';
import { isJungleStage } from '../../helpers/stages';
import type { System } from './types';

export class ProjectileSystem implements System {
  readonly name = 'ProjectileSystem';
  update(world: World, dt: number, io: Server): void {
    const remove: number[] = [];
    const fauna = faunaTargets(world);
    world.forEachWithTag(Tags.Projectile, (entity) => {
      const pos = world.getComponent<PositionComponent>(entity, Components.Position);
      const vel = world.getComponent<VelocityComponent>(entity, Components.Velocity);
      const proj = world.getComponent<ProjectileComponent>(entity, Components.Projectile);
      const id = getStringIdByEntity(entity);
      if (!pos || !vel || !proj || !id) return;
      if (proj.state !== 'traveling') {
        remove.push(entity);
        return;
      }
      const ax = pos.x,
        ay = pos.y;
      const speed = Math.hypot(vel.x, vel.y);
      const travel = Math.min(speed * dt, Math.max(0, proj.maxDistance - proj.distanceTraveled));
      const bx = ax + (speed ? (vel.x / speed) * travel : 0),
        by = ay + (speed ? (vel.y / speed) * travel : 0);
      let hit:
        | {
            t: number;
            entity: number;
            id: string;
            type: 'tree' | 'player' | 'cyberbug' | 'creature' | 'serpent';
          }
        | undefined;
      const consider = (
        target: number,
        targetId: string,
        type: NonNullable<typeof hit>['type'],
        x: number,
        y: number,
        radius: number
      ) => {
        const t = segmentCircleHit(
          ax,
          ay,
          bx,
          by,
          x,
          y,
          radius + GAME_CONFIG.PROJECTILE_COLLISION_RADIUS
        );
        if (t !== null && (!hit || t < hit.t)) hit = { t, entity: target, id: targetId, type };
      };
      // Tree trunks have the same solid footprint for shots and movement.
      world.forEachWithTag(Tags.Tree, (target) => {
        const p = getPosition(world, target),
          tree = world.getComponent<TreeComponent>(target, Components.Tree);
        if (p && tree) consider(target, '', 'tree', p.x, p.y, tree.radius);
      });
      forEachPlayer(world, (target, targetId) => {
        const p = getPosition(world, target),
          stage = getStage(world, target),
          energy = getEnergy(world, target);
        if (
          targetId === proj.ownerSocketId ||
          !p ||
          !stage ||
          !energy ||
          energy.current <= 0 ||
          stage.isEvolving ||
          !isJungleStage(stage.stage)
        )
          return;
        consider(target, targetId, 'player', p.x, p.y, stage.radius);
      });
      for (const target of fauna)
        if (world.hasEntity(target.entity))
          consider(
            target.entity,
            target.id,
            target.type,
            target.position.x,
            target.position.y,
            target.radius
          );
      const contact = hit as
        | {
            t: number;
            entity: number;
            id: string;
            type: 'tree' | 'player' | 'cyberbug' | 'creature' | 'serpent';
          }
        | undefined;
      pos.x = contact ? ax + (bx - ax) * contact.t : bx;
      pos.y = contact ? ay + (by - ay) * contact.t : by;
      proj.distanceTraveled += travel;
      if (contact) {
        if (contact.type === 'tree')
          io.emit('projectileRetracted', { type: 'projectileRetracted', projectileId: id });
        else {
          const killed =
            contact.type === 'player'
              ? (subtractEnergy(world, contact.entity, proj.damage),
                (getEnergy(world, contact.entity)?.current ?? 0) <= 0)
              : damageFauna(world, io, contact.entity, proj.ownerSocketId, proj.damage);
          io.emit('projectileHit', {
            type: 'projectileHit',
            projectileId: id,
            targetId: contact.id,
            targetType: contact.type,
            hitPosition: { x: pos.x, y: pos.y },
            damage: proj.damage,
            killed,
          });
        }
        proj.state = 'hit';
        remove.push(entity);
      } else if (proj.distanceTraveled >= proj.maxDistance) {
        proj.state = 'missed';
        remove.push(entity);
        io.emit('projectileRetracted', { type: 'projectileRetracted', projectileId: id });
      }
    });
    for (const entity of remove) destroyEntity(world, entity);
  }
}
