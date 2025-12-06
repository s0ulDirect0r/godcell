// ============================================
// AuraStateSystem - Client-Side Aura Component Manager
// Detects conditions and manages aura ECS components
// ============================================

import type { World, EntityId, ClientDamageInfoComponent, StageComponent, EnergyComponent } from '#shared';
import { Components, Tags, GAME_CONFIG } from '#shared';
import { ClientComponents } from '../types';
import type { GainAuraComponent, EvolutionAuraComponent } from '../components';
import {
  setDrainAura,
  clearDrainAura,
  triggerGainAura,
  clearGainAura,
  setEvolutionAura,
  clearEvolutionAura,
  getEntityByStringId,
} from '../factories';

/**
 * AuraStateSystem - Detects conditions and manages aura components
 *
 * Responsibilities:
 * 1. Drain Auras: Query ClientDamageInfo, create/remove DrainAuraComponent
 * 2. Gain Auras: Compare energy frames + event-driven triggers, manage GainAuraComponent
 * 3. Evolution Auras: Query isEvolving state, manage EvolutionAuraComponent
 *
 * This is a client-only system that runs before rendering to prepare aura state.
 * AuraRenderSystem then queries these components for rendering.
 */
export class AuraStateSystem {
  // Previous energy tracking for continuous gain detection
  private previousEnergy: Map<EntityId, number> = new Map();

  // Track entities with active gain auras for timeout cleanup
  private gainAuraEntities: Set<EntityId> = new Set();

  /**
   * Update aura components based on entity state
   * Call this each frame before AuraRenderSystem
   */
  update(world: World, _deltaTime: number): void {
    this.updateDrainAuras(world);
    this.updateGainAuras(world);
    this.updateEvolutionAuras(world);
  }

  /**
   * Update drain auras based on ClientDamageInfo components
   * State-driven: entity has damage → entity has drain aura
   */
  private updateDrainAuras(world: World): void {
    // Track which entities currently have damage
    const entitiesWithDamage = new Set<EntityId>();

    // Process players with ClientDamageInfo
    world.forEachWithTag(Tags.Player, (entity) => {
      const damageInfo = world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);

      if (damageInfo && damageInfo.totalDamageRate > 0) {
        entitiesWithDamage.add(entity);

        // Calculate intensity from damage rate (0-1)
        // Using same formula as existing AuraEffect
        const intensity = Math.min(1.0, damageInfo.totalDamageRate / 100);

        setDrainAura(world, entity, intensity, damageInfo.primarySource, damageInfo.proximityFactor);
      }
    });

    // Process swarms with ClientDamageInfo (when being consumed by EMP)
    world.forEachWithTag(Tags.Swarm, (entity) => {
      const damageInfo = world.getComponent<ClientDamageInfoComponent>(entity, Components.ClientDamageInfo);

      if (damageInfo && damageInfo.totalDamageRate > 0) {
        entitiesWithDamage.add(entity);

        const intensity = Math.min(1.0, damageInfo.totalDamageRate / 100);
        setDrainAura(world, entity, intensity, damageInfo.primarySource, damageInfo.proximityFactor);
      }
    });

    // Remove drain auras from entities that no longer have damage
    // Query all entities with DrainAura and check if they still have damage
    world.forEachWithTag(Tags.Player, (entity) => {
      if (!entitiesWithDamage.has(entity)) {
        if (world.hasComponent(entity, ClientComponents.DrainAura)) {
          clearDrainAura(world, entity);
        }
      }
    });

    world.forEachWithTag(Tags.Swarm, (entity) => {
      if (!entitiesWithDamage.has(entity)) {
        if (world.hasComponent(entity, ClientComponents.DrainAura)) {
          clearDrainAura(world, entity);
        }
      }
    });
  }

  /**
   * Update gain auras based on energy changes
   * State-driven: compare energy each frame for continuous gains
   *
   * Note: Event-driven triggers (fruit collection) are handled externally
   * via triggerGainAuraForEntity()
   */
  private updateGainAuras(world: World): void {
    const now = Date.now();

    // Detect energy gains and trigger gain auras
    world.forEachWithTag(Tags.Player, (entity) => {
      const energy = world.getComponent<EnergyComponent>(entity, Components.Energy);
      if (!energy) return;

      const prevEnergy = this.previousEnergy.get(entity) ?? energy.current;
      const energyGain = energy.current - prevEnergy;

      // Trigger cyan gain aura if energy increased (threshold prevents float noise)
      if (energyGain > 0.1) {
        // Calculate intensity from energy gain rate
        const intensity = Math.min(1.0, 0.3 + energyGain / 50);

        // Trigger cyan aura (0x00ffff) for standard energy gains
        triggerGainAura(world, entity, intensity, 0x00ffff, 500);
        this.gainAuraEntities.add(entity);
      }

      // Store current energy for next frame comparison
      this.previousEnergy.set(entity, energy.current);
    });

    // Cleanup expired gain auras
    this.gainAuraEntities.forEach((entity) => {
      const gainAura = world.getComponent<GainAuraComponent>(entity, ClientComponents.GainAura);
      if (gainAura) {
        const elapsed = now - gainAura.triggerTime;
        if (elapsed >= gainAura.duration) {
          clearGainAura(world, entity);
          this.gainAuraEntities.delete(entity);
        }
      } else {
        // Component was removed externally
        this.gainAuraEntities.delete(entity);
      }
    });

    // Cleanup previous energy for dead entities
    this.previousEnergy.forEach((_, entity) => {
      if (!world.hasTag(entity, Tags.Player)) {
        this.previousEnergy.delete(entity);
      }
    });
  }

  /**
   * Update evolution auras based on isEvolving state
   * State-driven: entity is evolving → entity has evolution aura
   */
  private updateEvolutionAuras(world: World): void {
    world.forEachWithTag(Tags.Player, (entity) => {
      const stage = world.getComponent<StageComponent>(entity, Components.Stage);
      if (!stage) return;

      if (stage.isEvolving) {
        // Check if we already have an evolution aura
        const existingAura = world.getComponent<EvolutionAuraComponent>(entity, ClientComponents.EvolutionAura);

        if (!existingAura) {
          // Start evolution aura (we don't know target stage, use next stage logic)
          // The evolution duration comes from GAME_CONFIG
          setEvolutionAura(world, entity, stage.stage, GAME_CONFIG.EVOLUTION_MOLTING_DURATION);
        } else {
          // Update progress
          const elapsed = Date.now() - existingAura.startTime;
          existingAura.progress = Math.min(1.0, elapsed / existingAura.duration);
        }
      } else {
        // Not evolving - remove aura if it exists
        if (world.hasComponent(entity, ClientComponents.EvolutionAura)) {
          clearEvolutionAura(world, entity);
        }
      }
    });
  }

  /**
   * Trigger a gold gain aura for fruit collection (event-driven)
   * Called externally when dataFruitCollected event fires
   */
  triggerFruitCollectionAura(world: World, entityId: string): void {
    const entity = this.getEntityFromStringId(world, entityId);
    if (entity === undefined) {
      return;
    }

    // Trigger gold aura for fruit collection
    triggerGainAura(world, entity, 0.8, 0xffd700, 600);
    this.gainAuraEntities.add(entity);
  }

  /**
   * Helper to get entity from string ID
   * Uses the lookup table from factories
   */
  private getEntityFromStringId(_world: World, stringId: string): EntityId | undefined {
    return getEntityByStringId(stringId);
  }

  /**
   * Clear all state (for mode transitions or cleanup)
   */
  clearAll(world: World): void {
    // Clear all drain auras
    world.forEachWithTag(Tags.Player, (entity) => {
      if (world.hasComponent(entity, ClientComponents.DrainAura)) {
        clearDrainAura(world, entity);
      }
      if (world.hasComponent(entity, ClientComponents.GainAura)) {
        clearGainAura(world, entity);
      }
      if (world.hasComponent(entity, ClientComponents.EvolutionAura)) {
        clearEvolutionAura(world, entity);
      }
    });

    world.forEachWithTag(Tags.Swarm, (entity) => {
      if (world.hasComponent(entity, ClientComponents.DrainAura)) {
        clearDrainAura(world, entity);
      }
    });

    this.previousEnergy.clear();
    this.gainAuraEntities.clear();
  }
}
