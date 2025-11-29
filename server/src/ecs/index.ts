// ============================================
// ECS - Entity Component System
// ============================================

// Core types, classes, and components from shared package
export {
  World,
  ComponentStore,
  Components,
  Tags,
} from '@godcell/shared';
export type {
  EntityId,
  ComponentType,
  // Component interfaces
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  PlayerComponent,
  StageComponent,
  InputComponent,
  SprintComponent,
  StunnedComponent,
  CooldownsComponent,
  DamageTrackingComponent,
  DrainTargetComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
} from '@godcell/shared';

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
  // Query helpers
  getAllPlayerEntities,
  forEachPlayer,
  getPlayerSnapshot,
  entityToLegacyPlayer,
  buildPlayersRecord,
} from './factories';
export type { PlayerSnapshot } from './factories';

// Systems
export * from './systems';

// Serialization (ECS to network message conversion)
export * from './serialization';
