/**
 * HUD view model - derives display-ready HUD data from GameState.
 * Pure functions, no side effects, no DOM manipulation.
 */

import type { GameState } from '../state/GameState';
import { getLocalPlayer } from '../state/selectors';
import { formatCountdown } from '../sim/timers';
import { EvolutionStage } from '@godcell/shared';

/**
 * HUD data ready for rendering
 */
export interface HUDData {
  // Health & Energy
  health: number;
  maxHealth: number;
  healthPercent: number;
  healthText: string;

  energy: number;
  maxEnergy: number;
  energyPercent: number;
  energyText: string;

  // Evolution
  stage: EvolutionStage;
  stageText: string;
  isEvolving: boolean;

  // Status
  isAlive: boolean;
  isDead: boolean;

  // Countdown (starvation timer)
  countdownText: string | null;
  showCountdown: boolean;
}

/**
 * Derive HUD data from game state
 */
export function deriveHUD(state: GameState): HUDData {
  const localPlayer = getLocalPlayer(state);

  // Default HUD (no local player)
  if (!localPlayer) {
    return {
      health: 0,
      maxHealth: 100,
      healthPercent: 0,
      healthText: '0 / 100',
      energy: 0,
      maxEnergy: 100,
      energyPercent: 0,
      energyText: '0 / 100',
      stage: EvolutionStage.SINGLE_CELL,
      stageText: formatStage(EvolutionStage.SINGLE_CELL),
      isEvolving: false,
      isAlive: false,
      isDead: true,
      countdownText: null,
      showCountdown: false,
    };
  }

  // Calculate percentages
  const healthPercent = (localPlayer.health / localPlayer.maxHealth) * 100;
  const energyPercent = (localPlayer.energy / localPlayer.maxEnergy) * 100;

  // Health text
  const healthText = `${Math.floor(localPlayer.health)} / ${Math.floor(localPlayer.maxHealth)}`;

  // Energy text
  const energyText = `${Math.floor(localPlayer.energy)} / ${Math.floor(localPlayer.maxEnergy)}`;

  // Stage text
  const stageText = formatStage(localPlayer.stage);

  // Countdown timer (if starving)
  const isStarving = localPlayer.energy <= 0 && localPlayer.health > 0;
  const starvationTimeRemaining = isStarving ? localPlayer.health / 5 : 0; // 5 damage/second
  const countdownText = isStarving ? formatCountdown(starvationTimeRemaining) : null;

  return {
    health: localPlayer.health,
    maxHealth: localPlayer.maxHealth,
    healthPercent: Math.max(0, Math.min(100, healthPercent)),
    healthText,
    energy: localPlayer.energy,
    maxEnergy: localPlayer.maxEnergy,
    energyPercent: Math.max(0, Math.min(100, energyPercent)),
    energyText,
    stage: localPlayer.stage,
    stageText,
    isEvolving: localPlayer.isEvolving,
    isAlive: localPlayer.health > 0,
    isDead: localPlayer.health <= 0,
    countdownText,
    showCountdown: isStarving,
  };
}

/**
 * Format evolution stage as display text
 */
export function formatStage(stage: EvolutionStage): string {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return 'Single Cell';
    case EvolutionStage.MULTI_CELL:
      return 'Multi-Cell';
    case EvolutionStage.CYBER_ORGANISM:
      return 'Cyber Organism';
    case EvolutionStage.HUMANOID:
      return 'Humanoid';
    case EvolutionStage.GODCELL:
      return 'GODCELL';
    default:
      return 'Unknown';
  }
}

/**
 * Format energy with decimal places
 */
export function formatEnergy(energy: number, decimalPlaces = 0): string {
  return energy.toFixed(decimalPlaces);
}

/**
 * Format health with decimal places
 */
export function formatHealth(health: number, decimalPlaces = 0): string {
  return health.toFixed(decimalPlaces);
}
