// ============================================
// Main Entry Point - Bootstrap & Update Loop
// ============================================

import { GAME_CONFIG, EvolutionStage, World } from '@godcell/shared';
import { createClientWorld, getLocalPlayer } from './ecs';
import { SocketManager } from './core/net/SocketManager';
import { InputManager } from './core/input/InputManager';
import { eventBus } from './core/events/EventBus';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { PerformanceMonitor } from './utils/performance';
import { DebugOverlay } from './ui/DebugOverlay';
import { HUDOverlay } from './render/hud/HUDOverlay';
import { DevPanel } from './ui/DevPanel';
import { StartScreen, type PreGameSettings } from './ui/StartScreen';
import { SpecializationModal } from './ui/SpecializationModal';

// ============================================
// URL Flags
// ============================================

const urlParams = new URLSearchParams(window.location.search);
const devMode = urlParams.has('dev');
const debugMode = urlParams.has('debug');

// ============================================
// Game State (initialized on start)
// ============================================

let world: World;
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
  // Create ECS World - this is the single source of truth
  world = createClientWorld();
  inputManager = new InputManager();

  // Determine server URL
  const serverUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

  // Connect to server - SocketManager writes directly to World
  socketManager = new SocketManager(serverUrl, world, settings.playgroundMode);

  // Setup console log forwarding to server (for debugging)
  setupLogForwarding(socketManager);

  // Pause server on connect if requested (wait for connection first)
  if (settings.pauseOnStart) {
    eventBus.once('client:socketConnected', () => {
      console.log('[Init] Sending pause command to server');
      socketManager.sendPause();
    });
  }

  // Initialize renderer (pass world for render systems to query directly)
  renderer = new ThreeRenderer();
  const container = document.getElementById('game-container')!;
  renderer.init(container, GAME_CONFIG.VIEWPORT_WIDTH, GAME_CONFIG.VIEWPORT_HEIGHT, world);

  // Wire input manager with renderer's camera projection
  inputManager.setCameraProjection(renderer.getCameraProjection());

  // Initialize HUD
  hudOverlay = new HUDOverlay();

  // Initialize Dev Panel if dev mode
  if (devMode) {
    devPanel = new DevPanel({
      socket: socketManager.getSocket(),
      world,
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

  // Perf debug toggles (always available)
  window.addEventListener('keydown', (e) => {
    // B = toggle bloom
    if (e.key === 'b' || e.key === 'B') {
      renderer?.toggleBloom();
    }
  });

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
    // Route to appropriate projectile based on player stage
    const myPlayer = getLocalPlayer(world);
    const stage = myPlayer?.stage;

    // Stage 3+ with ranged specialization uses projectile
    // Stage 2 uses pseudopod beam (for PvP)
    // Note: Server validates specialization - just send projectileFire for Stage 3+
    if (stage === EvolutionStage.CYBER_ORGANISM ||
        stage === EvolutionStage.HUMANOID ||
        stage === EvolutionStage.GODCELL) {
      socketManager.sendProjectileFire(event.targetX, event.targetY);
    } else {
      socketManager.sendPseudopodFire(event.targetX, event.targetY);
    }
  });

  eventBus.on('client:sprint', (event) => {
    socketManager.sendSprint(event.sprinting);
  });

  // Stage 3 specialization selection
  eventBus.on('client:selectSpecialization', (event) => {
    socketManager.sendSelectSpecialization(event.specialization);
  });

  // Show specialization modal when server prompts
  eventBus.on('specializationPrompt', (event) => {
    new SpecializationModal({
      playerId: event.playerId,
      deadline: event.deadline,
    });
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
  const myPlayer = getLocalPlayer(world);
  const isFirstPerson = myPlayer?.stage === EvolutionStage.HUMANOID;
  inputManager.setFirstPersonMode(isFirstPerson);

  // Update systems
  inputManager.update(dt);

  // Render (renderer queries World directly)
  renderer.render(dt);

  // Update HUD
  hudOverlay.update(world);

  // Debug overlay
  if (debugOverlay) {
    debugOverlay.update(perfMonitor.getMetrics(), 'three-only');
  }

  requestAnimationFrame(update);
}

// ============================================
// Log Forwarding to Server
// ============================================

function setupLogForwarding(socket: SocketManager): void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args);
    socket.sendLog('log', args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    socket.sendLog('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    socket.sendLog('error', args);
  };

  // Also catch unhandled errors
  window.addEventListener('error', (event) => {
    socket.sendLog('error', [`[Uncaught] ${event.message} at ${event.filename}:${event.lineno}`]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    socket.sendLog('error', [`[UnhandledPromise] ${event.reason}`]);
  });
}
