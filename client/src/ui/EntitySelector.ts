// ============================================
// Entity Selector - Click-to-select entities
// Converts screen clicks to world coords and finds nearest entity
// ============================================

import {
  type World,
  type EntityId,
  Components,
  Tags,
  type PositionComponent,
  type StageComponent,
  type SwarmComponent,
  type ObstacleComponent,
  type NutrientComponent,
} from '#shared';
import { getStringIdByEntity } from '../ecs';
import type { ThreeRenderer } from '../render/three/ThreeRenderer';

// ============================================
// Types
// ============================================

export interface EntitySelectorOptions {
  world: World;
  renderer: ThreeRenderer;
  onSelect: (entityId: EntityId, stringId: string | null) => void;
}

interface EntityCandidate {
  entityId: EntityId;
  stringId: string | null;
  distance: number;
  radius: number;
}

// ============================================
// Entity Selector Class
// ============================================

export class EntitySelector {
  private world: World;
  private renderer: ThreeRenderer;
  private onSelect: (entityId: EntityId, stringId: string | null) => void;
  private enabled = false;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(options: EntitySelectorOptions) {
    this.world = options.world;
    this.renderer = options.renderer;
    this.onSelect = options.onSelect;
  }

  // ----------------------------------------
  // Public API
  // ----------------------------------------

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.clickHandler = (e: MouseEvent) => {
      // Only handle left clicks, and not if modifier keys are pressed
      if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

      // Don't intercept clicks on UI elements
      const target = e.target as HTMLElement;
      if (target.closest('#dev-panel') || target.closest('#ecs-xray-panel')) return;

      this.handleClick(e);
    };

    // Use capture phase to get the event before other handlers
    window.addEventListener('click', this.clickHandler, { capture: false });
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.clickHandler) {
      window.removeEventListener('click', this.clickHandler, { capture: false });
      this.clickHandler = null;
    }
  }

  dispose(): void {
    this.disable();
  }

  // ----------------------------------------
  // Click Handling
  // ----------------------------------------

  private handleClick(e: MouseEvent): void {
    const cameraProjection = this.renderer.getCameraProjection();
    const worldPos = cameraProjection.screenToWorld(e.clientX, e.clientY);

    const nearest = this.findNearestEntity(worldPos.x, worldPos.y);
    if (nearest) {
      this.onSelect(nearest.entityId, nearest.stringId);
    }
  }

  private findNearestEntity(worldX: number, worldY: number): EntityCandidate | null {
    const candidates: EntityCandidate[] = [];
    const clickTolerance = 30; // Extra pixels of tolerance for clicking

    // Helper to add entity candidates
    const addCandidate = (entity: EntityId, radius: number) => {
      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      if (!pos) return;

      const dx = pos.x - worldX;
      const dy = pos.y - worldY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Only consider if click is within radius + tolerance
      if (distance <= radius + clickTolerance) {
        candidates.push({
          entityId: entity,
          stringId: getStringIdByEntity(entity) ?? null,
          distance,
          radius,
        });
      }
    };

    // Check all entity types

    // Players (including bots)
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const stage = this.world.getComponent<StageComponent>(entity, Components.Stage);
      const radius = stage?.radius ?? 20;
      addCandidate(entity, radius);
    });

    // Swarms
    this.world.forEachWithTag(Tags.Swarm, (entity) => {
      const swarm = this.world.getComponent<SwarmComponent>(entity, Components.Swarm);
      const radius = swarm?.size ?? 15;
      addCandidate(entity, radius);
    });

    // Nutrients
    this.world.forEachWithTag(Tags.Nutrient, (entity) => {
      addCandidate(entity, 15); // Fixed size for nutrients
    });

    // Obstacles (gravity wells)
    this.world.forEachWithTag(Tags.Obstacle, (entity) => {
      const obstacle = this.world.getComponent<ObstacleComponent>(entity, Components.Obstacle);
      const radius = obstacle?.radius ?? 100;
      addCandidate(entity, radius);
    });

    // Trees
    this.world.forEachWithTag(Tags.Tree, (entity) => {
      addCandidate(entity, 50); // Approximate tree size
    });

    // Pseudopods
    this.world.forEachWithTag(Tags.Pseudopod, (entity) => {
      addCandidate(entity, 20);
    });

    // Data Fruits
    this.world.forEachWithTag(Tags.DataFruit, (entity) => {
      addCandidate(entity, 20);
    });

    // Cyber Bugs
    this.world.forEachWithTag(Tags.CyberBug, (entity) => {
      addCandidate(entity, 15);
    });

    // Jungle Creatures
    this.world.forEachWithTag(Tags.JungleCreature, (entity) => {
      addCandidate(entity, 40);
    });

    // Entropy Serpents
    this.world.forEachWithTag(Tags.EntropySerpent, (entity) => {
      addCandidate(entity, 60);
    });

    // Projectiles
    this.world.forEachWithTag(Tags.Projectile, (entity) => {
      addCandidate(entity, 15);
    });

    // Traps
    this.world.forEachWithTag(Tags.Trap, (entity) => {
      addCandidate(entity, 20);
    });

    // Return the closest candidate
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0];
  }
}
