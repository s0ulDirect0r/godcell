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
const GODCELL_ACCEL = 15000; // High acceleration for responsiveness
const GODCELL_MAX_SPEED = 8000; // Fast for combat maneuverability
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

      // Skip dead players
      if (energyComponent.current <= 0) return;

      const playerId = getSocketIdByEntity(entity);

      // Get input direction (already transformed to world space by client)
      const inputX = input.direction.x ?? 0;
      const inputY = input.direction.y ?? 0;
      const inputZ = input.direction.z ?? 0;

      // DEBUG: Log once per second when we have a godcell
      if (Math.random() < 0.016) {
        logger.info({
          event: 'godcell_flight_tick',
          playerId,
          input: { x: inputX, y: inputY, z: inputZ },
          pos: { x: pos.x.toFixed(0), y: pos.y.toFixed(0), z: pos.z.toFixed(0) },
          vel: { x: vel.x.toFixed(0), y: vel.y.toFixed(0), z: vel.z.toFixed(0) },
        }, 'GodcellFlightSystem processing');
      }

      // Apply acceleration based on input
      if (inputX !== 0 || inputY !== 0 || inputZ !== 0) {
        // Normalize input for consistent speed in all directions
        const inputMag = Math.sqrt(inputX * inputX + inputY * inputY + inputZ * inputZ);
        const normX = inputX / inputMag;
        const normY = inputY / inputMag;
        const normZ = inputZ / inputMag;

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
        this.handleSphereCollision(pos, vel);
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
