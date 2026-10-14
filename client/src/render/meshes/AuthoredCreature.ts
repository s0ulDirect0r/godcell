import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CombatSpecialization } from '#shared';

const cache = new Map<string, Promise<THREE.Group>>();

/** Editable .blend sources accompany the GLBs; scripts/build-grove-models.py regenerates them. No runtime Blender dependency. */
export function attachAuthoredCreature(
  group: THREE.Group,
  kind: 'hexapod' | 'grazer',
  scale: number,
  color?: number
): void {
  if (!cache.has(kind))
    cache.set(
      kind,
      new GLTFLoader().loadAsync(`/models/grove/${kind}.glb`).then((g) => g.scene)
    );
  const fallback = [...group.children];
  let removed = false;
  group.addEventListener('removed', () => {
    removed = true;
  });
  cache
    .get(kind)!
    .then((source) => {
      if (removed) return;
      const model = source.clone(true);
      model.scale.setScalar(scale);
      if (kind === 'grazer') {
        model.rotation.order = 'YXZ';
        model.rotation.x = -Math.PI / 2;
        model.rotation.y = Math.PI / 2;
      }
      const legs: THREE.Object3D[] = [];
      const signals: THREE.MeshStandardMaterial[] = [];
      model.traverse((obj) => {
        if (obj.name.startsWith('leg_')) legs.push(obj);
        if (obj instanceof THREE.Mesh) {
          obj.geometry = obj.geometry.clone();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          const clones = materials.map((mat) => {
            const clone = mat.clone() as THREE.MeshStandardMaterial;
            if (clone.emissiveIntensity === 0) {
              clone.emissive.copy(clone.color);
              clone.emissiveIntensity = 0.35;
              clone.metalness = 0.35;
            }
            if (clone.name.startsWith('Energy')) {
              if (color !== undefined) {
                clone.color.setHex(color);
                clone.emissive.setHex(color);
              }
              if (obj.name.startsWith('Core')) {
                clone.emissiveIntensity = 0.4;
                clone.color.multiplyScalar(0.45);
                clone.emissive.multiplyScalar(0.4);
              }
              signals.push(clone);
            }
            return clone;
          });
          obj.material = Array.isArray(obj.material) ? clones : clones[0];
        }
      });
      for (const child of fallback) {
        group.remove(child);
        child.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) =>
              m.dispose()
            );
          }
        });
      }
      group.add(model);
      group.userData.authored = { model, legs, signals, phase: 0 };
      setCreatureSpecialization(group, group.userData.specialization ?? 'ranged');
    })
    .catch((error) =>
      console.error(`Could not load grove ${kind}; using procedural fallback`, error)
    );
}

export function setCreatureSpecialization(
  group: THREE.Group,
  specialization: CombatSpecialization
): void {
  group.userData.specialization = specialization;
  group.userData.authored?.model.traverse((obj: THREE.Object3D) => {
    if (obj.name.startsWith('spec_'))
      obj.visible = obj.name.startsWith(`spec_${specialization ?? 'ranged'}_`);
  });
}

export function animateAuthoredCreature(
  group: THREE.Group,
  moving: boolean,
  speed: number,
  dt: number
): boolean {
  const data = group.userData.authored;
  if (!data) return false;
  data.phase += dt * (moving ? Math.min(3, speed / 140) : 0.15);
  for (const leg of data.legs as THREE.Object3D[]) {
    const [, side, index] = leg.name.split('_');
    const phase =
      data.phase * Math.PI * 2 + ((Number(index) % 2) + (side === 'L' ? 0 : 1)) * Math.PI;
    leg.rotation.z = moving ? Math.sin(phase) * 0.25 : 0;
    leg.rotation.x = moving ? Math.max(0, Math.cos(phase)) * 0.3 * (side === 'L' ? 1 : -1) : 0;
  }
  return true;
}
