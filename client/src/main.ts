// ============================================
// Main Entry Point - Bootstrap & Update Loop
// ============================================

import { GAME_CONFIG } from '@godcell/shared';
import { GameState } from './core/state/GameState';
import { SocketManager } from './core/net/SocketManager';
import { InputManager } from './core/input/InputManager';
import { eventBus } from './core/events/EventBus';
import { PhaserRenderer } from './render/phaser/PhaserRenderer';
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

// Track if we've captured baseline (only once after 10s)
let baselineCaptured = false;

console.log(`[Init] Renderer mode: ${flags.mode}`);

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

const renderer = new PhaserRenderer();
const container = document.getElementById('game-container')!;
renderer.init(container, GAME_CONFIG.VIEWPORT_WIDTH, GAME_CONFIG.VIEWPORT_HEIGHT);

// Wire input manager with renderer's camera projection
inputManager.setCameraProjection(renderer.getCameraProjection());

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

  // Debug overlay
  if (debugOverlay) {
    debugOverlay.update(perfMonitor.getMetrics(), flags.mode);
  }

  // Capture baseline metrics after 10 seconds (only once)
  if (flags.captureBaseline && !baselineCaptured && performance.now() > 10000) {
    perfMonitor.log();
    console.log('[Baseline] Metrics captured after 10s');
    baselineCaptured = true;
  }

  requestAnimationFrame(update);
}

// Start loop
update();
