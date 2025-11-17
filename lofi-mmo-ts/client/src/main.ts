import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { GAME_CONFIG } from '@lofi-mmo/shared';

// ============================================
// Phaser Game Configuration
// ============================================

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL if available, fallback to Canvas
  parent: 'game-container',
  width: GAME_CONFIG.WORLD_WIDTH,
  height: GAME_CONFIG.WORLD_HEIGHT,
  backgroundColor: '#2d2d2d',
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
