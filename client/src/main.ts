/**
 * GODCELL - Entry point
 * Now using Three.js with renderer-agnostic architecture
 */

import { bootstrap } from './app/bootstrap';
import './style.css';

// Get game container
const container = document.getElementById('game-container');

if (!container) {
  throw new Error('Game container not found');
}

// Bootstrap the game
bootstrap(container);
