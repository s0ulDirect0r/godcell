// ============================================
// PointCloud - sized points for WebGPURenderer
// ============================================

import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, materialColor } from 'three/tsl';

/**
 * Drop-in replacement for THREE.Points that renders each point as an
 * instanced, camera-facing quad.
 *
 * WebGPU has no point size (THREE.Points always draws 1px points), so sized
 * particles must be sprites. Pass the same geometry you would give
 * THREE.Points and a PointsNodeMaterial with the same parameters as the old
 * PointsMaterial. Keep mutating `pointGeometry` attributes and setting
 * `needsUpdate` as before; changes are pushed to the GPU before each render.
 *
 * Like PointsMaterial, `size` applies to every point; a per-point 'size'
 * attribute on the geometry is ignored.
 */
export class PointCloud extends THREE.Sprite {
  readonly isPointCloud = true;
  pointGeometry: THREE.BufferGeometry;
  declare material: THREE.PointsNodeMaterial;
  // `geometry` is the shared sprite quad; point data lives in `pointGeometry`.
  // Typed as never so leftover `points.geometry.*` call sites fail to compile.
  declare geometry: never;

  private positionBuffer!: THREE.InstancedInterleavedBuffer;
  private colorBuffer: THREE.InstancedInterleavedBuffer | null = null;
  private positionVersion = -1;
  private colorVersion = -1;

  constructor(geometry: THREE.BufferGeometry, material: THREE.PointsNodeMaterial) {
    // Instanced attribute nodes live on the material, so each cloud needs its own
    super(material.positionNode ? (material.clone() as THREE.PointsNodeMaterial) : material);
    this.pointGeometry = geometry;
    // Sprite bounds are a single quad at the origin; the points spread much wider
    this.frustumCulled = false;
    this.bindAttributes();
  }

  private bindAttributes(): void {
    const material = this.material;
    const position = this.pointGeometry.getAttribute('position') as THREE.BufferAttribute;
    // Must be an *Instanced* buffer: WebGPU steps per instance only when the buffer says so
    this.positionBuffer = new THREE.InstancedInterleavedBuffer(position.array, position.itemSize);
    material.positionNode = instancedBufferAttribute(
      this.positionBuffer,
      'vec3',
      position.itemSize,
      0
    );
    this.positionVersion = position.version;
    this.count = Math.min(position.count, this.pointGeometry.drawRange.count);

    const color = this.pointGeometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (material.vertexColors && color) {
      this.colorBuffer = new THREE.InstancedInterleavedBuffer(color.array, color.itemSize);
      material.colorNode = materialColor.mul(
        instancedBufferAttribute(this.colorBuffer, 'vec3', color.itemSize, 0)
      );
      // Per-point colors come from colorNode; the sprite quad has no color attribute
      material.vertexColors = false;
      this.colorVersion = color.version;
    }
    material.needsUpdate = true;
  }

  onBeforeRender(): void {
    const position = this.pointGeometry.getAttribute('position') as THREE.BufferAttribute;
    if (position.array !== this.positionBuffer.array) {
      // Geometry attribute was replaced (e.g. resized); rebind
      this.colorBuffer = null;
      this.bindAttributes();
    } else {
      if (position.version !== this.positionVersion) {
        this.positionBuffer.needsUpdate = true;
        this.positionVersion = position.version;
      }
      const color = this.pointGeometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (this.colorBuffer && color && color.version !== this.colorVersion) {
        this.colorBuffer.needsUpdate = true;
        this.colorVersion = color.version;
      }
    }

    // drawRange.count limits visible points (drawRange.start is not supported)
    this.count = Math.min(position.count, this.pointGeometry.drawRange.count);
  }
}
