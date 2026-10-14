import * as THREE from 'three';
import { HUNTING_GROVE } from '../../../../shared/grove';

/** A quiet floor, warm feeding ground and a cold, broken den. All props here are ground markings. */
export function createGroveEnvironment(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lanternGrove';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 25, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.65, 'rgba(255,255,255,.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const alpha = new THREE.CanvasTexture(canvas);
  const floor = (x: number, y: number, r: number, color: number, sx = 1, sy = 1) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2, r * 2),
      new THREE.MeshBasicMaterial({
        color,
        map: alpha,
        transparent: true,
        depthWrite: false,
        opacity: 0.95,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.2, -y);
    mesh.scale.set(sx, sy, 1);
    group.add(mesh);
  };
  floor(12200, 6400, 1800, 0x102b2b, 1.6, 0.85);
  floor(11650, 6400, 720, 0x283327, 1.35, 1);
  floor(13900, 6400, 1100, 0x202334, 1, 1);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x42605a,
    transparent: true,
    opacity: 0.24,
  });
  for (let band = 0; band < 4; band++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 65; i++) {
      const t = (i / 64) * Math.PI * 2;
      const r = 1050 + band * 160 + Math.sin(t * 5 + band) * 60;
      pts.push(new THREE.Vector3(13900 + Math.cos(t) * r, 0.8, -6400 + Math.sin(t) * r));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  // Ground circuit roots lead east; short breaks preserve a natural forest-floor rhythm.
  for (let i = 0; i < 35; i++) {
    const x = 10300 + i * 130,
      y = 6400 + Math.sin(i * 0.35) * 90;
    const geo = new THREE.PlaneGeometry(58, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: i < 20 ? 0x84a779 : 0x7e759a,
      transparent: true,
      opacity: 0.45,
    });
    const trace = new THREE.Mesh(geo, mat);
    trace.rotation.x = -Math.PI / 2;
    trace.position.set(x, 1, -y);
    group.add(trace);
  }
  // Low seed fronds frame the feeding clearing; none obstruct the collision corridor.
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2;
    const x = HUNTING_GROVE.feeding.x + Math.cos(angle) * 870;
    const y = HUNTING_GROVE.feeding.y + Math.sin(angle) * 640;
    for (let j = 0; j < 3; j++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(13, 95 + j * 15, 4),
        new THREE.MeshStandardMaterial({
          color: 0x466b52,
          emissive: 0x365f35,
          emissiveIntensity: 0.2,
          roughness: 0.8,
        })
      );
      leaf.position.set(x + j * 18, 45, -y);
      leaf.rotation.z = (j - 1) * 0.3;
      group.add(leaf);
    }
  }
  return group;
}
