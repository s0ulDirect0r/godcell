/**
 * Camera controller - drives camera from core/sim camera descriptors
 */

import type { CameraDescriptor } from '../../../core/sim/camera';
import { lerp } from '../../../core/sim/utils';
import type { Camera2D } from './Camera2D';

export class CameraController {
  private camera2D: Camera2D;
  private currentZoom = 1.0;
  private shakeOffset = { x: 0, y: 0 };
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeElapsed = 0;

  constructor(camera2D: Camera2D) {
    this.camera2D = camera2D;
  }

  /**
   * Update camera from descriptor
   */
  update(descriptor: CameraDescriptor, deltaTime: number): void {
    const camera = this.camera2D.getCamera();

    // Lerp camera position toward target
    camera.position.x = lerp(
      camera.position.x,
      descriptor.target.x + this.shakeOffset.x,
      descriptor.easing
    );
    camera.position.y = lerp(
      camera.position.y,
      descriptor.target.y + this.shakeOffset.y,
      descriptor.easing
    );

    // Lerp zoom
    this.currentZoom = lerp(this.currentZoom, descriptor.zoom, 0.05);

    // Apply zoom to camera (by scaling the orthographic frustum)
    const baseSize = 1000;
    const zoomedSize = baseSize / this.currentZoom;
    const aspect = camera.right / camera.top; // Preserve aspect ratio

    camera.left = (-zoomedSize * aspect) / 2;
    camera.right = (zoomedSize * aspect) / 2;
    camera.top = zoomedSize / 2;
    camera.bottom = -zoomedSize / 2;
    camera.updateProjectionMatrix();

    // Update camera shake
    if (this.shakeDuration > 0) {
      this.shakeElapsed += deltaTime;

      if (this.shakeElapsed >= this.shakeDuration) {
        // Shake finished
        this.shakeDuration = 0;
        this.shakeElapsed = 0;
        this.shakeIntensity = 0;
        this.shakeOffset = { x: 0, y: 0 };
      } else {
        // Apply shake offset (random displacement)
        const progress = this.shakeElapsed / this.shakeDuration;
        const currentIntensity = this.shakeIntensity * (1 - progress); // Fade out

        this.shakeOffset.x = (Math.random() - 0.5) * 2 * currentIntensity;
        this.shakeOffset.y = (Math.random() - 0.5) * 2 * currentIntensity;
      }
    }

    // Apply shake from descriptor (if provided)
    if (descriptor.shake) {
      this.applyShake(descriptor.shake.intensity, descriptor.shake.duration);
    }
  }

  /**
   * Apply camera shake effect
   */
  applyShake(intensity: number, duration: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeElapsed = 0;
  }
}
