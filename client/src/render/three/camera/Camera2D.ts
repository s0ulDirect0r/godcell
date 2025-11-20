/**
 * Orthographic camera for 2D rendering
 */

import * as THREE from 'three';
import { CLIENT_CONFIG } from '../../../core/config/clientConfig';

export class Camera2D {
  camera: THREE.OrthographicCamera;

  constructor(width: number, height: number) {

    // Create orthographic camera (for 2D view)
    const aspect = width / height;
    const frustumSize = CLIENT_CONFIG.CAMERA_FRUSTUM_SIZE;

    this.camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      10000
    );

    this.camera.position.z = 100; // Pull back from z=0
  }

  /**
   * Resize camera to new dimensions
   */
  resize(width: number, height: number): void {
    const aspect = width / height;
    const frustumSize = CLIENT_CONFIG.CAMERA_FRUSTUM_SIZE;

    this.camera.left = (-frustumSize * aspect) / 2;
    this.camera.right = (frustumSize * aspect) / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;

    this.camera.updateProjectionMatrix();
  }

  /**
   * Get the THREE.js camera
   */
  getCamera(): THREE.OrthographicCamera {
    return this.camera;
  }
}
