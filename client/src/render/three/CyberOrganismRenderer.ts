// ============================================
// Cyber-Organism Renderer (Stage 3)
// Creates a 6-legged hexapod creature
// ============================================

import * as THREE from 'three';

/**
 * Visual parameters for cyber-organism appearance
 */
const CYBER_CONFIG = {
  // Body proportions (relative to base radius)
  BODY_LENGTH: 1.4,        // Elongated capsule shape (1.4x radius)
  BODY_WIDTH: 0.7,         // Width relative to radius
  BODY_SEGMENTS: 16,       // Geometry detail

  // Leg configuration
  LEG_COUNT: 6,            // 3 per side
  LEG_LENGTH: 1.2,         // Leg length relative to body length
  LEG_THICKNESS: 0.08,     // Leg cylinder radius (relative to body)
  LEG_SEGMENTS: 2,         // Joints per leg (upper + lower)
  LEG_ANGLE_SPREAD: 0.8,   // How far legs spread from body (radians)

  // Tail configuration
  TAIL_SEGMENTS: 4,        // Number of tail segments
  TAIL_LENGTH: 1.0,        // Total tail length relative to body length
  TAIL_BASE_THICKNESS: 0.12, // Thickness at base (relative to body width)
  TAIL_TIP_THICKNESS: 0.03,  // Thickness at tip (tapers down)
  TAIL_SWAY_AMPLITUDE: 0.25, // How much tail sways side-to-side (radians)
  TAIL_SWAY_FREQUENCY: 1.5,  // Tail sway frequency (Hz)

  // Head configuration
  HEAD_SIZE: 0.35,         // Head size relative to body width
  HEAD_OFFSET: 0.65,       // How far head extends from body center (relative to body length)
  HEAD_LIFT: 0.4,          // How high head floats above body (relative to body width) - disconnected look
  HEAD_BOB_AMPLITUDE: 0.03, // Subtle head bob during movement (relative to body)
  HEAD_BOB_FREQUENCY: 2.0,  // Head bob frequency (Hz)

  // Core/nucleus
  CORE_SIZE: 0.25,         // Core size relative to body width
  CORE_PULSE_SPEED: 2.0,   // Glow pulse frequency (Hz)
  CORE_PULSE_INTENSITY: 0.3, // How much the glow varies (0-1)

  // Animation
  WALK_FREQUENCY: 4.0,     // Steps per second
  WALK_AMPLITUDE: 0.15,    // How much legs move during walk (radians)
  IDLE_SWAY_FREQUENCY: 0.5, // Idle breathing/sway frequency
  IDLE_SWAY_AMPLITUDE: 0.05, // Subtle idle movement
};

/**
 * Create a cyber-organism (hexapod) mesh
 *
 * @param radius - Base radius in world units (from getPlayerRadius)
 * @param colorHex - Player color as hex number
 * @returns THREE.Group containing the complete hexapod mesh
 */
export function createCyberOrganism(radius: number, colorHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cyberOrganism';

  // Calculate dimensions
  const bodyLength = radius * CYBER_CONFIG.BODY_LENGTH;
  const bodyWidth = radius * CYBER_CONFIG.BODY_WIDTH;

  // === BODY (Elongated capsule/ellipsoid) ===
  const body = createBody(bodyLength, bodyWidth, colorHex);
  group.add(body);

  // === LEGS (6 total, 3 per side) ===
  const legLength = bodyLength * CYBER_CONFIG.LEG_LENGTH;
  const legThickness = bodyWidth * CYBER_CONFIG.LEG_THICKNESS;

  // Left side legs (indices 0, 1, 2)
  for (let i = 0; i < 3; i++) {
    const leg = createLeg(legLength, legThickness, colorHex, 'left', i);
    positionLeg(leg, bodyLength, bodyWidth, 'left', i);
    group.add(leg);
  }

  // Right side legs (indices 3, 4, 5)
  for (let i = 0; i < 3; i++) {
    const leg = createLeg(legLength, legThickness, colorHex, 'right', i);
    positionLeg(leg, bodyLength, bodyWidth, 'right', i);
    group.add(leg);
  }

  // === HEAD (Front sphere, floating slightly above body) ===
  const head = createHead(bodyWidth * CYBER_CONFIG.HEAD_SIZE, colorHex);
  const headLift = bodyWidth * CYBER_CONFIG.HEAD_LIFT;
  head.position.set(bodyLength * CYBER_CONFIG.HEAD_OFFSET, 0, headLift);
  group.add(head);

  // === CORE (Glowing energy center) ===
  const core = createCore(bodyWidth * CYBER_CONFIG.CORE_SIZE, colorHex);
  group.add(core);

  // === TAIL (Segmented appendage at rear) ===
  const tailLength = bodyLength * CYBER_CONFIG.TAIL_LENGTH;
  const tail = createTail(tailLength, bodyWidth, colorHex);
  // Position tail at back of body
  tail.position.set(-bodyLength / 2, 0, 0);
  group.add(tail);

  // Store metadata for animation
  group.userData.baseRadius = radius;
  group.userData.colorHex = colorHex;
  group.userData.walkPhase = 0; // Animation phase
  group.userData.isMoving = false; // Track if creature is moving

  return group;
}

/**
 * Create the elongated body mesh
 */
function createBody(length: number, width: number, colorHex: number): THREE.Mesh {
  // Use CapsuleGeometry for smooth elongated shape
  const geometry = new THREE.CapsuleGeometry(
    width,                    // radius
    length - width * 2,       // length (minus caps)
    CYBER_CONFIG.BODY_SEGMENTS,
    CYBER_CONFIG.BODY_SEGMENTS
  );

  // Rotate to horizontal orientation (default is vertical)
  geometry.rotateZ(Math.PI / 2);

  const material = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.7,
    roughness: 0.3,
    metalness: 0.4,          // More metallic than cells
    clearcoat: 0.5,
    emissive: colorHex,
    emissiveIntensity: 0.15, // Subtle glow
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'body';
  return mesh;
}

/**
 * Create a single leg with two segments (upper + lower)
 */
function createLeg(
  length: number,
  thickness: number,
  colorHex: number,
  side: 'left' | 'right',
  index: number
): THREE.Group {
  const legGroup = new THREE.Group();
  legGroup.name = `leg-${side}-${index}`;

  const segmentLength = length / 2;

  // Darken color slightly for legs
  const legColor = new THREE.Color(colorHex).multiplyScalar(0.7);

  // Upper leg segment
  const upperGeometry = new THREE.CylinderGeometry(
    thickness,         // top radius
    thickness * 1.2,   // bottom radius (slightly thicker at base)
    segmentLength,
    8
  );
  const upperMaterial = new THREE.MeshPhysicalMaterial({
    color: legColor,
    roughness: 0.4,
    metalness: 0.5,
    emissive: legColor,
    emissiveIntensity: 0.1,
  });
  const upper = new THREE.Mesh(upperGeometry, upperMaterial);
  upper.name = 'upper';
  upper.position.y = -segmentLength / 2; // Pivot at top
  legGroup.add(upper);

  // Lower leg segment (child of upper for hierarchical animation)
  const lowerGroup = new THREE.Group();
  lowerGroup.name = 'joint';
  lowerGroup.position.y = -segmentLength; // At bottom of upper segment

  const lowerGeometry = new THREE.CylinderGeometry(
    thickness * 0.8,   // top radius
    thickness * 0.5,   // bottom radius (tapers)
    segmentLength,
    8
  );
  const lowerMaterial = new THREE.MeshPhysicalMaterial({
    color: legColor,
    roughness: 0.4,
    metalness: 0.5,
    emissive: legColor,
    emissiveIntensity: 0.1,
  });
  const lower = new THREE.Mesh(lowerGeometry, lowerMaterial);
  lower.name = 'lower';
  lower.position.y = -segmentLength / 2;
  lowerGroup.add(lower);

  legGroup.add(lowerGroup);

  // Store segment references for animation
  legGroup.userData.upper = upper;
  legGroup.userData.joint = lowerGroup;
  legGroup.userData.side = side;
  legGroup.userData.index = index;

  return legGroup;
}

/**
 * Position a leg on the body
 */
function positionLeg(
  leg: THREE.Group,
  bodyLength: number,
  bodyWidth: number,
  side: 'left' | 'right',
  index: number
): void {
  // Position along body length (-1, 0, 1 for front, middle, back)
  const longitudinalPositions = [-0.35, 0, 0.35]; // Relative positions
  const x = bodyLength * longitudinalPositions[index];

  // Position to side of body
  const sideSign = side === 'left' ? 1 : -1;
  const y = bodyWidth * 0.9 * sideSign;

  leg.position.set(x, y, 0);

  // Rotate leg outward
  const baseAngle = Math.PI / 2; // Point down
  const spreadAngle = CYBER_CONFIG.LEG_ANGLE_SPREAD * sideSign;
  leg.rotation.z = baseAngle + spreadAngle;

  // Slight forward/backward angle based on position
  const forwardAngle = index === 0 ? -0.2 : (index === 2 ? 0.2 : 0);
  leg.rotation.x = forwardAngle;
}

/**
 * Create the glowing energy core
 */
function createCore(radius: number, colorHex: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 16, 16);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: colorHex,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.9,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'core';
  return mesh;
}

/**
 * Create the head sphere at the front of the creature
 */
function createHead(radius: number, colorHex: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 16, 16);

  const material = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.8,
    roughness: 0.2,
    metalness: 0.5,
    clearcoat: 0.6,
    emissive: colorHex,
    emissiveIntensity: 0.2, // Slightly brighter than body
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'head';
  return mesh;
}

/**
 * Create a segmented tail that extends from the back of the body
 * Each segment is a child of the previous, allowing wave-like animation
 */
function createTail(totalLength: number, bodyWidth: number, colorHex: number): THREE.Group {
  const tailGroup = new THREE.Group();
  tailGroup.name = 'tail';

  const segmentCount = CYBER_CONFIG.TAIL_SEGMENTS;
  const segmentLength = totalLength / segmentCount;
  const baseThickness = bodyWidth * CYBER_CONFIG.TAIL_BASE_THICKNESS;
  const tipThickness = bodyWidth * CYBER_CONFIG.TAIL_TIP_THICKNESS;

  // Darken color for tail (similar to legs)
  const tailColor = new THREE.Color(colorHex).multiplyScalar(0.6);

  // Build segments as a chain (each segment is child of previous)
  let parentGroup = tailGroup;

  for (let i = 0; i < segmentCount; i++) {
    const t = i / (segmentCount - 1); // 0 to 1 along tail
    const topRadius = baseThickness * (1 - t * 0.7); // Taper from base
    const bottomRadius = baseThickness * (1 - (t + 1 / segmentCount) * 0.7);

    // Clamp to minimum tip thickness
    const finalTopRadius = Math.max(topRadius, tipThickness);
    const finalBottomRadius = Math.max(bottomRadius, tipThickness * 0.5);

    const segmentGroup = new THREE.Group();
    segmentGroup.name = `tail-segment-${i}`;

    const geometry = new THREE.CylinderGeometry(
      finalTopRadius,
      finalBottomRadius,
      segmentLength,
      8
    );
    // Rotate cylinder to point backward (along -X axis)
    geometry.rotateZ(Math.PI / 2);

    const material = new THREE.MeshPhysicalMaterial({
      color: tailColor,
      roughness: 0.4,
      metalness: 0.5,
      emissive: tailColor,
      emissiveIntensity: 0.1,
    });

    const segment = new THREE.Mesh(geometry, material);
    segment.name = `segment-mesh-${i}`;
    // Position segment so pivot is at the connection point
    segment.position.x = -segmentLength / 2;
    segmentGroup.add(segment);

    // Position this segment group at the end of the previous segment
    if (i === 0) {
      // First segment attaches at tail origin
      segmentGroup.position.set(0, 0, 0);
    } else {
      // Subsequent segments attach at the end of previous
      segmentGroup.position.set(-segmentLength, 0, 0);
    }

    parentGroup.add(segmentGroup);

    // Store segment reference for animation
    segmentGroup.userData.segmentIndex = i;

    // Next segment will be child of this one
    parentGroup = segmentGroup;
  }

  return tailGroup;
}

/**
 * Update cyber-organism animation (called every frame)
 *
 * @param group - The cyber-organism group
 * @param isMoving - Whether the creature is currently moving
 * @param dt - Delta time in seconds
 */
export function updateCyberOrganismAnimation(
  group: THREE.Group,
  isMoving: boolean,
  dt: number
): void {
  if (!group.userData.baseRadius) return;

  // Update walk phase
  const frequency = isMoving ? CYBER_CONFIG.WALK_FREQUENCY : CYBER_CONFIG.IDLE_SWAY_FREQUENCY;
  const amplitude = isMoving ? CYBER_CONFIG.WALK_AMPLITUDE : CYBER_CONFIG.IDLE_SWAY_AMPLITUDE;
  group.userData.walkPhase = (group.userData.walkPhase + dt * frequency * Math.PI * 2) % (Math.PI * 2);

  const phase = group.userData.walkPhase;

  // Animate legs
  group.children.forEach(child => {
    if (child.name.startsWith('leg-')) {
      const legGroup = child as THREE.Group;
      const { index, side } = legGroup.userData;

      // Tripod gait: legs 0,2 (front/back) move together, leg 1 (middle) opposite
      // Left and right sides alternate
      const gaitOffset = index === 1 ? Math.PI : 0;
      const sideOffset = side === 'right' ? Math.PI : 0;
      const legPhase = phase + gaitOffset + sideOffset;

      // Swing leg forward/backward
      const swing = Math.sin(legPhase) * amplitude;
      legGroup.rotation.x += swing;

      // Animate joint (knee bend)
      const joint = legGroup.userData.joint as THREE.Group;
      if (joint) {
        const bendAmount = Math.abs(Math.sin(legPhase)) * amplitude * 0.5;
        joint.rotation.x = bendAmount;
      }
    }
  });

  // Animate core glow
  const core = group.children.find(c => c.name === 'core') as THREE.Mesh | undefined;
  if (core && core.material instanceof THREE.MeshStandardMaterial) {
    const pulsePhase = Date.now() * 0.001 * CYBER_CONFIG.CORE_PULSE_SPEED * Math.PI * 2;
    const pulseIntensity = 1.5 + Math.sin(pulsePhase) * CYBER_CONFIG.CORE_PULSE_INTENSITY;
    core.material.emissiveIntensity = pulseIntensity;
  }

  // Animate head bob when moving
  const head = group.children.find(c => c.name === 'head') as THREE.Mesh | undefined;
  if (head) {
    const baseRadius = group.userData.baseRadius as number;
    const bodyLength = baseRadius * CYBER_CONFIG.BODY_LENGTH;
    const bodyWidth = baseRadius * CYBER_CONFIG.BODY_WIDTH;
    const baseX = bodyLength * CYBER_CONFIG.HEAD_OFFSET;
    const baseZ = bodyWidth * CYBER_CONFIG.HEAD_LIFT; // Floating height

    if (isMoving) {
      const headPhase = Date.now() * 0.001 * CYBER_CONFIG.HEAD_BOB_FREQUENCY * Math.PI * 2;
      const bobAmount = baseRadius * CYBER_CONFIG.HEAD_BOB_AMPLITUDE;
      // Subtle forward/back and up/down bob
      head.position.x = baseX + Math.sin(headPhase) * bobAmount * 0.5;
      head.position.z = baseZ + Math.abs(Math.sin(headPhase * 2)) * bobAmount;
    } else {
      // Reset to base position when idle
      head.position.x = baseX;
      head.position.z = baseZ;
    }
  }

  // Animate tail with wave-like motion
  const tail = group.children.find(c => c.name === 'tail') as THREE.Group | undefined;
  if (tail) {
    const tailFrequency = isMoving ? CYBER_CONFIG.TAIL_SWAY_FREQUENCY * 2 : CYBER_CONFIG.TAIL_SWAY_FREQUENCY;
    const tailAmplitude = isMoving ? CYBER_CONFIG.TAIL_SWAY_AMPLITUDE * 1.5 : CYBER_CONFIG.TAIL_SWAY_AMPLITUDE;
    const tailPhase = Date.now() * 0.001 * tailFrequency * Math.PI * 2;

    // Traverse tail segments and apply wave motion
    // Each segment rotates slightly more than the previous, creating a sinuous wave
    const animateTailSegment = (node: THREE.Object3D, segmentIndex: number) => {
      if (node.name.startsWith('tail-segment-')) {
        const idx = node.userData.segmentIndex as number;
        // Wave propagates down the tail with increasing amplitude
        const segmentPhase = tailPhase - idx * 0.8; // Phase delay per segment
        const segmentAmplitude = tailAmplitude * (1 + idx * 0.3); // Amplitude increases toward tip
        // Rotate on Y axis for side-to-side sway (in local space of the tail)
        node.rotation.y = Math.sin(segmentPhase) * segmentAmplitude;
      }
      node.children.forEach(child => animateTailSegment(child, segmentIndex + 1));
    };
    animateTailSegment(tail, 0);
  }
}

/**
 * Update cyber-organism energy visualization
 * Lower energy = dimmer glow, darker body
 *
 * @param group - The cyber-organism group
 * @param energyRatio - Current energy / max energy (0-1)
 */
export function updateCyberOrganismEnergy(group: THREE.Group, energyRatio: number): void {
  // Clamp to valid range
  const ratio = Math.max(0, Math.min(1, energyRatio));

  // Update body opacity/emissive
  const body = group.children.find(c => c.name === 'body') as THREE.Mesh | undefined;
  if (body && body.material instanceof THREE.MeshPhysicalMaterial) {
    body.material.emissiveIntensity = 0.15 * ratio;
    body.material.opacity = 0.5 + 0.2 * ratio;
  }

  // Update core intensity
  const core = group.children.find(c => c.name === 'core') as THREE.Mesh | undefined;
  if (core && core.material instanceof THREE.MeshStandardMaterial) {
    // Keep some minimum glow even at low energy
    const baseIntensity = 0.3 + 1.2 * ratio;
    core.material.emissiveIntensity = baseIntensity;
  }
}

/**
 * Dispose of cyber-organism resources
 */
export function disposeCyberOrganism(group: THREE.Group): void {
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}
