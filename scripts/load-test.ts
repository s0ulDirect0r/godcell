#!/usr/bin/env npx tsx
// ============================================
// Load Test Script - Fake Clients for Stress Testing
// ============================================
// Usage: npx tsx scripts/load-test.ts [serverUrl] [clientCount] [durationSec]
// Example: npx tsx scripts/load-test.ts http://localhost:3000 10 180

import { io, Socket } from 'socket.io-client';

// ============================================
// Configuration
// ============================================

const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const CLIENT_COUNT = parseInt(process.argv[3] || '10', 10);
const DURATION_SEC = parseInt(process.argv[4] || '180', 10);

// Stats tracking
interface ClientStats {
  messagesReceived: number;
  bytesReceived: number;
  lastPosition: { x: number; y: number } | null;
  connected: boolean;
  latency: number[];
}

const stats: Map<number, ClientStats> = new Map();
let totalMessagesReceived = 0;
let totalBytesReceived = 0;

// ============================================
// Fake Client
// ============================================

function createFakeClient(clientId: number): Socket {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    reconnection: false,
  });

  const clientStats: ClientStats = {
    messagesReceived: 0,
    bytesReceived: 0,
    lastPosition: null,
    connected: false,
    latency: [],
  };
  stats.set(clientId, clientStats);

  socket.on('connect', () => {
    clientStats.connected = true;
    console.log(`[Client ${clientId}] Connected`);

    // Start sending random movement inputs
    const moveInterval = setInterval(() => {
      if (!socket.connected) {
        clearInterval(moveInterval);
        return;
      }

      // Random direction (-1, 0, or 1 for each axis)
      const direction = {
        x: Math.floor(Math.random() * 3) - 1,
        y: Math.floor(Math.random() * 3) - 1,
      };

      socket.emit('playerMove', { direction });
    }, 50); // Send input 20 times per second
  });

  socket.on('disconnect', () => {
    clientStats.connected = false;
    console.log(`[Client ${clientId}] Disconnected`);
  });

  // Track all incoming messages for bandwidth stats
  const trackMessage = (eventName: string, data: unknown) => {
    clientStats.messagesReceived++;
    totalMessagesReceived++;

    const size = JSON.stringify(data).length;
    clientStats.bytesReceived += size;
    totalBytesReceived += size;
  };

  // Listen to key events
  socket.on('worldSnapshot', (data) => trackMessage('worldSnapshot', data));
  socket.on('playerMoved', (data) => {
    trackMessage('playerMoved', data);
    if (data.playerId === socket.id) {
      clientStats.lastPosition = data.position;
    }
  });
  socket.on('playerJoined', (data) => trackMessage('playerJoined', data));
  socket.on('playerLeft', (data) => trackMessage('playerLeft', data));
  socket.on('energyUpdate', (data) => trackMessage('energyUpdate', data));
  socket.on('playerDrainState', (data) => trackMessage('playerDrainState', data));
  socket.on('nutrientCollected', (data) => trackMessage('nutrientCollected', data));
  socket.on('nutrientSpawned', (data) => trackMessage('nutrientSpawned', data));
  socket.on('nutrientMoved', (data) => trackMessage('nutrientMoved', data));
  socket.on('swarmMoved', (data) => trackMessage('swarmMoved', data));
  socket.on('playerEvolved', (data) => trackMessage('playerEvolved', data));
  socket.on('playerDied', (data) => {
    trackMessage('playerDied', data);
    // Auto-respawn after death
    setTimeout(() => {
      if (socket.connected) {
        socket.emit('playerRespawnRequest', {});
      }
    }, 1000);
  });
  socket.on('playerRespawned', (data) => trackMessage('playerRespawned', data));
  socket.on('detectionUpdate', (data) => trackMessage('detectionUpdate', data));
  socket.on('pseudopodSpawned', (data) => trackMessage('pseudopodSpawned', data));
  socket.on('pseudopodMoved', (data) => trackMessage('pseudopodMoved', data));
  socket.on('empActivated', (data) => trackMessage('empActivated', data));

  socket.on('connect_error', (err) => {
    console.error(`[Client ${clientId}] Connection error:`, err.message);
  });

  return socket;
}

// ============================================
// Stats Reporting
// ============================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reportStats(elapsedSec: number) {
  const connectedClients = Array.from(stats.values()).filter((s) => s.connected).length;
  const msgPerSec = totalMessagesReceived / Math.max(1, elapsedSec);
  const bytesPerSec = totalBytesReceived / Math.max(1, elapsedSec);

  console.log('\n' + '='.repeat(60));
  console.log(`LOAD TEST STATS @ ${elapsedSec}s`);
  console.log('='.repeat(60));
  console.log(`Connected clients: ${connectedClients}/${CLIENT_COUNT}`);
  console.log(`Total messages received: ${totalMessagesReceived}`);
  console.log(`Messages/sec: ${msgPerSec.toFixed(1)}`);
  console.log(`Total bandwidth: ${formatBytes(totalBytesReceived)}`);
  console.log(`Bandwidth/sec: ${formatBytes(bytesPerSec)}/s`);
  console.log(
    `Avg bandwidth/client/sec: ${formatBytes(bytesPerSec / Math.max(1, connectedClients))}/s`
  );
  console.log('='.repeat(60) + '\n');
}

// ============================================
// Main
// ============================================

async function main() {
  console.log(`\nStarting load test:`);
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Clients: ${CLIENT_COUNT}`);
  console.log(`  Duration: ${DURATION_SEC}s\n`);

  const clients: Socket[] = [];

  // Stagger client connections to avoid thundering herd
  for (let i = 0; i < CLIENT_COUNT; i++) {
    clients.push(createFakeClient(i));
    await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms between connections
  }

  const startTime = Date.now();

  // Report stats every 10 seconds
  const statsInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    reportStats(elapsed);
  }, 10000);

  // Wait for duration
  await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));

  // Final stats
  clearInterval(statsInterval);
  reportStats(DURATION_SEC);

  // Disconnect all clients
  console.log('Disconnecting clients...');
  for (const client of clients) {
    client.disconnect();
  }

  console.log('Load test complete.\n');
  process.exit(0);
}

main().catch(console.error);
