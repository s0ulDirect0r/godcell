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
  });

  const glowMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 5,
    roughness: 0.1,
    metalness: 0.0,
  });

  // === HEAD (original: radius 1.8, position X=-3) ===
  const headGeo = new THREE.SphereGeometry(1.8 * s, 32, 32);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.x = -3 * s;
  head.name = 'head';
  group.add(head);

  // Eye (original: radius 0.8, offset -1.4, 0.3, 0.8)
  const eyeGeo = new THREE.SphereGeometry(0.8 * s, 24, 24);
  const eye = new THREE.Mesh(eyeGeo, glowMat.clone());
  eye.position.set(-1.4 * s, 0.3 * s, 0.8 * s);
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

  // === LEGS (original: positions X = -1, 1, 3) ===
  const legPositionsX = [-1, 1, 3];

  legPositionsX.forEach((posX, i) => {
    // Left
    const left = createLeg(s, 1, bodyMat);
    left.position.set(posX * s, -0.2 * s, 1.2 * s);
    left.rotation.y = (i - 1) * -0.3;
    left.name = `leg-L-${i}`;
    left.userData.side = 'left';
    left.userData.index = i;
    group.add(left);

    // Right
    const right = createLeg(s, -1, bodyMat);
    right.position.set(posX * s, -0.2 * s, -1.2 * s);
    right.rotation.y = (i - 1) * 0.3;
    right.name = `leg-R-${i}`;
    right.userData.side = 'right';
    right.userData.index = i;
    group.add(right);
  });

  // Rotate for top-down view
  group.rotation.x = Math.PI / 2;

  return group;
}

/**
 * Create leg using original values from cyberorganism.html
 * @param s - scale factor
 * @param side - 1 for left, -1 for right
 */
function createLeg(s: number, side: number, mat: THREE.Material): THREE.Group {
  const leg = new THREE.Group();
  const legRadius = 0.35 * s;

  // Thigh (original: CapsuleGeometry radius 0.35, length 1.2)
  const thighGeo = new THREE.CapsuleGeometry(legRadius, 1.2 * s, 8, 16);
  const thigh = new THREE.Mesh(thighGeo, mat);
  thigh.position.set(0, 0.5 * s, side * 0.5 * s);
  thigh.rotation.z = Math.PI / 4;
  thigh.rotation.x = -side * Math.PI / 8;
  leg.add(thigh);

  // Shin (original: radius 0.35 * 0.9, length 1.5)
  const shinGeo = new THREE.CapsuleGeometry(legRadius * 0.9, 1.5 * s, 8, 16);
  const shin = new THREE.Mesh(shinGeo, mat);
  shin.position.set(0.8 * s, -0.5 * s, side * 0.8 * s);
  shin.rotation.z = -Math.PI / 3;
  leg.add(shin);

  // Claw (original: radius 0.35, height 0.8)
  const clawGeo = new THREE.ConeGeometry(legRadius, 0.8 * s, 8);
  const claw = new THREE.Mesh(clawGeo, mat);
  claw.position.set(1.3 * s, -1.6 * s, side * 0.9 * s);
  claw.rotation.x = Math.PI / 2;
  leg.add(claw);

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
