// ============================================
// GODCELL Model Viewer
// Standalone viewer for testing 3D models
// ============================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
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

let models: Array<THREE.Group | THREE.Mesh> = [];
let currentEntityType: 'single-cell' | 'multi-cell' | 'swarm' | 'obstacle' | 'nutrient' | 'all' = 'multi-cell';
let currentStyle: MultiCellStyle = 'colonial';
let nutrientMultiplier: number = 1;

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
    nutrientMultiplier = 1;
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n1xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  n2xBtn.onclick = () => {
    nutrientMultiplier = 2;
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n2xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  n3xBtn.onclick = () => {
    nutrientMultiplier = 3;
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n3xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  n5xBtn.onclick = () => {
    nutrientMultiplier = 5;
    updateActiveButton([n1xBtn, n2xBtn, n3xBtn, n5xBtn], n5xBtn);
    if (currentEntityType === 'nutrient') updateModels();
  };

  // Window resize handler
  window.addEventListener('resize', onResize);

  // Initial models
  updateModels();
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Animate multi-cell models
  models.forEach((model) => {
    if (model instanceof THREE.Group && model.userData.cellRadius) {
      // It's a colonial cluster
      updateMultiCellEnergy(model, 'colonial', 100, 100, 100, 100);
    } else if (model instanceof THREE.Group && model.userData.coreRadius) {
      // It's a radial organism
      updateMultiCellEnergy(model, 'radial', 100, 100, 100, 100);
    }
  });

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
