// ============================================
// Component Store
// ============================================

import type { EntityId } from './types';

/**
 * ComponentStore - a typed Map wrapper for storing component data.
 * Each component type gets its own store: Map<EntityId, ComponentData>
 *
 * Generic parameter T is the component data shape (e.g., PositionComponent).
 */
export class ComponentStore<T> {
  private data = new Map<EntityId, T>();

  /**
   * Set component data for an entity.
   * Overwrites existing data if present.
   */
  set(entity: EntityId, value: T): void {
    this.data.set(entity, value);
  }

  /**
   * Get component data for an entity.
   * Returns undefined if entity doesn't have this component.
   */
  get(entity: EntityId): T | undefined {
    return this.data.get(entity);
  }

  /**
   * Check if entity has this component.
   */
  has(entity: EntityId): boolean {
    return this.data.has(entity);
  }

  /**
   * Remove component from entity.
   */
  delete(entity: EntityId): void {
    this.data.delete(entity);
  }

  /**
   * Iterate over all (entityId, data) pairs.
   */
  entries(): IterableIterator<[EntityId, T]> {
    return this.data.entries();
  }

  /**
   * Iterate over all component data values.
   */
  values(): IterableIterator<T> {
    return this.data.values();
  }

  /**
   * Iterate over all entity IDs that have this component.
   */
  keys(): IterableIterator<EntityId> {
    return this.data.keys();
  }

  /**
   * Number of entities with this component.
   */
  get size(): number {
    return this.data.size;
  }

  /**
   * Clear all component data.
   */
  clear(): void {
    this.data.clear();
  }
}
