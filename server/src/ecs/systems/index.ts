// ============================================
// ECS Systems - Index
// ============================================

// Types
export type { System } from './types';
export { SystemPriority } from './types';

// Runner
export { SystemRunner } from './SystemRunner';

// AI Systems
export { BotAISystem } from './BotAISystem';
export { SwarmAISystem } from './SwarmAISystem';
export { CyberBugAISystem } from './CyberBugAISystem';
export { JungleCreatureAISystem } from './JungleCreatureAISystem';
export { SpecializationSystem } from './SpecializationSystem';

// Physics Systems
export { GravitySystem } from './GravitySystem';
export { MovementSystem } from './MovementSystem';

// Ability Systems
export { PseudopodSystem } from './PseudopodSystem';
export { ProjectileSystem } from './ProjectileSystem';
export { TrapSystem } from './TrapSystem';

// Collision Systems
export { PredationSystem } from './PredationSystem';
export { SwarmCollisionSystem } from './SwarmCollisionSystem';
export { TreeCollisionSystem } from './TreeCollisionSystem';
export { NutrientCollisionSystem } from './NutrientCollisionSystem';
export { NutrientAttractionSystem } from './NutrientAttractionSystem';
export { MacroResourceCollisionSystem } from './MacroResourceCollisionSystem';

// Lifecycle Systems
export { MetabolismSystem } from './MetabolismSystem';
export { DeathSystem } from './DeathSystem';
export { DataFruitSystem } from './DataFruitSystem';

// Network Systems
export { NetworkBroadcastSystem } from './NetworkBroadcastSystem';
