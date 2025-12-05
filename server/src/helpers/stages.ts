// ============================================
// Stage Helpers
// Evolution stage configuration and lookups
// ============================================

import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import { getConfig } from '../dev';

/**
 * World bounds for each scale of existence
 */
export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Get max energy for evolution stage
 * Energy-only system: this is the full health+energy pool combined
 */
export function getStageMaxEnergy(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return GAME_CONFIG.SINGLE_CELL_MAX_ENERGY;
    case EvolutionStage.MULTI_CELL:
      return GAME_CONFIG.MULTI_CELL_MAX_ENERGY;
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.CYBER_ORGANISM_MAX_ENERGY;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.HUMANOID_MAX_ENERGY;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.GODCELL_MAX_ENERGY;
  }
}

/**
 * Get energy decay rate based on evolution stage (metabolic efficiency)
 */
export function getEnergyDecayRate(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return getConfig('SINGLE_CELL_ENERGY_DECAY_RATE');
    case EvolutionStage.MULTI_CELL:
      return getConfig('MULTI_CELL_ENERGY_DECAY_RATE');
    case EvolutionStage.CYBER_ORGANISM:
      return getConfig('CYBER_ORGANISM_ENERGY_DECAY_RATE');
    case EvolutionStage.HUMANOID:
      return getConfig('HUMANOID_ENERGY_DECAY_RATE');
    case EvolutionStage.GODCELL:
      return getConfig('GODCELL_ENERGY_DECAY_RATE');
  }
}

/**
 * Get player collision radius based on evolution stage
 * Returns radius for hitbox calculations
 *
 * @deprecated For most usages, prefer reading radius from StageComponent.radius instead.
 * This function is now only used by server/src/ecs/factories.ts when creating entities
 * or updating stage on evolution. All systems should read from stageComp.radius directly.
 */
export function getPlayerRadius(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return GAME_CONFIG.SINGLE_CELL_RADIUS;
    case EvolutionStage.MULTI_CELL:
      return GAME_CONFIG.MULTI_CELL_RADIUS;
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.CYBER_ORGANISM_RADIUS;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.HUMANOID_RADIUS;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.GODCELL_RADIUS;
  }
}

/**
 * Get world bounds based on evolution stage
 * Soup players (Stage 1-2) are confined to the soup region
 * Jungle players (Stage 3+) can roam the full jungle
 */
export function getWorldBoundsForStage(stage: EvolutionStage): WorldBounds {
  if (stage === EvolutionStage.SINGLE_CELL || stage === EvolutionStage.MULTI_CELL) {
    // Soup bounds (centered region within jungle)
    return {
      minX: GAME_CONFIG.SOUP_ORIGIN_X,
      minY: GAME_CONFIG.SOUP_ORIGIN_Y,
      maxX: GAME_CONFIG.SOUP_ORIGIN_X + GAME_CONFIG.SOUP_WIDTH,
      maxY: GAME_CONFIG.SOUP_ORIGIN_Y + GAME_CONFIG.SOUP_HEIGHT,
    };
  } else {
    // Jungle bounds (full world)
    return {
      minX: 0,
      minY: 0,
      maxX: GAME_CONFIG.JUNGLE_WIDTH,
      maxY: GAME_CONFIG.JUNGLE_HEIGHT,
    };
  }
}

/**
 * Check if a stage is soup-scale (Stage 1-2)
 */
export function isSoupStage(stage: EvolutionStage): boolean {
  return stage === EvolutionStage.SINGLE_CELL || stage === EvolutionStage.MULTI_CELL;
}

/**
 * Check if a stage is jungle-scale (Stage 3+)
 */
export function isJungleStage(stage: EvolutionStage): boolean {
  return !isSoupStage(stage);
}

/**
 * Get energy values for an evolution stage (for dev tools)
 * Uses getConfig() to respect runtime config overrides from dev panel
 */
export function getStageEnergy(stage: EvolutionStage): { energy: number; maxEnergy: number } {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return {
        energy: getConfig('SINGLE_CELL_ENERGY'),
        maxEnergy: getConfig('SINGLE_CELL_MAX_ENERGY'),
      };
    case EvolutionStage.MULTI_CELL:
      return {
        energy: getConfig('MULTI_CELL_ENERGY'),
        maxEnergy: getConfig('MULTI_CELL_MAX_ENERGY'),
      };
    case EvolutionStage.CYBER_ORGANISM:
      return {
        energy: getConfig('CYBER_ORGANISM_ENERGY'),
        maxEnergy: getConfig('CYBER_ORGANISM_MAX_ENERGY'),
      };
    case EvolutionStage.HUMANOID:
      return {
        energy: getConfig('HUMANOID_ENERGY'),
        maxEnergy: getConfig('HUMANOID_MAX_ENERGY'),
      };
    case EvolutionStage.GODCELL:
      return {
        energy: getConfig('GODCELL_ENERGY'),
        maxEnergy: getConfig('GODCELL_MAX_ENERGY'),
      };
  }
}

/**
 * Get next evolution stage and required maxEnergy threshold
 */
export function getNextEvolutionStage(currentStage: EvolutionStage): { stage: EvolutionStage; threshold: number } | null {
  switch (currentStage) {
    case EvolutionStage.SINGLE_CELL:
      return { stage: EvolutionStage.MULTI_CELL, threshold: getConfig('EVOLUTION_MULTI_CELL') };
    case EvolutionStage.MULTI_CELL:
      return { stage: EvolutionStage.CYBER_ORGANISM, threshold: getConfig('EVOLUTION_CYBER_ORGANISM') };
    case EvolutionStage.CYBER_ORGANISM:
      return { stage: EvolutionStage.HUMANOID, threshold: getConfig('EVOLUTION_HUMANOID') };
    case EvolutionStage.HUMANOID:
      return { stage: EvolutionStage.GODCELL, threshold: getConfig('EVOLUTION_GODCELL') };
    case EvolutionStage.GODCELL:
      return null; // Already at max stage
  }
}
