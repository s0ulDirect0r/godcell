// ============================================
// Compass Indicator Renderer
// Shows directional arrows pointing to detected entities
// ============================================

import * as THREE from 'three';
import { EvolutionStage } from '#shared';

/**
 * Detected entity for compass indicator display
 */
export interface DetectedEntity {
  entityType: 'nutrient' | 'player' | 'swarm';
  position: { x: number; y: number };
}

/**
 * Dispose of an existing compass indicators group
 * @param compassIndicators - The group to dispose
 */
export function disposeCompassIndicators(compassIndicators: THREE.Group): void {
  compassIndicators.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}

/**
 * Update compass indicators showing directions to detected entities
 * Shows colored arrows on the ring edge pointing toward detected entities
 *
 * @param scene - Three.js scene to add compass to
 * @param existingCompass - Previous compass group to remove (or null)
 * @param detectedEntities - Array of detected entities to show arrows for
 * @param playerPosition - Current player position
 * @param radius - Player radius for positioning arrows
 * @param stage - Current evolution stage (only Stage 2+ shows compass)
 * @returns New compass indicators group, or null if none needed
 */
export function updateCompassIndicators(
  scene: THREE.Scene,
  existingCompass: THREE.Group | null,
  detectedEntities: DetectedEntity[],
  playerPosition: { x: number; y: number },
  radius: number,
  stage: EvolutionStage
): THREE.Group | null {
  // Remove old compass indicators if they exist
  if (existingCompass) {
    disposeCompassIndicators(existingCompass);
    scene.remove(existingCompass);
  }

  // Only show compass for Stage 2+ (multi-cell has chemical sensing)
  if (stage === EvolutionStage.SINGLE_CELL) return null;

  // No detected entities to show
  if (detectedEntities.length === 0) return null;

  // Create new compass group on XZ plane (Y=height)
  const compassGroup = new THREE.Group();
  compassGroup.position.set(playerPosition.x, 0.2, -playerPosition.y); // Above outline

  const arrowSize = 12; // Base size of arrow (bigger)
  const ringRadius = radius + 35; // Position on invisible ring outside the white circle

  // Render arrow for each detected entity
  for (const entity of detectedEntities) {
    // Calculate angle from player to entity
    const dx = entity.position.x - playerPosition.x;
    const dy = entity.position.y - playerPosition.y;
    const angle = Math.atan2(dy, dx);

    // Choose color based on entity type
    let arrowColor: number;
    if (entity.entityType === 'nutrient') {
      arrowColor = 0x00ff00; // Green - food source
    } else if (entity.entityType === 'player') {
      arrowColor = 0xff00ff; // Magenta - other players
    } else {
      arrowColor = 0xff0000; // Red - threats (swarms)
    }

    // Create arrow geometry (pointier triangle)
    const arrowGeometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0,
      arrowSize * 1.2,
      0, // Tip (pointing outward, longer)
      -arrowSize * 0.35,
      -arrowSize * 0.4,
      0, // Base left (narrower)
      arrowSize * 0.35,
      -arrowSize * 0.4,
      0, // Base right (narrower)
    ]);
    arrowGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: arrowColor,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);

    // Position arrow on ring edge (XZ plane: game Y maps to -Z)
    arrow.position.x = Math.cos(angle) * ringRadius;
    arrow.position.y = 0;
    arrow.position.z = -Math.sin(angle) * ringRadius;

    // Rotate arrow to lie flat on XZ plane and point outward
    // First rotate -90° around X to lay flat (arrow now points +Z)
    // Then rotate around Y to point toward entity (offset by π/2 for initial +Z orientation)
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.y = -angle - Math.PI / 2;

    compassGroup.add(arrow);
  }

  scene.add(compassGroup);
  return compassGroup;
}
