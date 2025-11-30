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
 * Update single cell visual state based on energy level
 * Affects nucleus glow, cytoplasm opacity, organelle visibility
 *
 * @param cellGroup - The cell group created by createSingleCell
 * @param energy - Current energy level
 * @param maxEnergy - Maximum energy level
 */
export function updateSingleCellEnergy(cellGroup: THREE.Group, energy: number, maxEnergy: number): void {
  const energyRatio = Math.max(0, Math.min(1, energy / maxEnergy));

  // Get cell components (membrane, cytoplasm, organelles, nucleus)
  const membrane = cellGroup.children[0] as THREE.Mesh;
  const cytoplasm = cellGroup.children[1] as THREE.Mesh;
  const organelles = cellGroup.children[2] as THREE.Points;
  const nucleus = cellGroup.children[3] as THREE.Mesh;

  if (!membrane || !cytoplasm || !organelles || !nucleus) return;

  const membraneMaterial = membrane.material as THREE.MeshPhysicalMaterial;
  const cytoplasmMaterial = cytoplasm.material as THREE.ShaderMaterial;
  const organelleMaterial = organelles.material as THREE.PointsMaterial;
  const nucleusMaterial = nucleus.material as THREE.MeshStandardMaterial;

  // Nucleus fades based on energy
  nucleusMaterial.opacity = 0.3 + energyRatio * 0.7; // 0.3-1.0

  // Cytoplasm darkens toward black as energy drops
  if (cytoplasmMaterial.uniforms?.energyRatio) {
    cytoplasmMaterial.uniforms.energyRatio.value = energyRatio;
  }

  // Update based on energy level
  if (energyRatio > 0.5) {
    // High energy: bright and steady
    nucleusMaterial.emissiveIntensity = 2.5;
    if (cytoplasmMaterial.uniforms?.opacity) {
      cytoplasmMaterial.uniforms.opacity.value = 0.5;
    }
    organelleMaterial.opacity = 0.7;
    membraneMaterial.opacity = 0.15;
    nucleus.scale.set(1, 1, 1);
  } else if (energyRatio > 0.2) {
    // Medium energy: dimming
    nucleusMaterial.emissiveIntensity = 1.0 + energyRatio * 2;
    if (cytoplasmMaterial.uniforms?.opacity) {
      cytoplasmMaterial.uniforms.opacity.value = 0.35 + energyRatio * 0.3;
    }
    organelleMaterial.opacity = 0.5 + energyRatio * 0.4;
    membraneMaterial.opacity = 0.12 + energyRatio * 0.06;
    nucleus.scale.set(1, 1, 1);
  } else if (energyRatio > 0.1) {
    // Low energy: dramatic flickering
    const time = Date.now() * 0.01;
    const flicker = Math.sin(time) * 0.5 + 0.5;
    nucleusMaterial.emissiveIntensity = (0.3 + energyRatio * 2) * (0.4 + flicker * 0.6);
    if (cytoplasmMaterial.uniforms?.opacity) {
      cytoplasmMaterial.uniforms.opacity.value = (0.25 + energyRatio * 0.3) * (0.7 + flicker * 0.3);
    }
    organelleMaterial.opacity = 0.35 + energyRatio * 0.3 * flicker;
    membraneMaterial.opacity = 0.1;
    const scalePulse = 0.95 + flicker * 0.1;
    nucleus.scale.set(scalePulse, scalePulse, scalePulse);
  } else {
    // Critical energy: URGENT pulsing
    const time = Date.now() * 0.015;
    const pulse = Math.sin(time) * 0.6 + 0.4;
    nucleusMaterial.emissiveIntensity = 0.2 + pulse * 0.8;
    if (cytoplasmMaterial.uniforms?.opacity) {
      cytoplasmMaterial.uniforms.opacity.value = 0.15 + pulse * 0.2;
    }
    organelleMaterial.opacity = 0.2 + pulse * 0.25;
    membraneMaterial.opacity = 0.05 + pulse * 0.1;
    const scalePulse = 0.85 + pulse * 0.25;
    nucleus.scale.set(scalePulse, scalePulse, scalePulse);
  }
}

/**
 * Dispose of cached geometries (call on renderer cleanup)
 */
export function disposeSingleCellCache(): void {
  geometryCache.forEach(geometry => geometry.dispose());
  geometryCache.clear();
}
