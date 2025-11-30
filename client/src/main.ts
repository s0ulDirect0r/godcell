// ============================================
// Main Entry Point - Bootstrap & Update Loop
// ============================================

import { GAME_CONFIG, EvolutionStage } from '@godcell/shared';
import { GameState } from './core/state/GameState';
import { SocketManager } from './core/net/SocketManager';
import { InputManager } from './core/input/InputManager';
import { eventBus } from './core/events/EventBus';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { PerformanceMonitor } from './utils/performance';
import { DebugOverlay } from './ui/DebugOverlay';
import { HUDOverlay } from './render/hud/HUDOverlay';
import { DevPanel } from './ui/DevPanel';
import { StartScreen, type PreGameSettings } from './ui/StartScreen';

// ============================================
// URL Flags
// ============================================

const urlParams = new URLSearchParams(window.location.search);
const devMode = urlParams.has('dev');
const debugMode = urlParams.has('debug');

// ============================================
// Game State (initialized on start)
// ============================================

let gameState: GameState;
let socketManager: SocketManager;
let inputManager: InputManager;
let renderer: ThreeRenderer;
let hudOverlay: HUDOverlay;
let devPanel: DevPanel | null = null;
let debugOverlay: DebugOverlay | null = null;
let perfMonitor: PerformanceMonitor;
let gameStarted = false;

// ============================================
// Start Screen
// ============================================

new StartScreen({
  devMode,
  onStart: (settings: PreGameSettings) => {
    initializeGame(settings);
  },
});

// ============================================
// Game Initialization (called when player clicks Enter)
// ============================================

function initializeGame(settings: PreGameSettings): void {
  if (gameStarted) return;
  gameStarted = true;

  console.log('[Init] Starting GODCELL...');
  if (settings.playgroundMode) {
    console.log('[Init] Playground mode enabled');
  }
  if (settings.pauseOnStart) {
    console.log('[Init] Will pause server on connect');
  }

  // Performance monitoring
  perfMonitor = new PerformanceMonitor();

  // Debug overlay
  if (debugMode) {
    debugOverlay = new DebugOverlay();
  }

  // Core systems
  gameState = new GameState();
  inputManager = new InputManager();

  // Determine server URL
  const serverUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

  // Connect to server (pass playground mode for port switching)
  socketManager = new SocketManager(serverUrl, gameState, settings.playgroundMode);

  // Pause server on connect if requested (wait for connection first)
  if (settings.pauseOnStart) {
    eventBus.once('client:socketConnected', () => {
      console.log('[Init] Sending pause command to server');
      socketManager.sendPause();
    });
  }

  // Initialize renderer
  renderer = new ThreeRenderer();
  const container = document.getElementById('game-container')!;
  renderer.init(container, GAME_CONFIG.VIEWPORT_WIDTH, GAME_CONFIG.VIEWPORT_HEIGHT);

  // Wire input manager with renderer's camera projection
  inputManager.setCameraProjection(renderer.getCameraProjection());

  // Initialize HUD
  hudOverlay = new HUDOverlay();

  // Initialize Dev Panel if dev mode
  if (devMode) {
    devPanel = new DevPanel({
      socket: socketManager.getSocket(),
      gameState,
      renderer,
    });
    console.log('[Dev] Dev panel enabled - press H to toggle');

    // Dev panel toggle (H key)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') {
        devPanel?.toggle();
      }
    });
  }

  // Wire input handlers to network
  eventBus.on('client:inputMove', (event) => {
    socketManager.sendMove(event.direction);
  });

  eventBus.on('client:inputRespawn', () => {
    socketManager.sendRespawn();
  });

  eventBus.on('client:empActivate', () => {
    socketManager.sendEMPActivate();
  });

  eventBus.on('client:pseudopodFire', (event) => {
    socketManager.sendPseudopodFire(event.targetX, event.targetY);
  });

  eventBus.on('client:sprint', (event) => {
    socketManager.sendSprint(event.sprinting);
  });

  // Wire mouse look event to update InputManager's yaw (for movement rotation)
  eventBus.on('client:mouseLook', () => {
    // After renderer processes mouse look, sync yaw back to input manager
    inputManager.setFirstPersonYaw(renderer.getFirstPersonYaw());
  });

  // Start game loop
  update();
}

// ============================================
// Main Update Loop
// ============================================

function update(): void {
  const dt = 16; // Approx 60fps

  perfMonitor.tick();

  // Check if player is in first-person stage (Stage 4+) and update input mode
  const myPlayer = gameState.getMyPlayer();
  const isFirstPerson = myPlayer?.stage === EvolutionStage.HUMANOID;
  inputManager.setFirstPersonMode(isFirstPerson);

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
