// ============================================
// Main Entry Point - Bootstrap & Update Loop
// ============================================

import { GAME_CONFIG, EvolutionStage, World } from '#shared';
import { createClientWorld, getLocalPlayer } from './ecs';
import { SocketManager } from './core/net/SocketManager';
import { InputManager } from './core/input/InputManager';
import { eventBus } from './core/events/EventBus';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { PerformanceMonitor } from './utils/performance';
import { DebugOverlay } from './ui/DebugOverlay';
import { HUDOverlay } from './render/hud/HUDOverlay';
import { DevPanel } from './ui/DevPanel';
import { ECSXRayPanel } from './ui/ECSXRayPanel';
import { EntitySelector } from './ui/EntitySelector';
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
const ecsXRayPanel: ECSXRayPanel | null = null;
const entitySelector: EntitySelector | null = null;
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
  eventSubscriptions.forEach((unsubscribe) => unsubscribe());
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
  ecsXRayPanel?.dispose();
  entitySelector?.dispose();
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

// Track if we should auto-enable observer mode after init
let startInObserverMode = false;

// ============================================
// Game Initialization (called when player clicks Enter)
// ============================================

function initializeGame(settings: PreGameSettings): void {
  if (gameStarted) return;
  gameStarted = true;

  console.log('[Init] Starting GODCELL...');
  if (settings.observerMode) {
    console.log('[Init] Observer mode - will enable free-fly camera after connect');
    startInObserverMode = true;
  }
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
  // Priority: VITE_SERVER_URL env var > localhost detection > same origin
  const serverUrl =
    import.meta.env.VITE_SERVER_URL ||
    (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

  // Connect to server - SocketManager writes directly to World
  // Pass observerMode as spectator flag (no player creation)
  socketManager = new SocketManager(serverUrl, world, settings.playgroundMode, settings.observerMode);

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

  // Expose debug toggles to window for console access
  // Usage: window.debugSerpent() - toggles serpent head/body/attack visualization
  (window as unknown as { debugSerpent: () => boolean }).debugSerpent = () =>
    renderer!.toggleSerpentDebug();

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
    console.log('[Dev] Dev panel enabled - H: toggle panel, G: evolve, J: devolve');

    // Dev panel toggle (H key) - tracked for cleanup
    addTrackedListener(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'h' || (e as KeyboardEvent).key === 'H') {
        devPanel?.toggle();
      }
    });

    // Evolve to next stage (G key) - tracked for cleanup
    addTrackedListener(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'g' || (e as KeyboardEvent).key === 'G') {
        socketManager.sendEvolveNext();
      }
    });

    // Devolve to previous stage (J key) - tracked for cleanup
    addTrackedListener(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'j' || (e as KeyboardEvent).key === 'J') {
        socketManager.sendDevolvePrev();
      }
    });

    // ECS X-Ray Panel - click entities to inspect their components
    // Disabled for now - enable for debugging entity state
    // ecsXRayPanel = new ECSXRayPanel({ world });
    // entitySelector = new EntitySelector({
    //   world,
    //   renderer,
    //   onSelect: (entityId) => {
    //     ecsXRayPanel?.selectEntity(entityId);
    //   },
    // });
    // entitySelector.enable();

    // Pause toggle (P key) - tracked for cleanup
    let isPaused = false;
    addTrackedListener(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'p' || (e as KeyboardEvent).key === 'P') {
        isPaused = !isPaused;
        socketManager.getSocket().emit('devCommand', {
          type: 'devCommand',
          command: { action: 'pauseGame', paused: isPaused },
        });
        console.log(`[Dev] Game ${isPaused ? 'PAUSED' : 'RESUMED'}`);
      }
    });

    console.log('[Dev] ECS X-Ray enabled - X: toggle panel, P: pause, click entities to inspect');
  }

  // Perf debug toggles (always available) - tracked for cleanup
  addTrackedListener(window, 'keydown', (e) => {
    const key = (e as KeyboardEvent).key;

    // B = toggle bloom
    if (key === 'b' || key === 'B') {
      renderer?.toggleBloom();
    }
    // O = toggle observer mode (free-fly camera for debugging multi-sphere world)
    if (key === 'o' || key === 'O') {
      const isObserver = renderer?.toggleObserverMode();
      if (isObserver) {
        // Request pointer lock for mouse look (must be on canvas element)
        renderer?.requestPointerLock();
      } else {
        // Exit pointer lock
        document.exitPointerLock();
      }
    }
    // [ = zoom in (narrower FOV) in observer mode
    if (key === '[') {
      renderer?.adjustObserverFOV(-5);
    }
    // ] = zoom out (wider FOV) in observer mode
    if (key === ']') {
      renderer?.adjustObserverFOV(5);
    }
  });

  // Wire input handlers to network (tracked for cleanup)
  eventSubscriptions.push(
    eventBus.on('client:inputMove', (event) => {
      socketManager.sendMove(event.direction);
    })
  );

  eventSubscriptions.push(
    eventBus.on('client:inputRespawn', () => {
      socketManager.sendRespawn();
    })
  );

  eventSubscriptions.push(
    eventBus.on('client:empActivate', () => {
      socketManager.sendEMPActivate();
    })
  );

  eventSubscriptions.push(
    eventBus.on('client:pseudopodFire', (event) => {
      // Stage 1-2 pseudopod beam attack
      socketManager.sendPseudopodFire(event.targetX, event.targetY);
    })
  );

  eventSubscriptions.push(
    eventBus.on('client:sprint', (event) => {
      socketManager.sendSprint(event.sprinting);
    })
  );

  // Stage 5 Godcell phase shift
  eventSubscriptions.push(
    eventBus.on('client:phaseShift', (event) => {
      socketManager.sendPhaseShift(event.active);
    })
  );

  // Stage 3 specialization selection
  eventSubscriptions.push(
    eventBus.on('client:selectSpecialization', (event) => {
      socketManager.sendSelectSpecialization(event.specialization);
    })
  );

  // Stage 3 melee attack
  eventSubscriptions.push(
    eventBus.on('client:meleeAttack', (event) => {
      socketManager.sendMeleeAttack(event.attackType, event.targetX, event.targetY);
    })
  );

  // Stage 3 trap placement
  eventSubscriptions.push(
    eventBus.on('client:placeTrap', () => {
      socketManager.sendPlaceTrap();
    })
  );

  // Stage 3+ projectile fire (from InputManager when ranged spec or default)
  eventSubscriptions.push(
    eventBus.on('client:projectileFire', (event) => {
      socketManager.sendProjectileFire(event.targetX, event.targetY);
    })
  );

  // Show specialization modal when server prompts
  eventSubscriptions.push(
    eventBus.on('specializationPrompt', (event) => {
      new SpecializationModal({
        playerId: event.playerId,
        deadline: event.deadline,
      });
    })
  );

  // Wire mouse look event to update InputManager's yaw (for movement rotation)
  eventSubscriptions.push(
    eventBus.on('client:mouseLook', () => {
      // After renderer processes mouse look, sync yaw back to input manager
      inputManager.setFirstPersonYaw(renderer.getFirstPersonYaw());
    })
  );

  // Fullscreen toggle (F key)
  eventSubscriptions.push(
    eventBus.on('client:toggleFullscreen', () => {
      renderer.toggleFullscreen();
    })
  );

  // Handle browser fullscreen changes (user presses ESC, etc.)
  document.addEventListener('fullscreenchange', () => {
    renderer.handleFullscreenChange();
  });

  // Auto-enable observer mode if requested from start screen
  if (startInObserverMode) {
    renderer.toggleObserverMode();
    console.log('[Observer] Ready - click to lock mouse, WASD to fly, Space/Shift up/down, [/] FOV zoom, O to exit');
  }

  // Canvas click handler for pointer lock (observer mode OR godcell flight mode)
  // Pointer lock MUST be requested on canvas element, not document.body
  // Don't request pointer lock when in fullscreen - they can conflict on some browsers
  const canvas = renderer.getCanvas();
  canvas.addEventListener('click', () => {
    if (document.fullscreenElement) return;
    if (renderer?.isObserverMode() || inputManager.isGodcellFlightMode()) {
      renderer.requestPointerLock();
    }
  });

  // Start game loop
  update();
}

// ============================================
// Main Update Loop
// ============================================

let lastFrameTime = performance.now();

function update(): void {
  const now = performance.now();
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  const dtSeconds = dt / 1000; // Convert to seconds for observer physics

  perfMonitor.tick();

  // Handle observer mode input (free-fly camera for debugging)
  if (renderer?.isObserverMode()) {
    // Get movement input
    const observerInput = inputManager.getObserverInput();
    renderer.setObserverInput(observerInput.forward, observerInput.right, observerInput.up);

    // Get mouse look input
    const mouseDelta = inputManager.getObserverMouseDelta();
    renderer.updateObserverLook(mouseDelta.deltaX, mouseDelta.deltaY);

    // Update observer camera position
    renderer.updateObserver(dtSeconds);
  }

  // Check if player is in first-person stage (Stage 4+) and update input mode
  // Skip this when in observer mode - observer mode manages its own pointer lock
  if (!renderer?.isObserverMode()) {
    const myPlayer = getLocalPlayer(world);
    const isFirstPerson = myPlayer?.stage === EvolutionStage.HUMANOID;
    inputManager.setFirstPersonMode(isFirstPerson);

    // Check if player is Godcell - Godcells are ALWAYS in flight mode
    // (surfaceRadius check removed - Godcells float by definition in new architecture)
    const isGodcell = myPlayer?.stage === EvolutionStage.GODCELL;
    const isGodcellFloating = isGodcell; // Always true for Godcells

    // Debug: log once per second via server forwarding
    if (isGodcell && Math.random() < 0.016) {
      socketManager.sendLog('log', [
        '[Flight] Godcell check:',
        `stage=${myPlayer?.stage}`,
        `isGodcellFloating=${isGodcellFloating}`,
        `flightModeActive=${inputManager.isGodcellFlightMode()}`,
      ]);
    }

    if (isGodcellFloating && !inputManager.isGodcellFlightMode()) {
      // Enable godcell flight with callback to camera system
      console.log('[Flight] ENABLING godcell flight mode!');
      inputManager.setGodcellFlightMode(true, (deltaX, deltaY) => {
        renderer.getCameraSystem().updateGodcellLook(deltaX, deltaY);
        const yaw = renderer.getCameraSystem().getGodcellYaw();
        const pitch = renderer.getCameraSystem().getGodcellPitch();
        // Sync yaw/pitch back to input manager (for legacy code if needed)
        inputManager.setGodcellYawPitch(yaw, pitch);
        // Send camera facing to server for server-side input transform
        socketManager.sendCameraFacing(yaw, pitch);
      });
      renderer.getCameraSystem().setGodcellFlightMode(true);
      // Request pointer lock immediately (like observer mode does)
      renderer.requestPointerLock();
    } else if (!isGodcellFloating && inputManager.isGodcellFlightMode()) {
      inputManager.setGodcellFlightMode(false);
      renderer.getCameraSystem().setGodcellFlightMode(false);
    }
  }

  // Update systems (skip movement input if in observer mode)
  if (!renderer?.isObserverMode()) {
    inputManager.update(dt);
  } else {
    // Still allow fullscreen toggle in observer mode
    inputManager.updateFullscreen();
  }

  // Render (renderer queries World directly)
  renderer.render(dt);

  // Update HUD
  hudOverlay.update(world);

  // Debug overlay
  if (debugOverlay) {
    debugOverlay.update(perfMonitor.getMetrics(), 'three-only');
  }

  // ECS X-Ray panel (live component values)
  if (ecsXRayPanel) {
    ecsXRayPanel.update();
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
