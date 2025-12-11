// ============================================
// Entropy Serpent Mesh - Jungle Apex Predator
// Serpentine body made of entropy-swarm spheres
// Two clawed arms, single cyclopean eye
// Hunts Stage 3+ players in the digital jungle
// ============================================

import * as THREE from 'three';

/**
 * Configuration for the entropy serpent
 */
const CONFIG = {
  // Body segments - chain of swarm spheres
  BODY_SEGMENTS: 12,
  BODY_TAPER_START: 0.4,
  BODY_TAPER_END: 0.15,
  BODY_CURVE_AMPLITUDE: 0.3,

  // Head
  HEAD_SCALE: 1.4,
  EYE_SCALE: 0.35,
  EYE_GLOW_INTENSITY: 8,
  EYE_LIGHT_RANGE: 5,

  // Arms
  ARM_ATTACH_SEGMENT: 2,
  ARM_LENGTH: 2.5,
  ARM_THICKNESS: 0.25,

  // Claws
  CLAW_COUNT: 3,
  CLAW_LENGTH: 0.6,
  CLAW_RADIUS: 0.12,
  CLAW_SPREAD: 0.4,

  // Swarm-style body visuals
  PARTICLES_PER_SEGMENT: 40,      // Internal particles per body segment
  OUTER_OPACITY: 0.25,            // Outer sphere transparency
  PARTICLE_SPEED: 40,             // Base particle speed

  // Colors
  BODY_COLOR: 0xff6600,
  GLOW_COLOR: 0xff4400,
  CHASE_BODY_COLOR: 0xff3300,
  CHASE_GLOW_COLOR: 0xff0000,

  // Animation
  SLITHER_SPEED: 2.0,
  SLITHER_AMPLITUDE: 0.15,
  BREATHE_SPEED: 1.5,
  BREATHE_AMOUNT: 0.04,
  ARM_SWAY_SPEED: 1.2,
  ARM_SWAY_AMOUNT: 0.1,
};

/**
 * Particle data for internal storm animation
 */
interface ParticleData {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

/**
 * Animation state stored in userData
 */
export interface EntropySerpentAnimState {
  basePositions: THREE.Vector3[];
  time: number;
  segmentParticles: ParticleData[][];  // Particles for each body segment
}

/**
 * Create a swarm-style body segment
 */
function createSwarmSegment(segRadius: number, bodyColor: number): THREE.Group {
  const seg = new THREE.Group();

  // Outer semi-transparent sphere
  const outerGeo = new THREE.SphereGeometry(segRadius, 16, 16);
  const outerMat = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    transparent: true,
    opacity: CONFIG.OUTER_OPACITY,
    emissive: bodyColor,
    emissiveIntensity: 0.6,
    roughness: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.name = 'outer';
  seg.add(outer);

  // Internal particle storm
  const particleCount = CONFIG.PARTICLES_PER_SEGMENT;
  const positions = new Float32Array(particleCount * 3);
  const particleData: ParticleData[] = [];

  for (let i = 0; i < particleCount; i++) {
    // Random point inside sphere
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = Math.cbrt(Math.random()) * segRadius * 0.85;

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Random velocity
    const speed = CONFIG.PARTICLE_SPEED + Math.random() * 30;
    const vTheta = Math.random() * Math.PI * 2;
    const vPhi = Math.random() * Math.PI;

    particleData.push({
      x, y, z,
      vx: speed * Math.sin(vPhi) * Math.cos(vTheta),
      vy: speed * Math.sin(vPhi) * Math.sin(vTheta),
      vz: speed * Math.cos(vPhi),
    });
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const particleMat = new THREE.PointsMaterial({
    color: 0xffaa00,
    size: 1.5,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const particles = new THREE.Points(particleGeo, particleMat);
  particles.name = 'particles';
  seg.add(particles);

  seg.userData.segRadius = segRadius;
  seg.userData.particleData = particleData;

  return seg;
}

/**
 * Create an entropy serpent
 */
export function createEntropySerpent(radius: number, colorHex?: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'entropySerpent';

  const bodyColor = colorHex ?? CONFIG.BODY_COLOR;
  const glowColor = CONFIG.GLOW_COLOR;

  group.userData.baseRadius = radius;
  group.userData.bodyColor = bodyColor;
  group.userData.glowColor = glowColor;
  group.userData.state = 'patrol';

  // Glow material for eye and claws
  const glowMat = new THREE.MeshStandardMaterial({
    color: glowColor,
    emissive: glowColor,
    emissiveIntensity: CONFIG.EYE_GLOW_INTENSITY,
    roughness: 0.1,
    metalness: 0.0,
  });

  // === BODY - Chain of swarm-style segments ===
  const bodySegments: THREE.Group[] = [];
  const basePositions: THREE.Vector3[] = [];
  const segmentParticles: ParticleData[][] = [];

  for (let i = 0; i < CONFIG.BODY_SEGMENTS; i++) {
    const t = i / (CONFIG.BODY_SEGMENTS - 1);

    let sizeMult = 1.0;
    if (t > CONFIG.BODY_TAPER_START) {
      const taperT = (t - CONFIG.BODY_TAPER_START) / (1 - CONFIG.BODY_TAPER_START);
      sizeMult = 1.0 - taperT * (1.0 - CONFIG.BODY_TAPER_END);
    }

    const segRadius = radius * sizeMult * (i === 0 ? CONFIG.HEAD_SCALE : 1.0);
    const seg = createSwarmSegment(segRadius, bodyColor);

    const xPos = i * radius * 1.6;
    const yPos = Math.sin(t * Math.PI * 2) * radius * CONFIG.BODY_CURVE_AMPLITUDE;
    seg.position.set(xPos, yPos, 0);

    seg.name = i === 0 ? 'head' : `bodySegment-${i}`;
    seg.userData.segmentIndex = i;
    group.add(seg);
    bodySegments.push(seg);
    basePositions.push(seg.position.clone());
    segmentParticles.push(seg.userData.particleData as ParticleData[]);
  }

  group.userData.bodySegments = bodySegments;

  // === HEAD - Add eye ===
  const head = bodySegments[0];
  const headRadius = head.userData.segRadius;

  const eyeRadius = headRadius * CONFIG.EYE_SCALE;
  const eyeGeo = new THREE.SphereGeometry(eyeRadius, 16, 16);
  const eye = new THREE.Mesh(eyeGeo, glowMat.clone());
  eye.position.set(-headRadius * 0.8, 0, 0);
  eye.name = 'eye';
  head.add(eye);

  const eyeLight = new THREE.PointLight(glowColor, 4, radius * CONFIG.EYE_LIGHT_RANGE);
  eye.add(eyeLight);
  group.userData.eyeLight = eyeLight;

  // === ARMS ===
  const armAttachSeg = bodySegments[CONFIG.ARM_ATTACH_SEGMENT];
  const armAttachRadius = armAttachSeg.userData.segRadius;

  const arms: THREE.Group[] = [];
  [-1, 1].forEach((side, armIndex) => {
    const arm = createArm(radius, armAttachRadius, side, glowMat.clone(), bodyColor);
    arm.name = `arm-${armIndex}`;
    arm.userData.side = side;
    arm.position.set(0, side * armAttachRadius * 0.8, 0);
    armAttachSeg.add(arm);
    arms.push(arm);
  });

  group.userData.arms = arms;

  // === ANIMATION STATE ===
  const animState: EntropySerpentAnimState = {
    basePositions,
    time: 0,
    segmentParticles,
  };
  group.userData.animState = animState;

  // Center the group
  const centerOffset = (CONFIG.BODY_SEGMENTS / 2) * radius * 1.6;
  group.children.forEach(child => {
    child.position.x -= centerOffset;
  });
  animState.basePositions.forEach(pos => {
    pos.x -= centerOffset;
  });

  // Rotate for top-down view
  group.rotation.order = 'XZY';
  group.rotation.x = -Math.PI / 2;

  return group;
}

/**
 * Create an arm with clawed hand
 */
function createArm(
  baseRadius: number,
  attachRadius: number,
  side: number,
  glowMat: THREE.Material,
  bodyColor: number
): THREE.Group {
  const arm = new THREE.Group();

  const armLength = baseRadius * CONFIG.ARM_LENGTH;
  const armThickness = attachRadius * CONFIG.ARM_THICKNESS;

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-armLength * 0.3, side * armLength * 0.4, 0),
    new THREE.Vector3(-armLength * 0.5, side * armLength * 0.8, -armLength * 0.1),
    new THREE.Vector3(-armLength * 0.4, side * armLength * 1.0, -armLength * 0.2),
  ]);

  const armMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    emissive: bodyColor,
    emissiveIntensity: 0.3,
    roughness: 0.4,
    metalness: 0.2,
  });

  const tubeGeo = new THREE.TubeGeometry(curve, 12, armThickness, 8, false);
  const tube = new THREE.Mesh(tubeGeo, armMat);
  tube.name = 'armTube';
  arm.add(tube);

  const handRadius = armThickness * 1.5;
  const handGeo = new THREE.SphereGeometry(handRadius, 12, 12);
  const hand = new THREE.Mesh(handGeo, armMat);
  const endPoint = curve.getPoint(1);
  hand.position.copy(endPoint);
  hand.name = 'hand';
  arm.add(hand);

  // Claws
  const clawLength = baseRadius * CONFIG.CLAW_LENGTH;
  const clawRadius = baseRadius * CONFIG.CLAW_RADIUS;

  for (let i = 0; i < CONFIG.CLAW_COUNT; i++) {
    const spreadAngle = (i - (CONFIG.CLAW_COUNT - 1) / 2) * CONFIG.CLAW_SPREAD;
    const clawGeo = new THREE.ConeGeometry(clawRadius, clawLength, 8);
    const claw = new THREE.Mesh(clawGeo, glowMat.clone());

    claw.position.copy(endPoint);
    claw.position.x -= clawLength * 0.5;
    claw.rotation.z = Math.PI / 2;
    claw.rotation.y = spreadAngle * side;
    claw.position.y += Math.sin(spreadAngle) * handRadius * side;
    claw.position.z += (i - 1) * clawRadius * 2;

    claw.name = `claw-${i}`;
    arm.add(claw);
    // Claw glows via emissive material (glowMat) - no PointLight needed
    // Bloom post-processing picks up the emissive for visual glow effect
  }

  return arm;
}

/**
 * Update serpent animation
 */
export function updateEntropySerpentAnimation(
  group: THREE.Group,
  dt: number,
  isMoving: boolean = false
): void {
  const animState = group.userData.animState as EntropySerpentAnimState;
  const bodySegments = group.userData.bodySegments as THREE.Group[];
  const state = group.userData.state as string;

  animState.time += dt;
  const time = animState.time;

  const speedMult = state === 'chase' ? 1.5 : state === 'attack' ? 2.0 : 1.0;

  // === SLITHER ANIMATION ===
  const slitherSpeed = CONFIG.SLITHER_SPEED * speedMult;
  const slitherAmp = CONFIG.SLITHER_AMPLITUDE * (isMoving ? 1.5 : 1.0);

  bodySegments.forEach((seg, i) => {
    const basePos = animState.basePositions[i];
    const t = i / (bodySegments.length - 1);
    const phase = t * Math.PI * 2;

    const wave = Math.sin(time * slitherSpeed - phase) * slitherAmp * group.userData.baseRadius;
    seg.position.y = basePos.y + wave;

    // Breathing pulse on outer sphere
    const breathe = Math.sin(time * CONFIG.BREATHE_SPEED + phase * 0.5) * CONFIG.BREATHE_AMOUNT;
    const outer = seg.children.find(c => c.name === 'outer') as THREE.Mesh | undefined;
    if (outer) {
      outer.scale.setScalar(1 + breathe);
    }
  });

  // === INTERNAL PARTICLE STORM ===
  bodySegments.forEach((seg, segIndex) => {
    const particles = seg.children.find(c => c.name === 'particles') as THREE.Points | undefined;
    if (!particles) return;

    const particleData = animState.segmentParticles[segIndex];
    const positions = particles.geometry.attributes.position.array as Float32Array;
    const segRadius = seg.userData.segRadius;

    for (let i = 0; i < particleData.length; i++) {
      const p = particleData[i];

      // Move particle
      p.x += p.vx * dt * speedMult;
      p.y += p.vy * dt * speedMult;
      p.z += p.vz * dt * speedMult;

      // Bounce inside sphere
      const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      if (dist > segRadius * 0.85) {
        const nx = p.x / dist;
        const ny = p.y / dist;
        const nz = p.z / dist;
        const dot = p.vx * nx + p.vy * ny + p.vz * nz;
        p.vx -= 2 * dot * nx;
        p.vy -= 2 * dot * ny;
        p.vz -= 2 * dot * nz;

        const pushBack = segRadius * 0.84;
        p.x = nx * pushBack;
        p.y = ny * pushBack;
        p.z = nz * pushBack;
      }

      // Turbulence
      const turb = 80 * speedMult;
      p.vx += (Math.random() - 0.5) * turb * dt;
      p.vy += (Math.random() - 0.5) * turb * dt;
      p.vz += (Math.random() - 0.5) * turb * dt;

      // Damping
      const damping = Math.pow(0.6, dt);
      p.vx *= damping;
      p.vy *= damping;
      p.vz *= damping;

      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    particles.geometry.attributes.position.needsUpdate = true;
  });

  // === ARM SWAY ===
  const arms = group.userData.arms as THREE.Group[];
  if (arms) {
    arms.forEach((arm, i) => {
      const side = arm.userData.side as number;
      const swayPhase = i * Math.PI;
      if (state === 'attack') {
        arm.rotation.x = -0.3;
      } else {
        const sway = Math.sin(time * CONFIG.ARM_SWAY_SPEED + swayPhase) * CONFIG.ARM_SWAY_AMOUNT;
        arm.rotation.z = sway * side;
      }
    });
  }

  // === EYE GLOW PULSE ===
  const eyeLight = group.userData.eyeLight as THREE.PointLight;
  if (eyeLight) {
    const basePower = state === 'chase' ? 6 : state === 'attack' ? 8 : 4;
    const pulse = Math.sin(time * 3) * 1.5;
    eyeLight.intensity = basePower + pulse;
  }
}

/**
 * Update serpent visual state
 */
export function updateEntropySerpentState(
  group: THREE.Group,
  state: 'patrol' | 'chase' | 'attack'
): void {
  group.userData.state = state;

  const bodyColor = state === 'chase' || state === 'attack'
    ? CONFIG.CHASE_BODY_COLOR
    : CONFIG.BODY_COLOR;

  const glowColor = state === 'chase' || state === 'attack'
    ? CONFIG.CHASE_GLOW_COLOR
    : CONFIG.GLOW_COLOR;

  const outerOpacity = state === 'chase' ? 0.35 : state === 'attack' ? 0.45 : CONFIG.OUTER_OPACITY;
  const emissiveIntensity = state === 'chase' ? 0.8 : state === 'attack' ? 1.0 : 0.6;
  const glowIntensity = state === 'chase' ? 10 : state === 'attack' ? 12 : CONFIG.EYE_GLOW_INTENSITY;

  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

      if (child.name === 'outer') {
        mat.color.setHex(bodyColor);
        mat.emissive.setHex(bodyColor);
        mat.emissiveIntensity = emissiveIntensity;
        (mat as THREE.MeshPhysicalMaterial).opacity = outerOpacity;
      } else if (child.name === 'eye' || child.name.startsWith('claw')) {
        mat.color.setHex(glowColor);
        mat.emissive.setHex(glowColor);
        mat.emissiveIntensity = glowIntensity;
      } else if (child.name === 'armTube' || child.name === 'hand') {
        mat.color.setHex(bodyColor);
        mat.emissive.setHex(bodyColor);
        mat.emissiveIntensity = state === 'attack' ? 0.5 : 0.3;
      }
    }

    if (child instanceof THREE.Points) {
      const mat = child.material as THREE.PointsMaterial;
      // Shift particle color toward red in chase/attack
      const particleColor = state === 'chase' || state === 'attack' ? 0xff6600 : 0xffaa00;
      mat.color.setHex(particleColor);
    }

    if (child instanceof THREE.PointLight) {
      child.color.setHex(glowColor);
    }
  });
}

/**
 * Dispose of serpent resources
 */
export function disposeEntropySerpent(group: THREE.Group): void {
  group.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        (child.material as THREE.Material).dispose();
      }
    }
  });
}
