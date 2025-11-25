import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Model Viewer Structure Tests', () => {
  test('model-viewer.ts should export required functions and state', async () => {
    // Read the source file
    const sourceFile = path.join(__dirname, '../src/model-viewer.ts');
    const content = fs.readFileSync(sourceFile, 'utf-8');

    // Verify lil-gui import
    expect(content).toContain("import GUI from 'lil-gui'");

    // Verify animation state object exists with expected properties
    expect(content).toContain('animState');
    expect(content).toContain('energyLevel');
    expect(content).toContain('autoAnimate');
    expect(content).toContain('animationSpeed');
    expect(content).toContain('autoRotate');
    expect(content).toContain('rotationSpeed');
    expect(content).toContain('showWireframe');

    // Verify VFX parameters object exists with expected properties
    expect(content).toContain('vfxParams');
    expect(content).toContain('membraneOpacity');
    expect(content).toContain('nucleusGlow');
    expect(content).toContain('pulseFrequency');
    expect(content).toContain('tetherOpacity');
    expect(content).toContain('swarmTurbulence');
    expect(content).toContain('vortexSpeed');

    // Verify initGUI function exists
    expect(content).toContain('function initGUI()');

    // Verify GUI folders are created
    expect(content).toContain("'Entity Selection'");
    expect(content).toContain("'Animation'");
    expect(content).toContain("'VFX Parameters'");
    expect(content).toContain("'View Options'");
    expect(content).toContain("'Cell Visuals'");
    expect(content).toContain("'Multi-cell'");
    expect(content).toContain("'Swarm'");
    expect(content).toContain("'Gravity Well'");

    // Verify control names
    expect(content).toContain("'Entity Type'");
    expect(content).toContain("'Multi-cell Style'");
    expect(content).toContain("'Energy %'");
    expect(content).toContain("'Auto Cycle Energy'");
    expect(content).toContain("'Animation Speed'");
    expect(content).toContain("'Auto Rotate'");
    expect(content).toContain("'Wireframe'");
    expect(content).toContain("'Reset Camera'");
    expect(content).toContain("'Export Params'");

    // Verify animate function handles energy cycling
    expect(content).toContain('animState.autoAnimate');
    expect(content).toContain('energyDirection');
    expect(content).toContain('updateMultiCellEnergy');
  });

  test('model-viewer.html should exist and reference the viewer script', async () => {
    const htmlFile = path.join(__dirname, '../model-viewer.html');
    const content = fs.readFileSync(htmlFile, 'utf-8');

    // Verify it references the model-viewer script
    expect(content).toContain('model-viewer');

    // Verify it has the entity selection buttons
    expect(content).toContain('id="single-cell"');
    expect(content).toContain('id="multi-cell"');
    expect(content).toContain('id="swarm"');
    expect(content).toContain('id="obstacle"');
    expect(content).toContain('id="nutrient"');
    expect(content).toContain('id="all"');
  });

  test('DevPanel.ts should export DevPanel class with required methods', async () => {
    const sourceFile = path.join(__dirname, '../src/ui/DevPanel.ts');
    const content = fs.readFileSync(sourceFile, 'utf-8');

    // Verify lil-gui import
    expect(content).toContain("import GUI from 'lil-gui'");

    // Verify class export
    expect(content).toContain('export class DevPanel');

    // Verify config folders exist
    expect(content).toContain("'Config Tweaking'");
    expect(content).toContain("'Movement'");
    expect(content).toContain("'Energy Decay'");
    expect(content).toContain("'Evolution'");
    expect(content).toContain("'Nutrients'");
    expect(content).toContain("'Gravity Wells'");
    expect(content).toContain("'Entropy Swarms'");
    expect(content).toContain("'Combat'");
    expect(content).toContain("'EMP'");
    expect(content).toContain("'Detection'");

    // Verify spawn controls
    expect(content).toContain("'Entity Spawning'");
    expect(content).toContain("'Spawn at Center'");
    expect(content).toContain("'Spawn at Player'");
    expect(content).toContain("'Spawn 5 Random'");

    // Verify player controls
    expect(content).toContain("'Player Controls'");
    expect(content).toContain("'God Mode'");
    expect(content).toContain("'Set Energy'");
    expect(content).toContain("'Set Stage'");
    expect(content).toContain("'Refill Energy'");
    expect(content).toContain("'Max Energy + Stage 5'");

    // Verify debug controls
    expect(content).toContain("'Debug Visualization'");
    expect(content).toContain("'Collision Boxes'");
    expect(content).toContain("'Detection Ranges'");
    expect(content).toContain("'Gravity Wells'");
    expect(content).toContain("'Velocity Vectors'");

    // Verify game controls
    expect(content).toContain("'Game Control'");
    expect(content).toContain("'Paused'");
    expect(content).toContain("'Time Scale'");
    expect(content).toContain("'Step Tick'");
    expect(content).toContain("'Export Config'");

    // Verify public methods
    expect(content).toContain('toggle()');
    expect(content).toContain('show()');
    expect(content).toContain('hide()');
    expect(content).toContain('destroy()');

    // Verify socket event handlers
    expect(content).toContain("'devConfigUpdated'");
    expect(content).toContain("'devState'");
    expect(content).toContain("'devCommand'");
  });

  test('shared/index.ts should have dev panel types', async () => {
    const sourceFile = path.join(__dirname, '../../shared/index.ts');
    const content = fs.readFileSync(sourceFile, 'utf-8');

    // Verify dev message types exist
    expect(content).toContain('DevCommandMessage');
    expect(content).toContain('DevCommand');
    expect(content).toContain('DevUpdateConfigCommand');
    expect(content).toContain('DevSpawnEntityCommand');
    expect(content).toContain('DevDeleteEntityCommand');
    expect(content).toContain('DevSetGodModeCommand');
    expect(content).toContain('DevSetTimeScaleCommand');
    expect(content).toContain('DevTeleportPlayerCommand');
    expect(content).toContain('DevSetPlayerEnergyCommand');
    expect(content).toContain('DevSetPlayerStageCommand');
    expect(content).toContain('DevPauseGameCommand');
    expect(content).toContain('DevStepTickCommand');
    expect(content).toContain('DevConfigUpdatedMessage');
    expect(content).toContain('DevStateMessage');

    // Verify tunable configs array
    expect(content).toContain('DEV_TUNABLE_CONFIGS');
    expect(content).toContain('TunableConfigKey');

    // Verify some expected config keys
    expect(content).toContain("'PLAYER_SPEED'");
    expect(content).toContain("'MOVEMENT_FRICTION'");
    expect(content).toContain("'SINGLE_CELL_ENERGY_DECAY_RATE'");
    expect(content).toContain("'EVOLUTION_MULTI_CELL'");
    expect(content).toContain("'SWARM_SPEED'");
    expect(content).toContain("'EMP_COOLDOWN'");
  });

  test('server/src/dev.ts should export required functions', async () => {
    const sourceFile = path.join(__dirname, '../../server/src/dev.ts');
    const content = fs.readFileSync(sourceFile, 'utf-8');

    // Verify exports
    expect(content).toContain('export function getConfig');
    expect(content).toContain('export function isGamePaused');
    expect(content).toContain('export function getTimeScale');
    expect(content).toContain('export function hasGodMode');
    expect(content).toContain('export function shouldRunTick');
    expect(content).toContain('export function initDevHandler');
    expect(content).toContain('export function handleDevCommand');
    expect(content).toContain('export function getConfigOverrides');
    expect(content).toContain('export function resetDevState');

    // Verify command handlers
    expect(content).toContain('handleUpdateConfig');
    expect(content).toContain('handleSpawnEntity');
    expect(content).toContain('handleDeleteEntity');
    expect(content).toContain('handleSetGodMode');
    expect(content).toContain('handleSetTimeScale');
    expect(content).toContain('handleTeleportPlayer');
    expect(content).toContain('handleSetPlayerEnergy');
    expect(content).toContain('handleSetPlayerStage');
    expect(content).toContain('handlePauseGame');
    expect(content).toContain('handleStepTick');
  });
});
