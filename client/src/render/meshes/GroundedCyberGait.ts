import * as THREE from 'three';

type Leg = {
  node: THREE.Object3D;
  foot: THREE.Mesh;
  tube: THREE.Mesh;
  rest: THREE.Vector3;
  vertices: Float32Array;
  anchor: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  shadow: THREE.Mesh;
  swinging: boolean;
  wasSwingPhase: boolean;
  swingProgress: number;
  offset: number;
};
type Gait = {
  legs: Leg[];
  cycle: number;
  speed: number;
  blend: number;
  landingAge: number;
  virtual: THREE.Vector3;
  previous: THREE.Vector3;
  direction: THREE.Vector3;
  compression: number;
  lean: number;
};
const scratch = new THREE.Vector3();
const forward = new THREE.Vector3();
const desired = new THREE.Vector3();
const delta = new THREE.Vector3();

function makeShadow(radius: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({
      color: 0x061011,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  );
}

/** Feet remain in world space during support; curved limbs deform to their planted endpoints. */
export function updateGroundedCyberGait(
  group: THREE.Group,
  moving: boolean,
  speed: number,
  dt: number
): void {
  const step = Math.min(0.05, Math.max(0, dt));
  const s = group.userData.motionScale as number;
  const body = group.userData.bodyGroup as THREE.Group;
  const standingHeight = s * (2.8 * 0.7 + 0.39 * 1.5);
  let gait = group.userData.groundedGait as Gait | undefined;
  if (!gait) {
    body.position.z = standingHeight;
    group.updateWorldMatrix(true, true);
    const legs: Leg[] = [];
    for (const node of body.children.filter((n) => n.name.startsWith('leg-'))) {
      const foot = node.getObjectByName('legFoot') as THREE.Mesh;
      const tube = node.getObjectByName('legTube') as THREE.Mesh;
      const anchor = foot.getWorldPosition(new THREE.Vector3());
      const shadow = makeShadow(s * 0.68);
      group.add(shadow);
      legs.push({
        node,
        foot,
        tube,
        rest: foot.position.clone(),
        vertices: new Float32Array(tube.geometry.getAttribute('position').array),
        anchor,
        from: anchor.clone(),
        to: anchor.clone(),
        shadow,
        swinging: false,
        wasSwingPhase: false,
        swingProgress: 0,
        offset:
          (node.userData.side === 'left' && node.userData.index !== 1) ||
          (node.userData.side === 'right' && node.userData.index === 1)
            ? 0
            : 0.5,
      });
    }
    const bellyShadow = makeShadow(1);
    bellyShadow.name = 'groundContactShadow';
    bellyShadow.scale.set(s * 6, s * 2.2, 1);
    bellyShadow.position.set(-s * 1.5, 0, 0.3);
    (bellyShadow.material as THREE.MeshBasicMaterial).opacity = 0.1;
    group.add(bellyShadow);
    gait = {
      legs,
      cycle: 0,
      speed: 0,
      blend: 0,
      landingAge: 1,
      virtual: new THREE.Vector3(),
      previous: group.position.clone(),
      direction: new THREE.Vector3(-1, 0, 0),
      compression: 0,
      lean: 0,
    };
    group.userData.groundedGait = gait;
  }

  const targetSpeed = moving ? Math.max(0, speed) : 0;
  const oldSpeed = gait.speed;
  gait.speed += (targetSpeed - gait.speed) * (1 - Math.exp(-step * (moving ? 9 : 18)));
  gait.blend += ((moving ? 1 : 0) - gait.blend) * (1 - Math.exp(-step * 12));
  forward.set(-1, 0, 0).applyQuaternion(group.quaternion).setY(0).normalize();
  delta.copy(group.position).sub(gait.previous).setY(0);
  if (delta.lengthSq() > 0.001) gait.direction.copy(delta).normalize();
  else if (group.userData.gaitPreview) gait.direction.copy(forward);
  gait.previous.copy(group.position);
  if (group.userData.gaitPreview) gait.virtual.addScaledVector(forward, targetSpeed * step);

  const oldCycle = gait.cycle;
  const cadence = Math.min(4.2, (gait.speed / (s * 1.9)) * 0.72);
  gait.cycle += cadence * step;
  gait.landingAge += step;
  if (Math.floor(gait.cycle * 2) !== Math.floor(oldCycle * 2)) gait.landingAge = 0;
  // A short compression on touchdown; no free-floating idle bob.
  gait.compression =
    Math.sin(gait.landingAge * 22) * Math.exp(-gait.landingAge * 18) * s * 0.38 * gait.blend;
  const acceleration = step > 0 ? (gait.speed - oldSpeed) / step : 0;
  gait.lean +=
    (THREE.MathUtils.clamp(acceleration / (s * 220), -0.055, 0.055) - gait.lean) *
    (1 - Math.exp(-step * 10));
  body.position.z = standingHeight - gait.compression;
  body.rotation.y = gait.lean;
  body.rotation.x = Math.sin(gait.cycle * Math.PI * 2) * 0.022 * gait.blend;
  group.updateWorldMatrix(true, true);

  const footRadius = s * 0.39 * 1.5;
  const floorY = group.position.y;
  const stride = s * 1.9;
  const reach = s * 0.95;
  for (const leg of gait.legs) {
    desired.copy(leg.rest);
    leg.node.localToWorld(desired).add(gait.virtual);
    desired.y = floorY + footRadius;
    const phase = (gait.cycle + leg.offset) % 1;
    const swingPhase = phase >= 0.72;
    let stretched = leg.anchor.distanceTo(desired) > reach * 0.72;
    // Teleports reset contacts instead of stretching the model across the map.
    if (leg.anchor.distanceTo(desired) > stride * 4) {
      leg.anchor.copy(desired);
      leg.swinging = false;
      stretched = false;
    }
    const duration = Math.max(0.055, Math.min(0.16, 0.28 / Math.max(0.9, cadence)));
    if (!leg.swinging && ((moving && swingPhase && !leg.wasSwingPhase) || stretched)) {
      leg.swinging = true;
      leg.swingProgress = 0;
      leg.from.copy(leg.anchor);
      leg.to
        .copy(desired)
        .addScaledVector(
          gait.direction,
          moving ? Math.min(stride, gait.speed * duration + stride * 0.22) : 0
        );
    }
    leg.wasSwingPhase = swingPhase;
    let lift = 0;
    if (leg.swinging) {
      leg.swingProgress = Math.min(1, leg.swingProgress + step / duration);
      const t = leg.swingProgress;
      const eased = t * t * (3 - 2 * t);
      leg.anchor.lerpVectors(leg.from, leg.to, eased);
      lift = Math.pow(Math.sin(t * Math.PI), 1.5) * s * 0.7;
      if (t >= 1) {
        leg.swinging = false;
        gait.landingAge = 0;
      }
    }
    scratch.copy(leg.anchor).sub(gait.virtual);
    scratch.y = floorY + footRadius + lift;
    leg.node.worldToLocal(scratch);
    // Keep each toe in its own fore/aft lane, including sharp turns and sprinting.
    // Neighboring hip pairs are 2.5 units apart; fanning adds another 0.9 at the toe.
    scratch.x = THREE.MathUtils.clamp(scratch.x, leg.rest.x - reach, leg.rest.x + reach);
    scratch.y = THREE.MathUtils.clamp(scratch.y, leg.rest.y - s * 0.45, leg.rest.y + s * 0.45);
    leg.foot.position.copy(scratch);
    // Correct local Z after constraining X/Y so body lean cannot push the toe below ground.
    leg.node.localToWorld(scratch);
    scratch.y = floorY + footRadius + lift;
    leg.anchor.copy(scratch).add(gait.virtual);
    leg.anchor.y = floorY + footRadius;
    leg.node.worldToLocal(scratch);
    leg.foot.position.copy(scratch);
    delta.copy(scratch).sub(leg.rest);
    const position = leg.tube.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Each ring of the original TubeGeometry follows the endpoint progressively.
    const ringSize = 9;
    for (let i = 0; i < position.count; i++) {
      const t = Math.floor(i / ringSize) / 16;
      const weight = t * t * (3 - 2 * t);
      position.setXYZ(
        i,
        leg.vertices[i * 3] + delta.x * weight,
        leg.vertices[i * 3 + 1] + delta.y * weight,
        leg.vertices[i * 3 + 2] + delta.z * weight
      );
    }
    position.needsUpdate = true;
    leg.tube.geometry.computeVertexNormals();
    leg.tube.geometry.computeBoundingSphere();
    scratch.copy(leg.anchor).sub(gait.virtual);
    scratch.y = floorY + 0.4;
    group.worldToLocal(scratch);
    leg.shadow.position.copy(scratch);
    (leg.shadow.material as THREE.MeshBasicMaterial).opacity = 0.24 * (1 - lift / (s * 0.9));
    leg.shadow.visible = !(group.userData.cyberAttack && leg.node.userData.index === 0);
  }

  // Motion travels down the beaded tail with a small delay, then settles when stopping.
  const tail = [...group.userData.tailSegments, group.userData.tailTip] as THREE.Object3D[];
  tail.forEach((node, i) => {
    node.position.y = Math.sin(gait.cycle * Math.PI * 2 - i * 0.55) * s * 0.055 * gait.blend;
  });
}
