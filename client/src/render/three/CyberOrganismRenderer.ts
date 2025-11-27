// ============================================
// Cyber-Organism Renderer (Stage 3)
// Segmented creature with head, body pods, spiked tail, and 6 legs
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
};

/**
 * Create the cyber-organism
 * Uses original absolute values from cyberorganism.html, scaled to fit radius
 */
export function createCyberOrganism(radius: number, colorHex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cyberOrganism';

  // Scale factor: convert original units to our radius
  const s = radius * CONFIG.SCALE / CONFIG.REF_UNIT;

  group.userData.baseRadius = radius * CONFIG.SCALE;
  group.userData.colorHex = colorHex;

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

  // === HEAD (original: radius 1.8, position X=-3) ===
  const headGeo = new THREE.SphereGeometry(1.8 * s, 32, 32);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.x = -3 * s;
  head.name = 'head';
  group.add(head);

  // Eye - centered on front of head, looking forward (negative X)
  const eyeGeo = new THREE.SphereGeometry(0.8 * s, 24, 24);
  const eye = new THREE.Mesh(eyeGeo, glowMat.clone());
  eye.position.set(-1.5 * s, 0, 0);  // Front center of head
  eye.name = 'eye';
  head.add(eye);
  eye.add(new THREE.PointLight(colorHex, 3, 7 * s));

  // === BODY SEGMENTS (original: 3 segments at X = -0.5, 1.5, 3.5) ===
  for (let i = 0; i < 3; i++) {
    const scaleFactor = 1 - i * 0.15;

    // Original: radius 1.4 * scaleFactor, squashed to 0.7 on Y
    const segGeo = new THREE.SphereGeometry(1.4 * s * scaleFactor, 24, 24);
    segGeo.scale(1, 0.7, 1);

    const seg = new THREE.Mesh(segGeo, bodyMat);
    seg.position.x = (-0.5 + i * 2) * s;
    seg.name = `bodySegment-${i}`;
    group.add(seg);

    // Dorsal orb (original: radius 0.4 * scaleFactor, Y offset 0.8 * scaleFactor)
    const orbGeo = new THREE.SphereGeometry(0.4 * s * scaleFactor, 16, 16);
    const orb = new THREE.Mesh(orbGeo, glowMat.clone());
    orb.position.y = 0.8 * s * scaleFactor;
    orb.name = `bodyOrb-${i}`;
    seg.add(orb);
    orb.add(new THREE.PointLight(colorHex, 1.5, 4 * s));
  }

  // === TAIL (original: starts at X=4.5, Y=0.2, size=0.8) ===
  let tailPosX = 4.5 * s;
  let tailPosY = 0.2 * s;
  let tailSize = 0.8 * s;
  const tailSegments: THREE.Mesh[] = [];

  for (let i = 0; i < 5; i++) {
    const tailGeo = new THREE.SphereGeometry(tailSize, 16, 16);
    const tailSeg = new THREE.Mesh(tailGeo, bodyMat);
    tailSeg.position.set(tailPosX, tailPosY, 0);
    tailSeg.name = `tailSegment-${i}`;
    group.add(tailSeg);
    tailSegments.push(tailSeg);

    // Spike (original: radius = tailSize * 0.3, height = tailSize * 1.2)
    const spikeGeo = new THREE.ConeGeometry(tailSize * 0.3, tailSize * 1.2, 8);
    const spike = new THREE.Mesh(spikeGeo, bodyMat);
    spike.position.y = tailSize * 0.8;
    tailSeg.add(spike);

    // Original progression
    tailPosX += tailSize * 1.3;
    tailPosY += tailSize * 0.4;
    tailSize *= 0.85;
  }

  // Tail tip orb (original: radius 1.0, offset +0.5 from last position)
  const tipGeo = new THREE.SphereGeometry(1.0 * s, 24, 24);
  const tip = new THREE.Mesh(tipGeo, glowMat.clone());
  tip.position.set(tailPosX + 0.5 * s, tailPosY + 0.5 * s, 0);
  tip.name = 'tailTip';
  group.add(tip);
  tip.add(new THREE.PointLight(colorHex, 4, 10 * s));

  group.userData.tailTip = tip;
  group.userData.tailSegments = tailSegments;

  // === LEGS (like tails but extending sideways) ===
  const legPositionsX = [-1, 1, 3];

  legPositionsX.forEach((posX, i) => {
    // Left leg - attached at body side, extends outward via Z
    const left = createLeg(s, 1, bodyMat);
    left.position.set(posX * s, 0, 0.8 * s);
    left.rotation.y = (i - 1) * 0.25;  // Slight angle: front forward, back backward
    left.name = `leg-L-${i}`;
    left.userData.side = 'left';
    left.userData.index = i;
    group.add(left);

    // Right leg - mirror (side=-1 makes Z go negative)
    const right = createLeg(s, -1, bodyMat);
    right.position.set(posX * s, 0, -0.8 * s);
    right.rotation.y = (i - 1) * -0.25;
    right.name = `leg-R-${i}`;
    right.userData.side = 'right';
    right.userData.index = i;
    group.add(right);
  });

  // Rotate for top-down view (showing dorsal/top side)
  // Use ZXY order so heading (Z) is applied before tilt (X)
  group.rotation.order = 'ZXY';
  group.rotation.x = -Math.PI / 2;

  return group;
}

/**
 * Create leg: sphere joint with 3 curved tubes extending outward and down
 * @param s - scale factor
 * @param side - 1 for left, -1 for right
 */
function createLeg(s: number, side: number, mat: THREE.Material): THREE.Group {
  const leg = new THREE.Group();
  const jointSize = 0.6 * s;

  // Joint sphere at body attachment
  const jointGeo = new THREE.SphereGeometry(jointSize, 12, 12);
  const joint = new THREE.Mesh(jointGeo, mat);
  joint.name = 'legJoint';
  leg.add(joint);

  // Single curved tube extending from joint outward and down
  const tubeRadius = 0.39 * s;   // 20% thicker
  const tubeLength = 2.8 * s;    // 20% shorter

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),                                          // Start at joint
    new THREE.Vector3(0, -0.15 * tubeLength, side * 0.6 * tubeLength),   // Splay out more
    new THREE.Vector3(0, -0.4 * tubeLength, side * 1.1 * tubeLength),    // Continue outward
    new THREE.Vector3(0, -0.7 * tubeLength, side * 1.3 * tubeLength),    // End more to side
  ]);

  const tubeGeo = new THREE.TubeGeometry(curve, 16, tubeRadius, 8, false);
  const tube = new THREE.Mesh(tubeGeo, mat);
  tube.name = 'legTube';
  leg.add(tube);

  // Foot sphere at end of tube
  const footGeo = new THREE.SphereGeometry(tubeRadius * 1.5, 12, 12);
  const foot = new THREE.Mesh(footGeo, mat);
  foot.position.set(0, -0.7 * tubeLength, side * 1.3 * tubeLength);
  foot.name = 'legFoot';
  leg.add(foot);

  return leg;
}

/**
 * Update animation
 */
export function updateCyberOrganismAnimation(
  group: THREE.Group,
  isMoving: boolean,
  _dt: number
): void {
  const time = Date.now() * 0.001;
  const radius = group.userData.baseRadius || 1;

  // Float
  group.position.z = Math.sin(time) * radius * CONFIG.FLOAT_AMPLITUDE;

  // Tail sway
  const tip = group.userData.tailTip as THREE.Mesh | undefined;
  if (tip) {
    if (tip.userData.baseY === undefined) tip.userData.baseY = tip.position.y;
    tip.position.y = tip.userData.baseY + Math.sin(time * 2) * radius * CONFIG.TAIL_SWAY_AMPLITUDE;
  }

  // Legs
  if (isMoving) {
    const phase = time * 4;
    group.children.forEach(child => {
      if (child.name.startsWith('leg-')) {
        const { side, index } = child.userData;
        const offset = (index === 1 ? Math.PI : 0) + (side === 'right' ? Math.PI : 0);
        if (child.userData.baseRotY === undefined) child.userData.baseRotY = child.rotation.y;
        child.rotation.y = child.userData.baseRotY + Math.sin(phase + offset) * 0.2;
      }
    });
  }

  // Glow pulse
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
