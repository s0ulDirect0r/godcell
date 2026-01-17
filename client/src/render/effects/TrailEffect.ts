// ============================================
// Trail Renderer
// Creates and updates glowing ribbon trails behind players
// Single-cells: 1 trail behind center
// Multi-cells: 7 trails behind each nucleus (center + 6 ring)
// Godcells: 4 trails from major wing tips
// ============================================

import * as THREE from 'three';
import { EvolutionStage } from '#shared';
import { getGodcellWingTipPositions } from '../meshes/GodcellMesh';

// Reusable Vector3 objects to avoid per-frame allocations
const _pos = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _liftedPos = new THREE.Vector3();

// Note: Player radius is now stored on the entity and passed via TrailPlayerData.radius
// The getPlayerRadius() function has been removed - radius flows from server via ECS

/**
 * Trail point for position history
 * In sphere mode, stores full 3D position on sphere surface
 */
interface TrailPoint {
  x: number;
  y: number;
  z?: number; // For sphere mode
}

/**
 * Player data needed for trail rendering
 */
interface TrailPlayerData {
  stage: EvolutionStage;
  color: string;
  energy: number;
  maxEnergy: number;
  radius: number;
}

// Multi-cell nucleus offsets (local space, before rotation)
// Colonial cluster: 1 center + 6 ring nuclei
const MULTICELL_NUCLEUS_COUNT = 7;
function getMultiCellNucleusOffsets(cellRadius: number): Array<{ x: number; y: number }> {
  const individualCellRadius = cellRadius * 0.35;
  const ringRadius = individualCellRadius * 2.2;

  const offsets: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 }, // Center nucleus
  ];

  // 6 ring nuclei
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    offsets.push({
      x: Math.cos(angle) * ringRadius,
      y: Math.sin(angle) * ringRadius,
    });
  }

  return offsets;
}

/**
 * Update player trails with tapered ribbon geometry
 * Single-cells: 1 trail behind center
 * Multi-cells: 7 trails behind each nucleus
 *
 * @param scene - Three.js scene for adding/removing trail meshes
 * @param trailPoints - Map of trail key to trail point history (modified in place)
 * @param trailMeshes - Map of trail key to trail mesh (modified in place)
 * @param playerMeshes - Map of player ID to cell group (for getting current position)
 * @param players - Map of player ID to player data
 */
export function updateTrails(
  scene: THREE.Scene,
  trailPoints: Map<string, TrailPoint[]>,
  trailMeshes: Map<string, THREE.Mesh>,
  playerMeshes: Map<string, THREE.Group>,
  players: Map<string, TrailPlayerData>
): void {
  const activeTrailKeys = new Set<string>();

  players.forEach((player, id) => {
    const cellGroup = playerMeshes.get(id);
    if (!cellGroup) return;

    // Determine trail configuration based on stage
    const isMultiCell = player.stage === EvolutionStage.MULTI_CELL;
    const isGodcell = player.stage === EvolutionStage.GODCELL;

    // Trail count: godcell=4 major wing tips, multi-cell=7 nuclei, single-cell=1
    const GODCELL_WINGTIP_COUNT = 4; // Only major wings, not tail blades
    const trailCount = isGodcell ? GODCELL_WINGTIP_COUNT : (isMultiCell ? MULTICELL_NUCLEUS_COUNT : 1);

    // Trail length: godcell trails are longer for dramatic effect in 3D space
    const maxTrailLength = isGodcell ? 80 : (isMultiCell ? 67 : 50);

    // Get wing tip positions for godcell (already in world space)
    const wingTipPositions = isGodcell ? getGodcellWingTipPositions(cellGroup) : null;

    // Get nucleus offsets for multi-cells
    const nucleusOffsets = isMultiCell
      ? getMultiCellNucleusOffsets(player.radius)
      : [{ x: 0, y: 0 }];

    // Calculate trail width based on stage
    const cellRadius = player.radius;
    let maxWidth: number;
    let minTaperRatio: number;

    if (isGodcell) {
      // Godcell trails: thin, ethereal, full taper
      maxWidth = cellRadius * 0.08;
      minTaperRatio = 0;
    } else if (isMultiCell) {
      // Multi-cell trails: thinner, less taper
      const individualCellRadius = cellRadius * 0.35;
      const nucleusRadius = individualCellRadius * 0.3;
      maxWidth = nucleusRadius * 0.6;
      minTaperRatio = 0.3;
    } else {
      // Single-cell trails: full width, full taper
      const nucleusRadius = cellRadius * 0.3;
      maxWidth = nucleusRadius;
      minTaperRatio = 0;
    }

    // Get group rotation for transforming local offsets to world space
    // (not needed for godcell - wing tips are already world space)
    const groupRotZ = cellGroup.rotation.z || 0;

    for (let t = 0; t < trailCount; t++) {
      // Trail key includes stage type for proper cleanup
      const trailKey = isGodcell
        ? `${id}_wingtip_${t}`
        : (isMultiCell ? `${id}_nucleus_${t}` : id);
      activeTrailKeys.add(trailKey);

      // Get or create trail points array
      let points = trailPoints.get(trailKey);
      if (!points) {
        points = [];
        trailPoints.set(trailKey, points);
      }

      // Calculate world position based on stage
      let worldX: number, worldY: number, worldZ: number;

      if (isGodcell && wingTipPositions && wingTipPositions[t]) {
        // Godcell: use pre-calculated wing tip world positions
        const tipPos = wingTipPositions[t];
        worldX = tipPos.x;
        worldY = tipPos.y;
        worldZ = tipPos.z;
      } else {
        // Multi-cell/Single-cell: calculate from nucleus offsets
        const offset = nucleusOffsets[t] || { x: 0, y: 0 };
        const rotatedOffsetX = offset.x * Math.cos(groupRotZ) - offset.y * Math.sin(groupRotZ);
        const rotatedOffsetY = offset.x * Math.sin(groupRotZ) + offset.y * Math.cos(groupRotZ);
        worldX = cellGroup.position.x + rotatedOffsetX;
        worldY = cellGroup.position.y + rotatedOffsetY;
        worldZ = cellGroup.position.z;
      }

      points.push({ x: worldX, y: worldY, z: worldZ });

      // Keep only last N points
      if (points.length > maxTrailLength) {
        points.shift();
      }

      // Get or create trail mesh with pre-allocated buffers
      let trailMesh = trailMeshes.get(trailKey);
      if (!trailMesh) {
        const geometry = new THREE.BufferGeometry();

        // Pre-allocate buffers at max trail length to avoid per-frame allocations
        const maxVertices = maxTrailLength * 2;
        const positions = new Float32Array(maxVertices * 3);
        const colors = new Float32Array(maxVertices * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        // Pre-allocate index buffer (max triangles = (maxTrailLength - 1) * 2 * 3 indices)
        const maxIndices = (maxTrailLength - 1) * 6;
        const indices = new Uint16Array(maxIndices);
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const material = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          vertexColors: true,
        });
        trailMesh = new THREE.Mesh(geometry, material);
        // Trail is positioned in world space on sphere
        scene.add(trailMesh);
        trailMeshes.set(trailKey, trailMesh);
      }

      // Update trail opacity based on energy
      const energyRatio = player.energy / player.maxEnergy;
      const trailMaterial = trailMesh.material as THREE.MeshBasicMaterial;
      // Trail fades out as energy gets low (range 0.2-1.0)
      // Multi-cell trails slightly more transparent
      const baseOpacity = isMultiCell ? 0.7 : 1.0;
      trailMaterial.opacity = Math.max(0.2, energyRatio * 0.8 * baseOpacity + 0.2);

      // Update tapered ribbon geometry (reusing pre-allocated buffers)
      if (points.length >= 2) {
        const vertexCount = points.length * 2;

        // Get pre-allocated buffer arrays
        const posAttr = trailMesh.geometry.attributes.position as THREE.BufferAttribute;
        const colorAttr = trailMesh.geometry.attributes.color as THREE.BufferAttribute;
        const indexAttr = trailMesh.geometry.index as THREE.BufferAttribute;
        const positions = posAttr.array as Float32Array;
        const colors = colorAttr.array as Float32Array;
        const indices = indexAttr.array as Uint16Array;

        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const r = ((colorHex >> 16) & 255) / 255;
        const g = ((colorHex >> 8) & 255) / 255;
        const b = (colorHex & 255) / 255;

        // Turbulence constants (calculated once per trail)
        const turbulenceFreq = 2.5;
        const turbulenceAmp = 0.375;
        const flowSpeed = 4.0;
        const time = performance.now() * 0.001;

        for (let i = 0; i < points.length; i++) {
          const point = points[i];

          // Calculate width taper: thick at newest, thinner at oldest
          const age = i / (points.length - 1); // 0 = oldest, 1 = newest
          // Multi-cell: taper from minTaperRatio to 1.0 (less aggressive taper)
          const taperFactor = minTaperRatio + (1 - minTaperRatio) * age;
          const width = maxWidth * taperFactor;

          // Turbulent wake effect - sinusoidal width variation for liquid feel
          const phase = (i / points.length) * Math.PI * 2 * turbulenceFreq + time * flowSpeed;
          const turbulence = 1 + Math.sin(phase) * turbulenceAmp;
          const finalWidth = width * turbulence;

          // Calculate opacity fade
          const opacity = Math.pow(age, 1.5);

          const idx = i * 2;

          // Build ribbon in 3D on sphere surface (using reusable vectors)
          _pos.set(point.x, point.y, point.z ?? 0);
          _normal.copy(_pos).normalize();

          // Get tangent direction along trail
          if (i < points.length - 1) {
            const next = points[i + 1];
            _tangent.set(next.x - point.x, next.y - point.y, (next.z ?? 0) - (point.z ?? 0));
          } else if (i > 0) {
            const prev = points[i - 1];
            _tangent.set(point.x - prev.x, point.y - prev.y, (point.z ?? 0) - (prev.z ?? 0));
          }
          // Project tangent onto sphere surface (remove normal component)
          _tangent.addScaledVector(_normal, -_tangent.dot(_normal));
          if (_tangent.lengthSq() > 0.0001) {
            _tangent.normalize();
          } else {
            _tangent.set(1, 0, 0);
            _tangent.addScaledVector(_normal, -_tangent.dot(_normal)).normalize();
          }

          // Perpendicular direction on sphere surface
          _perp.crossVectors(_normal, _tangent).normalize();

          // Lift trail slightly above sphere surface
          _liftedPos.copy(_pos).addScaledVector(_normal, 0.5);

          // Top vertex
          positions[idx * 3] = _liftedPos.x + _perp.x * finalWidth;
          positions[idx * 3 + 1] = _liftedPos.y + _perp.y * finalWidth;
          positions[idx * 3 + 2] = _liftedPos.z + _perp.z * finalWidth;

          // Bottom vertex
          positions[(idx + 1) * 3] = _liftedPos.x - _perp.x * finalWidth;
          positions[(idx + 1) * 3 + 1] = _liftedPos.y - _perp.y * finalWidth;
          positions[(idx + 1) * 3 + 2] = _liftedPos.z - _perp.z * finalWidth;

          // Colors (same for both modes)
          colors[idx * 3] = r;
          colors[idx * 3 + 1] = g;
          colors[idx * 3 + 2] = b;

          // Fade colors based on age
          colors[(idx + 1) * 3] = r * opacity;
          colors[(idx + 1) * 3 + 1] = g * opacity;
          colors[(idx + 1) * 3 + 2] = b * opacity;

          // Write triangle indices for ribbon
          if (i < points.length - 1) {
            const current = i * 2;
            const nextIdx = (i + 1) * 2;
            const indexOffset = i * 6;
            indices[indexOffset] = current;
            indices[indexOffset + 1] = nextIdx;
            indices[indexOffset + 2] = current + 1;
            indices[indexOffset + 3] = nextIdx;
            indices[indexOffset + 4] = nextIdx + 1;
            indices[indexOffset + 5] = current + 1;
          }
        }

        // Mark buffers for GPU upload and set draw range
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        indexAttr.needsUpdate = true;
        trailMesh.geometry.setDrawRange(0, (points.length - 1) * 6);
        trailMesh.geometry.computeBoundingSphere();
      }
    }
  });

  // Clean up trails for disconnected players or stage changes
  trailPoints.forEach((_, key) => {
    if (!activeTrailKeys.has(key)) {
      const mesh = trailMeshes.get(key);
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        trailMeshes.delete(key);
      }
      trailPoints.delete(key);
    }
  });
}

/**
 * Dispose all trail meshes (call during renderer cleanup)
 */
export function disposeAllTrails(
  scene: THREE.Scene,
  trailPoints: Map<string, TrailPoint[]>,
  trailMeshes: Map<string, THREE.Mesh>
): void {
  trailMeshes.forEach((mesh) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
  trailMeshes.clear();
  trailPoints.clear();
}
