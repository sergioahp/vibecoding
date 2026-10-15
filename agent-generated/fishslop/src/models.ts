// Procedural meshes. Every model faces +Z so Object3D.lookAt() points it where it's going.
import * as THREE from 'three';
import type { CoinKind } from './rules.ts';

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finShape(w: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(w * 0.2, h * 0.9, w, h);
  s.quadraticCurveTo(w * 0.75, h * 0.35, w * 0.9, 0);
  s.lineTo(0, 0);
  return new THREE.ShapeGeometry(s, 6);
}

const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const eyePupil = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
const eyeGeo = new THREE.SphereGeometry(1, 12, 8);

export interface FishModel {
  root: THREE.Group;
  body: THREE.Group;
  tail: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  finMat: THREE.MeshStandardMaterial;
  crown: THREE.Object3D;
}

export function makeFish(): FishModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, roughness: 0.45, metalness: 0.1 });
  const finMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    roughness: 0.6,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), bodyMat);
  torso.scale.set(0.42, 0.62, 1);
  torso.castShadow = true;
  body.add(torso);

  // Eyes sit on the sides of the head, toward the front (+Z).
  for (const side of [-1, 1]) {
    const white = new THREE.Mesh(eyeGeo, eyeWhite);
    white.scale.setScalar(0.085);
    white.position.set(side * 0.17, 0.08, 0.3);
    const pupil = new THREE.Mesh(eyeGeo, eyePupil);
    pupil.scale.setScalar(0.045);
    pupil.position.set(side * 0.22, 0.085, 0.335);
    body.add(white, pupil);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.45);
  const tailFin = new THREE.Mesh(finShape(0.55, 0.42), finMat);
  tailFin.rotation.y = Math.PI / 2;
  const tailFin2 = tailFin.clone();
  tailFin2.scale.y = -1;
  tail.add(tailFin, tailFin2);
  body.add(tail);

  const dorsal = new THREE.Mesh(finShape(0.4, 0.28), finMat);
  dorsal.rotation.y = -Math.PI / 2;
  dorsal.position.set(0, 0.26, 0.12);
  body.add(dorsal);

  const crown = makeCrown();
  crown.position.set(0, 0.36, 0.05);
  crown.visible = false;
  body.add(crown);

  return { root, body, tail, bodyMat, finMat, crown };
}

function makeCrown() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.8, roughness: 0.25, emissive: 0x332200 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.07, 12, 1, true), gold);
  g.add(band);
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), gold);
    const a = (i / 5) * Math.PI * 2;
    spike.position.set(Math.cos(a) * 0.13, 0.09, Math.sin(a) * 0.13);
    g.add(spike);
  }
  return g;
}

export interface SubModel {
  root: THREE.Group;
  hull: THREE.Group;
  prop: THREE.Group;
  light: THREE.SpotLight;
}

export function makeSub(): SubModel {
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);

  const paint = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.35, metalness: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9fe8ff,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.6,
    transparent: true,
    opacity: 0.55,
    emissive: 0x0a3a4a,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.1, 8, 20), paint);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  hull.add(body);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.rotation.x = Math.PI / 2;
  dome.position.set(0, 0.06, 0.78);
  hull.add(dome);

  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.5), paint);
  tower.position.set(0, 0.48, 0.05);
  hull.add(tower);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), trim);
  scope.position.set(0, 0.75, 0.15);
  hull.add(scope);

  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.3), trim);
    fin.position.set(side * 0.45, 0, -0.6);
    hull.add(fin);
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14), glass);
    port.rotation.z = Math.PI / 2;
    port.position.set(side * 0.41, 0.08, 0.2);
    hull.add(port);
  }
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.3), trim);
  rudder.position.set(0, 0.1, -0.75);
  hull.add(rudder);

  const prop = new THREE.Group();
  prop.position.set(0, 0, -0.98);
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.15, 10), trim);
  hub.rotation.x = -Math.PI / 2;
  prop.add(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.02), trim);
    blade.position.y = 0.15;
    const arm = new THREE.Group();
    arm.rotation.z = (i / 3) * Math.PI * 2;
    blade.rotation.y = 0.5;
    arm.add(blade);
    prop.add(arm);
  }
  hull.add(prop);

  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff6c8 }),
  );
  lamp.position.set(0, -0.2, 0.92);
  hull.add(lamp);

  const light = new THREE.SpotLight(0xfff1c0, 30, 22, 0.45, 0.6, 1.4);
  light.position.copy(lamp.position);
  light.target.position.set(0, -0.6, 6);
  hull.add(light, light.target);

  return { root, hull, prop, light };
}

export interface MonsterModel {
  root: THREE.Group;
  body: THREE.Mesh;
  pupil: THREE.Object3D;
  mat: THREE.MeshStandardMaterial;
  tentacles: THREE.Object3D[];
}

export function makeMonster(): MonsterModel {
  const root = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1.3, 3);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 4.1) * Math.sin(v.y * 3.7) * Math.sin(v.z * 4.3);
    v.multiplyScalar(1 + 0.18 * n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7b2cbf, roughness: 0.55, emissive: 0x240046 });
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  root.add(body);

  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xc77dff, roughness: 0.4 });
  const spikeGeo = new THREE.ConeGeometry(0.16, 0.6, 6);
  const rand = mulberry32(7);
  for (let i = 0; i < 18; i++) {
    const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    if (dir.z > 0.6) continue; // leave the face clear
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.position.copy(dir).multiplyScalar(1.35);
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    root.add(spike);
  }

  const eye = new THREE.Mesh(eyeGeo, eyeWhite);
  eye.scale.setScalar(0.48);
  eye.position.set(0, 0.25, 1.1);
  root.add(eye);
  const pupil = new THREE.Mesh(eyeGeo, new THREE.MeshStandardMaterial({ color: 0xd00000, emissive: 0x550000 }));
  pupil.scale.setScalar(0.2);
  pupil.position.set(0, 0.25, 1.52);
  root.add(pupil);

  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.07, 8, 20, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x10002b }),
  );
  mouth.position.set(0, -0.45, 1.05);
  mouth.rotation.z = Math.PI;
  root.add(mouth);

  const tentacles: THREE.Object3D[] = [];
  const tentGeo = new THREE.CylinderGeometry(0.12, 0.03, 1.4, 8);
  tentGeo.translate(0, -0.7, 0);
  for (let i = 0; i < 6; i++) {
    const t = new THREE.Mesh(tentGeo, mat);
    const a = (i / 6) * Math.PI * 2;
    t.position.set(Math.cos(a) * 0.7, -1.0, Math.sin(a) * 0.7 - 0.2);
    root.add(t);
    tentacles.push(t);
  }
  return { root, body, pupil, mat, tentacles };
}

const coinMats: Record<CoinKind, THREE.Material> = {
  silver: new THREE.MeshStandardMaterial({ color: 0xd9e2ec, metalness: 0.9, roughness: 0.25, emissive: 0x1a1f26 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.9, roughness: 0.2, emissive: 0x3a2600 }),
  gem: new THREE.MeshStandardMaterial({ color: 0x4cf2d4, metalness: 0.3, roughness: 0.05, emissive: 0x0b4d44 }),
  treasure: new THREE.MeshStandardMaterial({ color: 0xff4fd8, metalness: 0.4, roughness: 0.1, emissive: 0x4d0b40 }),
};
const coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20);
coinGeo.rotateX(Math.PI / 2);
const gemGeo = new THREE.OctahedronGeometry(0.26);
const treasureGeo = new THREE.OctahedronGeometry(0.5);

export function makeCoin(kind: CoinKind): THREE.Mesh {
  const geo = kind === 'gem' ? gemGeo : kind === 'treasure' ? treasureGeo : coinGeo;
  const m = new THREE.Mesh(geo, coinMats[kind]);
  m.castShadow = true;
  return m;
}

const pelletGeo = new THREE.DodecahedronGeometry(0.11);
const pelletMats = [
  new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0xd45d2a, roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: 0x5bd16b, roughness: 0.7, emissive: 0x0e3313 }),
];
export function makePellet(quality: number): THREE.Mesh {
  return new THREE.Mesh(pelletGeo, pelletMats[Math.min(quality, 3) - 1]);
}

const boltGeo = new THREE.CapsuleGeometry(0.05, 0.5, 4, 8);
boltGeo.rotateX(Math.PI / 2);
const boltMat = new THREE.MeshBasicMaterial({ color: 0x9ff7ff });
export function makeBolt(): THREE.Mesh {
  return new THREE.Mesh(boltGeo, boltMat);
}
