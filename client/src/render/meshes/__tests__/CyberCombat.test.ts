import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  createCyberOrganism,
  updateCyberOrganismAnimation,
  disposeCyberOrganism,
} from '../CyberOrganismMesh';
import { triggerCyberOrganismAttack, sampleCyberAttack } from '../CyberAttackMotion';
import { spawnMeleeArc, poseMeleeArc, disposeMeleeArc } from '../../effects/SharpMeleeEffect';
import { updateMeleeArcAnimations } from '../../three/AnimationUpdater';
import { GAME_CONFIG } from '#shared';

describe('cyber-organism combat presentation', () => {
  it('retains the original head, six curved legs, and tail instead of loading armor', () => {
    const model = createCyberOrganism(101, 0x66ddcc);
    expect(model.getObjectByName('head')).toBeDefined();
    expect(model.getObjectByName('tailTip')).toBeDefined();
    expect(
      model.userData.bodyGroup.children.filter((n: THREE.Object3D) => n.name.startsWith('leg-'))
    ).toHaveLength(6);
    expect(model.userData.authored).toBeUndefined();
    disposeCyberOrganism(model);
  });

  it.each(['swipe', 'thrust', 'fire'] as const)(
    '%s visibly moves the body and returns to rest without accumulating offsets',
    (type) => {
      const model = createCyberOrganism(101, 0x66ddcc);
      const body = model.userData.bodyGroup as THREE.Group;
      const restX = body.position.x;
      const samples: number[] = [];
      for (let repeat = 0; repeat < 8; repeat++) {
        triggerCyberOrganismAttack(model, type);
        updateCyberOrganismAnimation(model, false, 0, 0.064);
        samples.push(body.position.x);
        expect(body.position.x).not.toBeCloseTo(restX);
        updateCyberOrganismAnimation(model, false, 0, 0.3);
        expect(body.position.x).toBeCloseTo(restX);
        expect(body.rotation.z).toBeCloseTo(0);
        expect(body.getObjectByName('leg-R-0')!.rotation.z).toBeCloseTo(0);
        expect(model.userData.cyberAttack).toBeUndefined();
      }
      samples.forEach((value) => expect(value).toBeCloseTo(samples[0]));
      disposeCyberOrganism(model);
    }
  );

  it('distinguishes a cross-body slash, a paired forward thrust, and backward firing recoil', () => {
    const slash = sampleCyberAttack('swipe', 0.32);
    const thrust = sampleCyberAttack('thrust', 0.32);
    const fire = sampleCyberAttack('fire', 0.32);
    expect(slash.twist).not.toBe(0);
    expect(Math.abs(slash.right)).toBeGreaterThan(Math.abs(slash.left));
    expect(thrust.left).toBeCloseTo(-thrust.right);
    expect(thrust.reach).toBeGreaterThan(0);
    expect(fire.reach).toBeLessThan(0);
    expect(fire.pulse).toBeGreaterThan(0.9);
  });

  it.each(['swipe', 'thrust'] as const)(
    '%s stays within attack range and disposes every effect resource',
    (type) => {
      const scene = new THREE.Scene();
      const effect = spawnMeleeArc(scene, 100, 200, type, 0, 1);
      poseMeleeArc(effect, 0.32);
      expect(effect.group.visible).toBe(true);
      expect(effect.group.rotation.y).toBeCloseTo(Math.PI / 2);
      const positions = effect.core.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++)
        expect(Math.hypot(positions.getX(i), positions.getY(i))).toBeLessThanOrEqual(
          GAME_CONFIG.MELEE_SWIPE_RANGE + 0.001
        );
      const disposeCore = vi.spyOn(effect.core.geometry, 'dispose');
      const disposeEcho = vi.spyOn(effect.echo.geometry, 'dispose');
      const disposeMaterial = vi.spyOn(effect.echo.material as THREE.Material, 'dispose');
      const list = [effect];
      effect.startTime = Date.now() - effect.duration - 1;
      updateMeleeArcAnimations(scene, list, 16);
      expect(list).toHaveLength(0);
      expect(scene.children).toHaveLength(0);
      expect(disposeCore).toHaveBeenCalledOnce();
      expect(disposeEcho).toHaveBeenCalledOnce();
      expect(disposeMaterial).toHaveBeenCalledOnce();
    }
  );

  it('can hide a preview at rest and dispose it before its animation finishes', () => {
    const scene = new THREE.Scene();
    const effect = spawnMeleeArc(scene, 0, 0, 'swipe', -1, 0);
    poseMeleeArc(effect, 0);
    expect(effect.group.visible).toBe(false);
    disposeMeleeArc(effect);
    expect(scene.children).toHaveLength(0);
  });
});
