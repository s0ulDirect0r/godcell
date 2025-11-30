// ============================================
// Client ECS - Entity Component System for Rendering
// ============================================

// Re-export core types and classes from shared
export {
  World,
  ComponentStore,
  Components,
  Tags,
} from '@godcell/shared';
export type {
  EntityId,
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  PlayerComponent,
  StageComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  InterpolationTargetComponent,
  ClientDamageInfoComponent,
} from '@godcell/shared';

// Client-specific factories and helpers
export {
  // World setup
  createClientWorld,
  // Lookup helpers
  getEntityByStringId,
  getStringIdByEntity,
  unregisterEntity,
  clearLookups,
  // Local player management
  setLocalPlayer,
  clearLocalPlayer,
  getLocalPlayerEntity,
  getLocalPlayerId,
  getLocalPlayer,
  // Player operations
  upsertPlayer,
  updatePlayerTarget,
  removePlayer,
  updatePlayerEnergy,
  setPlayerEvolving,
  updatePlayerEvolved,
  getPlayer,
  hasPlayer,
  getPlayerEnergy,
  getPlayerStage,
  forEachPlayer,
  // Nutrient operations
  upsertNutrient,
  updateNutrientPosition,
  removeNutrient,
  // Obstacle operations
  upsertObstacle,
  // Swarm operations
  upsertSwarm,
  updateSwarmTarget,
  removeSwarm,
  // Pseudopod operations
  upsertPseudopod,
  updatePseudopodPosition,
  removePseudopod,
  // Damage info
  setPlayerDamageInfo,
  clearPlayerDamageInfo,
  setSwarmDamageInfo,
} from './factories';
