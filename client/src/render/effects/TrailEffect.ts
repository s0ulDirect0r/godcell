// ============================================
// Trail Renderer
// Creates and updates glowing ribbon trails behind players
// Single-cells: 1 trail behind center
// Multi-cells: 7 trails behind each nucleus (center + 6 ring)
// ============================================

import * as THREE from 'three';
import { EvolutionStage, isSphereMode } from '#shared';

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

    // Determine if multi-cell (needs 7 trails) or single-cell (1 trail)
    const isMultiCell = player.stage === EvolutionStage.MULTI_CELL;
    const trailCount = isMultiCell ? MULTICELL_NUCLEUS_COUNT : 1;
    // Multi-cell trails are 1/3 longer to match their larger visual footprint
    const maxTrailLength = isMultiCell ? 67 : 50;

    // Get nucleus offsets for multi-cells
    const nucleusOffsets = isMultiCell
      ? getMultiCellNucleusOffsets(player.radius)
      : [{ x: 0, y: 0 }];

    // Calculate trail width based on nucleus size
    const cellRadius = player.radius;
    // Multi-cell: individual cell radius is smaller, nucleus is 30% of that
    // Single-cell: nucleus is 30% of cell radius
    const individualCellRadius = isMultiCell ? cellRadius * 0.35 : cellRadius;
    const nucleusRadius = individualCellRadius * 0.3;
    // Multi-cell trails: thinner, less taper (0.6x width, 0.3 min taper)
    // Single-cell trails: full width, full taper
    const maxWidth = isMultiCell ? nucleusRadius * 0.6 : nucleusRadius;
    const minTaperRatio = isMultiCell ? 0.3 : 0; // Multi-cell trails don't taper to zero

    // Get group rotation for transforming local offsets to world space
    // The multi-cell group has rotation.z for the rocking animation
    // and rotation.x = -PI/2 to lie flat on XZ plane
    const groupRotZ = cellGroup.rotation.z || 0;

    for (let t = 0; t < trailCount; t++) {
      const trailKey = isMultiCell ? `${id}_nucleus_${t}` : id;
      activeTrailKeys.add(trailKey);

      // Get or create trail points array
      let points = trailPoints.get(trailKey);
      if (!points) {
        points = [];
        trailPoints.set(trailKey, points);
      }

      // Calculate world position for this nucleus
      const offset = nucleusOffsets[t];
      // Apply group rotation to offset (rotation around Z in local space)
      const rotatedOffsetX = offset.x * Math.cos(groupRotZ) - offset.y * Math.sin(groupRotZ);
      const rotatedOffsetY = offset.x * Math.sin(groupRotZ) + offset.y * Math.cos(groupRotZ);

      if (isSphereMode()) {
        // Sphere mode: store 3D position directly
        // Note: offsets are small relative to sphere, just add to position
        const worldX = cellGroup.position.x + rotatedOffsetX;
        const worldY = cellGroup.position.y + rotatedOffsetY;
        const worldZ = cellGroup.position.z;
        points.push({ x: worldX, y: worldY, z: worldZ });
      } else {
        // Flat mode: cellGroup position is in 3D space: .x = game X, .z = -game Y
        const worldX = cellGroup.position.x + rotatedOffsetX;
        const worldY = -cellGroup.position.z + rotatedOffsetY;
        points.push({ x: worldX, y: worldY });
      }

      // Keep only last N points
      if (points.length > maxTrailLength) {
        points.shift();
      }

      // Get or create trail mesh
      let trailMesh = trailMeshes.get(trailKey);
      if (!trailMesh) {
        const geometry = new THREE.BufferGeometry();
        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const material = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 1,
          side: THREE.DoubleSide,
          vertexColors: true,
        });
        trailMesh = new THREE.Mesh(geometry, material);
        // In sphere mode, trail is positioned in world space (no offset needed)
        // In flat mode, position slightly below cell
        if (!isSphereMode()) {
          trailMesh.position.y = -0.5;
        }
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

      // Create tapered ribbon geometry
      if (points.length >= 2) {
        const vertexCount = points.length * 2;
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        const indices: number[] = [];

        const colorHex = parseInt(player.color.replace('#', ''), 16);
        const r = ((colorHex >> 16) & 255) / 255;
        const g = ((colorHex >> 8) & 255) / 255;
        const b = (colorHex & 255) / 255;

        const sphereMode = isSphereMode();

        for (let i = 0; i < points.length; i++) {
          const point = points[i];

          // Calculate width taper: thick at newest, thinner at oldest
          const age = i / (points.length - 1); // 0 = oldest, 1 = newest
          // Multi-cell: taper from minTaperRatio to 1.0 (less aggressive taper)
          const taperFactor = minTaperRatio + (1 - minTaperRatio) * age;
          const width = maxWidth * taperFactor;

          // Turbulent wake effect - sinusoidal width variation for liquid feel
          // turbulenceFreq: waves per trail length (1.5-4.0, higher = more ripples)
          // turbulenceAmp: % of width variation (0.15-0.5, higher = more dramatic)
          // flowSpeed: how fast ripples travel along trail (rad/sec)
          const turbulenceFreq = 2.5;
          const turbulenceAmp = 0.375;
          const flowSpeed = 4.0;
          const time = performance.now() * 0.001;
          const phase = (i / points.length) * Math.PI * 2 * turbulenceFreq + time * flowSpeed;
          const turbulence = 1 + Math.sin(phase) * turbulenceAmp;
          const finalWidth = width * turbulence;

          // Calculate opacity fade
          const opacity = Math.pow(age, 1.5);

          const idx = i * 2;

          if (sphereMode) {
            // Sphere mode: build ribbon in 3D on sphere surface
            const pos = new THREE.Vector3(point.x, point.y, point.z ?? 0);
            const normal = pos.clone().normalize();

            // Get tangent direction along trail
            let tangent = new THREE.Vector3();
            if (i < points.length - 1) {
              const next = points[i + 1];
              tangent.set(next.x - point.x, next.y - point.y, (next.z ?? 0) - (point.z ?? 0));
            } else if (i > 0) {
              const prev = points[i - 1];
              tangent.set(point.x - prev.x, point.y - prev.y, (point.z ?? 0) - (prev.z ?? 0));
            }
            // Project tangent onto sphere surface (remove normal component)
            tangent.addScaledVector(normal, -tangent.dot(normal));
            if (tangent.lengthSq() > 0.0001) {
              tangent.normalize();
            } else {
              tangent.set(1, 0, 0);
              tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
            }

            // Perpendicular direction on sphere surface
            const perp = new THREE.Vector3().crossVectors(normal, tangent).normalize();

            // Lift trail slightly above sphere surface
            const liftedPos = pos.clone().addScaledVector(normal, 0.5);

            // Top vertex
            positions[idx * 3] = liftedPos.x + perp.x * finalWidth;
            positions[idx * 3 + 1] = liftedPos.y + perp.y * finalWidth;
            positions[idx * 3 + 2] = liftedPos.z + perp.z * finalWidth;

            // Bottom vertex
            positions[(idx + 1) * 3] = liftedPos.x - perp.x * finalWidth;
            positions[(idx + 1) * 3 + 1] = liftedPos.y - perp.y * finalWidth;
            positions[(idx + 1) * 3 + 2] = liftedPos.z - perp.z * finalWidth;
          } else {
            // Flat mode: build ribbon on XZ plane
            // Get perpendicular direction for ribbon width
            let perpX = 0,
              perpY = 1;
            if (i < points.length - 1) {
              const next = points[i + 1];
              const dx = next.x - point.x;
              const dy = next.y - point.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len > 0) {
                perpX = -dy / len;
                perpY = dx / len;
              }
            } else if (i > 0) {
              const prev = points[i - 1];
              const dx = point.x - prev.x;
              const dy = point.y - prev.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len > 0) {
                perpX = -dy / len;
                perpY = dx / len;
              }
            }

            // Top vertex
            positions[idx * 3] = point.x + perpX * finalWidth;
            positions[idx * 3 + 1] = 0;
            positions[idx * 3 + 2] = -point.y - perpY * finalWidth;

            // Bottom vertex
            positions[(idx + 1) * 3] = point.x - perpX * finalWidth;
            positions[(idx + 1) * 3 + 1] = 0;
            positions[(idx + 1) * 3 + 2] = -point.y + perpY * finalWidth;
          }

          // Colors (same for both modes)
          colors[idx * 3] = r;
          colors[idx * 3 + 1] = g;
          colors[idx * 3 + 2] = b;

          // Fade colors based on age
          colors[(idx + 1) * 3] = r * opacity;
          colors[(idx + 1) * 3 + 1] = g * opacity;
          colors[(idx + 1) * 3 + 2] = b * opacity;

          // Create triangle indices for ribbon
          if (i < points.length - 1) {
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
