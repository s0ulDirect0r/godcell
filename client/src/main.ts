import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { GAME_CONFIG } from '@godcell/shared';

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
new Phaser.Game(config);
