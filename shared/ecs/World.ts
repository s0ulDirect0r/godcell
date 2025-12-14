// ============================================
// ECS World
// ============================================

import { ComponentStore } from './Component';
import type { EntityId, ComponentType } from './types';

/**
 * World - the central ECS container.
 *
 * Manages:
 * - Entity lifecycle (create, destroy)
 * - Component storage (add, get, remove)
 * - Queries (find entities with specific components)
 * - Tags (lightweight entity classification)
 */
export class World {
  private nextEntityId = 1;
  private entities = new Set<EntityId>();
  private stores = new Map<ComponentType, ComponentStore<unknown>>();
  private entityTags = new Map<EntityId, Set<string>>();

  // Resources - singleton data that isn't tied to entities
  // Examples: Time, Config, Network IO
  private resources = new Map<string, unknown>();

  // ============================================
  // Entity Lifecycle
  // ============================================

  /**
   * Create a new entity.
   * Returns the entity ID (just a number).
   */
  createEntity(): EntityId {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  /**
   * Destroy an entity and all its components.
   * Removes from all component stores and clears tags.
   */
  destroyEntity(id: EntityId): void {
    if (!this.entities.has(id)) return;

    this.entities.delete(id);

    // Remove from all component stores
    for (const store of this.stores.values()) {
      store.delete(id);
    }

    // Clear tags
    this.entityTags.delete(id);
  }

  /**
   * Check if an entity exists.
   */
  hasEntity(id: EntityId): boolean {
    return this.entities.has(id);
  }

  /**
   * Get all entity IDs.
   */
  getAllEntities(): EntityId[] {
    return Array.from(this.entities);
  }

  /**
   * Get total entity count.
   */
  get entityCount(): number {
    return this.entities.size;
  }

  // ============================================
  // Component Management
  // ============================================

  /**
   * Register a component store.
   * Must be called before using a component type.
   */
  registerStore<T>(type: ComponentType, store: ComponentStore<T>): void {
    this.stores.set(type, store as ComponentStore<unknown>);
  }

  /**
   * Get a component store by type.
   * Returns undefined if not registered.
   */
  getStore<T>(type: ComponentType): ComponentStore<T> | undefined {
    return this.stores.get(type) as ComponentStore<T> | undefined;
  }

  /**
   * Add a component to an entity.
   * Throws if component type not registered.
   */
  addComponent<T>(entity: EntityId, type: ComponentType, data: T): void {
    const store = this.stores.get(type) as ComponentStore<T>;
    if (!store) {
      throw new Error(`Component type not registered: ${type}. Call world.registerStore() first.`);
    }
    store.set(entity, data);
  }

  /**
   * Get a component from an entity.
   * Returns undefined if entity doesn't have the component.
   */
  getComponent<T>(entity: EntityId, type: ComponentType): T | undefined {
    const store = this.stores.get(type) as ComponentStore<T>;
    return store?.get(entity);
  }

  /**
   * Check if entity has a component.
   */
  hasComponent(entity: EntityId, type: ComponentType): boolean {
    const store = this.stores.get(type);
    return store?.has(entity) ?? false;
  }

  /**
   * Remove a component from an entity.
   */
  removeComponent(entity: EntityId, type: ComponentType): void {
    const store = this.stores.get(type);
    store?.delete(entity);
  }

  // ============================================
  // Queries
  // ============================================

  /**
   * Query: get all entities with ALL specified components.
   *
   * Example: world.query('Position', 'Velocity')
   * Returns entities that have BOTH Position AND Velocity.
   */
  query(...types: ComponentType[]): EntityId[] {
    const result: EntityId[] = [];

    for (const entity of this.entities) {
      if (types.every((type) => this.hasComponent(entity, type))) {
        result.push(entity);
      }
    }

    return result;
  }

  /**
   * Query with callback - avoids array allocation for hot paths.
   *
   * Example: world.queryEach(['Position', 'Velocity'], (eid) => { ... })
   */
  queryEach(types: ComponentType[], callback: (entity: EntityId) => void): void {
    for (const entity of this.entities) {
      if (types.every((type) => this.hasComponent(entity, type))) {
        callback(entity);
      }
    }
  }

  // ============================================
  // Tags (lightweight entity classification)
  // ============================================

  /**
   * Add a tag to an entity.
   * Tags are lightweight strings for quick classification.
   */
  addTag(entity: EntityId, tag: string): void {
    if (!this.entityTags.has(entity)) {
      this.entityTags.set(entity, new Set());
    }
    this.entityTags.get(entity)!.add(tag);
  }

  /**
   * Remove a tag from an entity.
   */
  removeTag(entity: EntityId, tag: string): void {
    this.entityTags.get(entity)?.delete(tag);
  }

  /**
   * Check if entity has a tag.
   */
  hasTag(entity: EntityId, tag: string): boolean {
    return this.entityTags.get(entity)?.has(tag) ?? false;
  }

  /**
   * Get all tags for an entity.
   */
  getTags(entity: EntityId): Set<string> | undefined {
    return this.entityTags.get(entity);
  }

  /**
   * Get all entities with a specific tag.
   */
  getEntitiesWithTag(tag: string): EntityId[] {
    const result: EntityId[] = [];
    for (const [entity, tags] of this.entityTags) {
      if (tags.has(tag)) {
        result.push(entity);
      }
    }
    return result;
  }

  /**
   * Iterate entities with tag via callback (avoids allocation).
   */
  forEachWithTag(tag: string, callback: (entity: EntityId) => void): void {
    for (const [entity, tags] of this.entityTags) {
      if (tags.has(tag)) {
        callback(entity);
      }
    }
  }

  /**
   * Remove a tag from all entities that have it.
   * Used for clearing transient per-tick tags.
   */
  clearTagFromAll(tag: string): void {
    for (const tags of this.entityTags.values()) {
      tags.delete(tag);
    }
  }

  // ============================================
  // Resources (singleton data)
  // ============================================

  /**
   * Set a resource value.
   * Resources are singleton data not tied to entities.
   * Examples: Time { delta, elapsed }, Config, Network IO
   */
  setResource<T>(key: string, value: T): void {
    this.resources.set(key, value);
  }

  /**
   * Get a resource value.
   * Returns undefined if not set.
   */
  getResource<T>(key: string): T | undefined {
    return this.resources.get(key) as T | undefined;
  }

  /**
   * Check if a resource exists.
   */
  hasResource(key: string): boolean {
    return this.resources.has(key);
  }

  /**
   * Delete a resource.
   */
  deleteResource(key: string): void {
    this.resources.delete(key);
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Clear all entities and components.
   * Keeps component stores registered.
   */
  clear(): void {
    this.entities.clear();
    this.entityTags.clear();
    for (const store of this.stores.values()) {
      store.clear();
    }
    this.resources.clear();
    this.nextEntityId = 1;
  }

  /**
   * Debug: get stats about the world.
   */
  getStats(): {
    entities: number;
    componentTypes: number;
    stores: Record<string, number>;
    resources: string[];
  } {
    const stores: Record<string, number> = {};
    for (const [type, store] of this.stores) {
      stores[type] = store.size;
    }
    return {
      entities: this.entities.size,
      componentTypes: this.stores.size,
      stores,
      resources: Array.from(this.resources.keys()),
    };
  }
}
