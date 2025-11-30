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

// Physics Systems
export { GravitySystem } from './GravitySystem';
export { MovementSystem } from './MovementSystem';

// Ability Systems
export { PseudopodSystem } from './PseudopodSystem';

// Collision Systems
export { PredationSystem } from './PredationSystem';
export { SwarmCollisionSystem } from './SwarmCollisionSystem';
export { NutrientCollisionSystem } from './NutrientCollisionSystem';
export { NutrientAttractionSystem } from './NutrientAttractionSystem';

// Lifecycle Systems
export { MetabolismSystem } from './MetabolismSystem';
export { DeathSystem } from './DeathSystem';

// Network Systems
export { NetworkBroadcastSystem } from './NetworkBroadcastSystem';
