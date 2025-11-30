// ============================================
// GODCELL Model Viewer
// Standalone viewer for testing 3D models
// Extended with lil-gui for VFX parameter tuning
// Now with bloom postprocessing for game-accurate visuals
// ============================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import {
  createMultiCell,
  updateMultiCellEnergy,
  type MultiCellStyle,
} from './render/meshes/MultiCellMesh';
import {
  createEntropySwarm,
  createGravityDistortion,
  createNutrient,
} from './render/three/ModelFactory';
import {
  createSingleCell,
  updateSingleCellEnergy,
} from './render/meshes/SingleCellMesh';
import {
  createCyberOrganism,
  updateCyberOrganismAnimation,
  updateCyberOrganismEnergy,
} from './render/meshes/CyberOrganismMesh';
import {
  updateEvolutionCorona,
  updateEvolutionRing,
  removeEvolutionEffects,
  applyEvolutionEffects,
} from './render/three/EvolutionVisuals';

// Game's neon color palette (matches shared/index.ts CELL_COLORS)
const CELL_COLORS = [
  '#00ffff', // Cyan
  '#ff00ff', // Magenta
  '#ffff00', // Yellow
  '#00ff88', // Mint
  '#ff0088', // Hot pink
  '#88ff00', // Lime
  '#0088ff', // Electric blue
];

function randomCellColor(): number {
  const hex = CELL_COLORS[Math.floor(Math.random() * CELL_COLORS.length)];
  return parseInt(hex.replace('#', ''), 16);
}

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let composer: EffectComposer;
let bloomPass: UnrealBloomPass;
let controls: OrbitControls;
let gui: GUI;
let currentColor: number = randomCellColor();

let models: Array<THREE.Group | THREE.Mesh> = [];
let currentEntityType: 'single-cell' | 'multi-cell' | 'cyber-organism' | 'swarm' | 'obstacle' | 'nutrient' | 'all' = 'multi-cell';
let currentStyle: MultiCellStyle = 'colonial';
let lastTime = 0;
let energyDirection = -1; // -1 = draining, 1 = filling

// Animation state for energy visualization
const animState = {
  energyLevel: 100,       // 0-100 current energy percentage
  maxEnergy: 100,         // Max energy (affects evolution progress)
  animationSpeed: 1.0,    // Animation speed multiplier
  autoAnimate: true,      // Auto-cycle energy for preview
  showWireframe: false,
  rotationSpeed: 0.5,     // Auto-rotation speed
  autoRotate: false,
  // Evolution visuals
  evolutionProgress: 0,   // 0-1 progress toward next stage
  showEvolution: false,   // Show evolution progress indicators (corona, ring)
  playMolting: false,     // Play the molting animation
  moltingProgress: 0,     // 0-1 progress through molting animation
};

// VFX parameters for tuning
const vfxParams = {
  // Cell visuals
  membraneOpacity: 0.15,
  nucleusGlow: 2.0,
  organelleCount: 8,
  pulseFrequency: 1.0,

  // Swarm visuals
  swarmParticleCount: 200,
  swarmTurbulence: 1.0,

  // Gravity well visuals
  vortexSpeed: 1.0,
  accretionDensity: 1.0,

  // Multi-cell visuals
  tetherOpacity: 0.6,
  tetherWidth: 2,
  cellSpacing: 1.0,
};

init();
animate();

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 200);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.5;
  document.body.appendChild(renderer.domElement);

  // Postprocessing composer with bloom (game-accurate glow)
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2,  // strength - strong glow for neon aesthetic
    0.8,  // radius - spread of glow
    0.3   // threshold - lower = more things glow
  );
  composer.addPass(bloomPass);

  // OrbitControls for camera manipulation
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = true;

  // Lights
  scene.add(new THREE.AmbientLight(0x404040, 2));
  const directional = new THREE.DirectionalLight(0xffffff, 1.5);
  directional.position.set(1, 1, 1);
  scene.add(directional);

  // Grid helper for spatial reference
  const gridHelper = new THREE.GridHelper(400, 20, 0x00ff88, 0x004422);
  gridHelper.rotation.x = Math.PI / 2; // Rotate to XY plane
  scene.add(gridHelper);

  // Window resize handler
  window.addEventListener('resize', onResize);

  // Initialize lil-gui
  initGUI();

  // Initial models
  updateModels();
}

function initGUI() {
  gui = new GUI({ title: 'Model Viewer Controls', width: 300 });

  // Entity selection folder
  const entityFolder = gui.addFolder('Entity Selection');
  entityFolder.add({ type: currentEntityType }, 'type', [
    'single-cell', 'multi-cell', 'cyber-organism', 'swarm', 'obstacle', 'nutrient', 'all'
  ])
    .name('Entity Type')
    .onChange((value: typeof currentEntityType) => {
      currentEntityType = value;
      updateModels();
    });

  entityFolder.add({ style: currentStyle }, 'style', ['colonial', 'radial'])
    .name('Multi-cell Style')
    .onChange((value: MultiCellStyle) => {
      currentStyle = value;
      if (currentEntityType === 'multi-cell') updateModels();
    });
  entityFolder.open();

  // Animation controls folder
  const animFolder = gui.addFolder('Animation');
  animFolder.add(animState, 'energyLevel', 0, 100, 1)
    .name('Energy %')
    .listen();
  animFolder.add(animState, 'maxEnergy', 50, 500, 10)
    .name('Max Energy')
    .listen();
  animFolder.add(animState, 'autoAnimate')
    .name('Auto Cycle Energy');
  animFolder.add(animState, 'animationSpeed', 0.1, 3, 0.1)
    .name('Animation Speed');
  animFolder.add(animState, 'autoRotate')
    .name('Auto Rotate');
  animFolder.add(animState, 'rotationSpeed', 0, 2, 0.1)
    .name('Rotation Speed');
  animFolder.open();

  // Evolution visuals folder
  const evoFolder = gui.addFolder('Evolution');
  evoFolder.add(animState, 'evolutionProgress', 0, 1, 0.01)
    .name('Evolution Progress')
    .listen();
  evoFolder.add(animState, 'showEvolution')
    .name('Show Progress FX')
    .onChange((show: boolean) => {
      if (!show) {
        // Remove evolution effects from all cell models
        models.forEach(model => {
          if (model instanceof THREE.Group) {
            removeEvolutionEffects(model);
          }
        });
      }
    });
  evoFolder.add(animState, 'playMolting')
    .name('Play Molting')
    .onChange((play: boolean) => {
      if (play) {
        animState.moltingProgress = 0;
      }
    });
  evoFolder.open();

  // VFX parameters folder
  const vfxFolder = gui.addFolder('VFX Parameters');

  // Cell subfolder
  const cellVfx = vfxFolder.addFolder('Cell Visuals');
  cellVfx.add(vfxParams, 'membraneOpacity', 0.05, 0.5, 0.01)
    .name('Membrane Opacity')
    .onChange(() => updateModels());
  cellVfx.add(vfxParams, 'nucleusGlow', 0.5, 5, 0.1)
    .name('Nucleus Glow')
    .onChange(() => updateModels());
  cellVfx.add(vfxParams, 'pulseFrequency', 0.2, 3, 0.1)
    .name('Pulse Frequency');
  cellVfx.close();

  // Multi-cell subfolder
  const multiVfx = vfxFolder.addFolder('Multi-cell');
  multiVfx.add(vfxParams, 'tetherOpacity', 0.1, 1, 0.05)
    .name('Tether Opacity');
  multiVfx.add(vfxParams, 'tetherWidth', 1, 5, 0.5)
    .name('Tether Width');
  multiVfx.add(vfxParams, 'cellSpacing', 0.5, 2, 0.1)
    .name('Cell Spacing')
    .onChange(() => updateModels());
  multiVfx.close();

  // Swarm subfolder
  const swarmVfx = vfxFolder.addFolder('Swarm');
  swarmVfx.add(vfxParams, 'swarmTurbulence', 0.2, 3, 0.1)
    .name('Turbulence');
  swarmVfx.close();

  // Gravity well subfolder
  const gravityVfx = vfxFolder.addFolder('Gravity Well');
  gravityVfx.add(vfxParams, 'vortexSpeed', 0.2, 3, 0.1)
    .name('Vortex Speed');
  gravityVfx.add(vfxParams, 'accretionDensity', 0.2, 3, 0.1)
    .name('Accretion Density');
  gravityVfx.close();

  vfxFolder.close();

  // Bloom controls folder
  const bloomFolder = gui.addFolder('Bloom / Glow');
  const bloomParams = {
    strength: 1.2,
    radius: 0.8,
    threshold: 0.3,
  };
  bloomFolder.add(bloomParams, 'strength', 0, 3, 0.1)
    .name('Strength')
    .onChange((v: number) => { bloomPass.strength = v; });
  bloomFolder.add(bloomParams, 'radius', 0, 2, 0.1)
    .name('Radius')
    .onChange((v: number) => { bloomPass.radius = v; });
  bloomFolder.add(bloomParams, 'threshold', 0, 1, 0.05)
    .name('Threshold')
    .onChange((v: number) => { bloomPass.threshold = v; });
  bloomFolder.open();

  // Color controls folder
  const colorFolder = gui.addFolder('Cell Color');
  const colorDisplay = { color: '#' + currentColor.toString(16).padStart(6, '0') };
  colorFolder.addColor(colorDisplay, 'color')
    .name('Current Color')
    .listen()
    .onChange((hex: string) => {
      currentColor = parseInt(hex.replace('#', ''), 16);
      updateModels();
    });
  colorFolder.add({ randomize: () => {
    currentColor = randomCellColor();
    colorDisplay.color = '#' + currentColor.toString(16).padStart(6, '0');
    updateModels();
  }}, 'randomize').name('🎲 Randomize Color');
  colorFolder.open();

  // View options folder
  const viewFolder = gui.addFolder('View Options');
  viewFolder.add(animState, 'showWireframe')
    .name('Wireframe')
    .onChange((show: boolean) => {
      models.forEach(model => {
        model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => { m.wireframe = show; });
            } else {
              child.material.wireframe = show;
            }
          }
        });
      });
    });
  viewFolder.add({ resetCamera: () => {
    camera.position.set(0, 0, 200);
    controls.reset();
  }}, 'resetCamera').name('Reset Camera');
  viewFolder.add({ exportParams: () => {
    console.log('VFX Parameters:', JSON.stringify(vfxParams, null, 2));
    navigator.clipboard?.writeText(JSON.stringify(vfxParams, null, 2));
    console.log('Copied to clipboard!');
  }}, 'exportParams').name('Export Params');
  viewFolder.close();
}

function updateModels() {
  // Clear existing models
  models.forEach((model) => {
    scene.remove(model);
    // TODO: proper cleanup of geometries/materials
  });
  models = [];

  switch (currentEntityType) {
    case 'single-cell': {
      const cell = createSingleCell(24, currentColor);
      cell.position.set(0, 0, 0);
      scene.add(cell);
      models.push(cell);
      camera.position.set(0, 0, 150);
      break;
    }

    case 'multi-cell': {
      const cell = createMultiCell({
        radius: 48,
        colorHex: currentColor,
        style: currentStyle,
      });
      cell.position.set(0, 0, 0);
      scene.add(cell);
      models.push(cell);
      camera.position.set(0, 0, 200);
      break;
    }

    case 'cyber-organism': {
      // Stage 3 hexapod - use larger radius matching game (144px = CYBER_ORGANISM_SIZE_MULTIPLIER * PLAYER_SIZE)
      const cyberOrg = createCyberOrganism(144, currentColor);
      cyberOrg.position.set(0, 0, 0);
      scene.add(cyberOrg);
      models.push(cyberOrg);
      camera.position.set(0, 0, 400); // Further out for larger model
      break;
    }

    case 'swarm': {
      const swarm = createEntropySwarm(40);
      swarm.position.set(0, 0, 0);
      scene.add(swarm);
      models.push(swarm);
      camera.position.set(0, 0, 200);
      break;
    }

    case 'obstacle': {
      const obstacle = createGravityDistortion(100);
      obstacle.position.set(0, 0, 0);
      scene.add(obstacle);
      models.push(obstacle);
      camera.position.set(0, 0, 400);
      break;
    }

    case 'nutrient': {
      // Show all 4 nutrient types in a row
      const spacing = 30;
      const multipliers = [1, 2, 3, 5];
      const xOffset = -spacing * 1.5;

      multipliers.forEach((mult, i) => {
        const nutrient = createNutrient(mult);
        nutrient.position.set(xOffset + i * spacing, 0, 0);
        scene.add(nutrient);
        models.push(nutrient);
      });

      camera.position.set(0, 0, 150);
      break;
    }

    case 'all': {
      // Grid layout of all models with random colors
      const spacing = 150;

      // Row 1: Player stages (each with random color from game palette)
      const singleCell = createSingleCell(24, randomCellColor());
      singleCell.position.set(-spacing * 2, spacing, 0);
      scene.add(singleCell);
      models.push(singleCell);

      const colonial = createMultiCell({ radius: 48, colorHex: randomCellColor(), style: 'colonial' });
      colonial.position.set(-spacing * 0.5, spacing, 0);
      scene.add(colonial);
      models.push(colonial);

      const radial = createMultiCell({ radius: 48, colorHex: randomCellColor(), style: 'radial' });
      radial.position.set(spacing * 0.5, spacing, 0);
      scene.add(radial);
      models.push(radial);

      // Cyber-organism (scaled down to fit in grid - actual game size is 144)
      const cyberOrg = createCyberOrganism(60, randomCellColor());
      cyberOrg.position.set(spacing * 1.5, spacing, 0);
      scene.add(cyberOrg);
      models.push(cyberOrg);

      // Row 2: Threats
      const swarm = createEntropySwarm(40);
      swarm.position.set(-spacing, -spacing * 0.5, 0);
      scene.add(swarm);
      models.push(swarm);

      const obstacle = createGravityDistortion(80);
      obstacle.position.set(spacing, -spacing * 0.5, 0);
      scene.add(obstacle);
      models.push(obstacle);

      // Row 3: Nutrients
      const nutrientSpacing = 25;
      const nutY = -spacing * 1.5;
      [1, 2, 3, 5].forEach((mult, i) => {
        const nutrient = createNutrient(mult);
        nutrient.position.set(-nutrientSpacing * 1.5 + i * nutrientSpacing, nutY, 0);
        scene.add(nutrient);
        models.push(nutrient);
      });

      camera.position.set(0, 0, 600);
      break;
    }
  }

  controls.update();
}

function animate(currentTime: number = 0) {
  requestAnimationFrame(animate);

  const deltaTime = (currentTime - lastTime) / 1000;
  lastTime = currentTime;

  controls.update();

  // Auto-cycle energy for preview
  if (animState.autoAnimate) {
    animState.energyLevel += energyDirection * deltaTime * 20 * animState.animationSpeed;
    if (animState.energyLevel <= 5) {
      animState.energyLevel = 5;
      energyDirection = 1;
    } else if (animState.energyLevel >= 100) {
      animState.energyLevel = 100;
      energyDirection = -1;
    }
  }

  // Auto-rotate models
  if (animState.autoRotate) {
    models.forEach((model) => {
      model.rotation.z += deltaTime * animState.rotationSpeed;
    });
  }

  // Play molting animation if enabled
  if (animState.playMolting) {
    animState.moltingProgress += deltaTime * 0.5 * animState.animationSpeed; // ~2 seconds for full animation
    if (animState.moltingProgress >= 1) {
      animState.moltingProgress = 0;
      animState.playMolting = false;
    }
  }

  // Animate multi-cell models with current energy level
  const energy = animState.energyLevel;
  const maxEnergy = animState.maxEnergy;

  models.forEach((model) => {
    if (model instanceof THREE.Group && model.userData.cellRadius) {
      // It's a colonial cluster
      updateMultiCellEnergy(model, 'colonial', energy, maxEnergy);

      // Evolution progress visuals
      if (animState.showEvolution && animState.evolutionProgress > 0) {
        const radius = model.userData.cellRadius || 48;
        updateEvolutionCorona(model, animState.evolutionProgress);
        updateEvolutionRing(model, animState.evolutionProgress, radius);
      }

      // Molting animation (intense glow + scale pulse during evolution)
      if (animState.playMolting) {
        applyEvolutionEffects(model, 'multi_cell', animState.moltingProgress);
      }
    } else if (model instanceof THREE.Group && model.userData.coreRadius) {
      // It's a radial organism
      updateMultiCellEnergy(model, 'radial', energy, maxEnergy);

      // Evolution progress visuals
      if (animState.showEvolution && animState.evolutionProgress > 0) {
        const radius = model.userData.coreRadius || 48;
        updateEvolutionCorona(model, animState.evolutionProgress);
        updateEvolutionRing(model, animState.evolutionProgress, radius);
      }

      // Molting animation
      if (animState.playMolting) {
        applyEvolutionEffects(model, 'multi_cell', animState.moltingProgress);
      }
    } else if (model instanceof THREE.Group && model.userData.radius) {
      // It's a single cell (created by SingleCellRenderer)
      updateSingleCellEnergy(model, energy, maxEnergy);

      // Evolution progress visuals for single cell
      if (animState.showEvolution && animState.evolutionProgress > 0) {
        const radius = model.userData.radius || 24;
        updateEvolutionCorona(model, animState.evolutionProgress);
        updateEvolutionRing(model, animState.evolutionProgress, radius);
      }

      // Molting animation
      if (animState.playMolting) {
        applyEvolutionEffects(model, 'single_cell', animState.moltingProgress);
      }
    } else if (model instanceof THREE.Group && model.name === 'cyberOrganism') {
      // Cyber-organism - animate legs and energy glow
      updateCyberOrganismEnergy(model, energy / 100);
      updateCyberOrganismAnimation(model, animState.autoAnimate, deltaTime);
    } else if (model instanceof THREE.Group && model.userData.crystalSize) {
      // It's a 3D nutrient crystal - animate rotation and inner core pulsing
      const { rotationSpeed, bobPhase } = model.userData;
      const now = Date.now();

      // Rotate around Y axis (tumbling effect)
      // rotationSpeed is stored in radians/ms, deltaTime in seconds → multiply by 1000 to convert
      model.rotation.y += rotationSpeed * deltaTime * 1000;
      // Slight wobble on X axis
      model.rotation.x = Math.sin(now * 0.0005 + bobPhase) * 0.3;

      // Pulse the inner core brightness
      const core = model.children.find(c => c.name === 'core') as THREE.Mesh | undefined;
      if (core && core.material instanceof THREE.MeshBasicMaterial) {
        const pulse = 0.7 + Math.sin(now * 0.004 + bobPhase) * 0.3;
        core.material.opacity = pulse;
      }
    }
  });

  composer.render();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}
