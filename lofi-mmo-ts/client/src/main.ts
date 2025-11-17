import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { GAME_CONFIG } from '@lofi-mmo/shared';

// ============================================
// Phaser Game Configuration
// ============================================

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL if available, fallback to Canvas
  parent: 'game-container',
  width: 1200,  // Viewport width (what you see on screen)
  height: 800,  // Viewport height (what you see on screen)
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
