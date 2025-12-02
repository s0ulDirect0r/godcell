// ============================================
// Client-Only ECS Types
// Component types for client-only visual components
// ============================================

/**
 * Client-only component types (extend shared ComponentType pattern)
 *
 * These are registered in createClientWorld() and used for visual
 * feedback that doesn't need to be synced to the server.
 */
export enum ClientComponentType {
  DrainAura = 'DrainAura',
  GainAura = 'GainAura',
  EvolutionAura = 'EvolutionAura',
}

/**
 * ClientComponents - convenience object for component type access
 * Mirrors the shared Components pattern for consistency.
 */
export const ClientComponents = {
  DrainAura: ClientComponentType.DrainAura,
  GainAura: ClientComponentType.GainAura,
  EvolutionAura: ClientComponentType.EvolutionAura,
} as const;
