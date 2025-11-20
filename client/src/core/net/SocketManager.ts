/**
 * Socket.io connection lifecycle management.
 * Handles connect, disconnect, reconnect with exponential backoff.
 * Does NOT process messages (that's MessageProcessor's job).
 */

import { io, Socket } from 'socket.io-client';

/**
 * Socket connection events
 */
export type SocketEvent =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'message'; // Generic message event (delegates to MessageProcessor)

export type SocketEventHandler = (data?: any) => void;

/**
 * Manages Socket.io connection to game server
 */
export class SocketManager {
  private socket: Socket | null = null;
  private serverUrl: string;
  private listeners = new Map<SocketEvent, Set<SocketEventHandler>>();

  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1 second
  private maxReconnectDelay = 30000; // Cap at 30 seconds

  constructor(serverUrl: string = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
  }

  /**
   * Connect to the game server
   */
  connect(): void {
    if (this.socket) {
      console.warn('Socket already connected');
      return;
    }

    this.socket = io(this.serverUrl, {
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: this.maxReconnectDelay,
    });

    this.setupSocketListeners();
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Get the socket instance (for sending messages)
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  /**
   * Get the socket ID (assigned by server)
   */
  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Register an event listener
   */
  on(event: SocketEvent, handler: SocketEventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /**
   * Unregister an event listener
   */
  off(event: SocketEvent, handler: SocketEventHandler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit a socket event (delegates to all registered handlers)
   */
  private emit(event: SocketEvent, data?: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  /**
   * Setup socket.io event listeners
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // Connection lifecycle events
    this.socket.on('connect', () => {
      console.log('✅ Connected to server:', this.socket!.id);
      this.reconnectAttempts = 0;
      this.emit('connected', { socketId: this.socket!.id });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from server:', reason);
      this.emit('disconnected', { reason });
    });

    this.socket.on('connect_error', (error) => {
      console.error('🔌 Connection error:', error);
      this.reconnectAttempts++;
      this.emit('error', { error, attempts: this.reconnectAttempts });
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Reconnected after', attemptNumber, 'attempts');
      this.reconnectAttempts = 0;
      this.emit('connected', { socketId: this.socket!.id });
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('🔄 Reconnecting... attempt', attemptNumber);
      this.emit('reconnecting', { attempts: attemptNumber });
    });

    this.socket.on('reconnect_failed', () => {
      console.error('❌ Reconnection failed - max attempts reached');
      this.emit('error', { error: 'Max reconnection attempts reached' });
    });

    // Forward all game messages to MessageProcessor (via 'message' event)
    this.registerGameMessageListeners();
  }

  /**
   * Register listeners for all game-specific messages
   * Forwards them to MessageProcessor via generic 'message' event
   */
  private registerGameMessageListeners(): void {
    if (!this.socket) return;

    const messageTypes = [
      'gameState',
      'playerJoined',
      'playerLeft',
      'playerMoved',
      'nutrientSpawned',
      'nutrientCollected',
      'nutrientMoved',
      'energyUpdate',
      'playerDied',
      'playerRespawned',
      'playerEvolved',
      'swarmSpawned',
      'swarmMoved',
      'detectionUpdate',
      'pseudopodSpawned',
      'pseudopodRetracted',
      'playerEngulfed',
    ];

    messageTypes.forEach((type) => {
      this.socket!.on(type, (data) => {
        this.emit('message', { type, data });
      });
    });
  }
}
