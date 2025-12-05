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
// Cleanup Tracking (prevents memory leaks on restart)
// ============================================

// Track global event listeners for cleanup
const trackedListeners: Array<{ target: EventTarget; type: string; handler: EventListener }> = [];

// Track eventBus subscriptions for cleanup
const eventSubscriptions: Array<() => void> = [];

/**
 * Add a tracked event listener that can be cleaned up later
 */
function addTrackedListener(target: EventTarget, type: string, handler: EventListener): void {
  target.addEventListener(type, handler);
  trackedListeners.push({ target, type, handler });
}

/**
 * Clean up all tracked event listeners
 */
function cleanupTrackedListeners(): void {
  trackedListeners.forEach(({ target, type, handler }) => {
    target.removeEventListener(type, handler);
  });
  trackedListeners.length = 0;
}

/**
 * Clean up all eventBus subscriptions
 */
function cleanupEventSubscriptions(): void {
  eventSubscriptions.forEach(unsubscribe => unsubscribe());
  eventSubscriptions.length = 0;
}

/**
 * Full game cleanup (call before restart)
 * Exported for use by restart functionality
 */
export function cleanupGame(): void {
  cleanupTrackedListeners();
  cleanupEventSubscriptions();
  inputManager?.dispose();
  renderer?.dispose();
  hudOverlay?.dispose();
  devPanel?.dispose();
}

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

  // Wire input manager with player state provider (for stage/specialization)
  inputManager.setPlayerStateProvider({
    getStage: () => getLocalPlayer(world)?.stage ?? null,
    getSpecialization: () => socketManager.getMySpecialization(),
  });

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

    // Dev panel toggle (H key) - tracked for cleanup
    addTrackedListener(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'h' || (e as KeyboardEvent).key === 'H') {
        devPanel?.toggle();
      }
    });
  }

  // Perf debug toggles (always available) - tracked for cleanup
  addTrackedListener(window, 'keydown', (e) => {
    // B = toggle bloom
    if ((e as KeyboardEvent).key === 'b' || (e as KeyboardEvent).key === 'B') {
      renderer?.toggleBloom();
    }
  });

  // Wire input handlers to network (tracked for cleanup)
  eventSubscriptions.push(eventBus.on('client:inputMove', (event) => {
    socketManager.sendMove(event.direction);
  }));

  eventSubscriptions.push(eventBus.on('client:inputRespawn', () => {
    socketManager.sendRespawn();
  }));

  eventSubscriptions.push(eventBus.on('client:empActivate', () => {
    socketManager.sendEMPActivate();
  }));

  eventSubscriptions.push(eventBus.on('client:pseudopodFire', (event) => {
    // Stage 1-2 pseudopod beam attack
    socketManager.sendPseudopodFire(event.targetX, event.targetY);
  }));

  eventSubscriptions.push(eventBus.on('client:sprint', (event) => {
    socketManager.sendSprint(event.sprinting);
  }));

  // Stage 3 specialization selection
  eventSubscriptions.push(eventBus.on('client:selectSpecialization', (event) => {
    socketManager.sendSelectSpecialization(event.specialization);
  }));

  // Stage 3 melee attack
  eventSubscriptions.push(eventBus.on('client:meleeAttack', (event) => {
    socketManager.sendMeleeAttack(event.attackType, event.targetX, event.targetY);
  }));

  // Stage 3 trap placement
  eventSubscriptions.push(eventBus.on('client:placeTrap', () => {
    socketManager.sendPlaceTrap();
  }));

  // Stage 3+ projectile fire (from InputManager when ranged spec or default)
  eventSubscriptions.push(eventBus.on('client:projectileFire', (event) => {
    socketManager.sendProjectileFire(event.targetX, event.targetY);
  }));

  // Show specialization modal when server prompts
  eventSubscriptions.push(eventBus.on('specializationPrompt', (event) => {
    new SpecializationModal({
      playerId: event.playerId,
      deadline: event.deadline,
    });
  }));

  // Wire mouse look event to update InputManager's yaw (for movement rotation)
  eventSubscriptions.push(eventBus.on('client:mouseLook', () => {
    // After renderer processes mouse look, sync yaw back to input manager
    inputManager.setFirstPersonYaw(renderer.getFirstPersonYaw());
  }));

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

  // Also catch unhandled errors (tracked for cleanup)
  addTrackedListener(window, 'error', (event) => {
    const e = event as ErrorEvent;
    socket.sendLog('error', [`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}`]);
  });

  addTrackedListener(window, 'unhandledrejection', (event) => {
    const e = event as PromiseRejectionEvent;
    socket.sendLog('error', [`[UnhandledPromise] ${e.reason}`]);
  });
}
