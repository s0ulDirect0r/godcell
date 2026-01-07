// ============================================
// Godcell Renderer (Stage 5)
// Alien-angel transcendent form
//
// Visual design (from concept art):
// - Purple spherical body with green fresnel rim glow
// - Eye-orbs embedded in body (hollow shell + green nucleus)
// - 4 major wing-blades: flat, curved, sweep OUTWARD from equator and curve back
// - 3 minor tail blades at southern pole, trailing behind
// ============================================

import * as THREE from 'three';

/**
 * Godcell Configuration
 */
export const CONFIG = {
  // === BODY ===
  BODY: {
    radius: 1.0,
    color: 0x6622cc,
    emissive: 0x220044,
    roughness: 0.3,
    metalness: 0.2,
  },

  // === FRESNEL AURA ===
  FRESNEL: {
    color: 0x00ff44,
    intensity: 2.0,
    shellOffset: 0.02,
    opacity: 0.3,
  },

  // === EYE-ORBS ===
  EYES: {
    count: 20, // Number of eyes to distribute
    shellRadius: 0.18, // 1.5x size
    shellColor: 0x6622cc,
    shellOpacity: 0.4,
    nucleusRadius: 0.075,
    nucleusColor: 0x00ff44,
    nucleusEmissive: 3.0,
    surfaceOffset: 0.95, // How far out eyes sit (1.0 = on surface, <1 = embedded)
  },

  // === WING-BLADES ===
  // Wings are arranged like angel wings: 2 pairs on each side (left/right),
  // all extending BACKWARD (parallel to +Z axis)
  WINGS: {
    major: {
      count: 4,
      color: 0x00ff44,
      emissiveIntensity: 2.5,
      // Blade dimensions (fractions of body radius)
      length: 2.0, // How far the blade extends backward
      baseWidth: 0.25, // Width at the base (near body)
      tipWidth: 0.02, // Width at the tip (tapered)
      thickness: 0.03, // Blade thickness (thin and flat)
      // Wing definitions: each wing has position and direction
      // direction: 1 = extend toward +Z (right side), -1 = extend toward +Z but mirrored (left side)
      wings: [
        // RIGHT SIDE (2 wings)
        { theta: 0, phi: Math.PI * 0.35, side: 1 }, // Upper-right
        { theta: 0, phi: Math.PI * 0.65, side: 1 }, // Lower-right
        // LEFT SIDE (2 wings)
        { theta: Math.PI, phi: Math.PI * 0.35, side: -1 }, // Upper-left
        { theta: Math.PI, phi: Math.PI * 0.65, side: -1 }, // Lower-left
      ],
      // Curve shape in wing-local space:
      // x = outward from body (perpendicular to body surface)
      // y = up (world Y)
      // z = backward (world +Z, will be flipped for left side)
      curve: [
        [0, 0, 0], // Start at body
        [0.15, 0.1, 0.4], // Slight outward, mostly backward
        [0.1, 0.05, 0.8], // Continue backward
        [0, 0, 1.0], // Tip straight back
      ],
      spots: {
        count: 5,
        radius: 0.06,
        color: 0x8833ff,
        emissiveIntensity: 1.5,
      },
    },
    minor: {
      count: 3,
      color: 0x00ff44,
      emissiveIntensity: 2.0,
      length: 1.2,
      baseWidth: 0.15,
      tipWidth: 0.02,
      thickness: 0.025,
      // Tail curve in wing-local space: [outward, up, backward]
      // Trails downward and backward
      curve: [
        [0, 0, 0], // Start at body
        [0.1, -0.3, 0.4], // Down and back
        [0.05, -0.6, 0.7], // Continue down and back
        [0, -0.8, 0.9], // Tip droops down
      ],
      baseTheta: Math.PI * 0.1, // Offset so they don't align with major wings
      phi: Math.PI * 0.75,
      spots: {
        count: 3,
        radius: 0.05,
        color: 0x8833ff,
        emissiveIntensity: 1.5,
      },
    },
  },

  // === ANIMATION ===
  ANIMATION: {
    pulseSpeed: 2.0,
    pulseMin: 2.0,
    pulseRange: 1.0,
    floatAmplitude: 0.03,
    floatSpeed: 1.0,
    rotationSpeed: 0.2,
  },
};

/**
 * Create a godcell mesh
 */
export function createGodcell(radius: number, colorHex: number): THREE.Group {
  const godcellGroup = new THREE.Group();
  godcellGroup.name = 'godcell';

  const s = radius / CONFIG.BODY.radius;

  godcellGroup.userData.radius = radius;
  godcellGroup.userData.colorHex = colorHex;
  godcellGroup.userData.scale = s;

  // === 1. MAIN BODY ===
  const bodyGeo = new THREE.SphereGeometry(CONFIG.BODY.radius * s, 32, 32);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: CONFIG.BODY.color,
    emissive: CONFIG.BODY.emissive,
    emissiveIntensity: 0.5,
    roughness: CONFIG.BODY.roughness,
    metalness: CONFIG.BODY.metalness,
  });

  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'body';
  godcellGroup.add(body);

  // === 2. FRESNEL SHELL ===
  const fresnelRadius = CONFIG.BODY.radius * s * (1 + CONFIG.FRESNEL.shellOffset);
  const fresnelGeo = new THREE.SphereGeometry(fresnelRadius, 32, 32);
  const fresnelMat = new THREE.MeshStandardMaterial({
    color: CONFIG.FRESNEL.color,
    emissive: CONFIG.FRESNEL.color,
    emissiveIntensity: CONFIG.FRESNEL.intensity,
    transparent: true,
    opacity: CONFIG.FRESNEL.opacity,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const fresnel = new THREE.Mesh(fresnelGeo, fresnelMat);
  fresnel.name = 'fresnel';
  body.add(fresnel);

  // === 3. EYE-ORBS ===
  const eyesGroup = new THREE.Group();
  eyesGroup.name = 'eyes';

  const eyePositions = fibonacciSphere(CONFIG.EYES.count);
  eyePositions.forEach((pos, i) => {
    const eye = createEyeOrb(s, pos.x, pos.y, pos.z);
    eye.name = `eye-${i}`;
    eyesGroup.add(eye);
  });

  body.add(eyesGroup);

  // === 3b. EYE SPIRAL TUBES ===
  // Add spiral tubes from all eyes
  const spiralEyeIndices = Array.from({ length: CONFIG.EYES.count }, (_, i) => i); // All eyes
  spiralEyeIndices.forEach((eyeIndex) => {
    const tube = createEyeSpiralTubeInternal(s, eyePositions[eyeIndex], eyeIndex);
    if (tube) {
      tube.name = `eyeSpiral-${eyeIndex}`;
      body.add(tube);
    }
  });

  // === 4. MAJOR WING-BLADES ===
  const wingsGroup = new THREE.Group();
  wingsGroup.name = 'wings';

  CONFIG.WINGS.major.wings.forEach((wingDef, i) => {
    const wing = createWingBlade(s, CONFIG.WINGS.major, wingDef.theta, wingDef.phi, wingDef.side);
    wing.name = `wing-major-${i}`;
    wingsGroup.add(wing);
  });

  godcellGroup.add(wingsGroup);

  // === 5. MINOR TAIL BLADES ===
  const tailGroup = new THREE.Group();
  tailGroup.name = 'tail';

  for (let i = 0; i < CONFIG.WINGS.minor.count; i++) {
    const theta = CONFIG.WINGS.minor.baseTheta + (i / CONFIG.WINGS.minor.count) * Math.PI * 2;
    // Tail blades all extend backward (side=1)
    const wing = createWingBlade(s, CONFIG.WINGS.minor, theta, CONFIG.WINGS.minor.phi, 1);
    wing.name = `wing-minor-${i}`;
    tailGroup.add(wing);
  }

  godcellGroup.add(tailGroup);

  // === 6. POINT LIGHT ===
  const light = new THREE.PointLight(CONFIG.FRESNEL.color, 2, radius * 4);
  light.name = 'godcellLight';
  body.add(light);

  return godcellGroup;
}

/**
 * Generate evenly distributed points on a sphere using fibonacci spiral
 */
function fibonacciSphere(count: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2; // y goes from 1 to -1
    const radius = Math.sqrt(1 - y * y); // Radius at y
    const theta = phi * i; // Golden angle increment

    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;

    points.push(new THREE.Vector3(x, y, z));
  }

  return points;
}

/**
 * Create an eye-orb at a normalized direction
 */
function createEyeOrb(s: number, nx: number, ny: number, nz: number): THREE.Group {
  const eyeGroup = new THREE.Group();
  const bodyRadius = CONFIG.BODY.radius * s;
  const cfg = CONFIG.EYES;

  // Position eye on body surface (with offset to protrude)
  const surfaceRadius = bodyRadius * cfg.surfaceOffset;
  eyeGroup.position.set(nx * surfaceRadius, ny * surfaceRadius, nz * surfaceRadius);

  const shellGeo = new THREE.SphereGeometry(cfg.shellRadius * s, 16, 16);
  const shellMat = new THREE.MeshStandardMaterial({
    color: cfg.shellColor,
    transparent: true,
    opacity: cfg.shellOpacity,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });

  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.name = 'shell';
  eyeGroup.add(shell);

  const nucleusGeo = new THREE.SphereGeometry(cfg.nucleusRadius * s, 12, 12);
  const nucleusMat = new THREE.MeshStandardMaterial({
    color: cfg.nucleusColor,
    emissive: cfg.nucleusColor,
    emissiveIntensity: cfg.nucleusEmissive,
    roughness: 0.1,
  });

  const nucleus = new THREE.Mesh(nucleusGeo, nucleusMat);
  nucleus.name = 'nucleus';
  eyeGroup.add(nucleus);

  return eyeGroup;
}

/**
 * Create a flat, tapered wing-blade that follows a curve
 *
 * @param s - Scale factor
 * @param cfg - Wing configuration
 * @param theta - Spherical theta (angle around Y axis)
 * @param phi - Spherical phi (angle from top)
 * @param side - 1 for right side (blade extends +Z), -1 for left side (blade mirrors)
 */
function createWingBlade(
  s: number,
  cfg: typeof CONFIG.WINGS.major,
  theta: number,
  phi: number,
  side: number
): THREE.Group {
  const wingGroup = new THREE.Group();
  const bodyRadius = CONFIG.BODY.radius * s;

  // Attachment point on body surface
  wingGroup.position.set(
    bodyRadius * Math.sin(phi) * Math.cos(theta),
    bodyRadius * Math.cos(phi),
    bodyRadius * Math.sin(phi) * Math.sin(theta)
  );

  // Build coordinate frame for wing orientation:
  // - outward: perpendicular to body surface (radial direction)
  // - backward: +Z direction (world space)
  // - up: +Y direction (world space)
  const outward = wingGroup.position.clone().normalize();

  // Curve is defined in wing-local space: [outward, up, backward]
  // outward.x is already +1 for right side, -1 for left side
  // So we just multiply x by outward.x to get natural mirror symmetry
  const bladeLength = cfg.length * bodyRadius;
  const spinePoints: THREE.Vector3[] = cfg.curve.map(([x, y, z]) => {
    // x = outward from body (perpendicular to surface)
    // y = up (world Y)
    // z = backward (world +Z)
    return new THREE.Vector3(
      outward.x * x * bladeLength, // outward.x handles L/R mirroring naturally
      y * bladeLength,
      z * bladeLength // Both sides go backward
    );
  });

  const spineCurve = new THREE.CatmullRomCurve3(spinePoints);

  // Create blade geometry: flat ribbon that tapers
  const bladeGeo = createBladeGeometry(
    spineCurve,
    cfg.baseWidth * bodyRadius,
    cfg.tipWidth * bodyRadius,
    cfg.thickness * bodyRadius,
    32 // segments along the blade
  );

  const bladeMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.color,
    emissiveIntensity: cfg.emissiveIntensity,
    roughness: 0.15,
    side: THREE.DoubleSide,
  });

  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.name = 'blade';
  wingGroup.add(blade);

  // Purple spots along the blade
  const spotGeo = new THREE.SphereGeometry(cfg.spots.radius * bodyRadius, 12, 12);
  const spotMat = new THREE.MeshStandardMaterial({
    color: cfg.spots.color,
    emissive: cfg.spots.color,
    emissiveIntensity: cfg.spots.emissiveIntensity,
    roughness: 0.1,
  });

  for (let i = 0; i < cfg.spots.count; i++) {
    const t = (i + 0.5) / cfg.spots.count;
    const spotPos = spineCurve.getPoint(t);

    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.copy(spotPos);
    spot.name = `spot-${i}`;
    wingGroup.add(spot);
  }

  return wingGroup;
}

/**
 * Create a flat, tapered blade geometry following a curve
 *
 * @param curve - The spine curve of the blade
 * @param baseWidth - Width at the start (base)
 * @param tipWidth - Width at the end (tip)
 * @param thickness - Blade thickness
 * @param segments - Number of segments along the blade
 */
function createBladeGeometry(
  curve: THREE.CatmullRomCurve3,
  baseWidth: number,
  tipWidth: number,
  thickness: number,
  segments: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Generate vertices along the curve
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPoint(t);
    const tangentVec = curve.getTangent(t);

    // Width tapers from base to tip
    const width = baseWidth + (tipWidth - baseWidth) * t;
    const halfWidth = width / 2;
    const halfThickness = thickness / 2;

    // Calculate perpendicular vectors for the blade cross-section
    // "up" is perpendicular to tangent, in the vertical plane
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangentVec, up).normalize();
    if (right.lengthSq() < 0.01) {
      right.set(1, 0, 0);
    }
    const bladeUp = new THREE.Vector3().crossVectors(right, tangentVec).normalize();

    // Create 4 vertices for cross-section: top-left, top-right, bottom-right, bottom-left
    // The blade is wide along "right" axis, thin along "bladeUp" axis
    const tl = point
      .clone()
      .addScaledVector(right, -halfWidth)
      .addScaledVector(bladeUp, halfThickness);
    const tr = point
      .clone()
      .addScaledVector(right, halfWidth)
      .addScaledVector(bladeUp, halfThickness);
    const br = point
      .clone()
      .addScaledVector(right, halfWidth)
      .addScaledVector(bladeUp, -halfThickness);
    const bl = point
      .clone()
      .addScaledVector(right, -halfWidth)
      .addScaledVector(bladeUp, -halfThickness);

    positions.push(tl.x, tl.y, tl.z); // 0 + i*4
    positions.push(tr.x, tr.y, tr.z); // 1 + i*4
    positions.push(br.x, br.y, br.z); // 2 + i*4
    positions.push(bl.x, bl.y, bl.z); // 3 + i*4

    // Normals (simplified - could be more accurate)
    normals.push(bladeUp.x, bladeUp.y, bladeUp.z); // top-left: up
    normals.push(bladeUp.x, bladeUp.y, bladeUp.z); // top-right: up
    normals.push(-bladeUp.x, -bladeUp.y, -bladeUp.z); // bottom-right: down
    normals.push(-bladeUp.x, -bladeUp.y, -bladeUp.z); // bottom-left: down
  }

  // Create faces connecting adjacent cross-sections
  for (let i = 0; i < segments; i++) {
    const base = i * 4;
    const next = (i + 1) * 4;

    // Top face (tl, tr, next_tr, next_tl)
    indices.push(base + 0, base + 1, next + 1);
    indices.push(base + 0, next + 1, next + 0);

    // Bottom face (bl, br, next_br, next_bl) - reversed winding
    indices.push(base + 3, next + 3, next + 2);
    indices.push(base + 3, next + 2, base + 2);

    // Right edge (tr, br, next_br, next_tr)
    indices.push(base + 1, base + 2, next + 2);
    indices.push(base + 1, next + 2, next + 1);

    // Left edge (tl, bl, next_bl, next_tl) - reversed winding
    indices.push(base + 0, next + 0, next + 3);
    indices.push(base + 0, next + 3, base + 3);
  }

  // End caps
  // Base cap (i=0)
  indices.push(0, 3, 2);
  indices.push(0, 2, 1);

  // Tip cap (i=segments)
  const tipBase = segments * 4;
  indices.push(tipBase + 0, tipBase + 1, tipBase + 2);
  indices.push(tipBase + 0, tipBase + 2, tipBase + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); // Recompute for smooth shading

  return geometry;
}

/**
 * Update godcell visual state based on energy level
 */
export function updateGodcellEnergy(godcellGroup: THREE.Group, energyRatio: number): void {
  const ratio = Math.max(0, Math.min(1, energyRatio));

  const body = godcellGroup.getObjectByName('body') as THREE.Mesh | undefined;
  const fresnel = godcellGroup.getObjectByName('fresnel') as THREE.Mesh | undefined;
  const light = godcellGroup.getObjectByName('godcellLight') as THREE.PointLight | undefined;

  if (fresnel && fresnel.material instanceof THREE.MeshStandardMaterial) {
    fresnel.material.emissiveIntensity = 1.0 + ratio * 1.5;
    fresnel.material.opacity = 0.2 + ratio * 0.2;
  }

  if (body && body.material instanceof THREE.MeshStandardMaterial) {
    body.material.emissiveIntensity = 0.3 + ratio * 0.4;
  }

  if (light) {
    light.intensity = 1 + ratio * 2;
  }

  const eyes = godcellGroup.getObjectByName('eyes') as THREE.Group | undefined;
  if (eyes) {
    eyes.traverse((child) => {
      if (child.name === 'nucleus' && child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.5 + ratio * 2.0;
      }
    });
  }

  if (ratio < 0.2) {
    const time = performance.now() * 0.015;
    const pulse = Math.sin(time) * 0.5 + 0.5;

    if (fresnel && fresnel.material instanceof THREE.MeshStandardMaterial) {
      fresnel.material.emissiveIntensity = 0.5 + pulse * 1.5;
    }
    if (light) {
      light.intensity = 0.5 + pulse * 1.5;
    }
  }
}

/**
 * Animate the godcell
 */
export function animateGodcell(godcellGroup: THREE.Group, delta: number): void {
  const time = performance.now() * 0.001;
  const s = godcellGroup.userData.scale || 1;
  const bodyRadius = CONFIG.BODY.radius * s;

  const body = godcellGroup.getObjectByName('body') as THREE.Mesh | undefined;
  const fresnel = godcellGroup.getObjectByName('fresnel') as THREE.Mesh | undefined;
  const wings = godcellGroup.getObjectByName('wings') as THREE.Group | undefined;
  const tail = godcellGroup.getObjectByName('tail') as THREE.Group | undefined;

  if (fresnel && fresnel.material instanceof THREE.MeshStandardMaterial) {
    const pulse = Math.sin(time * CONFIG.ANIMATION.pulseSpeed) + 1;
    fresnel.material.emissiveIntensity =
      CONFIG.ANIMATION.pulseMin + pulse * (CONFIG.ANIMATION.pulseRange / 2);
  }

  const floatOffset =
    Math.sin(time * CONFIG.ANIMATION.floatSpeed) * CONFIG.ANIMATION.floatAmplitude * bodyRadius;

  if (body) {
    body.position.y = floatOffset;
  }
  if (wings) {
    wings.position.y = floatOffset;
  }
  if (tail) {
    tail.position.y = floatOffset;
  }

  godcellGroup.rotation.y += delta * CONFIG.ANIMATION.rotationSpeed;
}

/**
 * Dispose godcell resources
 */
export function disposeGodcell(godcellGroup: THREE.Group): void {
  godcellGroup.traverse((child) => {
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

/**
 * Dispose cached geometries
 */
export function disposeGodcellCache(): void {
  // No caching
}

/**
 * Internal helper: create a spiral tube from an eye position (used during godcell creation)
 */
function createEyeSpiralTubeInternal(s: number, eyeDir: THREE.Vector3, eyeIndex: number): THREE.Mesh | null {
  const bodyRadius = CONFIG.BODY.radius * s;
  const eyeRadius = CONFIG.EYES.shellRadius * s;

  // Alternate spiral direction: even = clockwise, odd = counter-clockwise
  const spiralDirection = eyeIndex % 2 === 0 ? 1 : -1;
  const spiralTurns = 2.5 * spiralDirection;

  const tubeRadius = eyeRadius * 0.04; // Thinner
  const arcLength = 0.3;

  // Spiral diameter = 1/2 eye radius (smaller)
  const spiralRadius = (eyeRadius * 0.5) / bodyRadius;

  // Calculate spiral center: offset from eye by arcLength radians
  // Vary the offset direction based on eye index for more variety
  const normalizedEyeDir = eyeDir.clone().normalize();

  // Create a base perpendicular direction
  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normalizedEyeDir.dot(up)) > 0.9) {
    up.set(1, 0, 0);
  }
  const tangent1 = new THREE.Vector3().crossVectors(normalizedEyeDir, up).normalize();
  const tangent2 = new THREE.Vector3().crossVectors(normalizedEyeDir, tangent1).normalize();

  // Rotate the offset direction around the eye based on index (golden angle for good distribution)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees
  const offsetAngle = eyeIndex * goldenAngle;
  const tangent = new THREE.Vector3()
    .addScaledVector(tangent1, Math.cos(offsetAngle))
    .addScaledVector(tangent2, Math.sin(offsetAngle))
    .normalize();

  const spiralCenterDir = new THREE.Vector3()
    .addScaledVector(normalizedEyeDir, Math.cos(arcLength))
    .addScaledVector(tangent, Math.sin(arcLength))
    .normalize();

  return createEyeToSpiralTube(new THREE.Vector3(0, 0, 0), bodyRadius, normalizedEyeDir, spiralCenterDir, {
    spiralTurns,
    spiralRadius,
    tubeRadius,
    arcSegments: 12,
    spiralSegments: 32,
  });
}

/**
 * Add a tube that connects an eye to a nearby inward spiral on the sphere surface.
 *
 * @param godcellGroup - The godcell group to add the tube to
 * @param eyeIndex - Which eye to start from (0-19)
 * @param options - Optional overrides for spiral appearance
 */
export function addEyeSpiralTube(
  godcellGroup: THREE.Group,
  eyeIndex: number,
  options: {
    spiralTurns?: number; // How many times the spiral wraps inward (default: 2.5)
    tubeRadius?: number; // Tube thickness as fraction of eye radius (default: 0.15)
    arcLength?: number; // How far the arc travels before spiraling (radians, default: 0.4)
  } = {}
): THREE.Mesh | null {
  const {
    spiralTurns = 2.5,
    tubeRadius = 0.15,
    arcLength = 0.4, // Short arc - about 23 degrees
  } = options;

  const s = godcellGroup.userData.scale || 1;
  const bodyRadius = CONFIG.BODY.radius * s;
  const eyeRadius = CONFIG.EYES.shellRadius * s;

  // Spiral diameter = 2x eye radius, convert to angular size on sphere
  const spiralRadius = (eyeRadius * 2) / bodyRadius;

  // Find the eye
  const eye = godcellGroup.getObjectByName(`eye-${eyeIndex}`) as THREE.Group | undefined;
  if (!eye) {
    console.warn(`Eye ${eyeIndex} not found`);
    return null;
  }

  const body = godcellGroup.getObjectByName('body') as THREE.Mesh;
  if (!body) {
    console.warn('Body not found');
    return null;
  }

  // Eye direction (normalized position = direction from center)
  const eyeDir = eye.position.clone().normalize();

  // Calculate spiral center: offset from eye by arcLength radians
  // Pick a perpendicular direction to offset toward
  let offsetDir = new THREE.Vector3(0, 1, 0);
  if (Math.abs(eyeDir.dot(offsetDir)) > 0.9) {
    offsetDir.set(1, 0, 0);
  }
  const tangent = new THREE.Vector3().crossVectors(eyeDir, offsetDir).normalize();

  // Spiral center is arcLength radians away from eye along the tangent direction
  const spiralCenterDir = new THREE.Vector3()
    .addScaledVector(eyeDir, Math.cos(arcLength))
    .addScaledVector(tangent, Math.sin(arcLength))
    .normalize();

  // Build the tube
  const tube = createEyeToSpiralTube(new THREE.Vector3(0, 0, 0), bodyRadius, eyeDir, spiralCenterDir, {
    spiralTurns,
    spiralRadius,
    tubeRadius: eyeRadius * tubeRadius,
    arcSegments: 12,
    spiralSegments: 32,
  });

  tube.name = `eyeSpiral-${eyeIndex}`;
  body.add(tube);

  return tube;
}

/**
 * Create a tube that starts at an eye position, arcs across the sphere surface,
 * and ends in an inward spiral to a terminus point.
 */
function createEyeToSpiralTube(
  sphereCenter: THREE.Vector3,
  sphereRadius: number,
  eyeDir: THREE.Vector3,
  spiralCenterDir: THREE.Vector3,
  options: {
    spiralTurns: number;
    spiralRadius: number;
    tubeRadius: number;
    arcSegments: number;
    spiralSegments: number;
  }
): THREE.Mesh {
  const { spiralTurns, tubeRadius, arcSegments, spiralSegments } = options;

  const points: THREE.Vector3[] = [];
  const totalSegments = arcSegments + spiralSegments;

  // Build local coordinate frame at spiral center
  const center = spiralCenterDir.clone().normalize();

  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(center.dot(up)) > 0.99) {
    up.set(1, 0, 0);
  }
  const tangentU = new THREE.Vector3().crossVectors(up, center).normalize();
  const tangentV = new THREE.Vector3().crossVectors(center, tangentU).normalize();

  // Calculate the starting radius (angular distance from eye to spiral center)
  const eyeNorm = eyeDir.clone().normalize();
  const startingRadius = Math.acos(Math.max(-1, Math.min(1, eyeNorm.dot(center))));

  // Calculate starting angle (where the eye is relative to the spiral center's coordinate frame)
  const eyeRelative = eyeNorm.clone().sub(center.clone().multiplyScalar(eyeNorm.dot(center)));
  const startingAngle = Math.atan2(eyeRelative.dot(tangentV), eyeRelative.dot(tangentU));

  // Create one unified spiral from eye to center
  // Stop before radius gets too small (prevents degenerate geometry)
  const minRadius = tubeRadius * 1.5 / sphereRadius; // Stop at 1.5x tube radius

  // Use more segments for smoother curves
  const smoothSegments = totalSegments * 5;

  for (let i = 0; i <= smoothSegments; i++) {
    const t = i / smoothSegments;

    // Radius shrinks smoothly, but stops at minRadius
    const easedT = t * t * (3 - 2 * t); // smoothstep easing
    const r = startingRadius * (1 - easedT);

    // Stop adding points once we're too tight
    if (r < minRadius && i > 0) break;

    // Angle: start at eye's angle, then add spiral turns
    const theta = startingAngle + t * Math.PI * 2 * spiralTurns;

    const dir = new THREE.Vector3()
      .addScaledVector(center, Math.cos(r))
      .addScaledVector(tangentU, Math.sin(r) * Math.cos(theta))
      .addScaledVector(tangentV, Math.sin(r) * Math.sin(theta))
      .normalize();

    points.push(sphereCenter.clone().addScaledVector(dir, sphereRadius));
  }

  // Create tube geometry
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, points.length, tubeRadius, 8, false);

  const material = new THREE.MeshStandardMaterial({
    color: CONFIG.FRESNEL.color,
    emissive: CONFIG.FRESNEL.color,
    emissiveIntensity: 1.5,
  });

  const tube = new THREE.Mesh(geometry, material);

  // Add cap sphere at the end of the tube
  const lastPoint = points[points.length - 1];
  const capGeo = new THREE.SphereGeometry(tubeRadius, 8, 8);
  const cap = new THREE.Mesh(capGeo, material);
  cap.position.copy(lastPoint);
  tube.add(cap);

  return tube;
}
