// ============================================
// Trail Renderer
// Creates and updates glowing ribbon trails behind players
// ============================================

import * as THREE from 'three';
import { EvolutionStage, GAME_CONFIG } from '@godcell/shared';

/**
 * Calculate player radius based on evolution stage
 * Duplicated here to avoid circular dependency with ThreeRenderer
 */
function getPlayerRadius(stage: EvolutionStage): number {
  switch (stage) {
    case EvolutionStage.SINGLE_CELL:
      return GAME_CONFIG.PLAYER_SIZE;
    case EvolutionStage.MULTI_CELL:
      return GAME_CONFIG.PLAYER_SIZE * 1.5;
    case EvolutionStage.CYBER_ORGANISM:
      return GAME_CONFIG.PLAYER_SIZE * 2.0;
    case EvolutionStage.HUMANOID:
      return GAME_CONFIG.PLAYER_SIZE * 2.5;
    case EvolutionStage.GODCELL:
      return GAME_CONFIG.PLAYER_SIZE * 3.0;
    default:
      return GAME_CONFIG.PLAYER_SIZE;
  }
}

/**
 * Trail point for position history
 */
interface TrailPoint {
  x: number;
  y: number;
}

/**
 * Player data needed for trail rendering
 */
interface TrailPlayerData {
  stage: EvolutionStage;
  color: string;
  energy: number;
  maxEnergy: number;
}

/**
 * Update player trails with tapered ribbon geometry
 *
 * @param scene - Three.js scene for adding/removing trail meshes
 * @param trailPoints - Map of player ID to trail point history (modified in place)
 * @param trailMeshes - Map of player ID to trail mesh (modified in place)
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
  const maxTrailLength = 50; // Trail point history

  players.forEach((player, id) => {
    // Get or create trail points array
    let points = trailPoints.get(id);
    if (!points) {
      points = [];
      trailPoints.set(id, points);
    }

    // Add current GROUP position to trail (not server position!)
    // cellGroup is on XZ plane: .x = game X, .z = -game Y
    const cellGroup = playerMeshes.get(id);
    if (cellGroup) {
      points.push({ x: cellGroup.position.x, y: -cellGroup.position.z });
    }

    // Keep only last N points
    if (points.length > maxTrailLength) {
      points.shift();
    }

    // Get or create trail mesh
    let trailMesh = trailMeshes.get(id);
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
      trailMesh.position.y = -0.5; // Below the cell (Y=height)
      scene.add(trailMesh);
      trailMeshes.set(id, trailMesh);
    }

    // Update trail opacity based on energy
    const energyRatio = player.energy / player.maxEnergy;
    const trailMaterial = trailMesh.material as THREE.MeshBasicMaterial;
    // Trail fades out as energy gets low (range 0.2-1.0)
    trailMaterial.opacity = Math.max(0.2, energyRatio * 0.8 + 0.2);

    // Calculate trail width based on nucleus size (not full cell size)
    const cellRadius = getPlayerRadius(player.stage);
    const nucleusRadius = cellRadius * 0.3;
    const maxWidth = nucleusRadius; // Trail width = nucleus radius

    // Create tapered ribbon geometry
    if (points.length >= 2) {
      const vertexCount = points.length * 2; // Two vertices per point (top and bottom of ribbon)
      const positions = new Float32Array(vertexCount * 3);
      const colors = new Float32Array(vertexCount * 3);
      const indices: number[] = [];

      const colorHex = parseInt(player.color.replace('#', ''), 16);
      const r = ((colorHex >> 16) & 255) / 255;
      const g = ((colorHex >> 8) & 255) / 255;
      const b = (colorHex & 255) / 255;

      for (let i = 0; i < points.length; i++) {
        const point = points[i];

        // Calculate width taper: thick at newest (i=length-1), thin at oldest (i=0)
        const age = i / (points.length - 1); // 0 = oldest, 1 = newest
        const width = maxWidth * age; // Taper from 0 to maxWidth

        // Calculate opacity fade
        const opacity = Math.pow(age, 1.5); // Fade from transparent to bright

        // Get perpendicular direction for ribbon width
        let perpX = 0, perpY = 1;
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

        // Create two vertices (top and bottom of ribbon)
        // XZ plane: X=game X, Y=height(0), Z=-game Y
        // Perpendicular direction (perpX, perpY) in game space maps to (perpX, 0, -perpY) in 3D
        const idx = i * 2;

        // Top vertex
        positions[idx * 3] = point.x + perpX * width;
        positions[idx * 3 + 1] = 0; // Y = height (flat on ground)
        positions[idx * 3 + 2] = -point.y - perpY * width;

        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;

        // Bottom vertex
        positions[(idx + 1) * 3] = point.x - perpX * width;
        positions[(idx + 1) * 3 + 1] = 0; // Y = height (flat on ground)
        positions[(idx + 1) * 3 + 2] = -point.y + perpY * width;

        // Fade colors based on age
        colors[(idx + 1) * 3] = r * opacity;
        colors[(idx + 1) * 3 + 1] = g * opacity;
        colors[(idx + 1) * 3 + 2] = b * opacity;

        // Create triangle indices for ribbon
        if (i < points.length - 1) {
          const current = i * 2;
          const next = (i + 1) * 2;

          // Two triangles per segment
          indices.push(current, next, current + 1);
          indices.push(next, next + 1, current + 1);
        }
      }

      trailMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      trailMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      trailMesh.geometry.setIndex(indices);
      trailMesh.geometry.computeBoundingSphere();
    }
  });

  // Clean up trails for disconnected players
  trailPoints.forEach((_, id) => {
    if (!players.has(id)) {
      const mesh = trailMeshes.get(id);
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        trailMeshes.delete(id);
      }
      trailPoints.delete(id);
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
