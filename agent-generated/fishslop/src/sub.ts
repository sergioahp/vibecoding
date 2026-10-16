import * as THREE from 'three';
import { TANK } from './rules.ts';
import { makeSub, type SubModel } from './models.ts';
import { floorHeight, type Collider } from './tank.ts';
import type { Input } from './input.ts';

const LOOK_SENS = 0.0022;
const ACCEL = 15;
const BOOST_ACCEL = 24;
const DRAG = 2.3;

export class Sub {
  readonly model: SubModel = makeSub();
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  yaw = Math.PI;
  pitch = -0.1;
  thrust = 0;
  private roll = 0;
  private propSpin = 0;

  constructor(scene: THREE.Scene) {
    this.pos = this.model.root.position;
    this.model.root.rotation.order = 'YXZ';
    scene.add(this.model.root);
    this.reset();
  }

  reset() {
    this.pos.set(0, 7, 7);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = -0.1;
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  right(out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  nose(out = new THREE.Vector3()) {
    return this.forward(out).multiplyScalar(1.1).add(this.pos);
  }

  update(dt: number, input: Input, colliders: Collider[]) {
    const [dx, dy] = input.consumeLook();
    const stick = input.stick;
    // The stick steers like a boat: sideways turns, up and down drive.
    const turn = THREE.MathUtils.clamp(input.axis(['ArrowRight'], ['ArrowLeft']) - stick.x, -1, 1);
    const pitchKeys = input.axis(['ArrowDown'], ['ArrowUp']);
    this.yaw -= dx * LOOK_SENS;
    this.yaw += turn * 2.2 * dt;
    this.pitch -= dy * LOOK_SENS;
    this.pitch += pitchKeys * 1.6 * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.15, 1.15);

    const fwd = THREE.MathUtils.clamp(input.axis(['KeyS'], ['KeyW']) + stick.y, -1, 1);
    const strafe = input.axis(['KeyA'], ['KeyD']);
    const vert = input.axis(['KeyC', 'KeyQ'], ['Space', 'KeyE']);
    const boost = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || stick.boost;

    const ahead = this.forward();
    // On touch, looking up or down only aims: the stick drives level and Up/Down change depth.
    // Otherwise every look drag would leave the sub slowly climbing or sinking.
    if (input.touch) ahead.setY(0).normalize();
    const dir = ahead.multiplyScalar(fwd).add(this.right().multiplyScalar(strafe));
    dir.y += vert;
    if (dir.lengthSq() > 1) dir.normalize();
    this.thrust = dir.length();
    this.vel.addScaledVector(dir, (boost ? BOOST_ACCEL : ACCEL) * dt);
    this.vel.multiplyScalar(Math.exp(-DRAG * dt));
    this.pos.addScaledVector(this.vel, dt);

    const minY = floorHeight(this.pos.x, this.pos.z) + 0.65;
    const bounds: [keyof THREE.Vector3 & ('x' | 'y' | 'z'), number, number][] = [
      ['x', TANK.minX + 0.8, TANK.maxX - 0.8],
      ['y', minY, TANK.maxY - 0.7],
      ['z', TANK.minZ + 0.8, TANK.maxZ - 0.8],
    ];
    for (const [k, lo, hi] of bounds) {
      if (this.pos[k] < lo) {
        this.pos[k] = lo;
        if (this.vel[k] < 0) this.vel[k] = 0;
      } else if (this.pos[k] > hi) {
        this.pos[k] = hi;
        if (this.vel[k] > 0) this.vel[k] = 0;
      }
    }
    for (const c of colliders) {
      const r = c.radius + 0.6;
      const off = new THREE.Vector3().subVectors(this.pos, c.center);
      const d = off.length();
      if (d < r && d > 1e-4) {
        off.divideScalar(d);
        this.pos.copy(c.center).addScaledVector(off, r);
        const into = this.vel.dot(off);
        if (into < 0) this.vel.addScaledVector(off, -into);
      }
    }

    const root = this.model.root;
    root.rotation.y = this.yaw;
    root.rotation.x = -this.pitch;
    this.roll = THREE.MathUtils.damp(this.roll, -strafe * 0.35 + dx * 0.004 - turn * 0.2, 5, dt);
    this.model.hull.rotation.z = this.roll;
    this.propSpin += dt * (4 + this.thrust * (boost ? 40 : 25));
    this.model.prop.rotation.z = this.propSpin;
  }
}
