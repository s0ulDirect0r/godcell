// ============================================
// Client ECS - Entity Component System for Rendering
// ============================================

// Re-export core types and classes from shared
export {
  World,
  ComponentStore,
  Components,
  Tags,
  GAME_CONFIG,
  getEntityScale,
} from '@shared';
export type {
  EntityId,
  EntityScale,
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  PlayerComponent,
  StageComponent,
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  TreeComponent,
  InterpolationTargetComponent,
  ClientDamageInfoComponent,
  // Stage 3+ component types
  DataFruitComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  ProjectileComponent,
  TrapComponent,
} from '@shared';

// Client-only component types and interfaces
export { ClientComponents, ClientComponentType } from './types';
export type {
  DrainAuraComponent,
  GainAuraComponent,
  EvolutionAuraComponent,
} from './components';

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
  // Tree operations
  upsertTree,
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
  // Stage 3+ macro-resource operations
  upsertDataFruit,
  removeDataFruit,
  upsertCyberBug,
  removeCyberBug,
  updateCyberBugPosition,
  upsertJungleCreature,
  removeJungleCreature,
  updateJungleCreaturePosition,
  upsertProjectile,
  removeProjectile,
  // Trap operations (Stage 3 traps specialization)
  upsertTrap,
  removeTrap,
  // Aura component helpers
  setDrainAura,
  clearDrainAura,
  triggerGainAura,
  clearGainAura,
  setEvolutionAura,
  clearEvolutionAura,
  getDrainAura,
  getGainAura,
  getEvolutionAura,
} from './factories';

// Client-only ECS systems
export { AuraStateSystem } from './systems/AuraStateSystem';
