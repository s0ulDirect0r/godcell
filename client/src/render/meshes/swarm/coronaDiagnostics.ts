// ============================================
// Corona Diagnostics - GPU compute vs CPU reference
// ============================================

import * as THREE from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import { CoronaSwarm } from './CoronaSwarm';
import {
  coronaStepCPU,
  coronaSurfaceCPU,
  coronaTailStateCPU,
  type CoronaParams,
} from './coronaSim';

export interface CoronaScenarioResult {
  name: string;
  particles: number;
  positionMatchedPct: number; // GPU and CPU positions within POSITION_TOLERANCE
  velocityMatchedPct: number; // ...and velocities within VELOCITY_TOLERANCE
  maxPositionError: number; // Px, among matched particles
  maxVelocityError: number; // Px/s, among matched particles
  tailParticles: number; // Particles mostly in the tail (CPU side); > 0 means the trail path was exercised
  gpuNonFinite: number;
}

export interface CoronaParityResult {
  scenarios: CoronaScenarioResult[];
}

const POSITION_TOLERANCE = 0.05; // Px
const VELOCITY_TOLERANCE = 1; // Px/s (finite differences amplify float noise by 1/h)
const SWARM_RADIUS = 47; // Game swarm size

/** Read a vec3 storage buffer back as tightly packed xyz, whatever its GPU stride (12 or 16 bytes) */
async function readVec3(
  renderer: WebGPURenderer,
  attribute: THREE.BufferAttribute,
  count: number
): Promise<Float32Array> {
  const raw = new Float32Array(await renderer.getArrayBufferAsync(attribute));
  const stride = raw.length / count;
  if (stride === 3) return raw;
  const packed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    packed[i * 3] = raw[i * stride];
    packed[i * 3 + 1] = raw[i * stride + 1];
    packed[i * 3 + 2] = raw[i * stride + 2];
  }
  return packed;
}

async function compare(
  renderer: WebGPURenderer,
  fx: CoronaSwarm,
  name: string
): Promise<CoronaScenarioResult> {
  const params: CoronaParams = fx.params;
  renderer.compute(fx.computeNode);
  const [gpuPos, gpuVel] = await Promise.all([
    readVec3(renderer, fx.buffers.positions, fx.count),
    readVec3(renderer, fx.buffers.velocities, fx.count),
  ]);
  const cpu = coronaStepCPU(params);

  let posMatched = 0;
  let velMatched = 0;
  let maxPos = 0;
  let maxVel = 0;
  let gpuNonFinite = 0;
  let tailParticles = 0;
  for (let i = 0; i < fx.count; i++) {
    const surface = coronaSurfaceCPU(i, params.time, params.radius, params.chase);
    const { weight } = coronaTailStateCPU(i, params.time, surface, params.chase, params.move);
    if (weight > 0.5) tailParticles++;

    let posErr = 0;
    let velErr = 0;
    let finite = true;
    for (let c = 0; c < 3; c++) {
      const g = gpuPos[i * 3 + c];
      const gv = gpuVel[i * 3 + c];
      if (!Number.isFinite(g) || !Number.isFinite(gv)) finite = false;
      posErr = Math.max(posErr, Math.abs(g - cpu.positions[i * 3 + c]));
      velErr = Math.max(velErr, Math.abs(gv - cpu.velocities[i * 3 + c]));
    }
    if (!finite) {
      gpuNonFinite++;
      continue;
    }
    if (posErr <= POSITION_TOLERANCE) {
      posMatched++;
      maxPos = Math.max(maxPos, posErr);
      if (velErr <= VELOCITY_TOLERANCE) {
        velMatched++;
        maxVel = Math.max(maxVel, velErr);
      }
    }
  }
  return {
    name,
    particles: fx.count,
    positionMatchedPct: (100 * posMatched) / fx.count,
    velocityMatchedPct: (100 * velMatched) / fx.count,
    maxPositionError: maxPos,
    maxVelocityError: maxVel,
    tailParticles,
    gpuNonFinite,
  };
}

/** Feed `seconds` of movement at 60 fps; `at(t)` gives the game position at time t */
function drive(fx: CoronaSwarm, seconds: number, at: (t: number) => [number, number]): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at(i / 60);
    fx.update(1 / 60, new THREE.Vector3(x, 0.2, -y));
  }
}

/**
 * Run scripted scenarios through a real CoronaSwarm on the GPU and compare its
 * compute output with coronaStepCPU given the same uniform values.
 */
export async function checkCoronaParity(renderer: WebGPURenderer): Promise<CoronaParityResult> {
  await renderer.init();
  const fx = new CoronaSwarm(SWARM_RADIUS);
  const scenarios: CoronaScenarioResult[] = [];
  try {
    // 1. Idle: no movement, so no tail
    fx.setState('patrol', false);
    drive(fx, 1, () => [0, 0]);
    scenarios.push(await compare(renderer, fx, 'idle'));

    // 2. Moving along an arc: tail follows the curved path
    const R = 70;
    const speed = 120;
    const arc = (t: number): [number, number] => [
      R * Math.sin((speed / R) * t),
      R * (1 - Math.cos((speed / R) * t)),
    ];
    drive(fx, 2, arc);
    scenarios.push(await compare(renderer, fx, 'moving-arc'));

    // 3. Chasing while still turning (chase eases in)
    fx.setState('chase', false);
    drive(fx, 1.5, (t) => arc(2 + t));
    scenarios.push(await compare(renderer, fx, 'chase-arc'));
  } finally {
    fx.dispose();
  }
  return { scenarios };
}
