// ============================================
// ECS - Entity Component System
// ============================================

// Core
export { World } from './World';
export { ComponentStore } from './Component';
export type { EntityId, ComponentType } from './types';
export { Components, Tags } from './types';

// Components
export * from './components';

// Factories and World Setup
export {
  createWorld,
  createPlayer,
  createBot,
  createNutrient,
  createObstacle,
  createSwarm,
  createPseudopod,
  setPlayerStage,
  destroyEntity,
  clearLookups,
  getEntityBySocketId,
  getSocketIdByEntity,
  getEntityByStringId,
  getStringIdByEntity,
  unregisterEntity,
} from './factories';
