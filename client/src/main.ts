import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { GAME_CONFIG } from '@godcell/shared';
import { PerformanceMonitor } from './utils/performance';
import { getRendererFlags } from './config/renderer-flags';
import { DebugOverlay } from './ui/DebugOverlay';

// ============================================
// Performance Monitoring & Renderer Flags
// ============================================

const flags = getRendererFlags();
const perfMonitor = new PerformanceMonitor();
let debugOverlay: DebugOverlay | null = null;

if (flags.showDebugOverlay) {
  debugOverlay = new DebugOverlay();
}

console.log(`[Init] Renderer mode: ${flags.mode}`);

// Track if we've captured baseline (only once after 10s)
let baselineCaptured = false;

// ============================================
// Phaser Game Configuration
// ============================================

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL if available, fallback to Canvas
  parent: 'game-container',
  width: GAME_CONFIG.VIEWPORT_WIDTH,
  height: GAME_CONFIG.VIEWPORT_HEIGHT,
  backgroundColor: GAME_CONFIG.BACKGROUND_COLOR, // Deep void
  scene: [GameScene],
  physics: {
    default: 'arcade', // Simple physics system
    arcade: {
      debug: false,
    },
  },
};

// Start the game
const game = new Phaser.Game(config);

// Hook into Phaser's game loop for performance monitoring
game.events.on('step', () => {
  perfMonitor.tick();

  if (debugOverlay) {
    debugOverlay.update(perfMonitor.getMetrics(), flags.mode);
  }

  // Capture baseline metrics after 10 seconds (only once)
  if (flags.captureBaseline && !baselineCaptured && performance.now() > 10000) {
    perfMonitor.log();
    console.log('[Baseline] Metrics captured after 10s');
    baselineCaptured = true;
  }
});
