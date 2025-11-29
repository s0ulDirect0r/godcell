// ============================================
// ECS Package Exports
// ============================================

// Core ECS classes
export { World } from './World';
export { ComponentStore } from './Component';

// Types and constants
export { Components, Tags } from './types';
export type { EntityId, ComponentType } from './types';

// Component interfaces
export type {
  // Core components
  PositionComponent,
  VelocityComponent,
  EnergyComponent,
  // Player components
  PlayerComponent,
  StageComponent,
  InputComponent,
  SprintComponent,
  StunnedComponent,
  CooldownsComponent,
  DamageTrackingComponent,
  DrainTargetComponent,
  // Entity type components
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  // Ability components
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
  // Client-only components
  InterpolationTargetComponent,
  ClientDamageInfoComponent,
} from './components';
