import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createCyberOrganism,
  updateCyberOrganismAnimation,
  disposeCyberOrganism,
} from '../CyberOrganismMesh';

function foot(model: THREE.Group) {
  return model.getObjectByName('leg-L-0')!.getObjectByName('legFoot')!;
}

describe('grounded cyber-organism gait', () => {
  it('holds a supporting foot in world space while the body moves over it', () => {
    const model = createCyberOrganism(101, 0x66eecc);
    updateCyberOrganismAnimation(model, false, 0, 0);
    const planted = foot(model).getWorldPosition(new THREE.Vector3());
    let supportingFrames = 0;
    let beganNextStep = false;
    for (let i = 0; i < 8; i++) {
      model.position.x -= 180 / 60;
      updateCyberOrganismAnimation(model, true, 180, 1 / 60);
      if (!model.userData.groundedGait.legs[0].swinging) {
        supportingFrames++;
        expect(foot(model).getWorldPosition(new THREE.Vector3()).distanceTo(planted)).toBeLessThan(
          0.001
        );
      } else {
        beganNextStep = true;
        expect(foot(model).getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(planted.y);
      }
    }
    expect(supportingFrames).toBeGreaterThanOrEqual(4);
    expect(beganNextStep).toBe(true);
    expect(model.position.x).toBe(-24);
    disposeCyberOrganism(model);
  });

  it('keeps feet above the floor and finishes airborne steps when stopping', () => {
    const model = createCyberOrganism(101, 0x66eecc);
    const footRadius = model.userData.motionScale * 0.39 * 1.5;
    for (let i = 0; i < 180; i++) {
      const moving = i < 90;
      if (moving) model.position.x -= 380 / 60;
      updateCyberOrganismAnimation(model, moving, moving ? 380 : 0, 1 / 60);
      for (const leg of model.userData.groundedGait.legs) {
        expect(leg.foot.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThanOrEqual(
          footRadius - 0.001
        );
      }
    }
    expect(
      model.userData.groundedGait.legs.every((leg: { swinging: boolean }) => !leg.swinging)
    ).toBe(true);
    const rest = foot(model).getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 60; i++) updateCyberOrganismAnimation(model, false, 0, 1 / 60);
    expect(foot(model).getWorldPosition(new THREE.Vector3()).distanceTo(rest)).toBeLessThan(0.001);
    disposeCyberOrganism(model);
  });

  it('resets contacts after a teleport instead of stretching legs across the world', () => {
    const model = createCyberOrganism(101, 0x66eecc);
    updateCyberOrganismAnimation(model, false, 0, 0);
    model.position.x = 10000;
    updateCyberOrganismAnimation(model, false, 0, 1 / 60);
    for (const leg of model.userData.groundedGait.legs) {
      expect(leg.foot.position.distanceTo(leg.rest)).toBeLessThan(model.userData.motionScale * 0.6);
    }
    disposeCyberOrganism(model);
  });

  it('releases a foot into a visible swing rather than sliding indefinitely', () => {
    const model = createCyberOrganism(101, 0x66eecc);
    let highestLift = 0;
    for (let i = 0; i < 120; i++) {
      model.position.x -= 380 / 60;
      updateCyberOrganismAnimation(model, true, 380, 1 / 60);
      highestLift = Math.max(highestLift, foot(model).getWorldPosition(new THREE.Vector3()).y);
    }
    expect(highestLift).toBeGreaterThan(model.userData.motionScale * 0.9);
    disposeCyberOrganism(model);
  });
  it.each([180, 380, 1000])(
    'keeps neighboring leg geometry apart at %i units/sec, including turns',
    (speed) => {
      const model = createCyberOrganism(101, 0x66eecc);
      const body = model.userData.bodyGroup as THREE.Group;
      const bodyInverse = new THREE.Matrix4();
      const transform = new THREE.Matrix4();
      const point = new THREE.Vector3();
      for (let frame = 0; frame < 180; frame++) {
        const angle = frame < 90 ? 0 : Math.min(Math.PI / 2, (frame - 90) * 0.04);
        model.rotation.z = angle;
        model.position.x -= (Math.cos(angle) * speed) / 60;
        model.position.z += (Math.sin(angle) * speed) / 60;
        updateCyberOrganismAnimation(model, true, speed, 1 / 60);
        model.updateWorldMatrix(true, true);
        bodyInverse.copy(body.matrixWorld).invert();
        for (const side of ['L', 'R']) {
          let previousMax = -Infinity;
          for (let i = 0; i < 3; i++) {
            const leg = body.getObjectByName(`leg-${side}-${i}`)!;
            let min = Infinity,
              max = -Infinity;
            for (const name of ['legTube', 'legFoot']) {
              const mesh = leg.getObjectByName(name) as THREE.Mesh;
              transform.multiplyMatrices(bodyInverse, mesh.matrixWorld);
              const positions = mesh.geometry.getAttribute('position');
              for (let v = 0; v < positions.count; v++) {
                point.fromBufferAttribute(positions, v).applyMatrix4(transform);
                min = Math.min(min, point.x);
                max = Math.max(max, point.x);
              }
            }
            expect(min - previousMax).toBeGreaterThan(0);
            previousMax = max;
          }
        }
      }
      disposeCyberOrganism(model);
    }
  );
});
