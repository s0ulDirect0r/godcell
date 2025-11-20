/**
 * Sends player intents (movement, actions) to the server.
 * Buffers intents if disconnected (optional feature).
 */

import type { Socket } from 'socket.io-client';
import type { PlayerMoveMessage, PlayerRespawnRequestMessage, PseudopodExtendMessage } from '@godcell/shared';

/**
 * Sends player intents to the game server
 */
export class IntentSender {
  private socket: Socket | null = null;

  /**
   * Set the socket instance (called by SocketManager after connection)
   */
  setSocket(socket: Socket | null): void {
    this.socket = socket;
  }

  /**
   * Send player movement intent
   */
  sendMove(direction: { x: number; y: number }): void {
    if (!this.socket?.connected) {
      console.warn('Cannot send move - not connected');
      return;
    }

    const message: PlayerMoveMessage = {
      type: 'playerMove',
      direction,
    };

    this.socket.emit('playerMove', message);
  }

  /**
   * Send respawn request
   */
  sendRespawnRequest(): void {
    if (!this.socket?.connected) {
      console.warn('Cannot send respawn request - not connected');
      return;
    }

    const message: PlayerRespawnRequestMessage = {
      type: 'playerRespawnRequest',
    };

    this.socket.emit('playerRespawnRequest', message);
  }

  /**
   * Send pseudopod extension request
   */
  sendPseudopodExtend(targetX: number, targetY: number): void {
    if (!this.socket?.connected) {
      console.warn('Cannot send pseudopod extend - not connected');
      return;
    }

    const message: PseudopodExtendMessage = {
      type: 'pseudopodExtend',
      targetX,
      targetY,
    };

    this.socket.emit('pseudopodExtend', message);
  }
}
