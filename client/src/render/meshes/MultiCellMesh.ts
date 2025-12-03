// ============================================
// Multi-Cell Stage Rendering Options
// ============================================

import * as THREE from 'three';

export type MultiCellStyle = 'colonial' | 'radial';

interface MultiCellParams {
  radius: number;
  colorHex: number;
  style: MultiCellStyle;
}

/**
 * Create a multi-cell organism group based on the specified style
 */
export function createMultiCell(params: MultiCellParams): THREE.Group {
  let group: THREE.Group;
  if (params.style === 'colonial') {
    group = createColonialCluster(params.radius, params.colorHex);
  } else {
    group = createRadialOrganism(params.radius, params.colorHex);
  }

  // Rotate group so multi-cell cluster lies flat on XZ plane when viewed from above
  // Camera looks down Y axis, so rotate -90° around X to flip local XY to world XZ
  group.rotation.x = -Math.PI / 2;

  return group;
}

// ============================================
// OPTION A: Colonial Cluster (Volvox-style)
// ============================================

function createColonialCluster(baseRadius: number, colorHex: number): THREE.Group {
  const group = new THREE.Group();

  // Individual cell size (smaller than single-cell)
  const cellRadius = baseRadius * 0.35;

  // Hexagonal arrangement: 6 cells around 1 center = 7 total
  const centerCell = createIndividualCell(cellRadius, colorHex, 1.0);
  group.add(centerCell);

  const ringRadius = cellRadius * 2.2; // Distance from center to ring cells
  const cellCount = 6;

  for (let i = 0; i < cellCount; i++) {
    const angle = (i / cellCount) * Math.PI * 2;
    const x = Math.cos(angle) * ringRadius;
    const y = Math.sin(angle) * ringRadius;

    const cell = createIndividualCell(cellRadius, colorHex, 0.85); // Slightly dimmer than center
    cell.position.set(x, y, 0);
    group.add(cell);
  }

  // Energy tethers connecting cells
  const tetherGroup = createEnergyTethers(ringRadius, cellCount, colorHex);
  group.add(tetherGroup);

  // Store metadata for animation
  group.userData.cellRadius = cellRadius;
  group.userData.cellCount = cellCount + 1; // 7 total
  group.userData.ringRadius = ringRadius;

  return group;
}

function createIndividualCell(radius: number, colorHex: number, intensityMultiplier: number): THREE.Group {
  const cellGroup = new THREE.Group();

  // Membrane
  const membraneGeometry = new THREE.SphereGeometry(radius, 16, 16);
  const membraneMaterial = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.2,
    roughness: 0.1,
    metalness: 0.05,
    clearcoat: 0.6,
  });
  const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
  cellGroup.add(membrane);

  // Nucleus
  const nucleusRadius = radius * 0.3;
  const nucleusGeometry = new THREE.SphereGeometry(nucleusRadius, 16, 16);
  const nucleusMaterial = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.5 * intensityMultiplier,
  });
  const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
  cellGroup.add(nucleus);

  return cellGroup;
}

function createEnergyTethers(ringRadius: number, cellCount: number, colorHex: number): THREE.Group {
  const tetherGroup = new THREE.Group();

  // Connect center to each ring cell
  for (let i = 0; i < cellCount; i++) {
    const angle = (i / cellCount) * Math.PI * 2;
    const x = Math.cos(angle) * ringRadius;
    const y = Math.sin(angle) * ringRadius;

    const points = [
      new THREE.Vector3(0, 0, 0), // Center
      new THREE.Vector3(x, y, 0), // Ring cell
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.4,
      linewidth: 2,
    });

    const tether = new THREE.Line(geometry, material);
    tetherGroup.add(tether);
  }

  // Connect adjacent ring cells
  for (let i = 0; i < cellCount; i++) {
    const angle1 = (i / cellCount) * Math.PI * 2;
    const angle2 = ((i + 1) % cellCount / cellCount) * Math.PI * 2;

    const x1 = Math.cos(angle1) * ringRadius;
    const y1 = Math.sin(angle1) * ringRadius;
    const x2 = Math.cos(angle2) * ringRadius;
    const y2 = Math.sin(angle2) * ringRadius;

    const points = [
      new THREE.Vector3(x1, y1, 0),
      new THREE.Vector3(x2, y2, 0),
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.3,
      linewidth: 1,
    });

    const tether = new THREE.Line(geometry, material);
    tetherGroup.add(tether);
  }

  return tetherGroup;
}

// ============================================
// OPTION B: Radial Organism (Hydra-style)
// ============================================

function createRadialOrganism(baseRadius: number, colorHex: number): THREE.Group {
  const group = new THREE.Group();

  // Central core (larger, brightest)
  const coreRadius = baseRadius * 0.5;
  const core = createIndividualCell(coreRadius, colorHex, 1.2);
  group.add(core);

  // Appendage cells (smaller, radiating outward)
  const appendageCount = 5;
  const appendageRadius = baseRadius * 0.3;
  const appendageDistance = coreRadius + appendageRadius * 1.8;

  for (let i = 0; i < appendageCount; i++) {
    const angle = (i / appendageCount) * Math.PI * 2;
    const x = Math.cos(angle) * appendageDistance;
    const y = Math.sin(angle) * appendageDistance;

    const appendage = createIndividualCell(appendageRadius, colorHex, 0.7);
    appendage.position.set(x, y, 0);
    group.add(appendage);

    // Energy flow line from core to appendage
    const flowLine = createEnergyFlowLine(0, 0, x, y, colorHex);
    group.add(flowLine);
  }

  // Store metadata
  group.userData.coreRadius = coreRadius;
  group.userData.appendageCount = appendageCount;
  group.userData.appendageRadius = appendageRadius;
  group.userData.appendageDistance = appendageDistance;

  return group;
}

function createEnergyFlowLine(x1: number, y1: number, x2: number, y2: number, colorHex: number): THREE.Mesh {
  // Create a thicker energy beam using a tube
  const path = new THREE.LineCurve3(
    new THREE.Vector3(x1, y1, 0),
    new THREE.Vector3(x2, y2, 0)
  );

  const tubeGeometry = new THREE.TubeGeometry(path, 2, 1.5, 8, false);
  const tubeMaterial = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });

  const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
  return tube;
}

// ============================================
// Animation Updates
// ============================================

/**
 * Animate colonial cluster (synchronized pulsing, gentle rotation)
 */
export function animateColonialCluster(group: THREE.Group, time: number, energyRatio: number): void {
  // No pulsing for now
  // const pulseSpeed = 2.0;
  // const pulseAmount = 0.04;
  // const scale = 1.0 + Math.sin(time * pulseSpeed) * pulseAmount * energyRatio;

  // Update cells (children 0-6 are cells, child 7 is tether group)
  const cellCount = group.userData.cellCount || 7;
  for (let i = 0; i < cellCount; i++) {
    const cell = group.children[i] as THREE.Group;
    if (cell) {
      // cell.scale.set(scale, scale, scale); // No pulse

      // Adjust nucleus brightness based on energy
      const nucleus = cell.children[1] as THREE.Mesh;
      if (nucleus) {
        const material = nucleus.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = (1.5 + Math.sin(time * 3) * 0.3) * energyRatio;
      }
    }
  }

  // Gentle rotation of entire cluster
  group.rotation.z = Math.sin(time * 0.5) * 0.2; // Rock back and forth

  // Pulse tether opacity
  const tetherGroup = group.children[cellCount] as THREE.Group;
  if (tetherGroup) {
    tetherGroup.children.forEach((tether) => {
      const material = (tether as THREE.Line).material as THREE.LineBasicMaterial;
      material.opacity = (0.3 + Math.sin(time * 2) * 0.15) * energyRatio;
    });
  }
}

/**
 * Animate radial organism (core pulsing, appendages waving)
 */
export function animateRadialOrganism(group: THREE.Group, time: number, energyRatio: number): void {
  const appendageCount = group.userData.appendageCount || 5;
  const appendageDistance = group.userData.appendageDistance || 20;

  // Core pulsing (child 0)
  const core = group.children[0] as THREE.Group;
  if (core) {
    const corePulseSpeed = 2.5;
    const corePulseAmount = 0.04; // Reduced to prevent nucleus ring artifact
    const coreScale = 1.0 + Math.sin(time * corePulseSpeed) * corePulseAmount * energyRatio;
    core.scale.set(coreScale, coreScale, coreScale);

    // Core nucleus brightness
    const coreNucleus = core.children[1] as THREE.Mesh;
    if (coreNucleus) {
      const material = coreNucleus.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = (1.8 + Math.sin(time * 3.5) * 0.4) * energyRatio;
    }
  }

  // Appendages waving (undulating motion)
  for (let i = 0; i < appendageCount; i++) {
    const appendageIndex = i + 1; // Core is 0, appendages start at 1
    const appendage = group.children[appendageIndex] as THREE.Group;
    const flowLine = group.children[appendageIndex + appendageCount] as THREE.Mesh;

    if (appendage) {
      // Base angle for this appendage
      const baseAngle = (i / appendageCount) * Math.PI * 2;

      // Wave motion: each appendage undulates with phase offset
      const wavePhase = time * 1.5 + i * 0.5;
      const waveAmount = 0.15; // How far they wave
      const waveOffset = Math.sin(wavePhase) * waveAmount;

      // Calculate new position with wave
      const angle = baseAngle + waveOffset;
      const distance = appendageDistance * (1.0 + Math.sin(wavePhase * 0.5) * 0.1); // Slight in-out

      appendage.position.x = Math.cos(angle) * distance;
      appendage.position.y = Math.sin(angle) * distance;

      // Pulse appendage
      const appendagePulse = 0.98 + Math.sin(time * 2 + i) * 0.04 * energyRatio; // Reduced pulse
      appendage.scale.set(appendagePulse, appendagePulse, appendagePulse);

      // Update appendage nucleus brightness
      const nucleus = appendage.children[1] as THREE.Mesh;
      if (nucleus) {
        const material = nucleus.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = (1.0 + Math.sin(time * 2.5 + i) * 0.3) * energyRatio;
      }

      // Update energy flow line to match new appendage position
      if (flowLine && flowLine.geometry) {
        const path = new THREE.LineCurve3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(appendage.position.x, appendage.position.y, 0)
        );

        const newGeometry = new THREE.TubeGeometry(path, 2, 1.5, 8, false);
        flowLine.geometry.dispose();
        flowLine.geometry = newGeometry;

        // Pulse flow line opacity
        const material = flowLine.material as THREE.MeshBasicMaterial;
        material.opacity = (0.5 + Math.sin(time * 3 + i * 0.3) * 0.2) * energyRatio;
      }
    }
  }
}

/**
 * Update multi-cell based on energy (sole life resource)
 */
export function updateMultiCellEnergy(
  group: THREE.Group,
  style: MultiCellStyle,
  energy: number,
  maxEnergy: number
): void {
  const energyRatio = energy / maxEnergy;
  const time = performance.now() * 0.001;

  if (style === 'colonial') {
    animateColonialCluster(group, time, energyRatio);
  } else {
    animateRadialOrganism(group, time, energyRatio);
  }

  // Energy affects overall opacity/dimming (apply to all cells)
  const cellCount = style === 'colonial' ? (group.userData.cellCount || 7) : 1;
  for (let i = 0; i < cellCount; i++) {
    const cell = group.children[i] as THREE.Group;
    if (cell && cell.children) {
      // Dim nucleus based on energy
      const nucleus = cell.children[1] as THREE.Mesh;
      if (nucleus) {
        const material = nucleus.material as THREE.MeshStandardMaterial;
        material.opacity = 0.5 + energyRatio * 0.5; // 0.5-1.0 based on energy
      }
    }
  }
}
