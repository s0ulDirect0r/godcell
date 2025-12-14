// ============================================
// ECS Package Exports
// ============================================

// Core ECS classes
export { World } from './World';
export { ComponentStore } from './Component';

// Types and constants
export { Components, Tags, Resources } from './types';
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
  SpawnImmunityComponent,
  CooldownsComponent,
  DamageTrackingComponent,
  DrainTargetComponent,
  CombatSpecializationComponent,
  KnockbackComponent,
  // Entity type components
  NutrientComponent,
  ObstacleComponent,
  SwarmComponent,
  PseudopodComponent,
  TreeComponent,
  // Stage 3+ macro-resource components
  DataFruitComponent,
  CyberBugComponent,
  JungleCreatureComponent,
  ProjectileComponent,
  TrapComponent,
  // Ability components
  CanFireEMPComponent,
  CanFirePseudopodComponent,
  CanSprintComponent,
  CanEngulfComponent,
  CanDetectComponent,
  // Client-only components
  InterpolationTargetComponent,
  ClientDamageInfoComponent,
  // Deferred action components
  PendingRespawnComponent,
  AbilityIntentComponent,
  PendingExpirationComponent,
} from './components';
