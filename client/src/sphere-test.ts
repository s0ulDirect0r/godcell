// ============================================
// Sphere Movement Test Harness
// Full server integration - tests real SphereMovementSystem physics
// ============================================

import * as THREE from 'three';
import { io, Socket } from 'socket.io-client';
import { createSingleCell } from './render/meshes/SingleCellMesh';
import {
  createGravityDistortion,
  updateGravityDistortionAnimation,
  type GravityDistortionResult,
} from './render/meshes/GravityDistortionMesh';
import { GAME_CONFIG } from '#shared';
import type {
  WorldSnapshotMessage,
  PlayerMovedMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  EnergyUpdateMessage,
  PlayerDiedMessage,
} from '#shared';

// ============================================
// Constants
// ============================================

const SPHERE_RADIUS = GAME_CONFIG.SPHERE_RADIUS; // Use config value
const PLAYER_RADIUS = 15; // Single-cell size
const CAMERA_HEIGHT = 800; // Above surface (zoomed out)

// ============================================
// State
// ============================================

// My player ID (assigned by server)
let myPlayerId: string | null = null;

// Player position on sphere surface (updated from server)
const playerPos = new THREE.Vector3(SPHERE_RADIUS, 0, 0);

// Player velocity (for trail rendering - derived from position changes)
const velocity = new THREE.Vector3(0, 0, 0);
let lastPosition = new THREE.Vector3(SPHERE_RADIUS, 0, 0);

// Input state
const keys = new Set<string>();

// Stats for HUD
let distanceTraveled = 0;
let lapCount = 0;
let lastAngle = 0; // For tracking circumnavigation

// Server connection status
let connected = false;

// Energy state (from server)
let currentEnergy = 100;
let maxEnergy = 100;
let isDead = false;

// ============================================
// Trail State
// ============================================

const TRAIL_MAX_LENGTH = 50;
const TRAIL_COLOR = 0x00ff88;
const TRAIL_WIDTH = PLAYER_RADIUS * 0.3;
const trailPoints: THREE.Vector3[] = [];
let trailMesh: THREE.Mesh | null = null;

// ============================================
// Debug Visualization State
// ============================================

let forwardArrow: THREE.ArrowHelper | null = null;
let rightArrow: THREE.ArrowHelper | null = null;
let debugForward = new THREE.Vector3();
let debugRight = new THREE.Vector3();

// ============================================
// Camera Mode
// ============================================

type CameraMode = 'momentum' | 'free' | 'pole-locked';
let cameraMode: CameraMode = 'pole-locked';
let lastVelocityDir = new THREE.Vector3(0, 0, 1);

// ============================================
// Gravity Distortion State
// ============================================

interface SphereGravityWell {
  position: THREE.Vector3;
  result: GravityDistortionResult;
  pulsePhase: number;
}

const gravityWells: SphereGravityWell[] = [];
const GRAVITY_WELL_RADIUS = 150;

// ============================================
// Socket Connection (Full Player Integration)
// ============================================

let socket: Socket | null = null;

function connectToServer() {
  socket = io('http://localhost:3000', {
    transports: ['websocket'],
    reconnection: true,
  });

  socket.on('connect', () => {
    console.log('[SPHERE-TEST] Connected to server as player');
    myPlayerId = socket!.id || null;
    connected = true;
    serverLog('info', `Connected as player ${myPlayerId}`);
  });

  socket.on('disconnect', () => {
    console.log('[SPHERE-TEST] Disconnected from server');
    connected = false;
    myPlayerId = null;
  });

  // Receive initial world state
  socket.on('worldSnapshot', (message: WorldSnapshotMessage) => {
    serverLog('info', 'Received world snapshot', {
      playerCount: Object.keys(message.players).length,
    });

    // Find my player in the snapshot
    if (myPlayerId && message.players[myPlayerId]) {
      const player = message.players[myPlayerId];
      playerPos.set(player.position.x, player.position.y, player.position.z ?? SPHERE_RADIUS);
      lastPosition.copy(playerPos);
      currentEnergy = player.energy;
      maxEnergy = player.maxEnergy;
      isDead = player.energy <= 0;
      serverLog('info', 'Initial state from server', {
        x: playerPos.x.toFixed(0),
        y: playerPos.y.toFixed(0),
        z: playerPos.z.toFixed(0),
        energy: currentEnergy,
        maxEnergy: maxEnergy,
      });
    }
  });

  // Receive position updates from server
  socket.on('playerMoved', (message: PlayerMovedMessage) => {
    if (message.playerId === myPlayerId) {
      // Update position from server (server is authoritative)
      const newPos = message.position;
      playerPos.set(newPos.x, newPos.y, newPos.z ?? playerPos.z);

      // Calculate velocity from position change for trail rendering
      velocity.subVectors(playerPos, lastPosition);
      lastPosition.copy(playerPos);
    }
  });

  socket.on('playerJoined', (message: PlayerJoinedMessage) => {
    serverLog('info', `Player joined: ${message.player.id}`);
  });

  socket.on('playerLeft', (message: PlayerLeftMessage) => {
    serverLog('info', `Player left: ${message.playerId}`);
  });

  // Track energy updates
  socket.on('energyUpdate', (message: EnergyUpdateMessage) => {
    if (message.playerId === myPlayerId) {
      currentEnergy = message.energy;
      maxEnergy = message.maxEnergy;
    }
  });

  // Track death
  socket.on('playerDied', (message: PlayerDiedMessage) => {
    if (message.playerId === myPlayerId) {
      isDead = true;
      serverLog('warn', 'YOU DIED!', { cause: message.cause });
    }
  });

  // Track respawn
  socket.on('playerRespawned', (message: { player: { id: string; position: { x: number; y: number; z?: number } } }) => {
    if (message.player.id === myPlayerId) {
      isDead = false;
      playerPos.set(
        message.player.position.x,
        message.player.position.y,
        message.player.position.z ?? SPHERE_RADIUS
      );
      lastPosition.copy(playerPos);
      serverLog('info', 'Respawned!');
    }
  });
}

/**
 * Send movement input to server
 */
function sendInput(x: number, y: number) {
  if (socket?.connected) {
    socket.emit('playerMove', {
      type: 'playerMove',
      direction: { x, y, z: 0 }, // 2D input, server handles 3D transformation
    });
  }
}

/**
 * Forward log to server (appears in logs/client.log)
 */
function serverLog(level: 'info' | 'warn' | 'error', ...args: unknown[]) {
  const message = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');

  console.log(`[SPHERE] ${message}`);

  if (socket?.connected) {
    socket.emit('clientLog', {
      level,
      args: ['[SPHERE]', ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))],
      timestamp: Date.now(),
    });
  }
}

// ============================================
// Spherical Math Functions
// ============================================

function projectToSphere(pos: THREE.Vector3, radius: number): THREE.Vector3 {
  const mag = pos.length();
  if (mag === 0) return new THREE.Vector3(radius, 0, 0);
  return pos.clone().multiplyScalar(radius / mag);
}

function tangentVelocity(pos: THREE.Vector3, vel: THREE.Vector3): THREE.Vector3 {
  const mag = pos.length();
  if (mag === 0) return vel.clone();
  const normal = pos.clone().divideScalar(mag);
  const dot = vel.dot(normal);
  return vel.clone().sub(normal.multiplyScalar(dot));
}

function getSurfaceNormal(pos: THREE.Vector3): THREE.Vector3 {
  const mag = pos.length();
  if (mag === 0) return new THREE.Vector3(1, 0, 0);
  return pos.clone().divideScalar(mag);
}

// ============================================
// Input Handling
// ============================================

function setupInput() {
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase());

    // Camera mode switching
    if (e.key === '1') {
      cameraMode = 'momentum';
      serverLog('info', 'Camera mode: MOMENTUM (up follows velocity)');
    } else if (e.key === '2') {
      cameraMode = 'free';
      serverLog('info', 'Camera mode: FREE (world rotates)');
    } else if (e.key === '3') {
      cameraMode = 'pole-locked';
      serverLog('info', 'Camera mode: POLE-LOCKED (up toward north)');
    } else if (e.key === 'r' && isDead) {
      // Request respawn
      if (socket?.connected) {
        socket.emit('playerRespawnRequest', { type: 'playerRespawnRequest' });
        serverLog('info', 'Respawn requested');
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
  });
}

/**
 * Get local input direction from WASD
 */
function getInputDirection(): { x: number; y: number } {
  let x = 0;
  let y = 0;

  if (keys.has('w') || keys.has('arrowup')) y += 1;
  if (keys.has('s') || keys.has('arrowdown')) y -= 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;

  // Normalize diagonal
  const mag = Math.sqrt(x * x + y * y);
  if (mag > 1) {
    x /= mag;
    y /= mag;
  }

  return { x, y };
}

// ============================================
// Camera
// ============================================

function updateCamera(camera: THREE.PerspectiveCamera) {
  const normal = getSurfaceNormal(playerPos);

  camera.position.copy(playerPos).addScaledVector(normal, CAMERA_HEIGHT);
  camera.lookAt(playerPos);

  if (cameraMode === 'momentum') {
    const tangentVel = tangentVelocity(playerPos, velocity);
    const speed = tangentVel.length();

    if (speed > 0.1) {
      lastVelocityDir.copy(tangentVel).normalize();
    }

    camera.up.copy(lastVelocityDir);
  } else if (cameraMode === 'free') {
    const tangentZ = new THREE.Vector3(0, 0, 1);
    tangentZ.addScaledVector(normal, -tangentZ.dot(normal));
    if (tangentZ.lengthSq() > 0.0001) {
      tangentZ.normalize();
      camera.up.copy(tangentZ);
    } else {
      camera.up.set(1, 0, 0);
    }
  } else {
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, normal);

    if (right.lengthSq() > 0.0001) {
      right.normalize();
      camera.up.crossVectors(normal, right).normalize();
    } else {
      camera.up.set(0, 0, -1);
    }
  }

  // Calculate debug directions for HUD (based on camera orientation)
  const forward = camera.up.clone();
  forward.addScaledVector(normal, -forward.dot(normal));
  if (forward.lengthSq() > 0.0001) {
    forward.normalize();
  }
  const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
  debugForward.copy(forward);
  debugRight.copy(right);
}

// ============================================
// Scene Setup
// ============================================

function createScene(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  playerMesh: THREE.Group;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(GAME_CONFIG.BACKGROUND_COLOR);

  const aspect = window.innerWidth / window.innerHeight;
  const fov = 60; // Field of view in degrees
  const camera = new THREE.PerspectiveCamera(
    fov,
    aspect,
    1,      // near
    5000    // far (increased to see more of sphere)
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 2, 1).normalize();
  scene.add(directionalLight);

  // Sphere wireframe
  const sphereGeometry = new THREE.IcosahedronGeometry(SPHERE_RADIUS, 3);
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: GAME_CONFIG.GRID_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });
  const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
  scene.add(sphereMesh);

  // Equator ring
  const equatorGeometry = new THREE.TorusGeometry(SPHERE_RADIUS, 2, 4, 64);
  const equatorMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.5,
  });
  const equatorMesh = new THREE.Mesh(equatorGeometry, equatorMaterial);
  equatorMesh.rotation.x = Math.PI / 2;
  scene.add(equatorMesh);

  // Player mesh
  const playerMesh = createSingleCell(PLAYER_RADIUS, 0x00ff88);
  scene.add(playerMesh);

  // Trail mesh
  trailMesh = createTrailMesh(scene);

  // Debug arrows
  const arrowLength = 50;
  forwardArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    playerPos.clone(),
    arrowLength,
    0x00ff00,
    10,
    5
  );
  rightArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    playerPos.clone(),
    arrowLength,
    0xff0000,
    10,
    5
  );
  scene.add(forwardArrow);
  scene.add(rightArrow);

  // Gravity wells
  createGravityWellsOnSphere(scene);

  // Handle resize
  window.addEventListener('resize', () => {
    const newAspect = window.innerWidth / window.innerHeight;
    camera.aspect = newAspect;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, playerMesh };
}

// ============================================
// Player Mesh Orientation
// ============================================

function orientPlayerMesh(mesh: THREE.Group, pos: THREE.Vector3) {
  const normal = getSurfaceNormal(pos);
  const up = new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
  mesh.quaternion.copy(quaternion);
  mesh.position.copy(pos);
}

// ============================================
// Gravity Wells on Sphere
// ============================================

function createGravityWellsOnSphere(scene: THREE.Scene) {
  const wellPositions = [
    { theta: 0, phi: Math.PI / 2 },
    { theta: Math.PI, phi: Math.PI / 2 },
    { theta: Math.PI / 2, phi: Math.PI / 3 },
    { theta: -Math.PI / 2, phi: (2 * Math.PI) / 3 },
  ];

  for (const { theta, phi } of wellPositions) {
    const x = SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta);
    const y = SPHERE_RADIUS * Math.cos(phi);
    const z = SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta);
    const position = new THREE.Vector3(x, y, z);

    const result = createGravityDistortion({ x: 0, y: 0 }, GRAVITY_WELL_RADIUS);

    const normal = getSurfaceNormal(position);
    result.group.position.copy(position);

    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);
    result.group.quaternion.copy(quaternion);
    result.group.rotateX(Math.PI / 2);

    scene.add(result.group);

    gravityWells.push({
      position,
      result,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }

  serverLog('info', `Created ${gravityWells.length} gravity wells on sphere`);
}

function updateGravityWells(dt: number) {
  const dtMs = dt * 1000;
  for (const well of gravityWells) {
    updateGravityDistortionAnimation(well.result.group, well.result.particles, GRAVITY_WELL_RADIUS, well.pulsePhase, dtMs);
  }
}

// ============================================
// Trail Rendering
// ============================================

function createTrailMesh(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({
    color: TRAIL_COLOR,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
}

function updateTrail() {
  if (!trailMesh) return;

  trailPoints.push(playerPos.clone());

  while (trailPoints.length > TRAIL_MAX_LENGTH) {
    trailPoints.shift();
  }

  if (trailPoints.length < 2) return;

  const vertexCount = trailPoints.length * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  const r = ((TRAIL_COLOR >> 16) & 255) / 255;
  const g = ((TRAIL_COLOR >> 8) & 255) / 255;
  const b = (TRAIL_COLOR & 255) / 255;

  for (let i = 0; i < trailPoints.length; i++) {
    const point = trailPoints[i];
    const normal = getSurfaceNormal(point);

    const age = i / (trailPoints.length - 1);
    const taperFactor = age;
    const width = TRAIL_WIDTH * taperFactor;
    const opacity = Math.pow(age, 1.5);

    let tangentDir = new THREE.Vector3();

    if (i < trailPoints.length - 1) {
      const next = trailPoints[i + 1];
      tangentDir.subVectors(next, point);
    } else if (i > 0) {
      const prev = trailPoints[i - 1];
      tangentDir.subVectors(point, prev);
    }

    tangentDir.addScaledVector(normal, -tangentDir.dot(normal));
    const tangentLen = tangentDir.length();
    if (tangentLen > 0.0001) {
      tangentDir.divideScalar(tangentLen);
    } else {
      tangentDir.set(1, 0, 0);
      tangentDir.addScaledVector(normal, -tangentDir.dot(normal)).normalize();
    }

    const perpDir = new THREE.Vector3().crossVectors(normal, tangentDir).normalize();
    const liftedPoint = point.clone().addScaledVector(normal, 0.5);

    const idx = i * 2;

    positions[idx * 3] = liftedPoint.x + perpDir.x * width;
    positions[idx * 3 + 1] = liftedPoint.y + perpDir.y * width;
    positions[idx * 3 + 2] = liftedPoint.z + perpDir.z * width;

    colors[idx * 3] = r * opacity;
    colors[idx * 3 + 1] = g * opacity;
    colors[idx * 3 + 2] = b * opacity;

    positions[(idx + 1) * 3] = liftedPoint.x - perpDir.x * width;
    positions[(idx + 1) * 3 + 1] = liftedPoint.y - perpDir.y * width;
    positions[(idx + 1) * 3 + 2] = liftedPoint.z - perpDir.z * width;

    colors[(idx + 1) * 3] = r * opacity;
    colors[(idx + 1) * 3 + 1] = g * opacity;
    colors[(idx + 1) * 3 + 2] = b * opacity;

    if (i < trailPoints.length - 1) {
      const current = i * 2;
      const next = (i + 1) * 2;
      indices.push(current, next, current + 1);
      indices.push(next, next + 1, current + 1);
    }
  }

  trailMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  trailMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  trailMesh.geometry.setIndex(indices);
  trailMesh.geometry.computeBoundingSphere();
}

// ============================================
// Debug Visualization
// ============================================

function updateDebugArrows() {
  if (!forwardArrow || !rightArrow) return;

  const normal = getSurfaceNormal(playerPos);
  const arrowOrigin = playerPos.clone().addScaledVector(normal, 5);

  forwardArrow.position.copy(arrowOrigin);
  forwardArrow.setDirection(debugForward);

  rightArrow.position.copy(arrowOrigin);
  rightArrow.setDirection(debugRight);
}

// ============================================
// Stats Tracking
// ============================================

function updateStats(dt: number) {
  // Calculate distance from velocity (derived from position changes)
  const moveDistance = velocity.length();
  distanceTraveled += moveDistance;

  // Track circumnavigation
  const currentAngle = Math.atan2(playerPos.z, playerPos.x);
  const angleDiff = currentAngle - lastAngle;

  if (angleDiff > Math.PI) {
    lapCount--;
  } else if (angleDiff < -Math.PI) {
    lapCount++;
  }
  lastAngle = currentAngle;
}

// ============================================
// HUD
// ============================================

function updateHUD() {
  const hud = document.getElementById('hud');
  if (!hud) return;

  const speed = velocity.length().toFixed(1);
  const circumference = (2 * Math.PI * SPHERE_RADIUS).toFixed(0);
  const input = getInputDirection();

  const modeNames = {
    momentum: '1: MOMENTUM',
    free: '2: FREE',
    'pole-locked': '3: POLE-LOCKED',
  };

  const connectionStatus = connected ? `Connected (${myPlayerId?.slice(0, 8)}...)` : 'Disconnected';
  const safeEnergy = currentEnergy ?? 0;
  const safeMaxEnergy = maxEnergy ?? 100;
  const energyPercent = safeMaxEnergy > 0 ? ((safeEnergy / safeMaxEnergy) * 100).toFixed(0) : '0';
  const energyColor = isDead ? '#ff0000' : (safeMaxEnergy > 0 && safeEnergy / safeMaxEnergy > 0.3 ? '#00ff00' : '#ffaa00');

  hud.innerHTML = `
    <div style="color: ${connected ? '#00ff00' : '#ff0000'}; font-weight: bold;">Server: ${connectionStatus}</div>
    ${isDead ? '<div style="color: #ff0000; font-size: 18px; font-weight: bold;">☠️ DEAD - Press R to respawn</div>' : ''}
    <div style="color: ${energyColor}; font-weight: bold;">Energy: ${safeEnergy.toFixed(0)} / ${safeMaxEnergy.toFixed(0)} (${energyPercent}%)</div>
    <div style="color: #ffff00; font-weight: bold;">Camera: ${modeNames[cameraMode]}</div>
    <div style="margin-top: 5px;">Position: (${playerPos.x.toFixed(0)}, ${playerPos.y.toFixed(0)}, ${playerPos.z.toFixed(0)})</div>
    <div>Speed: ${speed} u/s</div>
    <div>Distance: ${distanceTraveled.toFixed(0)} units</div>
    <div>Laps: ${Math.abs(lapCount)} ${lapCount >= 0 ? 'CCW' : 'CW'}</div>
    <div>Circumference: ${circumference} units</div>
    <div style="margin-top: 10px; color: #888;">--- Debug ---</div>
    <div>Input: (${input.x.toFixed(1)}, ${input.y.toFixed(1)})</div>
    <div style="color: #00ff00;">Forward: (${debugForward.x.toFixed(2)}, ${debugForward.y.toFixed(2)}, ${debugForward.z.toFixed(2)})</div>
    <div style="color: #ff0000;">Right: (${debugRight.x.toFixed(2)}, ${debugRight.y.toFixed(2)}, ${debugRight.z.toFixed(2)})</div>
  `;
}

// ============================================
// Main Loop
// ============================================

function main() {
  // Connect to server as a real player
  connectToServer();

  setupInput();

  const { scene, camera, renderer, playerMesh } = createScene();

  let lastTime = performance.now();
  let logTimer = 0;

  serverLog('info', 'Sphere test started (SERVER PHYSICS)', {
    sphereRadius: SPHERE_RADIUS,
    playerRadius: PLAYER_RADIUS,
  });

  function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Send input to server (server handles physics)
    const input = getInputDirection();
    if (input.x !== 0 || input.y !== 0) {
      sendInput(input.x, input.y);
    } else {
      // Send zero input to stop movement
      sendInput(0, 0);
    }

    // Update stats (based on position changes from server)
    updateStats(dt);

    // Orient and position player mesh (position comes from server)
    orientPlayerMesh(playerMesh, playerPos);

    // Update trail
    updateTrail();

    // Update debug arrows
    updateDebugArrows();

    // Update gravity well animations
    updateGravityWells(dt);

    // Update camera to follow player
    updateCamera(camera);

    // Render
    renderer.render(scene, camera);

    // Update HUD
    updateHUD();

    // Periodic logging
    logTimer += dt;
    if (logTimer > 2 && velocity.length() > 0.5) {
      logTimer = 0;
      serverLog('info', 'Movement state', {
        pos: { x: playerPos.x.toFixed(0), y: playerPos.y.toFixed(0), z: playerPos.z.toFixed(0) },
        speed: velocity.length().toFixed(1),
        input: { x: input.x.toFixed(1), y: input.y.toFixed(1) },
        laps: lapCount,
      });
    }
  }

  animate();
}

main();
