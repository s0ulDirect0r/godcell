// ============================================
// Godcell Flight System
// Handles Stage 5 Godcell 3D flight physics
// Clean, dedicated system - not hacked into SphereMovement
// ============================================

import type { Server } from 'socket.io';
import {
  Tags,
  Components,
  type World,
  GAME_CONFIG,
  EvolutionStage,
  type CameraFacingComponent,
} from '#shared';
import type { System } from './types';
import {
  requireEnergy,
  requirePosition,
  requireStage,
  requireVelocity,
  requireInput,
  getSocketIdByEntity,
} from '../factories';
import { logger } from '../../logger';

// Flight physics constants
const GODCELL_ACCEL = 18000; // High acceleration for responsiveness (+20%)
const GODCELL_MAX_SPEED = 9600; // Fast for combat maneuverability (+20%)
const GODCELL_FRICTION = 0.3; // Low friction, floaty feel

// Sphere radii for collision
const SOUP_RADIUS = GAME_CONFIG.SOUP_SPHERE_RADIUS;
const JUNGLE_RADIUS = GAME_CONFIG.JUNGLE_SPHERE_RADIUS;
const GOD_RADIUS = GAME_CONFIG.GOD_SPHERE_RADIUS;

// How far inside a sphere surface before we push back
const COLLISION_MARGIN = 50;

/**
 * GodcellFlightSystem - 3D flight for Stage 5 Godcells
 *
 * Key differences from surface-bound movement:
 * - True 3D movement (no sphere projection)
 * - No gravity (godcells float freely)
 * - Collision with sphere surfaces (unless intangible)
 * - High speed, responsive controls for combat
 */
export class GodcellFlightSystem implements System {
  readonly name = 'GodcellFlightSystem';

  update(world: World, deltaTime: number, _io: Server): void {
    world.forEachWithTag(Tags.Player, (entity) => {
      // Only process Stage 5 Godcells
      const stageComp = requireStage(world, entity);
      if (stageComp.stage !== EvolutionStage.GODCELL) return;

      const energyComponent = requireEnergy(world, entity);
      const pos = requirePosition(world, entity);
      const vel = requireVelocity(world, entity);
      const input = requireInput(world, entity);

      // Ensure z is always defined for 3D flight (Godcells use full 3D space)
      if (pos.z === undefined) pos.z = 0;
      if (vel.z === undefined) vel.z = 0;

      // Skip dead players
      if (energyComponent.current <= 0) return;

      const playerId = getSocketIdByEntity(entity);

      // Get raw input direction (local-space: x=strafe, y=forward/back, z=up/down)
      const localRight = input.direction.x ?? 0; // A/D strafe
      const localForward = input.direction.y ?? 0; // W/S forward/back
      const localUp = input.direction.z ?? 0; // Q/E up/down

      // Get camera facing for local→world transform
      const facing = world.getComponent<CameraFacingComponent>(
        entity,
        Components.CameraFacing
      );

      // Calculate world-space direction from local input + camera facing
      let worldX = 0;
      let worldY = 0;
      let worldZ = 0;

      if (localForward !== 0 || localRight !== 0 || localUp !== 0) {
        if (facing) {
          // Transform local→world using camera yaw/pitch
          const yaw = facing.yaw;
          const pitch = facing.pitch;

          // Forward vector in world space (where camera is looking)
          const fwdX = -Math.sin(yaw) * Math.cos(pitch);
          const fwdY = Math.sin(pitch);
          const fwdZ = -Math.cos(yaw) * Math.cos(pitch);

          // Right vector (perpendicular to forward, horizontal only)
          const rightX = Math.cos(yaw);
          const rightY = 0;
          const rightZ = -Math.sin(yaw);

          // Up vector (world up for consistent behavior)
          const upX = 0;
          const upY = 1;
          const upZ = 0;

          // Combine local input with basis vectors to get world direction
          worldX = localForward * fwdX + localRight * rightX + localUp * upX;
          worldY = localForward * fwdY + localRight * rightY + localUp * upY;
          worldZ = localForward * fwdZ + localRight * rightZ + localUp * upZ;
        } else {
          // No camera facing yet - use raw input as fallback
          // (this shouldn't happen in normal gameplay)
          worldX = localRight;
          worldY = localUp;
          worldZ = localForward;
        }
      }

      // DEBUG: Log once per second when we have a godcell
      if (Math.random() < 0.016) {
        logger.info({
          event: 'godcell_flight_tick',
          playerId,
          localInput: { forward: localForward, right: localRight, up: localUp },
          facing: facing ? { yaw: facing.yaw.toFixed(2), pitch: facing.pitch.toFixed(2) } : null,
          worldDir: { x: worldX.toFixed(2), y: worldY.toFixed(2), z: worldZ.toFixed(2) },
          pos: { x: pos.x.toFixed(0), y: pos.y.toFixed(0), z: pos.z.toFixed(0) },
          vel: { x: vel.x.toFixed(0), y: vel.y.toFixed(0), z: vel.z.toFixed(0) },
        }, 'GodcellFlightSystem processing');
      }

      // Apply acceleration based on world-space direction
      if (worldX !== 0 || worldY !== 0 || worldZ !== 0) {
        // Normalize for consistent speed in all directions
        const mag = Math.sqrt(worldX * worldX + worldY * worldY + worldZ * worldZ);
        const normX = worldX / mag;
        const normY = worldY / mag;
        const normZ = worldZ / mag;

        vel.x += normX * GODCELL_ACCEL * deltaTime;
        vel.y += normY * GODCELL_ACCEL * deltaTime;
        vel.z += normZ * GODCELL_ACCEL * deltaTime;
      }

      // Apply friction (exponential decay)
      const frictionFactor = Math.pow(1 - GODCELL_FRICTION, deltaTime * 60);
      vel.x *= frictionFactor;
      vel.y *= frictionFactor;
      vel.z *= frictionFactor;

      // Clamp to max speed
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      if (speed > GODCELL_MAX_SPEED) {
        const scale = GODCELL_MAX_SPEED / speed;
        vel.x *= scale;
        vel.y *= scale;
        vel.z *= scale;
      }

      // Apply velocity to position
      pos.x += vel.x * deltaTime;
      pos.y += vel.y * deltaTime;
      pos.z += vel.z * deltaTime;

      // Check for sphere collision (unless intangible/phasing)
      const isIntangible = world.hasComponent(entity, Components.Intangible);
      if (!isIntangible) {
        // pos.z and vel.z are guaranteed to be defined after initialization above
        this.handleSphereCollision(
          pos as { x: number; y: number; z: number },
          vel as { x: number; y: number; z: number }
        );
      }

      // Broadcast position update to all clients
      const moveMessage = {
        type: 'playerMoved' as const,
        playerId,
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
      };
      _io.emit('playerMoved', moveMessage);
    });
  }

  /**
   * Handle collision with sphere surfaces.
   * Godcells can't pass through spheres unless phasing.
   *
   * Collision logic:
   * - If inside soup sphere (< SOUP_RADIUS): push outward
   * - If inside jungle shell (> SOUP but < JUNGLE): push to nearest surface
   * - If inside god shell (> JUNGLE but < GOD): push to nearest surface
   * - If outside god sphere (> GOD): allowed (The Final Battle arena)
   */
  private handleSphereCollision(
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number }
  ): void {
    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    if (dist < 0.001) return; // Avoid division by zero at origin

    const nx = pos.x / dist; // Radial normal (points outward)
    const ny = pos.y / dist;
    const nz = pos.z / dist;

    // Soup sphere - inner boundary (can't go inside the primordial ocean)
    if (dist < SOUP_RADIUS - COLLISION_MARGIN) {
      // Push outward to soup surface
      pos.x = nx * SOUP_RADIUS;
      pos.y = ny * SOUP_RADIUS;
      pos.z = nz * SOUP_RADIUS;

      // Cancel inward velocity
      const radialVel = vel.x * nx + vel.y * ny + vel.z * nz;
      if (radialVel < 0) {
        vel.x -= radialVel * nx;
        vel.y -= radialVel * ny;
        vel.z -= radialVel * nz;
      }
    }

    // Jungle sphere shell - can't enter the solid shell (between inner surface and outer boundary)
    // Jungle inner surface is at JUNGLE_RADIUS, shell extends inward ~100 units
    // Actually, for now, allow flying through jungle space freely
    // Only soup and god have collision

    // God sphere - outer boundary (The Final Battle is OUTSIDE)
    // Allow passing through - once you exit, you're in the final arena
    // No collision here - it's a one-way exit
  }
}
