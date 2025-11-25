// ============================================
// GODCELL Model Viewer
// Standalone viewer for testing 3D models
// Extended with lil-gui for VFX parameter tuning
// ============================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {
  createMultiCell,
  updateMultiCellEnergy,
  type MultiCellStyle,
} from './render/three/MultiCellRenderer';
import {
  createSingleCell,
  createEntropySwarm,
  createGravityDistortion,
  createNutrient,
} from './render/three/ModelFactory';

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let gui: GUI;

let models: Array<THREE.Group | THREE.Mesh> = [];
let currentEntityType: 'single-cell' | 'multi-cell' | 'swarm' | 'obstacle' | 'nutrient' | 'all' = 'multi-cell';
let currentStyle: MultiCellStyle = 'colonial';

// Animation state for energy visualization
const animState = {
  energyLevel: 100,       // 0-100 current energy percentage
  maxEnergyLevel: 100,
  animationSpeed: 1.0,    // Animation speed multiplier
  autoAnimate: true,      // Auto-cycle energy for preview
  showWireframe: false,
  rotationSpeed: 0.5,     // Auto-rotation speed
  autoRotate: false,
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
  document.body.appendChild(renderer.domElement);

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

  // Button handlers
  const singleCellBtn = document.getElementById('single-cell')!;
  const multiCellBtn = document.getElementById('multi-cell')!;
  const swarmBtn = document.getElementById('swarm')!;
  const obstacleBtn = document.getElementById('obstacle')!;
  const nutrientBtn = document.getElementById('nutrient')!;
  const allBtn = document.getElementById('all')!;

  const colonialBtn = document.getElementById('colonial')!;
  const radialBtn = document.getElementById('radial')!;

  const n1xBtn = document.getElementById('n1x')!;
  const n2xBtn = document.getElementById('n2x')!;
  const n3xBtn = document.getElementById('n3x')!;
  const n5xBtn = document.getElementById('n5x')!;

  const multiCellOptions = document.getElementById('multi-cell-options')!;
  const nutrientOptions = document.getElementById('nutrient-options')!;

  singleCellBtn.onclick = () => {
    currentEntityType = 'single-cell';
    updateActiveButton([singleCellBtn, multiCellBtn, swarmBtn, obstacleBtn, nutrientBtn, allBtn], singleCellBtn);
    multiCellOptions.style.display = 'none';
    nutrientOptions.style.display = 'none';
    updateModels();
  };

  multiCellBtn.onclick = () => {
    currentEntityType = 'multi-cell';
    updateActiveButton([singleCellBtn, multiCellBtn, swarmBtn, obstacleBtn, nutrientBtn, allBtn], multiCellBtn);
    multiCellOptions.style.display = 'block';
    nutrientOptions.style.display = 'none';
    updateModels();
  };

  swarmBtn.onclick = () => {
    currentEntityType = 'swarm';
    updateActiveButton([singleCellBtn, multiCellBtn, swarmBtn, obstacleBtn, nutrientBtn, allBtn], swarmBtn);
    multiCellOptions.style.display = 'none';
    nutrientOptions.style.display = 'none';
    updateModels();
  };

  obstacleBtn.onclick = () => {
    currentEntityType = 'obstacle';
    updateActiveButton([singleCellBtn, multiCellBtn, swarmBtn, obstacleBtn, nutrientBtn, allBtn], obstacleBtn);
    multiCellOptions.style.display = 'none';
    nutrientOptions.style.display = 'none';
    updateModels();
  };

  nutrientBtn.onclick = () => {
    currentEntityType = 'nutrient';
    updateActiveButton([singleCellBtn, multiCellBtn, swarmBtn, obstacleBtn, nutrientBtn, allBtn], nutrientBtn);
    multiCellOptions.style.display = 'none';
    nutrientOptions.style.display = 'block';
    updateModels();
  };

  allBtn.onclick = () => {
    currentEntityType = 'all';
    updateActiveButton([singleCellBtn, multiCellBtn, swarmBtn, obstacleBtn, nutrientBtn, allBtn], allBtn);
    multiCellOptions.style.display = 'none';
    nutrientOptions.style.display = 'none';
    updateModels();
  };

  colonialBtn.onclick = () => {
    currentStyle = 'colonial';
    updateActiveButton([colonialBtn, radialBtn], colonialBtn);
    if (currentEntityType === 'multi-cell') updateModels();
  };

  radialBtn.onclick = () => {
    currentStyle = 'radial';
    updateActiveButton([colonialBtn, radialBtn], radialBtn);
    if (currentEntityType === 'multi-cell') updateModels();
  };

  n1xBtn.onclick = () => {
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n1xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  n2xBtn.onclick = () => {
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n2xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  n3xBtn.onclick = () => {
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n3xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  n5xBtn.onclick = () => {
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n5xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

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
    'single-cell', 'multi-cell', 'swarm', 'obstacle', 'nutrient', 'all'
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
  animFolder.add(animState, 'autoAnimate')
    .name('Auto Cycle Energy');
  animFolder.add(animState, 'animationSpeed', 0.1, 3, 0.1)
    .name('Animation Speed');
  animFolder.add(animState, 'autoRotate')
    .name('Auto Rotate');
  animFolder.add(animState, 'rotationSpeed', 0, 2, 0.1)
    .name('Rotation Speed');
  animFolder.open();

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

function updateActiveButton(buttons: HTMLElement[], active: HTMLElement) {
  buttons.forEach((btn) => btn.classList.remove('active'));
  active.classList.add('active');
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
      const cell = createSingleCell(24, 0x00ff88);
      cell.position.set(0, 0, 0);
      scene.add(cell);
      models.push(cell);
      camera.position.set(0, 0, 150);
      break;
    }

    case 'multi-cell': {
      const cell = createMultiCell({
        radius: 48,
        colorHex: 0x00ff88,
        style: currentStyle,
      });
      cell.position.set(0, 0, 0);
      scene.add(cell);
      models.push(cell);
      camera.position.set(0, 0, 200);
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
      // Grid layout of all models
      const spacing = 150;

      // Row 1: Cells
      const singleCell = createSingleCell(24, 0x00ff88);
      singleCell.position.set(-spacing * 1.5, spacing, 0);
      scene.add(singleCell);
      models.push(singleCell);

      const colonial = createMultiCell({ radius: 48, colorHex: 0x00ff88, style: 'colonial' });
      colonial.position.set(-spacing * 0.5, spacing, 0);
      scene.add(colonial);
      models.push(colonial);

      const radial = createMultiCell({ radius: 48, colorHex: 0xff8800, style: 'radial' });
      radial.position.set(spacing * 0.5, spacing, 0);
      scene.add(radial);
      models.push(radial);

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

let lastTime = 0;
let energyDirection = -1; // -1 = draining, 1 = filling

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

  // Animate multi-cell models with current energy level
  const energy = animState.energyLevel;
  const maxEnergy = animState.maxEnergyLevel;

  models.forEach((model) => {
    if (model instanceof THREE.Group && model.userData.cellRadius) {
      // It's a colonial cluster
      updateMultiCellEnergy(model, 'colonial', energy, maxEnergy);
    } else if (model instanceof THREE.Group && model.userData.coreRadius) {
      // It's a radial organism
      updateMultiCellEnergy(model, 'radial', energy, maxEnergy);
    }
  });

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
