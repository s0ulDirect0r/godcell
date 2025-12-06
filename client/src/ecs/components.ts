// ============================================
// Client-Only ECS Components
// Visual state components not synced to server
// ============================================

import type { DamageSource, EvolutionStage } from '@shared';

/**
 * DrainAuraComponent - Visual feedback for taking damage
 *
 * Attached to entities currently being damaged.
 * AuraRenderSystem queries for this to render red glow.
 */
export interface DrainAuraComponent {
  intensity: number;        // 0-1, drives visual glow strength
  source: DamageSource;     // For color selection (red for most, orange for starvation)
  proximityFactor?: number; // 0-1, for gradient effects (gravity wells)
}

/**
 * GainAuraComponent - Visual feedback for energy gain
 *
 * Attached to entities that just gained energy.
 * Triggers a brief flash animation then auto-removes.
 *
 * Colors:
 * - 0x00ffff (cyan) for nutrient collection
 * - 0xffd700 (gold) for DataFruit collection
 * - 0xff88ff (pink) for predation energy gain
 */
export interface GainAuraComponent {
  intensity: number;   // 0-1, drives visual strength
  color: number;       // THREE.Color hex value
  triggerTime: number; // Date.now() when triggered (for animation timing)
  duration: number;    // Flash duration in ms (typically 500-600ms)
}

/**
 * EvolutionAuraComponent - Visual feedback during evolution
 *
 * Attached to entities currently evolving (molting).
 * Renders a pulsing shell/cocoon effect.
 */
export interface EvolutionAuraComponent {
  progress: number;          // 0-1, drives the visual animation
  targetStage: EvolutionStage; // The stage being evolved to
  startTime: number;         // Date.now() when evolution started
  duration: number;          // Total evolution duration in ms
}
