// ============================================
// Data Tree Forest - instanced digital jungle trees
// Fiber-optic bark, crystalline canopy, energy roots (Stage 3+ obstacles)
// ============================================
//
// Every tree in the forest shares six InstancedMeshes (trunk, fibers, three canopy
// layers, roots), so the draw-call count stays at 6 however many trees there are.
// All animation (glow pulse, fiber wave, canopy sway, fade near the viewer) runs in
// TSL off the renderer's `time` and one per-tree vec4: (game x, game y, radius, variant).
//
// Tree-local units: trunk parts are modeled for radius 1 and trunk height 1, then
// scaled per instance by (radius, trunkHeight, radius); roots scale by radius;
// canopy layers scale by the canopy radius.

import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  attribute,
  color,
  hue,
  instancedBufferAttribute,
  length,
  positionLocal,
  sin,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

/** One tree, in game coordinates */
export interface TreeInstance {
  x: number;
  y: number;
  radius: number; // Trunk collision radius (sets overall size)
  height: number; // Visual height
  variant: number; // 0-1 seed for color and animation phase
}

const CONFIG = {
  // Trunk
  TRUNK_SEGMENTS: 12, // Cylinder segments (enough for fiber lines)
  TRUNK_HEIGHT_RATIO: 0.55, // Fraction of the height used for trunk (rest is canopy)
  TRUNK_TAPER: 0.6, // Top radius / bottom radius
  TRUNK_BASE_COLOR: 0x1a1a2e, // Dark blue-black base (contrast for fibers)
  TRUNK_GLOW_COLOR: 0x00ffff, // Cyan glow (matches jungle grid)
  TRUNK_GLOW_INTENSITY: 0.1, // Very subtle trunk glow

  // Fiber-optic bark (vertical glowing lines on the trunk)
  FIBER_LINE_COUNT: 6,
  FIBER_LINE_WIDTH: 0.08, // Width as a fraction of trunk radius
  FIBER_LINE_COLOR: 0x00ffff,
  FIBER_LINE_INTENSITY: 0.8, // Emissive strength
  FIBER_PULSE_RANGE: 0.4, // ±40% intensity as the wave passes
  FIBER_PULSE_OFFSET: 0.3, // Rad phase step between fibers (traveling wave around the trunk)
  FIBER_ANGLE_JITTER: 0.3, // Rad of per-tree rotation for the fiber ring

  // Crystalline canopy (three nested icosahedra)
  CANOPY_RADIUS_RATIO: 2.0, // Outer canopy radius / trunk radius
  CANOPY_LAYER_SCALE: [0.5, 0.75, 1.0], // Inner to outer
  CANOPY_LAYER_OPACITY: [0.9, 0.6, 0.3], // Inner to outer
  CANOPY_LAYER_DETAIL: [3, 2, 2], // Icosahedron detail (lower = more crystalline)
  CANOPY_CORE_COLOR: 0x00ff88, // Inner layer: green-cyan
  CANOPY_OUTER_COLOR: 0x00ffaa, // Mid/outer layers
  CANOPY_GLOW_INTENSITY: 0.4, // Inner layer emissive; each layer out is 20% dimmer
  CANOPY_LIFT: 0.6, // Canopy center sits this many canopy radii above the trunk top

  // Canopy fades when the viewer is under it, so a top-down camera can see them
  CANOPY_FADE_NEAR: 250, // Px beyond 2x trunk radius: fully faded inside this
  CANOPY_FADE_FAR: 700, // Px beyond 2x trunk radius: full opacity past this
  CANOPY_FADE_MIN: 0.12, // Opacity multiplier when faded
  CANOPY_FADE_GAIN: 0.6, // Added on top when far (far multiplier = MIN + GAIN)

  // Energy roots at the base
  ROOT_COUNT: 4,
  ROOT_LENGTH_RATIO: 0.6, // Root length / trunk radius
  ROOT_COLOR: 0x00ffff,
  ROOT_INTENSITY: 0.5,

  // Color variation: hue rotates by ±HUE_SHIFT turns across variants
  HUE_SHIFT: 0.05,

  // Animation
  GLOW_PULSE_SPEED: 0.4, // Hz
  GLOW_PULSE_RANGE: 0.25, // ±25% intensity
  CANOPY_LAYER_PHASE: 0.5, // Rad pulse offset per canopy layer (depth shimmer)
  SWAY_AMPLITUDE: 0.015, // Canopy sway as a fraction of trunk radius
  SWAY_SPEED: 0.25, // Hz
};

/** Unit trunk: radius 1 at the base, height 1, base at y = 0 */
function trunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(CONFIG.TRUNK_TAPER, 1, 1, CONFIG.TRUNK_SEGMENTS);
  geo.translate(0, 0.5, 0);
  return geo;
}

/** Unit fiber ring, with a per-vertex `fiberIndex` for the traveling pulse */
function fiberGeometry(): THREE.BufferGeometry {
  const width = CONFIG.FIBER_LINE_WIDTH;
  const ringRadius = ((1 + CONFIG.TRUNK_TAPER) / 2) * 0.95; // Mid-trunk surface
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < CONFIG.FIBER_LINE_COUNT; i++) {
    const angle = (i / CONFIG.FIBER_LINE_COUNT) * TAU;
    const geo = new THREE.BoxGeometry(width, 0.95, width * 0.3);
    geo.rotateY(-angle); // Face outward
    geo.translate(Math.cos(angle) * ringRadius, 0.5, Math.sin(angle) * ringRadius);
    const count = geo.getAttribute('position').count;
    geo.setAttribute('fiberIndex', new THREE.Float32BufferAttribute(new Array(count).fill(i), 1));
    parts.push(geo);
  }
  return mergeGeometries(parts)!;
}

/** Unit roots (trunk radius 1), lying flat and pointing outward from the base */
function rootGeometry(): THREE.BufferGeometry {
  const length = CONFIG.ROOT_LENGTH_RATIO;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < CONFIG.ROOT_COUNT; i++) {
    const angle = ((i + 0.5) / CONFIG.ROOT_COUNT) * TAU; // Between fiber lines
    const geo = new THREE.CylinderGeometry(0.02, 0.08, length, 6); // Thin tip, thick at trunk
    geo.rotateZ(Math.PI / 2); // Lie flat: thick end toward +x
    geo.rotateY(-angle); // Point outward along (cos, sin) in xz
    const reach = 0.8 + length / 2;
    geo.translate(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
    parts.push(geo);
  }
  return mergeGeometries(parts)!;
}

export class DataTreeForest {
  readonly group = new THREE.Group();
  /** Game position the canopy fades around (usually the local player) */
  private readonly uViewer = uniform(new THREE.Vector2(1e9, 1e9));
  private readonly meshes: THREE.InstancedMesh[] = [];

  constructor(trees: readonly TreeInstance[]) {
    this.group.name = 'dataTreeForest';
    const count = trees.length;
    const data = new Float32Array(count * 4);
    trees.forEach((t, i) => data.set([t.x, t.y, t.radius, t.variant], i * 4));
    const aTree = instancedBufferAttribute(
      new THREE.InstancedInterleavedBuffer(data, 4),
      'vec4',
      4,
      0
    ) as Node<'vec4'>;
    const radius = aTree.z;
    const variant = aTree.w;
    const pulsePhase = time.mul(CONFIG.GLOW_PULSE_SPEED * TAU).add(variant.mul(TAU));
    const pulse = (offset: Node<'float'> | number, range: number) =>
      sin(pulsePhase.add(offset)).mul(range).add(1);
    const tint = (hex: number) => hue(color(hex), variant.sub(0.5).mul(CONFIG.HUE_SHIFT * 2 * TAU));

    // --- Trunk ---
    const trunkMat = new THREE.MeshStandardNodeMaterial({
      color: CONFIG.TRUNK_BASE_COLOR,
      roughness: 0.7,
      metalness: 0.3,
      side: THREE.DoubleSide,
    });
    trunkMat.emissiveNode = tint(CONFIG.TRUNK_GLOW_COLOR).mul(
      pulse(0, CONFIG.GLOW_PULSE_RANGE).mul(CONFIG.TRUNK_GLOW_INTENSITY)
    );
    const trunk = this.addMesh('trunk', trunkGeometry(), trunkMat, count);

    // --- Fibers ---
    const fiberMat = new THREE.MeshStandardNodeMaterial({
      roughness: 0.2,
      metalness: 0.5,
      transparent: true,
      opacity: 0.9,
    });
    const fiberColor = tint(CONFIG.FIBER_LINE_COLOR);
    fiberMat.colorNode = fiberColor;
    fiberMat.emissiveNode = fiberColor.mul(
      pulse(
        attribute('fiberIndex', 'float').mul(CONFIG.FIBER_PULSE_OFFSET),
        CONFIG.FIBER_PULSE_RANGE
      ).mul(CONFIG.FIBER_LINE_INTENSITY)
    );
    const fibers = this.addMesh('fibers', fiberGeometry(), fiberMat, count);

    // --- Canopy layers ---
    const viewerDistance = length(vec2(aTree.x, aTree.y).sub(this.uViewer));
    const fadeStart = radius.mul(2);
    const fade = smoothstep(
      fadeStart.add(CONFIG.CANOPY_FADE_NEAR),
      fadeStart.add(CONFIG.CANOPY_FADE_FAR),
      viewerDistance
    );
    const fadeOpacity = fade.mul(CONFIG.CANOPY_FADE_GAIN).add(CONFIG.CANOPY_FADE_MIN);
    const swayPhase = time.mul(CONFIG.SWAY_SPEED * TAU).add(variant.mul(TAU));
    // positionNode runs after instancing, so this offset is in world units
    const sway = vec3(sin(swayPhase).mul(radius).mul(CONFIG.SWAY_AMPLITUDE), 0, 0);
    const canopies = CONFIG.CANOPY_LAYER_SCALE.map((scale, layer) => {
      const isOuter = layer === CONFIG.CANOPY_LAYER_SCALE.length - 1;
      const mat = new THREE.MeshStandardNodeMaterial({
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        side: isOuter ? THREE.DoubleSide : THREE.FrontSide,
        depthWrite: false,
      });
      const layerColor = tint(layer === 0 ? CONFIG.CANOPY_CORE_COLOR : CONFIG.CANOPY_OUTER_COLOR);
      mat.colorNode = layerColor;
      mat.emissiveNode = layerColor.mul(
        pulse(layer * CONFIG.CANOPY_LAYER_PHASE, CONFIG.GLOW_PULSE_RANGE).mul(
          CONFIG.CANOPY_GLOW_INTENSITY * (1 - layer * 0.2)
        )
      );
      mat.opacityNode = fadeOpacity.mul(CONFIG.CANOPY_LAYER_OPACITY[layer]);
      mat.positionNode = positionLocal.add(sway);
      const geo = new THREE.IcosahedronGeometry(scale, CONFIG.CANOPY_LAYER_DETAIL[layer]);
      return this.addMesh(`canopy_${layer}`, geo, mat, count);
    });

    // --- Roots ---
    const rootMat = new THREE.MeshStandardNodeMaterial({
      roughness: 0.3,
      metalness: 0.4,
      transparent: true,
      opacity: 0.7,
    });
    const rootColor = tint(CONFIG.ROOT_COLOR);
    rootMat.colorNode = rootColor;
    rootMat.emissiveNode = rootColor.mul(CONFIG.ROOT_INTENSITY);
    const roots = this.addMesh('roots', rootGeometry(), rootMat, count);

    // --- Instance transforms ---
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    trees.forEach((t, i) => {
      const trunkHeight = t.height * CONFIG.TRUNK_HEIGHT_RATIO;
      const canopyRadius = t.radius * CONFIG.CANOPY_RADIUS_RATIO;
      // Three.js: X = game X, Y = up, Z = -game Y
      pos.set(t.x, 0, -t.y);

      trunk.setMatrixAt(
        i,
        m.compose(pos, rot.identity(), scale.set(t.radius, trunkHeight, t.radius))
      );

      // Rotating about Y by -a turns the ring by +a in game-space angle
      rot.setFromAxisAngle(
        THREE.Object3D.DEFAULT_UP,
        -(t.variant - 0.5) * CONFIG.FIBER_ANGLE_JITTER
      );
      fibers.setMatrixAt(i, m.compose(pos, rot, scale));

      rot.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -t.variant * 0.5);
      roots.setMatrixAt(i, m.compose(pos, rot, scale.setScalar(t.radius)));

      const canopyPos = pos.clone().setY(trunkHeight + canopyRadius * CONFIG.CANOPY_LIFT);
      canopies.forEach((canopy, layer) => {
        // Each layer tilted differently for a faceted, crystalline look
        euler.set(layer * 0.2 + t.variant * 0.5, layer * 0.3 + t.variant * 0.7, layer * 0.1);
        canopy.setMatrixAt(
          i,
          m.compose(canopyPos, rot.setFromEuler(euler), scale.setScalar(canopyRadius))
        );
      });
    });
    for (const mesh of this.meshes) mesh.computeBoundingSphere();
  }

  private addMesh(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    this.meshes.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** Canopies near this game position fade out */
  setViewer(x: number, y: number): void {
    this.uViewer.value.set(x, y);
  }

  clearViewer(): void {
    this.uViewer.value.set(1e9, 1e9);
  }

  /** Total draw calls for the whole forest */
  get drawCalls(): number {
    return this.meshes.length;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.group.clear();
  }
}
