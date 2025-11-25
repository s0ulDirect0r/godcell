// ============================================
// Single-Cell Organism Renderer
// Creates and manages single-cell visual meshes
// ============================================

import * as THREE from 'three';

// Module-level geometry cache for performance
const geometryCache = new Map<string, THREE.BufferGeometry>();

function getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometryCache.has(key)) {
    geometryCache.set(key, factory());
  }
  return geometryCache.get(key)!;
}

/**
 * Create a single-cell organism mesh with 4 layers:
 * - Outer membrane (transparent shell)
 * - Cytoplasm (volumetric jelly with shader)
 * - Organelle particles
 * - Inner nucleus (glowing core)
 *
 * @param radius - Cell radius in world units
 * @param colorHex - Base color as hex number (e.g., 0x00ff88)
 * @returns THREE.Group containing the complete cell mesh
 */
export function createSingleCell(radius: number, colorHex: number): THREE.Group {
  const cellGroup = new THREE.Group();

  // === OUTER MEMBRANE (Transparent shell) ===
  // Slight clearcoat for wet/glossy cell appearance
  const membraneGeometry = getGeometry(`sphere-membrane-${radius}`, () =>
    new THREE.SphereGeometry(radius, 32, 32)
  );

  const membraneMaterial = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.15,           // Very transparent outer shell
    roughness: 0.1,          // Smooth surface
    metalness: 0.05,         // Slight metallic sheen
    clearcoat: 0.8,          // Wet/glossy appearance
  });

  const membrane = new THREE.Mesh(membraneGeometry, membraneMaterial);
  cellGroup.add(membrane);

  // === CYTOPLASM (Volumetric jelly with shader) ===
  // Custom shader creates depth-based coloring and fresnel edge glow
  const nucleusRadius = radius * 0.3;
  const cytoplasmGeometry = getGeometry(`sphere-cytoplasm-${radius}`, () =>
    new THREE.SphereGeometry(radius * 0.95, 32, 32)
  );

  const cytoplasmMaterial = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(colorHex) },
      opacity: { value: 0.5 },
      nucleusRadius: { value: nucleusRadius },
      cellRadius: { value: radius * 0.95 },
      energyRatio: { value: 1.0 },  // 0-1, affects brightness (low energy = darker)
    },
    vertexShader: `
      varying vec3 vPosition;      // Local space position (for gradient/depth)
      varying vec3 vWorldPosition; // World space position (for fresnel)
      varying vec3 vNormal;

      void main() {
        vPosition = position;
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform float nucleusRadius;
      uniform float cellRadius;
      uniform float energyRatio;

      varying vec3 vPosition;      // Local space (for gradient)
      varying vec3 vWorldPosition; // World space (for fresnel)
      varying vec3 vNormal;

      void main() {
        // Distance from center for gradient (use local space)
        float dist = length(vPosition);
        float gradient = smoothstep(nucleusRadius * 1.5, cellRadius, dist);

        // Fresnel effect for edge glow (use world space for proper camera-relative calculation)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);

        // Alpha: denser near nucleus, transparent at edges
        float alpha = mix(0.6, 0.2, gradient) * opacity;
        alpha += fresnel * 0.15;

        // Depth darkening for volumetric feel
        float depthDarken = 1.0 - (dist / cellRadius) * 0.3;

        // energyRatio affects brightness (0 = black, 1 = full color)
        vec3 finalColor = mix(vec3(0.0, 0.0, 0.0), color, energyRatio) * depthDarken;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const cytoplasm = new THREE.Mesh(cytoplasmGeometry, cytoplasmMaterial);
  cellGroup.add(cytoplasm);

  // === ORGANELLE PARTICLES ===
  // Small glowing dots floating in cytoplasm between nucleus and membrane
  const particleCount = 15;
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  const minRadius = nucleusRadius * 1.3;  // Just outside nucleus
  const maxRadius = radius * 0.85;         // Just inside membrane

  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = minRadius + Math.random() * (maxRadius - minRadius);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    sizes[i] = 1.5 + Math.random() * 1.5;  // Varying sizes
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particleMaterial = new THREE.PointsMaterial({
    color: colorHex,
    size: 2.5,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: false,
    blending: THREE.AdditiveBlending,  // Glow effect
  });

  const organelles = new THREE.Points(particleGeometry, particleMaterial);
  cellGroup.add(organelles);

  // === INNER NUCLEUS (Glowing core) ===
  // Brightest part of the cell, emissive for bloom effect
  const nucleusGeometry = getGeometry(`sphere-nucleus-${nucleusRadius}`, () =>
    new THREE.SphereGeometry(nucleusRadius, 16, 16)
  );

  const nucleusMaterial = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 2.0,  // Strong glow for bloom
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
  });

  const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
  cellGroup.add(nucleus);

  // Store metadata for evolution effects and updates
  cellGroup.userData.radius = radius;
  cellGroup.userData.colorHex = colorHex;

  return cellGroup;
}

/**
 * Dispose of cached geometries (call on renderer cleanup)
 */
export function disposeSingleCellCache(): void {
  geometryCache.forEach(geometry => geometry.dispose());
  geometryCache.clear();
}
