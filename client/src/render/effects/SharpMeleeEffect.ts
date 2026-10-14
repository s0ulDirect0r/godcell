import * as THREE from 'three';
import { GAME_CONFIG } from '#shared';

export interface MeleeArcAnimation {
  group: THREE.Group;
  core: THREE.Mesh;
  echo: THREE.Mesh;
  attackType: 'swipe' | 'thrust';
  baseAngle: number;
  startTime: number;
  duration: number;
}

function crescent(radius: number, width: number, arc: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const count = 48;
  for (let i = 0; i <= count; i++) {
    const angle = (i / count - 0.5) * arc;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  for (let i = count; i >= 0; i--) {
    const t = i / count,
      angle = (t - 0.5) * arc;
    const r = radius - width * Math.sin(t * Math.PI);
    shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function needle(range: number, width: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(175, 0);
  shape.lineTo(290, width);
  shape.lineTo(range, 0);
  shape.lineTo(290, -width);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function spawnMeleeArc(
  scene: THREE.Scene,
  x: number,
  y: number,
  attackType: 'swipe' | 'thrust',
  directionX: number,
  directionY: number,
  colorHex = 0x77eedd
): MeleeArcAnimation {
  const group = new THREE.Group();
  group.position.set(x, 18, -y);
  const baseAngle = Math.atan2(directionY, directionX);
  group.rotation.y = baseAngle;
  const range =
    attackType === 'swipe' ? GAME_CONFIG.MELEE_SWIPE_RANGE : GAME_CONFIG.MELEE_THRUST_RANGE;
  const arc = THREE.MathUtils.degToRad(GAME_CONFIG.MELEE_SWIPE_ARC);
  const core = new THREE.Mesh(
    attackType === 'swipe' ? crescent(range, 16, arc) : needle(range, 5),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.88),
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
  );
  const echo = new THREE.Mesh(
    attackType === 'swipe' ? crescent(range - 28, 7, arc * 0.92) : needle(range - 20, 20),
    new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
  );
  core.rotation.x = echo.rotation.x = -Math.PI / 2;
  core.position.y = 1;
  group.add(echo, core);
  scene.add(group);
  const anim = { group, core, echo, attackType, baseAngle, startTime: Date.now(), duration: 200 };
  poseMeleeArc(anim, 0);
  return anim;
}

/** Shared by gameplay and the viewer's frame scrubber. No random particle cloud. */
export function poseMeleeArc(anim: MeleeArcAnimation, progress: number): void {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const strike = Math.min(1, t / 0.32);
  const fade = t < 0.32 ? 1 : ((1 - t) / 0.68) ** 2;
  anim.group.visible = t > 0.06 && t < 1;
  anim.group.rotation.y = anim.baseAngle + (anim.attackType === 'swipe' ? -0.52 * (1 - strike) : 0);
  anim.group.scale.set(anim.attackType === 'thrust' ? 0.68 + strike * 0.32 : 1, 1, 1);
  (anim.core.material as THREE.MeshBasicMaterial).opacity = fade;
  (anim.echo.material as THREE.MeshBasicMaterial).opacity = fade * 0.4;
}

export function disposeMeleeArc(anim: MeleeArcAnimation): void {
  anim.group.removeFromParent();
  for (const mesh of [anim.core, anim.echo]) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}
