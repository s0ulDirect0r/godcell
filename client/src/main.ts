// ============================================
// Main Entry Point - Bootstrap & Update Loop
// ============================================

import { GAME_CONFIG } from '@godcell/shared';
import { GameState } from './core/state/GameState';
import { SocketManager } from './core/net/SocketManager';
import { InputManager } from './core/input/InputManager';
import { eventBus } from './core/events/EventBus';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { PerformanceMonitor } from './utils/performance';
import { DebugOverlay } from './ui/DebugOverlay';
import { HUDOverlay } from './render/hud/HUDOverlay';
import { DevPanel } from './ui/DevPanel';

// ============================================
// Performance Monitoring
// ============================================

const perfMonitor = new PerformanceMonitor();
let debugOverlay: DebugOverlay | null = null;

// Show debug overlay if ?debug in URL
if (new URLSearchParams(window.location.search).has('debug')) {
  debugOverlay = new DebugOverlay();
}

console.log('[Init] Using Three.js renderer');

// ============================================
// Initialize Core Systems
// ============================================

const gameState = new GameState();
const inputManager = new InputManager();

// Determine server URL based on whether we're running on localhost
const serverUrl = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : window.location.origin;

const socketManager = new SocketManager(serverUrl, gameState);

// ============================================
// Initialize Renderer
// ============================================

const renderer = new ThreeRenderer();
const container = document.getElementById('game-container')!;
renderer.init(container, GAME_CONFIG.VIEWPORT_WIDTH, GAME_CONFIG.VIEWPORT_HEIGHT);

// Wire input manager with renderer's camera projection
inputManager.setCameraProjection(renderer.getCameraProjection());

// Initialize HUD overlay
const hudOverlay = new HUDOverlay();

// Initialize Dev Panel if ?dev in URL
let devPanel: DevPanel | null = null;
if (new URLSearchParams(window.location.search).has('dev')) {
  devPanel = new DevPanel({
    socket: socketManager.getSocket(),
    gameState,
    renderer,
  });
  console.log('[Dev] Dev panel enabled - press H to toggle');
}

// ============================================
// Wire Input Handlers to Network
// ============================================

// Forward movement input to server
eventBus.on('client:inputMove', (event) => {
  socketManager.sendMove(event.direction);
});

// Forward respawn input to server
eventBus.on('client:inputRespawn', () => {
  socketManager.sendRespawn();
});

// Forward EMP activation to server
eventBus.on('client:empActivate', () => {
  socketManager.sendEMPActivate();
});

// Forward pseudopod beam fire to server
eventBus.on('client:pseudopodFire', (event) => {
  socketManager.sendPseudopodFire(event.targetX, event.targetY);
});

// Dev panel toggle (H key)
if (devPanel) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      devPanel?.toggle();
    }
  });
}

// ============================================
// Main Update Loop
// ============================================

function update(): void {
  const dt = 16; // Approx 60fps

  perfMonitor.tick();

  // Update systems
  inputManager.update(dt);

  // Render
  renderer.render(gameState, dt);

  // Update HUD
  hudOverlay.update(gameState);

  // Debug overlay
  if (debugOverlay) {
    debugOverlay.update(perfMonitor.getMetrics(), 'three-only');
  }

  requestAnimationFrame(update);
}

// Start loop
update();
