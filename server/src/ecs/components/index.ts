// ============================================
// Component Exports
// All component interfaces for the ECS
// ============================================

// Core components (shared by multiple entity types)
export type {
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
} from './core';

// Player-specific components
export type {
  PlayerComponent,
  StageComponent,
  InputComponent,
  SprintComponent,
  StunnedComponent,
  CooldownsComponent,
  DamageTrackingComponent,
  DrainTargetComponent,
} from './player';

// Entity type components
export type {
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
} from './entities';

// Ability marker components
export type {
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
} from './abilities';
