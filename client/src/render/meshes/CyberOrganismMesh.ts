// ============================================
// Cyber-Organism Renderer (Stage 3)
// Segmented creature with head, body pods, spiked tail, and 6 legs
//
// Local coordinate system (no baked-in rotation):
// - X axis: body axis (head at -X, tail at +X) = forward direction
// - Y axis: leg direction (left leg +Y, right leg -Y) = right direction
// - Z axis: dorsal direction (+Z = dorsal/top) = up direction
//
// Orientation is applied externally by orientHexapodToSurface() based on
// sphere position and heading. Legs curve toward -Z (toward sphere center).
// ============================================

import * as THREE from 'three';

/**
 * Cyber-Organism Configuration
 * All geometry values are in "reference units" - multiplied by scale factor (s) during creation.
 * This allows the entire creature to scale uniformly with the radius parameter.
 * Exported for model-viewer tuning.
 */
export const CONFIG = {
  // === SCALE ===
  SCALE: 0.5, // Overall size multiplier applied to input radius
  REF_UNIT: 1.8, // Reference unit (original head radius) for conversion

  // === HEAD ===
  HEAD: {
    radius: 1.8, // Head sphere radius
    position: -3, // X position along body axis (negative = front)
    eye: {
      radius: 0.8, // Eye sphere radius
      position: -1.5, // X offset from head center (negative = forward)
      lightIntensity: 3, // PointLight intensity
      lightRange: 7, // PointLight distance
    },
  },

  // === BODY SEGMENTS ===
  BODY: {
    segmentCount: 3, // Number of body segments
    baseRadius: 1.4, // Radius of first (largest) segment
    startX: -0.5, // X position of first segment
    spacing: 2, // X distance between segment centers
    taper: 0.15, // Size reduction per segment (0.15 = 15% smaller each)
    squash: 0.7, // Z-axis scale (flattens dorsal-ventral)
    centerOffset: 2.5, // Body group X offset to center visual mass at origin
    orb: {
      radius: 0.4, // Dorsal orb radius (scales with segment)
      zOffset: 0.8, // Z position on segment (scales with segment)
      lightIntensity: 1.5, // PointLight intensity
      lightRange: 4, // PointLight distance
    },
  },

  // === TAIL ===
  TAIL: {
    segmentCount: 5, // Number of tail segments
    startX: 4.5, // X position of first tail segment
    startZ: 0.2, // Initial Z offset (dorsal direction)
    initialSize: 0.8, // Radius of first tail segment
    decay: 0.85, // Size multiplier per segment (0.85 = 15% smaller each)
    xStep: 1.3, // X progression multiplier (tailSize * xStep)
    zStep: 0.4, // Z progression multiplier (tailSize * zStep)
    spike: {
      radiusRatio: 0.3, // Spike base radius as fraction of segment size
      heightRatio: 1.2, // Spike height as fraction of segment size
      zOffset: 0.8, // Z position as fraction of segment size
    },
    tip: {
      radius: 1.0, // Tail tip orb radius
      xOffset: 0.5, // Additional X offset from last segment
      zOffset: 0.5, // Additional Z offset from last segment
      lightIntensity: 4, // PointLight intensity
      lightRange: 10, // PointLight distance
    },
  },

  // === LEGS ===
  LEGS: {
    positions: [-1, 1, 3], // X positions along body for each leg pair
    attachmentY: 0.8, // Y offset from body center (left +, right -)
    angleSpread: 0, // Rotation per leg index from center (radians)
    joint: {
      radius: 0.6, // Hip joint sphere radius
    },
    tube: {
      radius: 0.39, // Leg tube radius
      length: 2.8, // Overall leg length reference
      // Curve control points as fractions of tube length
      // Each point: [yMultiplier, zMultiplier] where y is splay, z is drop
      curve: [
        [0, 0], // Start at joint
        [0.6, -0.15], // Splay out, slight drop
        [1.1, -0.4], // Continue outward, more drop
        [1.3, -0.7], // End position (foot)
      ],
    },
    foot: {
      radiusRatio: 1.5, // Foot radius as multiple of tube radius
    },
  },

  // === MATERIALS ===
  MATERIALS: {
    body: {
      color: 0xdddddd, // Body/leg color (light gray)
      roughness: 0.4,
      metalness: 0.1,
    },
    glow: {
      emissiveIntensity: 5, // Glow material emissive strength
      roughness: 0.1,
      metalness: 0.0,
    },
  },

  // === ANIMATION ===
  ANIMATION: {
    floatAmplitude: 0.03, // Vertical bobbing amplitude
    tailSwayAmplitude: 0.03, // Tail tip sway amplitude
    glowPulseMin: 4, // Minimum light intensity
    glowPulseRange: 1, // Light intensity variation
  },

  // === HEXAPOD GAIT ===
  GAIT: {
    cycleSpeed: 1.5, // Walk cycles per second
    strideAmplitude: 0.15, // Hip rotation amplitude (radians)
    liftAmplitude: 0.15, // Foot lift rotation amplitude (radians)
    stanceRatio: 0.5, // Fraction of cycle with foot planted
    bodyBob: 0.02, // Vertical body oscillation amplitude
    bodySway: 0.01, // Lateral body sway amplitude
  },

  // === DEBUG ===
  DEBUG: {
    gait: false, // Show gait debug markers
    stanceColor: 0x00ff00, // Green for stance phase
    swingColor: 0xff0000, // Red for swing phase
    sphereSize: 0.3, // Debug marker size multiplier
  },
};

// Enable gait debug in dev mode, or via ?gaitDebug URL param
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  CONFIG.DEBUG.gait = import.meta.env.DEV || params.has('gaitDebug');
}

/**
 * Determine which tripod a leg belongs to for alternating gait.
 * Hexapods walk with two tripods alternating: while one tripod supports,
 * the other swings forward.
 *
 * Tripod A (phase 0): Left-front, Right-middle, Left-back → L0, R1, L2
 * Tripod B (phase 0.5): Right-front, Left-middle, Right-back → R0, L1, R2
 *
 * @param side - 'left' or 'right'
 * @param index - 0 (front), 1 (middle), 2 (back)
 * @returns Phase offset: 0 for Tripod A, 0.5 for Tripod B
 */
function getTripodPhaseOffset(side: string, index: number): number {
  // Tripod A: left legs with index 0 or 2, OR right leg with index 1
  const isTripodA = (side === 'left' && index !== 1) || (side === 'right' && index === 1);
  return isTripodA ? 0 : 0.5;
}

/**
 * Calculate leg rotation for a given phase in the gait cycle.
 *
 * The gait cycle has two phases:
 * - STANCE (0 to stanceRatio): Foot on ground, hip rotates backward (pushes body forward)
 * - SWING (stanceRatio to 1): Foot in air, hip rotates forward, foot lifts in parabolic arc
 *
 * @param phase - Normalized position in gait cycle (0-1)
 * @param stanceRatio - Fraction of cycle spent in stance (typically 0.5)
 * @param strideAmp - Hip rotation amplitude in radians
 * @param liftAmp - X-rotation amplitude for foot lift (pitches leg up)
 * @returns Hip rotation (Z-axis) and lift rotation (X-axis)
 */
function calculateLegGait(
  phase: number,
  stanceRatio: number,
  strideAmp: number,
  liftAmp: number
): { hipRotation: number; liftRotation: number } {
  if (phase < stanceRatio) {
    // STANCE PHASE: foot planted, pushing body forward
    // Hip rotates from +strideAmp (leg forward) to -strideAmp (leg backward)
    const stanceProgress = phase / stanceRatio; // 0→1 during stance
    const hipRotation = strideAmp * (1 - 2 * stanceProgress);
    return { hipRotation, liftRotation: 0 };
  } else {
    // SWING PHASE: foot in air, swinging forward
    const swingProgress = (phase - stanceRatio) / (1 - stanceRatio); // 0→1 during swing
    // Hip rotates from -strideAmp back to +strideAmp
    const hipRotation = strideAmp * (-1 + 2 * swingProgress);
    // Foot lifts in smooth parabolic arc (sin curve)
    const liftRotation = liftAmp * Math.sin(swingProgress * Math.PI);
    return { hipRotation, liftRotation };
  }
}

/**
 * Create the cyber-organism mesh
 *
 * Local coordinate system (no baked rotation):
 * - Body extends along local X axis (head at -X, tail at +X)
 * - Dorsal (top) faces local +Z (will be oriented toward surface normal)
 * - Legs extend in local ±Y (perpendicular to body and dorsal)
 * - Leg feet curve toward local -Z (toward sphere center when oriented)
 *
 * Orientation is handled by orientHexapodToSurface() in PlayerRenderSystem.
 */
export function createCyberOrganism(radius: number, colorHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cyberOrganism';

  // Scale factor: convert original units to our radius
  const s = (radius * CONFIG.SCALE) / CONFIG.REF_UNIT;

  group.userData.baseRadius = radius * CONFIG.SCALE;
  group.userData.colorHex = colorHex;

  // Inner body group - offset to center visual mass at origin
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'bodyGroup';
  bodyGroup.position.x = -CONFIG.BODY.centerOffset * s;
  group.add(bodyGroup);
  group.userData.bodyGroup = bodyGroup;

  // Materials
  const bodyMat = new THREE.MeshStandardMaterial({
    color: CONFIG.MATERIALS.body.color,
    roughness: CONFIG.MATERIALS.body.roughness,
    metalness: CONFIG.MATERIALS.body.metalness,
    side: THREE.DoubleSide,
  });

  const glowMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: CONFIG.MATERIALS.glow.emissiveIntensity,
    roughness: CONFIG.MATERIALS.glow.roughness,
    metalness: CONFIG.MATERIALS.glow.metalness,
    side: THREE.DoubleSide,
  });

  // === HEAD ===
  const headGeo = new THREE.SphereGeometry(CONFIG.HEAD.radius * s, 32, 32);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.x = CONFIG.HEAD.position * s;
  head.name = 'head';
  bodyGroup.add(head);

  // Eye
  const eyeGeo = new THREE.SphereGeometry(CONFIG.HEAD.eye.radius * s, 24, 24);
  const eye = new THREE.Mesh(eyeGeo, glowMat.clone());
  eye.position.set(CONFIG.HEAD.eye.position * s, 0, 0);
  eye.name = 'eye';
  head.add(eye);
  eye.add(
    new THREE.PointLight(colorHex, CONFIG.HEAD.eye.lightIntensity, CONFIG.HEAD.eye.lightRange * s)
  );

  // === BODY SEGMENTS ===
  for (let i = 0; i < CONFIG.BODY.segmentCount; i++) {
    const scaleFactor = 1 - i * CONFIG.BODY.taper;

    const segGeo = new THREE.SphereGeometry(CONFIG.BODY.baseRadius * s * scaleFactor, 24, 24);
    segGeo.scale(1, 1, CONFIG.BODY.squash);

    const seg = new THREE.Mesh(segGeo, bodyMat);
    seg.position.x = (CONFIG.BODY.startX + i * CONFIG.BODY.spacing) * s;
    seg.name = `bodySegment-${i}`;
    bodyGroup.add(seg);

    // Dorsal orb
    const orbGeo = new THREE.SphereGeometry(CONFIG.BODY.orb.radius * s * scaleFactor, 16, 16);
    const orb = new THREE.Mesh(orbGeo, glowMat.clone());
    orb.position.z = CONFIG.BODY.orb.zOffset * s * scaleFactor;
    orb.name = `bodyOrb-${i}`;
    seg.add(orb);
    orb.add(
      new THREE.PointLight(colorHex, CONFIG.BODY.orb.lightIntensity, CONFIG.BODY.orb.lightRange * s)
    );
  }

  // === TAIL ===
  let tailPosX = CONFIG.TAIL.startX * s;
  let tailPosZ = CONFIG.TAIL.startZ * s;
  let tailSize = CONFIG.TAIL.initialSize * s;
  const tailSegments: THREE.Mesh[] = [];

  for (let i = 0; i < CONFIG.TAIL.segmentCount; i++) {
    const tailGeo = new THREE.SphereGeometry(tailSize, 16, 16);
    const tailSeg = new THREE.Mesh(tailGeo, bodyMat);
    tailSeg.position.set(tailPosX, 0, tailPosZ);
    tailSeg.name = `tailSegment-${i}`;
    bodyGroup.add(tailSeg);
    tailSegments.push(tailSeg);

    // Spike
    const spikeGeo = new THREE.ConeGeometry(
      tailSize * CONFIG.TAIL.spike.radiusRatio,
      tailSize * CONFIG.TAIL.spike.heightRatio,
      8
    );
    const spike = new THREE.Mesh(spikeGeo, bodyMat);
    spike.position.z = tailSize * CONFIG.TAIL.spike.zOffset;
    spike.rotation.x = Math.PI / 2;
    tailSeg.add(spike);

    // Progress to next segment
    tailPosX += tailSize * CONFIG.TAIL.xStep;
    tailPosZ += tailSize * CONFIG.TAIL.zStep;
    tailSize *= CONFIG.TAIL.decay;
  }

  // Tail tip orb
  const tipGeo = new THREE.SphereGeometry(CONFIG.TAIL.tip.radius * s, 24, 24);
  const tip = new THREE.Mesh(tipGeo, glowMat.clone());
  tip.position.set(
    tailPosX + CONFIG.TAIL.tip.xOffset * s,
    0,
    tailPosZ + CONFIG.TAIL.tip.zOffset * s
  );
  tip.name = 'tailTip';
  bodyGroup.add(tip);
  tip.add(
    new THREE.PointLight(colorHex, CONFIG.TAIL.tip.lightIntensity, CONFIG.TAIL.tip.lightRange * s)
  );

  group.userData.tailTip = tip;
  group.userData.tailSegments = tailSegments;

  // === LEGS ===
  CONFIG.LEGS.positions.forEach((posX, i) => {
    const midIndex = Math.floor(CONFIG.LEGS.positions.length / 2);

    // Left leg
    const left = createLeg(s, 1, bodyMat);
    left.position.set(posX * s, CONFIG.LEGS.attachmentY * s, 0);
    left.rotation.z = (i - midIndex) * CONFIG.LEGS.angleSpread;
    left.name = `leg-L-${i}`;
    left.userData.side = 'left';
    left.userData.index = i;
    bodyGroup.add(left);

    // Right leg
    const right = createLeg(s, -1, bodyMat);
    right.position.set(posX * s, -CONFIG.LEGS.attachmentY * s, 0);
    right.rotation.z = (i - midIndex) * -CONFIG.LEGS.angleSpread;
    right.name = `leg-R-${i}`;
    right.userData.side = 'right';
    right.userData.index = i;
    bodyGroup.add(right);
  });

  // NOTE: No rotation applied here - orientation is handled by orientHexapodToSurface()
  // in PlayerRenderSystem based on sphere position and heading direction.
  // Mesh local axes: X = forward (body axis), Y = right/left (leg direction), Z = up (dorsal)

  return group;
}

/**
 * Create leg: sphere joint with curved tube extending outward
 * @param s - scale factor
 * @param side - 1 for left (+Y), -1 for right (-Y)
 */
function createLeg(s: number, side: number, mat: THREE.Material): THREE.Group {
  const leg = new THREE.Group();
  const jointSize = CONFIG.LEGS.joint.radius * s;

  // Joint sphere at body attachment
  const jointGeo = new THREE.SphereGeometry(jointSize, 12, 12);
  const joint = new THREE.Mesh(jointGeo, mat);
  joint.name = 'legJoint';
  leg.add(joint);

  // Curved tube extending from joint outward (Y direction) and down (-Z direction)
  const tubeRadius = CONFIG.LEGS.tube.radius * s;
  const tubeLength = CONFIG.LEGS.tube.length * s;

  // Build curve from config control points
  const curvePoints = CONFIG.LEGS.tube.curve.map(
    ([yMult, zMult]) => new THREE.Vector3(0, side * yMult * tubeLength, zMult * tubeLength)
  );
  const curve = new THREE.CatmullRomCurve3(curvePoints);

  const tubeGeo = new THREE.TubeGeometry(curve, 16, tubeRadius, 8, false);
  const tube = new THREE.Mesh(tubeGeo, mat);
  tube.name = 'legTube';
  leg.add(tube);

  // Foot sphere at end of tube (position from last curve control point)
  const lastPoint = CONFIG.LEGS.tube.curve[CONFIG.LEGS.tube.curve.length - 1];
  const footGeo = new THREE.SphereGeometry(tubeRadius * CONFIG.LEGS.foot.radiusRatio, 12, 12);
  const foot = new THREE.Mesh(footGeo, mat);
  foot.position.set(0, side * lastPoint[0] * tubeLength, lastPoint[1] * tubeLength);
  foot.name = 'legFoot';

  // Debug marker for gait visualization (green = stance, red = swing)
  if (CONFIG.DEBUG.gait) {
    const debugGeo = new THREE.SphereGeometry(CONFIG.DEBUG.sphereSize * s, 8, 8);
    const debugMat = new THREE.MeshBasicMaterial({
      color: CONFIG.DEBUG.stanceColor,
      transparent: true,
      opacity: 0.7,
    });
    const debugSphere = new THREE.Mesh(debugGeo, debugMat);
    debugSphere.name = 'gaitDebug';
    foot.add(debugSphere);
  }
  leg.add(foot);

  return leg;
}

/**
 * Update animation with proper hexapod alternating tripod gait.
 *
 * @param group - The cyber-organism mesh group
 * @param isMoving - Whether the creature is currently moving
 * @param speed - Movement speed (units per second) for gait timing
 * @param dt - Delta time in seconds
 */
export function updateCyberOrganismAnimation(
  group: THREE.Group,
  isMoving: boolean,
  speed: number,
  dt: number
): void {
  const time = performance.now() * 0.001;
  const radius = group.userData.baseRadius || 1;

  // Initialize walk cycle counter and base Y position on first call
  if (group.userData.walkCycle === undefined) {
    group.userData.walkCycle = 0;
  }
  if (group.userData.baseY === undefined) {
    group.userData.baseY = group.position.y;
  }

  // Float animation (subtle bobbing in world Y) - use absolute positioning to prevent drift
  const floatOffset = Math.sin(time) * radius * CONFIG.ANIMATION.floatAmplitude * 0.1;
  group.position.y = group.userData.baseY + floatOffset;

  // Tail sway (Z direction in local space)
  const tip = group.userData.tailTip as THREE.Mesh | undefined;
  if (tip) {
    if (tip.userData.baseZ === undefined) tip.userData.baseZ = tip.position.z;
    tip.position.z =
      tip.userData.baseZ + Math.sin(time * 2) * radius * CONFIG.ANIMATION.tailSwayAmplitude;
  }

  // Hexapod walking animation with alternating tripod gait
  const bodyGroup = group.userData.bodyGroup as THREE.Group | undefined;
  if (!bodyGroup) return;

  if (isMoving && speed > 0.1) {
    // Accumulate walk cycle based on movement speed
    const cycleSpeed = CONFIG.GAIT.cycleSpeed * Math.min(speed / 100, 2);
    group.userData.walkCycle += dt * cycleSpeed;

    const walkCycle = group.userData.walkCycle;

    // Scale stride and lift amplitude with speed (faster = longer strides, higher lift)
    const speedFactor = Math.min(speed / 100, 1.5);
    const strideAmp = CONFIG.GAIT.strideAmplitude * speedFactor;
    const liftAmp = CONFIG.GAIT.liftAmplitude * speedFactor;

    // Animate each leg with proper tripod phasing
    bodyGroup.children.forEach((child) => {
      if (child.name.startsWith('leg-')) {
        const { side, index } = child.userData;

        // Store base rotations on first animation frame
        if (child.userData.baseRotZ === undefined) {
          child.userData.baseRotZ = child.rotation.z;
        }
        if (child.userData.baseRotX === undefined) {
          child.userData.baseRotX = child.rotation.x;
        }

        // Calculate this leg's phase in the gait cycle
        const tripodOffset = getTripodPhaseOffset(side, index);
        const legPhase = (walkCycle + tripodOffset) % 1;

        // Get rotation values from gait calculator
        const { hipRotation, liftRotation } = calculateLegGait(
          legPhase,
          CONFIG.GAIT.stanceRatio,
          strideAmp,
          liftAmp
        );

        // Apply hip rotation (Z-axis: forward/backward swing)
        child.rotation.z = child.userData.baseRotZ + hipRotation;
        // Apply lift rotation (X-axis: pitches leg up during swing)
        child.rotation.x = child.userData.baseRotX + liftRotation;

        // Update debug marker color if present
        if (CONFIG.DEBUG.gait) {
          const foot = child.children.find((c) => c.name === 'legFoot') as THREE.Mesh | undefined;
          const debugMarker = foot?.children.find((c) => c.name === 'gaitDebug') as
            | THREE.Mesh
            | undefined;
          if (debugMarker) {
            const inStance = legPhase < CONFIG.GAIT.stanceRatio;
            (debugMarker.material as THREE.MeshBasicMaterial).color.setHex(
              inStance ? CONFIG.DEBUG.stanceColor : CONFIG.DEBUG.swingColor
            );
          }
        }
      }
    });

    // Body secondary motion: subtle bob and sway synced to gait
    const bodyBob = Math.sin(walkCycle * Math.PI * 2) * radius * CONFIG.GAIT.bodyBob;
    const bodySway = Math.sin(walkCycle * Math.PI) * radius * CONFIG.GAIT.bodySway;
    bodyGroup.position.y = bodySway; // Lateral sway in local space
    group.position.y = group.userData.baseY + floatOffset + bodyBob; // Combine float + bob

    // Debug logging (only for one leg to avoid spam)
    if (CONFIG.DEBUG.gait) {
      const firstLeg = bodyGroup.children.find((c) => c.name === 'leg-L-0');
      if (firstLeg) {
        const legPhase = (walkCycle + getTripodPhaseOffset('left', 0)) % 1;
        // Log every ~60 frames (once per second at 60fps)
        if (Math.floor(walkCycle * 60) % 60 === 0) {
          console.log(
            `[Gait] cycle: ${walkCycle.toFixed(2)}, L0 phase: ${legPhase.toFixed(2)}, stance: ${legPhase < CONFIG.GAIT.stanceRatio}`
          );
        }
      }
    }
  }

  // Glow pulse (always active)
  const intensity =
    CONFIG.ANIMATION.glowPulseMin + Math.sin(time * 2) * CONFIG.ANIMATION.glowPulseRange;
  group.traverse((child) => {
    if (child instanceof THREE.PointLight) {
      child.intensity = intensity * (child.parent?.name === 'tailTip' ? 1.5 : 1);
    }
  });
}

/**
 * Update energy visualization
 */
export function updateCyberOrganismEnergy(group: THREE.Group, energyRatio: number): void {
  const ratio = Math.max(0, Math.min(1, energyRatio));

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity > 1) {
        mat.emissiveIntensity = 1 + 4 * ratio;
      }
    }
    if (child instanceof THREE.PointLight) {
      child.intensity = (1 + 3 * ratio) * (child.parent?.name === 'tailTip' ? 1.5 : 1);
    }
  });
}

/**
 * Dispose resources
 */
export function disposeCyberOrganism(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}
