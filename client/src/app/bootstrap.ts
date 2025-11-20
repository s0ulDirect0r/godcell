/**
 * Bootstrap the game - wire up core + renderer and start
 */

import { GameState } from '../core/state/GameState';
import { SocketManager } from '../core/net/SocketManager';
import { MessageProcessor } from '../core/net/MessageProcessor';
import { IntentSender } from '../core/net/IntentSender';
import { InputManager } from '../core/input/InputManager';
import { getCameraTarget } from '../core/sim/camera';
import { deriveHUD } from '../core/ui-model/HUDViewModel';
import { RenderLoop } from '../render/loop/RenderLoop';
import { Scene2D } from '../render/three/scene2d/Scene2D';
import { Camera2D } from '../render/three/camera/Camera2D';
import { CameraController } from '../render/three/camera/CameraController';
import { DOMInputAdapter } from '../render/three/input-adapter/DOMInputAdapter';
import { HUDOverlay } from '../render/three/hud/HUDOverlay';
import { CLIENT_CONFIG } from '../core/config/clientConfig';

/**
 * Bootstrap and start the game
 */
export function bootstrap(container: HTMLElement): void {
  console.log('🚀 Bootstrapping GODCELL with Three.js renderer...');

  // ============================================
  // Core Layer (Renderer-Agnostic)
  // ============================================

  // Game state
  const gameState = new GameState();

  // Networking
  const socketManager = new SocketManager();
  const messageProcessor = new MessageProcessor(gameState);
  const intentSender = new IntentSender();

  // Input
  const inputManager = new InputManager(intentSender);

  // ============================================
  // Render Layer (Three.js)
  // ============================================

  // Scene and camera
  const scene2D = new Scene2D(container);
  const camera2D = new Camera2D(container.clientWidth, container.clientHeight);
  const cameraController = new CameraController(camera2D);

  // HUD
  const hudOverlay = new HUDOverlay(container);

  // Input adapter (DOM → InputManager)
  new DOMInputAdapter(container, inputManager, camera2D);

  // Render loop
  const renderLoop = new RenderLoop();

  // ============================================
  // Wire Everything Together
  // ============================================

  // Connect socket to intent sender
  socketManager.on('connected', ({ socketId }) => {
    gameState.localPlayerId = socketId;
    gameState.isConnected = true;
    intentSender.setSocket(socketManager.getSocket());
    console.log('✅ Connected as player:', socketId);
  });

  socketManager.on('disconnected', () => {
    gameState.isConnected = false;
    gameState.reset();
    console.log('❌ Disconnected from server');
  });

  // Process incoming messages
  socketManager.on('message', ({ type, data }) => {
    messageProcessor.processMessage(type, data);
  });

  // Fixed-step simulation tick
  renderLoop.onTick(() => {
    // Update input manager (sends movement intents)
    inputManager.update();

    // Process any pending network messages
    // (Already handled by socket event listeners)
  });

  // Render frame (called every frame, uses interpolation)
  let lastRenderTime = performance.now();

  renderLoop.onRender(() => {
    const now = performance.now();
    const deltaTime = (now - lastRenderTime) / 1000; // Convert to seconds
    lastRenderTime = now;

    // Calculate render time (with interpolation delay)
    const renderTime = now - CLIENT_CONFIG.INTERPOLATION_DELAY_MS;

    // Update scene (renders entities with interpolated positions)
    scene2D.update(gameState, renderTime);

    // Update camera
    const cameraDescriptor = getCameraTarget(gameState);
    cameraController.update(cameraDescriptor, deltaTime);

    // Update HUD
    const hudData = deriveHUD(gameState);
    hudOverlay.update(hudData);

    // Render
    scene2D.render(camera2D.getCamera());
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = container.clientHeight;

    camera2D.resize(width, height);
    scene2D.resize(width, height);
  });

  // ============================================
  // Start
  // ============================================

  // Connect to server
  socketManager.connect();

  // Start render loop
  renderLoop.start();

  console.log('✅ GODCELL started with Three.js renderer');
}
