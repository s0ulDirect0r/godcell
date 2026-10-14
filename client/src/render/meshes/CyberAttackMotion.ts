import * as THREE from 'three';

export type CyberAttack = 'swipe' | 'thrust' | 'fire';
export const CYBER_ATTACK_DURATION: Record<CyberAttack, number> = {
  swipe: 200,
  thrust: 200,
  fire: 180,
};

/** Brief anticipation, a fast stroke, then a longer settling motion. */
export function sampleCyberAttack(type: CyberAttack, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const recover = t < 0.32 ? 1 : (1 - (t - 0.32) / 0.68) ** 2;
  const stroke = Math.sin((Math.min(1, t / 0.32) * Math.PI) / 2) * recover;
  const sweep =
    t < 0.12
      ? -0.3 * (t / 0.12)
      : t < 0.35
        ? -0.3 + 1.3 * ((t - 0.12) / 0.23)
        : ((1 - t) / 0.65) ** 2;
  return {
    twist: type === 'swipe' ? sweep * 0.22 : 0,
    reach: type === 'fire' ? -stroke * 0.42 : stroke * (type === 'thrust' ? 1.1 : 0.22),
    left: type === 'swipe' ? sweep * 0.45 : type === 'thrust' ? stroke * 1.12 : -stroke * 0.16,
    right: type === 'swipe' ? -sweep * 1.25 : type === 'thrust' ? -stroke * 1.12 : stroke * 0.16,
    lift: type === 'fire' ? stroke * 0.08 : stroke * 0.28,
    pulse: type === 'fire' ? stroke : 0,
  };
}

export function triggerCyberOrganismAttack(group: THREE.Group, type: CyberAttack): void {
  group.userData.cyberAttack = { type, elapsed: 0 };
}

/** Restore absolute rest transforms before gait is applied, avoiding cumulative pose drift. */
export function restoreCyberAttackPose(group: THREE.Group): void {
  const body = group.userData.bodyGroup as THREE.Group | undefined;
  if (!body) return;
  body.position.x = group.userData.bodyRestX;
  body.position.y = 0;
  body.rotation.z = 0;
  const head = body.getObjectByName('head');
  if (head) {
    head.position.x = group.userData.headRestX;
    head.scale.setScalar(1);
    head.getObjectByName('eye')?.scale.setScalar(1);
  }
  for (const leg of body.children.filter((child) => child.name.startsWith('leg-'))) {
    leg.rotation.x = leg.userData.baseRotX ?? 0;
    leg.rotation.z = leg.userData.baseRotZ ?? 0;
  }
}

export function applyCyberAttackPose(
  group: THREE.Group,
  type: CyberAttack,
  progress: number
): void {
  const body = group.userData.bodyGroup as THREE.Group | undefined;
  if (!body) return;
  const pose = sampleCyberAttack(type, progress);
  const s = group.userData.motionScale as number;
  body.rotation.z = pose.twist;
  body.position.x = group.userData.bodyRestX - pose.reach * s;
  const left = body.getObjectByName('leg-L-0');
  const right = body.getObjectByName('leg-R-0');
  if (left) {
    left.rotation.z += pose.left;
    left.rotation.x += pose.lift;
  }
  if (right) {
    right.rotation.z += pose.right;
    right.rotation.x -= pose.lift;
  }
  const head = body.getObjectByName('head');
  if (head) {
    head.scale.set(1 - pose.pulse * 0.13, 1 + pose.pulse * 0.07, 1 + pose.pulse * 0.07);
    head.position.x = group.userData.headRestX + pose.pulse * s * 0.24;
    const eye = head.getObjectByName('eye') as THREE.Mesh | undefined;
    if (eye) {
      eye.scale.set(1 + pose.pulse * 1.3, 1 + pose.pulse * 0.35, 1 + pose.pulse * 0.35);
      const material = eye.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 0.7 + 1.3 * (group.userData.energyRatio ?? 1) + pose.pulse * 3;
    }
  }
}

export function updateCyberAttackMotion(group: THREE.Group, dt: number): void {
  const attack = group.userData.cyberAttack as { type: CyberAttack; elapsed: number } | undefined;
  if (!attack) return;
  attack.elapsed += Math.max(0, dt) * 1000;
  const progress = attack.elapsed / CYBER_ATTACK_DURATION[attack.type];
  applyCyberAttackPose(group, attack.type, progress);
  if (progress >= 1) delete group.userData.cyberAttack;
}
