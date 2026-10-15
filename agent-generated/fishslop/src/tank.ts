import * as THREE from 'three';
import { TANK } from './rules.ts';
import { mulberry32 } from './models.ts';

export const WATER_COLOR = 0x0b5470;

export function floorHeight(x: number, z: number): number {
  return -0.18 + 0.12 * Math.sin(x * 0.33) * Math.cos(z * 0.41) + 0.06 * Math.sin(x * 1.07 + z * 0.73);
}

export interface Collider {
  center: THREE.Vector3;
  radius: number;
}

export interface Tank {
  colliders: Collider[];
  update(t: number): void;
}

function causticTexture(): THREE.CanvasTexture {
  // Tileable Worley-noise edges: bright where two cell borders meet, like light through ripples.
  const size = 256;
  const cells = 9;
  const rand = mulberry32(42);
  const pts: [number, number][] = [];
  for (let i = 0; i < cells * cells; i++) {
    const cx = i % cells;
    const cy = Math.floor(i / cells);
    pts.push([(cx + rand()) / cells, (cy + rand()) / cells]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let f1 = 9;
      let f2 = 9;
      for (const [px, py] of pts) {
        let dx = Math.abs(u - px);
        let dy = Math.abs(v - py);
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
      const edge = Math.max(0, 1 - (f2 - f1) * cells * 3.2);
      const val = Math.pow(edge, 2.2) * 255;
      const i = (y * size + x) * 4;
      img.data[i] = val;
      img.data[i + 1] = val;
      img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildTank(scene: THREE.Scene): Tank {
  const W = TANK.maxX - TANK.minX;
  const D = TANK.maxZ - TANK.minZ;
  const H = TANK.maxY - TANK.minY;
  const rand = mulberry32(1234);

  scene.background = new THREE.Color(WATER_COLOR);
  scene.fog = new THREE.FogExp2(WATER_COLOR, 0.034);

  scene.add(new THREE.HemisphereLight(0x9fe3ff, 0x6b5a3a, 1.1));
  const sun = new THREE.DirectionalLight(0xdff6ff, 2.2);
  sun.position.set(6, 30, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -W / 2 - 2;
  sc.right = W / 2 + 2;
  sc.top = D / 2 + 2;
  sc.bottom = -D / 2 - 2;
  sc.near = 5;
  sc.far = 45;
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  // Sand
  const sandGeo = new THREE.PlaneGeometry(W, D, 100, 60);
  sandGeo.rotateX(-Math.PI / 2);
  const sp = sandGeo.getAttribute('position');
  const colors: number[] = [];
  const base = new THREE.Color(0xd8c08a);
  const dark = new THREE.Color(0xa88a58);
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const z = sp.getZ(i);
    sp.setY(i, floorHeight(x, z));
    const c = base.clone().lerp(dark, rand() * 0.35 + 0.15 * Math.sin(x * 2.3 + z * 1.7));
    colors.push(c.r, c.g, c.b);
  }
  sandGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  sandGeo.computeVertexNormals();
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  sand.receiveShadow = true;
  scene.add(sand);

  const caustic = causticTexture();
  const causticLayers: THREE.Texture[] = [];
  for (const [rep, op] of [
    [5, 0.32],
    [3.3, 0.22],
  ] as const) {
    const tex = caustic.clone();
    tex.needsUpdate = true;
    tex.repeat.set(rep * (W / D), rep);
    causticLayers.push(tex);
    const layer = new THREE.Mesh(
      sandGeo,
      new THREE.MeshBasicMaterial({
        map: tex,
        color: 0x9fe8ff,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    scene.add(layer);
  }

  // Glass walls, seen from inside, plus the dark frame of the tank.
  const box = new THREE.BoxGeometry(W, H + 0.5, D);
  box.translate(0, H / 2 - 0.25, 0);
  scene.add(
    new THREE.Mesh(
      box,
      new THREE.MeshStandardMaterial({
        color: 0x1f7f9c,
        transparent: true,
        opacity: 0.22,
        side: THREE.BackSide,
        roughness: 0.1,
        depthWrite: false,
      }),
    ),
  );
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x0a1a24 })));

  // Water surface, rippling, seen from below.
  const surfGeo = new THREE.PlaneGeometry(W, D, 40, 24);
  surfGeo.rotateX(Math.PI / 2);
  surfGeo.translate(0, TANK.maxY, 0);
  const surf = new THREE.Mesh(
    surfGeo,
    new THREE.MeshStandardMaterial({
      color: 0x8fe3ff,
      emissive: 0x2a8aa8,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.15,
      depthWrite: false,
    }),
  );
  scene.add(surf);
  const surfPos = surfGeo.getAttribute('position');

  // Light shafts from the surface.
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xbff4ff,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const geo = new THREE.CylinderGeometry(0.6 + rand() * 0.6, 1.6 + rand() * 1.4, H, 16, 1, true);
    const shaft = new THREE.Mesh(geo, shaftMat.clone());
    shaft.position.set(TANK.minX + 3 + rand() * (W - 6), H / 2, TANK.minZ + 3 + rand() * (D - 6));
    shaft.rotation.z = 0.15;
    shafts.push(shaft);
    scene.add(shaft);
  }

  // Rocks: jittered dodecahedrons. Jitter keyed by vertex position so faces don't crack.
  const colliders: Collider[] = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.9, flatShading: true });
  const rockSpots = [
    [-14, -7, 1.6],
    [-11, -8.5, 1.0],
    [9, -8, 1.9],
    [12.5, -6, 1.1],
    [15, 6, 1.4],
    [-16, 7, 1.2],
    [2, -9.5, 1.3],
    [-4, 8, 0.9],
  ];
  for (const [x, z, r] of rockSpots) {
    const geo = new THREE.DodecahedronGeometry(r, 1);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
      const j = 1 + 0.18 * (k - Math.floor(k) - 0.5);
      p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, rockMat);
    const y = floorHeight(x, z) + r * 0.25;
    rock.position.set(x, y, z);
    rock.scale.y = 0.7;
    rock.rotation.y = rand() * Math.PI;
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
    colliders.push({ center: new THREE.Vector3(x, y, z), radius: r * 0.95 });
  }

  // Coral clusters.
  const coralColors = [0xff6f91, 0xff9671, 0xffc75f, 0xc490ff];
  for (let c = 0; c < 6; c++) {
    const cx = TANK.minX + 3 + rand() * (W - 6);
    const cz = rand() < 0.5 ? TANK.minZ + 1.5 + rand() * 3 : TANK.maxZ - 1.5 - rand() * 3;
    const mat = new THREE.MeshStandardMaterial({ color: coralColors[c % 4], roughness: 0.7 });
    for (let b = 0; b < 7; b++) {
      const h = 0.6 + rand() * 1.4;
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, h, 7), mat);
      const bx = cx + (rand() - 0.5) * 1.2;
      const bz = cz + (rand() - 0.5) * 1.2;
      branch.position.set(bx, floorHeight(bx, bz) + h / 2, bz);
      branch.rotation.set((rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.7);
      branch.castShadow = true;
      scene.add(branch);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat);
      tip.position.set(0, h / 2, 0);
      branch.add(tip);
    }
  }

  // Seaweed: vertex-animated strips.
  const weeds: { geo: THREE.PlaneGeometry; base: Float32Array; h: number; phase: number }[] = [];
  const weedMat = new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 34; i++) {
    const h = 2 + rand() * 4.5;
    const geo = new THREE.PlaneGeometry(0.32, h, 1, 14);
    geo.translate(0, h / 2, 0);
    const x = TANK.minX + 1 + rand() * (W - 2);
    const z = rand() < 0.6 ? TANK.minZ + 0.6 + rand() * 4 : TANK.maxZ - 0.6 - rand() * 4;
    const weed = new THREE.Mesh(geo, weedMat);
    weed.position.set(x, floorHeight(x, z) - 0.05, z);
    weed.rotation.y = rand() * Math.PI;
    scene.add(weed);
    weeds.push({ geo, base: Float32Array.from(geo.getAttribute('position').array), h, phase: rand() * 10 });
  }

  // Bubbles rising from vents near the rocks.
  const BUBBLES = 140;
  const bubbleMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.55, roughness: 0.1 }),
    BUBBLES,
  );
  scene.add(bubbleMesh);
  const vents = rockSpots.slice(0, 4).map(([x, z, r]) => new THREE.Vector3(x + r * 0.6, 0, z + r * 0.4));
  const bubbles = Array.from({ length: BUBBLES }, (_, i) => ({
    vent: vents[i % vents.length],
    y: rand() * H,
    speed: 0.8 + rand() * 1.2,
    phase: rand() * 10,
    size: 0.5 + rand() * 1.1,
  }));
  const m4 = new THREE.Matrix4();
  let lastT = 0;

  return {
    colliders,
    update(t) {
      const dt = Math.min(t - lastT, 0.1);
      lastT = t;

      causticLayers[0].offset.set(t * 0.012, t * 0.017);
      causticLayers[1].offset.set(-t * 0.009, t * 0.011);

      for (let i = 0; i < surfPos.count; i++) {
        const x = surfPos.getX(i);
        const z = surfPos.getZ(i);
        surfPos.setY(i, TANK.maxY + 0.12 * Math.sin(x * 0.6 + t * 1.1) + 0.08 * Math.cos(z * 0.8 - t * 1.4));
      }
      surfPos.needsUpdate = true;
      surfGeo.computeVertexNormals();

      shafts.forEach((s, i) => {
        (s.material as THREE.MeshBasicMaterial).opacity = 0.045 + 0.03 * Math.sin(t * 0.5 + i * 1.7);
      });

      for (const w of weeds) {
        const p = w.geo.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const y = w.base[i * 3 + 1];
          // Clamp: translate() leaves the root row at -0 or -1e-16, and pow(negative, 1.5) is NaN.
          const k = Math.pow(Math.max(0, y / w.h), 1.5);
          p.setX(i, w.base[i * 3] + Math.sin(t * 1.2 + w.phase + y * 0.6) * 0.45 * k);
          p.setZ(i, w.base[i * 3 + 2] + Math.cos(t * 0.9 + w.phase + y * 0.4) * 0.25 * k);
        }
        p.needsUpdate = true;
      }

      bubbles.forEach((b, i) => {
        b.y += b.speed * dt;
        if (b.y > H) b.y = 0;
        const wob = Math.sin(t * 2 + b.phase + b.y) * 0.15;
        m4.makeScale(b.size, b.size, b.size).setPosition(b.vent.x + wob, b.y, b.vent.z + wob * 0.6);
        bubbleMesh.setMatrixAt(i, m4);
      });
      bubbleMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
