import * as THREE from 'three';

interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  rise: number;
}

/** One instanced mesh for every bubble, crumb and burst in the tank. */
export class Particles {
  private readonly mesh: THREE.InstancedMesh;
  private readonly items: P[] = [];
  private next = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly capacity = 400,
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.06, 6, 4),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false }),
      capacity,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.items.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, rise: 0 });
      this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  emit(pos: THREE.Vector3, count: number, color: number, speed = 1.5, size = 1, rise = 1.2, life = 1.2) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const p = this.items[i];
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).setLength(speed * (0.3 + Math.random()));
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.rise = rise;
      this.mesh.setColorAt(i, this.color.set(color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.multiplyScalar(Math.exp(-dt * 2.5));
      p.vel.y += p.rise * dt;
      p.pos.addScaledVector(p.vel, dt);
      const s = p.life > 0 ? p.size * Math.min(1, (p.life / p.max) * 2) : 0;
      this.m4.makeScale(s, s, s).setPosition(p.pos);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
