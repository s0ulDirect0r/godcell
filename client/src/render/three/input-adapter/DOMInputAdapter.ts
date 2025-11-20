/**
 * DOM input adapter - connects DOM events to InputManager
 */

import type { InputManager } from '../../../core/input/InputManager';
import type { Camera2D } from '../camera/Camera2D';

export class DOMInputAdapter {
  private inputManager: InputManager;
  private camera2D: Camera2D;
  private container: HTMLElement;

  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;
  private mouseMoveHandler: (e: MouseEvent) => void;
  private mouseDownHandler: (e: MouseEvent) => void;
  private mouseUpHandler: (e: MouseEvent) => void;

  constructor(container: HTMLElement, inputManager: InputManager, camera2D: Camera2D) {
    this.container = container;
    this.inputManager = inputManager;
    this.camera2D = camera2D;

    // Create event handlers
    this.keyDownHandler = this.handleKeyDown.bind(this);
    this.keyUpHandler = this.handleKeyUp.bind(this);
    this.mouseMoveHandler = this.handleMouseMove.bind(this);
    this.mouseDownHandler = this.handleMouseDown.bind(this);
    this.mouseUpHandler = this.handleMouseUp.bind(this);

    this.attach();
  }

  /**
   * Attach event listeners
   */
  private attach(): void {
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    this.container.addEventListener('mousemove', this.mouseMoveHandler);
    this.container.addEventListener('mousedown', this.mouseDownHandler);
    this.container.addEventListener('mouseup', this.mouseUpHandler);
  }

  /**
   * Detach event listeners
   */
  detach(): void {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    this.container.removeEventListener('mousemove', this.mouseMoveHandler);
    this.container.removeEventListener('mousedown', this.mouseDownHandler);
    this.container.removeEventListener('mouseup', this.mouseUpHandler);
  }

  /**
   * Handle keydown
   */
  private handleKeyDown(e: KeyboardEvent): void {
    this.inputManager.handleKeyDown(e.key);
  }

  /**
   * Handle keyup
   */
  private handleKeyUp(e: KeyboardEvent): void {
    this.inputManager.handleKeyUp(e.key);
  }

  /**
   * Handle mouse move
   */
  private handleMouseMove(e: MouseEvent): void {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.inputManager.handleMouseMove(x, y);
    this.inputManager.handleMouseButtons(e.buttons);
  }

  /**
   * Handle mouse down (for actions like pseudopod extension)
   */
  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // Only left click

    const worldPos = this.screenToWorld(e.clientX, e.clientY);
    this.inputManager.handleMouseClick(worldPos.x, worldPos.y);
  }

  /**
   * Handle mouse up
   */
  private handleMouseUp(e: MouseEvent): void {
    this.inputManager.handleMouseButtons(e.buttons);
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    const camera = this.camera2D.getCamera();

    // Normalize screen coords to [-1, 1]
    const x = ((screenX - rect.left) / rect.width) * 2 - 1;
    const y = -((screenY - rect.top) / rect.height) * 2 + 1;

    // Convert to world coords using camera frustum
    const worldX = camera.position.x + x * (camera.right - camera.left) / 2;
    const worldY = camera.position.y + y * (camera.top - camera.bottom) / 2;

    return { x: worldX, y: worldY };
  }
}
