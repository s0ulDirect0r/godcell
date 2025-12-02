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
  TreeComponent,
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
  // Stage 3+ components
  DataFruitComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  OrganismProjectileComponent,
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
  buildAlivePlayersRecord,
  // Direct component access by socket ID
  getPlayerBySocketId,
  hasPlayer,
  getEnergyBySocketId,
  getPositionBySocketId,
  getStageBySocketId,
  getVelocityBySocketId,
  getInputBySocketId,
  getSprintBySocketId,
  setSprintBySocketId,
  getStunnedBySocketId,
  getCooldownsBySocketId,
  getDamageTrackingBySocketId,
  isBotBySocketId,
  deletePlayerBySocketId,
  // ECS Setters - update component values directly
  setEnergyBySocketId,
  setMaxEnergyBySocketId,
  addEnergyBySocketId,
  subtractEnergyBySocketId,
  setStageBySocketId,
  setPositionBySocketId,
  movePositionBySocketId,
  clampPositionBySocketId,
  setVelocityBySocketId,
  setInputBySocketId,
  // Obstacle query helpers
  forEachObstacle,
  getObstacleZones,
  getAllObstacleSnapshots,
  getObstacleCount,
  buildObstaclesRecord,
  // Nutrient query helpers
  forEachNutrient,
  getAllNutrientSnapshots,
  getNutrientPosition,
  getNutrientCount,
  buildNutrientsRecord,
  // Swarm query helpers
  forEachSwarm,
  getAllSwarmSnapshots,
  getSwarmCount,
  getSwarmEntity,
  getSwarmComponents,
  buildSwarmsRecord,
  // DrainTarget helpers (prey-predator drain relationships)
  setDrainTarget,
  clearDrainTarget,
  hasDrainTarget,
  getDrainPredatorId,
  forEachDrainTarget,
  // Damage tracking helpers
  recordDamage,
  // Tree query helpers
  createTree,
  forEachTree,
  getAllTreeSnapshots,
  getTreeCount,
  buildTreesRecord,
  // DataFruit query helpers (Stage 3+)
  createDataFruitOnGround,
  createDataFruit,
  forEachDataFruit,
  getAllDataFruitSnapshots,
  buildDataFruitsRecord,
  // CyberBug query helpers (Stage 3+)
  createCyberBug,
  forEachCyberBug,
  getAllCyberBugSnapshots,
  buildCyberBugsRecord,
  // JungleCreature query helpers (Stage 3+)
  createJungleCreature,
  forEachJungleCreature,
  getAllJungleCreatureSnapshots,
  buildJungleCreaturesRecord,
  // OrganismProjectile query helpers (Stage 3+)
  createOrganismProjectile,
  forEachOrganismProjectile,
  getAllOrganismProjectileSnapshots,
  buildOrganismProjectilesRecord,
} from './factories';
export type {
  PlayerSnapshot,
  NutrientSnapshot,
  ObstacleSnapshot,
  SwarmSnapshot,
  TreeSnapshot,
  DataFruitSnapshot,
  CyberBugSnapshot,
  JungleCreatureSnapshot,
  OrganismProjectileSnapshot,
} from './factories';

// Systems
export * from './systems';

// Serialization (ECS to network message conversion)
export * from './serialization';
