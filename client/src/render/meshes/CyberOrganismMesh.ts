// ============================================
// Cyber-Organism Renderer (Stage 3)
// Segmented creature with head, body pods, spiked tail, and 6 legs
// Built for XZ plane top-down view (dorsal faces +Z, which becomes +Y after rotation)
// ============================================

import * as THREE from 'three';

/**
 * All sizes are multipliers of the base radius parameter
 */
/**
 * Original reference uses absolute units where head radius = 1.8
 * We scale everything by (radius * SCALE / 1.8) to convert
 */
const CONFIG = {
  SCALE: 0.5,              // Overall size adjustment
  REF_UNIT: 1.8,           // Reference head radius from original

  // Animation
  FLOAT_AMPLITUDE: 0.03,
  TAIL_SWAY_AMPLITUDE: 0.03,
  GLOW_PULSE_MIN: 4,
  GLOW_PULSE_RANGE: 1,

  // Hexapod gait parameters
  WALK_CYCLE_SPEED: 1.5,      // Base cycles per second
  STRIDE_AMPLITUDE: 0.15,     // Hip rotation amplitude (radians) - controls forward/back swing
  LIFT_AMPLITUDE: 0.15,       // X-rotation for foot lift during swing phase
  STANCE_RATIO: 0.5,          // Fraction of cycle spent in stance (foot on ground)
  BODY_BOB_AMPLITUDE: 0.02,   // Vertical body oscillation during walk
  BODY_SWAY_AMPLITUDE: 0.01,  // Lateral body sway toward planted tripod

  // Debug visualization (enabled via ?gaitDebug URL param)
  DEBUG_GAIT: false,
  DEBUG_STANCE_COLOR: 0x00ff00,   // Green = foot planted (stance phase)
  DEBUG_SWING_COLOR: 0xff0000,    // Red = foot in air (swing phase)
  DEBUG_SPHERE_SIZE: 0.3,         // Debug marker radius multiplier
};

// Enable gait debug in dev mode, or via ?gaitDebug URL param
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  CONFIG.DEBUG_GAIT = import.meta.env.DEV || params.has('gaitDebug');
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
  const isTripodA = (side === 'left' && index !== 1) ||
                   (side === 'right' && index === 1);
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
 * @param liftAmp - Y-rotation amplitude for foot lift
 * @returns Hip rotation (Z-axis) and lift rotation (Y-axis)
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
 * Create the cyber-organism
 * Built for top-down XZ plane view:
 * - Body extends along local X axis (head at -X, tail at +X)
 * - Dorsal (top) faces local +Z (becomes world +Y after rotation, toward camera)
 * - Legs extend in local ±Y (becomes world ±Z after rotation, on ground plane)
 */
export function createCyberOrganism(radius: number, colorHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cyberOrganism';

  // Scale factor: convert original units to our radius
  const s = radius * CONFIG.SCALE / CONFIG.REF_UNIT;

  group.userData.baseRadius = radius * CONFIG.SCALE;
  group.userData.colorHex = colorHex;

  // Inner body group - offset to center visual mass at origin
  // Creature extends from head (X=-3*s) to tail tip (X≈8*s), visual center ≈ X=2.5*s
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'bodyGroup';
  bodyGroup.position.x = -2.5 * s; // Shift body so visual center is at origin
  group.add(bodyGroup);
  group.userData.bodyGroup = bodyGroup;

  // Materials (same as original)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const glowMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 5,
    roughness: 0.1,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  // === HEAD (position X=-3) ===
  const headGeo = new THREE.SphereGeometry(1.8 * s, 32, 32);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.x = -3 * s;
  head.name = 'head';
  bodyGroup.add(head);

  // Eye - centered on front of head, looking forward (negative X)
  const eyeGeo = new THREE.SphereGeometry(0.8 * s, 24, 24);
  const eye = new THREE.Mesh(eyeGeo, glowMat.clone());
  eye.position.set(-1.5 * s, 0, 0);  // Front center of head
  eye.name = 'eye';
  head.add(eye);
  eye.add(new THREE.PointLight(colorHex, 3, 7 * s));

  // === BODY SEGMENTS (3 segments along X axis) ===
  for (let i = 0; i < 3; i++) {
    const scaleFactor = 1 - i * 0.15;

    // Squash on Z axis (dorsal-ventral direction) instead of Y
    const segGeo = new THREE.SphereGeometry(1.4 * s * scaleFactor, 24, 24);
    segGeo.scale(1, 1, 0.7);

    const seg = new THREE.Mesh(segGeo, bodyMat);
    seg.position.x = (-0.5 + i * 2) * s;
    seg.name = `bodySegment-${i}`;
    bodyGroup.add(seg);

    // Dorsal orb - now at +Z (becomes +Y after rotation, facing camera)
    const orbGeo = new THREE.SphereGeometry(0.4 * s * scaleFactor, 16, 16);
    const orb = new THREE.Mesh(orbGeo, glowMat.clone());
    orb.position.z = 0.8 * s * scaleFactor;  // Dorsal side at +Z
    orb.name = `bodyOrb-${i}`;
    seg.add(orb);
    orb.add(new THREE.PointLight(colorHex, 1.5, 4 * s));
  }

  // === TAIL (extends along +X, curves upward in +Z direction) ===
  let tailPosX = 4.5 * s;
  let tailPosZ = 0.2 * s;  // Z instead of Y (dorsal direction)
  let tailSize = 0.8 * s;
  const tailSegments: THREE.Mesh[] = [];

  for (let i = 0; i < 5; i++) {
    const tailGeo = new THREE.SphereGeometry(tailSize, 16, 16);
    const tailSeg = new THREE.Mesh(tailGeo, bodyMat);
    tailSeg.position.set(tailPosX, 0, tailPosZ);  // Y=0, Z=dorsal offset
    tailSeg.name = `tailSegment-${i}`;
    bodyGroup.add(tailSeg);
    tailSegments.push(tailSeg);

    // Spike pointing dorsally (+Z direction)
    const spikeGeo = new THREE.ConeGeometry(tailSize * 0.3, tailSize * 1.2, 8);
    const spike = new THREE.Mesh(spikeGeo, bodyMat);
    spike.position.z = tailSize * 0.8;  // Dorsal direction
    spike.rotation.x = Math.PI / 2;  // Point cone toward +Z
    tailSeg.add(spike);

    // Original progression
    tailPosX += tailSize * 1.3;
    tailPosZ += tailSize * 0.4;
    tailSize *= 0.85;
  }

  // Tail tip orb
  const tipGeo = new THREE.SphereGeometry(1.0 * s, 24, 24);
  const tip = new THREE.Mesh(tipGeo, glowMat.clone());
  tip.position.set(tailPosX + 0.5 * s, 0, tailPosZ + 0.5 * s);  // Y=0, Z=dorsal
  tip.name = 'tailTip';
  bodyGroup.add(tip);
  tip.add(new THREE.PointLight(colorHex, 4, 10 * s));

  group.userData.tailTip = tip;
  group.userData.tailSegments = tailSegments;

  // === LEGS (extend in ±Y direction, becomes ±Z on ground plane after rotation) ===
  const legPositionsX = [-1, 1, 3];

  legPositionsX.forEach((posX, i) => {
    // Left leg - extends in +Y direction (becomes +Z after rotation)
    const left = createLeg(s, 1, bodyMat);
    left.position.set(posX * s, 0.8 * s, 0);  // Y offset for leg attachment
    left.rotation.z = (i - 1) * 0.25;  // Slight angle: front forward, back backward
    left.name = `leg-L-${i}`;
    left.userData.side = 'left';
    left.userData.index = i;
    bodyGroup.add(left);

    // Right leg - extends in -Y direction (becomes -Z after rotation)
    const right = createLeg(s, -1, bodyMat);
    right.position.set(posX * s, -0.8 * s, 0);  // -Y offset for right side
    right.rotation.z = (i - 1) * -0.25;
    right.name = `leg-R-${i}`;
    right.userData.side = 'right';
    right.userData.index = i;
    bodyGroup.add(right);
  });

  // Rotate for top-down view:
  // - X rotation: -90° tilts organism so +Z faces +Y (dorsal toward camera)
  // - Z rotation: heading (spins around vertical axis)
  // Use XZY order so tilt (X) is applied first, then heading (Z)
  group.rotation.order = 'XZY';
  group.rotation.x = -Math.PI / 2;

  return group;
}

/**
 * Create leg: sphere joint with curved tube extending outward
 * @param s - scale factor
 * @param side - 1 for left (+Y), -1 for right (-Y)
 */
function createLeg(s: number, side: number, mat: THREE.Material): THREE.Group {
  const leg = new THREE.Group();
  const jointSize = 0.6 * s;

  // Joint sphere at body attachment
  const jointGeo = new THREE.SphereGeometry(jointSize, 12, 12);
  const joint = new THREE.Mesh(jointGeo, mat);
  joint.name = 'legJoint';
  leg.add(joint);

  // Curved tube extending from joint outward (Y direction) and down (-Z direction)
  const tubeRadius = 0.39 * s;
  const tubeLength = 2.8 * s;

  // Curve extends in Y (side direction) and -Z (down, toward ground)
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),                                           // Start at joint
    new THREE.Vector3(0, side * 0.6 * tubeLength, -0.15 * tubeLength),    // Splay out
    new THREE.Vector3(0, side * 1.1 * tubeLength, -0.4 * tubeLength),     // Continue outward
    new THREE.Vector3(0, side * 1.3 * tubeLength, -0.7 * tubeLength),     // End at ground
  ]);

  const tubeGeo = new THREE.TubeGeometry(curve, 16, tubeRadius, 8, false);
  const tube = new THREE.Mesh(tubeGeo, mat);
  tube.name = 'legTube';
  leg.add(tube);

  // Foot sphere at end of tube
  const footGeo = new THREE.SphereGeometry(tubeRadius * 1.5, 12, 12);
  const foot = new THREE.Mesh(footGeo, mat);
  foot.position.set(0, side * 1.3 * tubeLength, -0.7 * tubeLength);
  foot.name = 'legFoot';

  // Debug marker for gait visualization (green = stance, red = swing)
  if (CONFIG.DEBUG_GAIT) {
    const debugGeo = new THREE.SphereGeometry(CONFIG.DEBUG_SPHERE_SIZE * s, 8, 8);
    const debugMat = new THREE.MeshBasicMaterial({
      color: CONFIG.DEBUG_STANCE_COLOR,
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

  // Initialize walk cycle counter on first call
  if (group.userData.walkCycle === undefined) {
    group.userData.walkCycle = 0;
  }

  // Float animation (subtle bobbing in world Y)
  group.position.y += Math.sin(time) * radius * CONFIG.FLOAT_AMPLITUDE * 0.1;

  // Tail sway (Z direction in local space)
  const tip = group.userData.tailTip as THREE.Mesh | undefined;
  if (tip) {
    if (tip.userData.baseZ === undefined) tip.userData.baseZ = tip.position.z;
    tip.position.z = tip.userData.baseZ + Math.sin(time * 2) * radius * CONFIG.TAIL_SWAY_AMPLITUDE;
  }

  // Hexapod walking animation with alternating tripod gait
  const bodyGroup = group.userData.bodyGroup as THREE.Group | undefined;
  if (!bodyGroup) return;

  if (isMoving && speed > 0.1) {
    // Accumulate walk cycle based on movement speed
    // Speed scales cycle rate: faster movement = faster leg cycling
    const cycleSpeed = CONFIG.WALK_CYCLE_SPEED * Math.min(speed / 100, 2);
    group.userData.walkCycle += dt * cycleSpeed;

    const walkCycle = group.userData.walkCycle;

    // Scale stride and lift amplitude with speed (faster = longer strides, higher lift)
    const speedFactor = Math.min(speed / 100, 1.5);
    const strideAmp = CONFIG.STRIDE_AMPLITUDE * speedFactor;
    const liftAmp = CONFIG.LIFT_AMPLITUDE * speedFactor;

    // Animate each leg with proper tripod phasing
    bodyGroup.children.forEach(child => {
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
          CONFIG.STANCE_RATIO,
          strideAmp,
          liftAmp
        );

        // Apply hip rotation (Z-axis: forward/backward swing)
        child.rotation.z = child.userData.baseRotZ + hipRotation;
        // Apply lift rotation (X-axis: pitches leg up during swing)
        child.rotation.x = child.userData.baseRotX + liftRotation;

        // Update debug marker color if present
        if (CONFIG.DEBUG_GAIT) {
          const foot = child.children.find(c => c.name === 'legFoot') as THREE.Mesh | undefined;
          const debugMarker = foot?.children.find(c => c.name === 'gaitDebug') as THREE.Mesh | undefined;
          if (debugMarker) {
            const inStance = legPhase < CONFIG.STANCE_RATIO;
            (debugMarker.material as THREE.MeshBasicMaterial).color.setHex(
              inStance ? CONFIG.DEBUG_STANCE_COLOR : CONFIG.DEBUG_SWING_COLOR
            );
          }
        }
      }
    });

    // Body secondary motion: subtle bob and sway synced to gait
    const bodyBob = Math.sin(walkCycle * Math.PI * 2) * radius * CONFIG.BODY_BOB_AMPLITUDE;
    const bodySway = Math.sin(walkCycle * Math.PI) * radius * CONFIG.BODY_SWAY_AMPLITUDE;
    bodyGroup.position.y = bodySway;  // Lateral sway in local space
    group.position.y += bodyBob;       // Vertical bob added to world position

    // Debug logging (only for one leg to avoid spam)
    if (CONFIG.DEBUG_GAIT) {
      const firstLeg = bodyGroup.children.find(c => c.name === 'leg-L-0');
      if (firstLeg) {
        const legPhase = (walkCycle + getTripodPhaseOffset('left', 0)) % 1;
        // Log every ~60 frames (once per second at 60fps)
        if (Math.floor(walkCycle * 60) % 60 === 0) {
          console.log(`[Gait] cycle: ${walkCycle.toFixed(2)}, L0 phase: ${legPhase.toFixed(2)}, stance: ${legPhase < CONFIG.STANCE_RATIO}`);
        }
      }
    }
  }

  // Glow pulse (always active)
  const intensity = CONFIG.GLOW_PULSE_MIN + Math.sin(time * 2) * CONFIG.GLOW_PULSE_RANGE;
  group.traverse(child => {
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

  group.traverse(child => {
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
