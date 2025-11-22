// ============================================
// Model Factory - Extract model creation from ThreeRenderer
// Standalone model creation for viewer/testing
// ============================================

import * as THREE from 'three';
import { GAME_CONFIG } from '@godcell/shared';

// ============================================
// SINGLE-CELL ORGANISM
// ============================================

export function createSingleCell(radius: number, colorHex: number): THREE.Group {
  const cellGroup = new THREE.Group();

  // === OUTER MEMBRANE (Transparent shell) ===
  const membraneGeometry = new THREE.SphereGeometry(radius, 32, 32);
  const membraneMaterial = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.15,
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    depthWrite: false, // Keep shell from occluding inner glow
  });
  const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
  cellGroup.add(membrane);

  // === CYTOPLASM (Volumetric jelly) ===
  const nucleusRadius = radius * 0.5;
  const cytoplasmGeometry = new THREE.SphereGeometry(radius * 0.95, 32, 32);
  const cytoplasmMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      baseColor: { value: new THREE.Color(colorHex) },
      opacity: { value: 0.25 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 baseColor;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
        vec3 finalColor = baseColor * (0.8 + fresnel * 0.4);
        gl_FragColor = vec4(finalColor, opacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const cytoplasm = new THREE.Mesh(cytoplasmGeometry, cytoplasmMaterial);
  cellGroup.add(cytoplasm);

  // === ORGANELLES (Floating dots inside cytoplasm) ===
  const organelleCount = 8;
  const organelleGeometry = new THREE.SphereGeometry(radius * 0.05, 8, 8);
  const organelleMaterial = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.8,
  });

  for (let i = 0; i < organelleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const distance = nucleusRadius * 1.5 + Math.random() * (radius * 0.6);
    const x = distance * Math.sin(phi) * Math.cos(theta);
    const y = distance * Math.sin(phi) * Math.sin(theta);
    const z = distance * Math.cos(phi);

    const organelle = new THREE.Mesh(organelleGeometry, organelleMaterial.clone());
    organelle.position.set(x, y, z);
    cellGroup.add(organelle);
  }

  // === INNER NUCLEUS (Glowing core) ===
  const nucleusGeometry = new THREE.SphereGeometry(nucleusRadius, 16, 16);
  const nucleusMaterial = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
  nucleus.renderOrder = 1;
  nucleus.layers.set(2); // Keep nuclei out of bloom when rendered in-engine
  cellGroup.add(nucleus);

  return cellGroup;
}

// ============================================
// NUTRIENT
// ============================================

export function createNutrient(valueMultiplier: number = 1): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(GAME_CONFIG.NUTRIENT_SIZE, 6);

  let color: number;
  if (valueMultiplier >= 5) {
    color = GAME_CONFIG.NUTRIENT_5X_COLOR; // Magenta
  } else if (valueMultiplier >= 3) {
    color = GAME_CONFIG.NUTRIENT_3X_COLOR; // Gold
  } else if (valueMultiplier >= 2) {
    color = GAME_CONFIG.NUTRIENT_2X_COLOR; // Cyan
  } else {
    color = GAME_CONFIG.NUTRIENT_COLOR; // Green
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.0,
  });

  return new THREE.Mesh(geometry, material);
}

// ============================================
// ENTROPY SWARM (Virus Enemy)
// ============================================

export function createEntropySwarm(size: number): THREE.Group {
  const group = new THREE.Group();

  // === OUTER SPHERE (Semi-transparent boundary) ===
  const outerGeometry = new THREE.SphereGeometry(size, 32, 32);
  const outerMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.15,
    roughness: 0.3,
    metalness: 0.1,
    clearcoat: 0.5,
    side: THREE.DoubleSide,
  });
  const outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
  group.add(outerSphere);

  // === INTERNAL PARTICLE STORM ===
  const particleCount = 200;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = Math.random() * size * 0.9;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    colors[i * 3] = 1.0;
    colors[i * 3 + 1] = 0.2 + Math.random() * 0.3;
    colors[i * 3 + 2] = 0.0;

    sizes[i] = 1.0 + Math.random() * 2.0;
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particleMaterial = new THREE.PointsMaterial({
    size: 2,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const particleStorm = new THREE.Points(particleGeometry, particleMaterial);
  group.add(particleStorm);

  return group;
}

// ============================================
// GRAVITY DISTORTION (Black Hole)
// ============================================

export function createGravityDistortion(radius: number): THREE.Group {
  const group = new THREE.Group();

  // === LAYER 1: OUTER RING (influence boundary) ===
  const ringWidth = 3;
  const outerGeometry = new THREE.RingGeometry(radius - ringWidth, radius, 64);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
  group.add(outerRing);

  // === LAYER 2: MIDDLE RING (3x nutrient zone) ===
  const middleRadius = radius * 0.6;
  const middleGeometry = new THREE.RingGeometry(middleRadius - ringWidth, middleRadius, 64);
  const middleMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const middleRing = new THREE.Mesh(middleGeometry, middleMaterial);
  group.add(middleRing);

  // === LAYER 3: EVENT HORIZON (danger zone) ===
  const horizonRadius = GAME_CONFIG.OBSTACLE_EVENT_HORIZON;
  const horizonGeometry = new THREE.SphereGeometry(horizonRadius, 32, 32);
  const horizonMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xff0088,
    transparent: true,
    opacity: 0.25,
    roughness: 0.1,
    metalness: 0.8,
    clearcoat: 1.0,
  });
  const eventHorizon = new THREE.Mesh(horizonGeometry, horizonMaterial);
  group.add(eventHorizon);

  // === LAYER 3.5: VORTEX SPIRAL PARTICLES ===
  const vortexParticleCount = 800;
  const vortexPositions = new Float32Array(vortexParticleCount * 3);
  const vortexColors = new Float32Array(vortexParticleCount * 3);
  const spiralTurns = 5;

  for (let i = 0; i < vortexParticleCount; i++) {
    const t = i / vortexParticleCount;
    const angle = t * Math.PI * 2 * spiralTurns;
    const r = horizonRadius * (1.0 - t * 0.8);
    const z = (Math.random() - 0.5) * 10;

    vortexPositions[i * 3] = r * Math.cos(angle);
    vortexPositions[i * 3 + 1] = r * Math.sin(angle);
    vortexPositions[i * 3 + 2] = z;

    vortexColors[i * 3] = 1.0;
    vortexColors[i * 3 + 1] = 0.0;
    vortexColors[i * 3 + 2] = 0.5 + t * 0.5;
  }

  const vortexGeometry = new THREE.BufferGeometry();
  vortexGeometry.setAttribute('position', new THREE.BufferAttribute(vortexPositions, 3));
  vortexGeometry.setAttribute('color', new THREE.BufferAttribute(vortexColors, 3));

  const vortexMaterial = new THREE.PointsMaterial({
    size: 2,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
  });

  const vortexParticles = new THREE.Points(vortexGeometry, vortexMaterial);
  group.add(vortexParticles);

  // === LAYER 4: SINGULARITY CORE (instant death) ===
  const coreRadius = GAME_CONFIG.OBSTACLE_CORE_RADIUS;
  const coreGeometry = new THREE.SphereGeometry(coreRadius, 32, 32);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a0011,
    emissive: 0xff00ff,
    emissiveIntensity: 3.0,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);

  // === LAYER 5: ACCRETION DISK PARTICLES ===
  const diskParticleCount = 300;
  const diskPositions = new Float32Array(diskParticleCount * 3);
  const diskColors = new Float32Array(diskParticleCount * 3);
  const diskSizes = new Float32Array(diskParticleCount);

  for (let i = 0; i < diskParticleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = radius * 0.7 + Math.random() * radius * 0.3;

    diskPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    diskPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    diskPositions[i * 3 + 2] = r * Math.cos(phi) * 0.3;

    const distRatio = r / radius;
    if (distRatio > 0.5) {
      diskColors[i * 3] = 0.4;
      diskColors[i * 3 + 1] = 0.27;
      diskColors[i * 3 + 2] = 1.0;
    } else {
      diskColors[i * 3] = 1.0;
      diskColors[i * 3 + 1] = 0.0;
      diskColors[i * 3 + 2] = 1.0;
    }

    diskSizes[i] = 2.0 + Math.random() * 3.0;
  }

  const diskGeometry = new THREE.BufferGeometry();
  diskGeometry.setAttribute('position', new THREE.BufferAttribute(diskPositions, 3));
  diskGeometry.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));
  diskGeometry.setAttribute('size', new THREE.BufferAttribute(diskSizes, 1));

  const diskMaterial = new THREE.PointsMaterial({
    size: 3,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const accretionDisk = new THREE.Points(diskGeometry, diskMaterial);
  group.add(accretionDisk);

  return group;
}
