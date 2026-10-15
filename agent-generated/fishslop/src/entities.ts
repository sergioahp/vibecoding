import * as THREE from 'three';
import {
  COIN_FLOOR_LIFETIME,
  COIN_VALUE,
  FISH_FLOOR_CLEARANCE,
  FOOD_FLOOR_LIFETIME,
  FOOD_REST_OFFSET,
  HUNGER,
  STAGES,
  TANK,
  eatRadius,
  stageFor,
  type CoinKind,
} from './rules.ts';
import { makeBolt, makeCoin, makeFish, makeMonster, makePellet, type FishModel, type MonsterModel } from './models.ts';
import { floorHeight, type Collider } from './tank.ts';

export interface World {
  scene: THREE.Scene;
  fish: Fish[];
  pellets: Pellet[];
  coins: Coin[];
  monster: Monster | null;
  colliders: Collider[];
  /** False on the title screen so the attract-mode fish never starve. */
  hungerDrains: boolean;
  spawnCoin(kind: CoinKind, pos: THREE.Vector3, value?: number): void;
  onFishAte(f: Fish, grewTo: number | null): void;
  onFishStarved(f: Fish): void;
  onFishEaten(f: Fish): void;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const dummy = new THREE.Object3D();

function clampToTank(p: THREE.Vector3, inset: number, floorClear: number, ceilingClear: number) {
  p.x = THREE.MathUtils.clamp(p.x, TANK.minX + inset, TANK.maxX - inset);
  p.z = THREE.MathUtils.clamp(p.z, TANK.minZ + inset, TANK.maxZ - inset);
  p.y = THREE.MathUtils.clamp(p.y, floorHeight(p.x, p.z) + floorClear, TANK.maxY - ceilingClear);
}

/** Push a point out of rock spheres. Returns true if it moved. */
export function pushOutOfRocks(p: THREE.Vector3, colliders: Collider[], pad: number): boolean {
  let moved = false;
  for (const c of colliders) {
    const r = c.radius + pad;
    const d2 = p.distanceToSquared(c.center);
    if (d2 < r * r) {
      tmp.subVectors(p, c.center);
      if (tmp.lengthSq() < 1e-6) tmp.set(1, 0, 0);
      tmp.setLength(r);
      p.copy(c.center).add(tmp);
      moved = true;
    }
  }
  return moved;
}

function faceAlong(obj: THREE.Object3D, dir: THREE.Vector3, rate: number, dt: number, maxPitch = 0.6) {
  if (dir.lengthSq() < 1e-4) return;
  tmp2.copy(dir);
  const flat = Math.hypot(tmp2.x, tmp2.z);
  tmp2.y = THREE.MathUtils.clamp(tmp2.y, -flat * maxPitch - 0.05, flat * maxPitch + 0.05);
  dummy.position.copy(obj.position);
  dummy.lookAt(tmp2.add(obj.position));
  obj.quaternion.slerp(dummy.quaternion, Math.min(1, dt * rate));
}

const STAGE_COLORS = [0xffb070, 0xff8a2a, 0xffbf1f, 0xff5fa2].map((c) => new THREE.Color(c));
const FIN_COLORS = [0xffd6a5, 0xffb347, 0xfff07a, 0xffb3d9].map((c) => new THREE.Color(c));
const SICK = new THREE.Color(0x7d9a52);
const SICK_FIN = new THREE.Color(0xa7bb7a);

export class Fish {
  readonly model: FishModel = makeFish();
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  growth = 0;
  stage = 0;
  hunger = 1;
  alive = true;
  /** Seconds since death; drives the belly-up sink. */
  deadFor = 0;
  removed = false;
  private coinTimer = 0;
  private wanderTarget = new THREE.Vector3();
  private wanderTimer = 0;
  private wag = Math.random() * 10;
  private scale = STAGES[0].scale;
  private flash = 0;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, growth = 0) {
    this.pos = this.model.root.position;
    this.pos.copy(pos);
    this.growth = growth;
    this.stage = stageFor(growth);
    this.scale = STAGES[this.stage].scale;
    this.hunger = 0.75 + Math.random() * 0.25;
    this.coinTimer = 3 + Math.random() * 6;
    this.model.root.rotation.y = Math.random() * Math.PI * 2;
    this.pickWander();
    scene.add(this.model.root);
  }

  get stageInfo() {
    return STAGES[this.stage];
  }

  private pickWander() {
    this.wanderTarget.set(
      THREE.MathUtils.lerp(TANK.minX + 2, TANK.maxX - 2, Math.random()),
      THREE.MathUtils.lerp(1.5, TANK.maxY - 3, Math.random()),
      THREE.MathUtils.lerp(TANK.minZ + 2, TANK.maxZ - 2, Math.random()),
    );
    this.wanderTimer = 4 + Math.random() * 6;
  }

  update(dt: number, w: World) {
    if (!this.alive) return this.updateDead(dt);
    const info = this.stageInfo;

    if (w.hungerDrains) this.hunger -= HUNGER.drainPerSec * dt;
    if (this.hunger <= 0) {
      this.alive = false;
      w.onFishStarved(this);
      return;
    }

    if (info.coin) {
      this.coinTimer -= dt;
      if (this.coinTimer <= 0) {
        w.spawnCoin(info.coin, this.pos);
        this.coinTimer = info.coinEvery * (0.8 + Math.random() * 0.4);
      }
    }

    const desired = tmp.set(0, 0, 0);
    let rate = 2.2;
    let seeking = false;
    const m = w.monster;
    if (m && m.alive && !m.leaving && this.pos.distanceTo(m.pos) < 9) {
      desired.subVectors(this.pos, m.pos).setLength(info.speed * 1.25);
      rate = 4;
    } else if (this.hunger < HUNGER.seekBelow && w.pellets.length) {
      let best: Pellet | null = null;
      let bestD = Infinity;
      for (const p of w.pellets) {
        if (p.dead) continue;
        const d = p.pos.distanceToSquared(this.pos);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        seeking = true;
        const dist = Math.sqrt(bestD);
        if (dist < eatRadius(this.scale)) {
          best.dead = true;
          this.hunger = 1;
          const before = this.stage;
          this.growth += best.quality;
          this.stage = stageFor(this.growth);
          this.flash = 0.4;
          w.onFishAte(this, this.stage !== before ? this.stage : null);
        } else {
          desired.subVectors(best.pos, this.pos).setLength(info.speed * 1.2 * Math.min(1, dist / 1.5 + 0.35));
          rate = 3.5;
        }
      }
    }
    if (desired.lengthSq() === 0) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0 || this.pos.distanceTo(this.wanderTarget) < 1) this.pickWander();
      desired.subVectors(this.wanderTarget, this.pos).setLength(info.speed * 0.45);
    }

    // Steer away from walls and rocks unless closing in on food.
    if (!seeking) {
      for (const c of w.colliders) {
        const d = this.pos.distanceTo(c.center);
        const r = c.radius + 0.9;
        if (d < r) desired.add(tmp2.subVectors(this.pos, c.center).setLength((r - d) * 2.5));
      }
    }

    this.vel.lerp(desired, Math.min(1, dt * rate));
    this.pos.addScaledVector(this.vel, dt);
    clampToTank(this.pos, 0.7, FISH_FLOOR_CLEARANCE, 0.8);
    pushOutOfRocks(this.pos, w.colliders, 0.25 * this.scale);

    faceAlong(this.model.root, this.vel, 6, dt);
    const speed = this.vel.length();
    this.wag += dt * (5 + speed * 4);
    this.model.tail.rotation.y = Math.sin(this.wag) * (0.35 + speed * 0.08);
    this.model.body.rotation.y = -Math.sin(this.wag) * 0.07;

    this.scale = THREE.MathUtils.damp(this.scale, info.scale * (1 + this.flash * 0.25), 6, dt);
    this.model.root.scale.setScalar(this.scale);
    this.flash = Math.max(0, this.flash - dt);
    this.model.crown.visible = this.stage === 3;

    const sick = THREE.MathUtils.clamp((0.5 - this.hunger) / 0.5, 0, 1);
    this.model.bodyMat.color.copy(STAGE_COLORS[this.stage]).lerp(SICK, sick);
    this.model.finMat.color.copy(FIN_COLORS[this.stage]).lerp(SICK_FIN, sick);
  }

  private updateDead(dt: number) {
    this.deadFor += dt;
    this.model.root.rotation.z = THREE.MathUtils.damp(this.model.root.rotation.z, Math.PI, 3, dt);
    this.pos.y += 0.6 * dt;
    const fade = 1 - this.deadFor / 3;
    this.model.bodyMat.transparent = this.model.finMat.transparent = true;
    this.model.bodyMat.opacity = Math.max(0, fade);
    this.model.finMat.opacity = Math.max(0, fade * 0.9);
    if (fade <= 0) this.removed = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.model.root);
    this.model.bodyMat.dispose();
    this.model.finMat.dispose();
  }
}

export class Pellet {
  readonly mesh: THREE.Mesh;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  resting = false;
  restLeft = FOOD_FLOOR_LIFETIME;
  dead = false;
  private phase = Math.random() * 10;

  constructor(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    readonly quality: number,
  ) {
    this.mesh = makePellet(quality);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.vel = vel.clone();
    scene.add(this.mesh);
  }

  update(dt: number, t: number, colliders: Collider[]) {
    if (this.resting) {
      this.restLeft -= dt;
      this.mesh.scale.setScalar(Math.min(1, this.restLeft / 2));
      if (this.restLeft <= 0) this.dead = true;
      return;
    }
    this.vel.y += (-1.3 - this.vel.y) * Math.min(1, dt * 2);
    this.vel.x *= Math.exp(-dt * 1.5);
    this.vel.z *= Math.exp(-dt * 1.5);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x += Math.sin(t * 3 + this.phase) * 0.15 * dt;
    // Rocks shed pellets onto the sand, so nothing settles where fish can't get it.
    if (pushOutOfRocks(this.pos, colliders, 0.12)) this.vel.y = Math.min(this.vel.y, -0.6);
    clampToTank(this.pos, 0.3, -1, 0.2);
    const rest = floorHeight(this.pos.x, this.pos.z) + FOOD_REST_OFFSET;
    if (this.pos.y <= rest) {
      this.pos.y = rest;
      this.resting = true;
    }
    this.mesh.rotation.x += dt * 2;
    this.mesh.rotation.y += dt * 1.3;
  }
}

export class Coin {
  readonly mesh: THREE.Mesh;
  readonly pos: THREE.Vector3;
  resting = false;
  restLeft = COIN_FLOOR_LIFETIME;
  dead = false;
  readonly value: number;

  constructor(
    scene: THREE.Scene,
    readonly kind: CoinKind,
    pos: THREE.Vector3,
    value?: number,
  ) {
    this.mesh = makeCoin(kind);
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.value = value ?? COIN_VALUE[kind as Exclude<CoinKind, 'treasure'>];
    scene.add(this.mesh);
  }

  update(dt: number, subPos: THREE.Vector3, magnet: number, colliders: Collider[]): boolean {
    this.mesh.rotation.y += dt * (this.kind === 'gem' || this.kind === 'treasure' ? 1.5 : 3);
    const d = this.pos.distanceTo(subPos);
    if (d < 1.1) return true;
    if (d < magnet) {
      tmp.subVectors(subPos, this.pos).setLength(Math.min(d, (6 + (magnet - d) * 4) * dt));
      this.pos.add(tmp);
      this.resting = false;
      return false;
    }
    if (this.resting) {
      this.restLeft -= dt;
      this.mesh.visible = this.restLeft > 3 || Math.floor(this.restLeft * 6) % 2 === 0;
      if (this.restLeft <= 0) this.dead = true;
      return false;
    }
    this.pos.y -= (this.kind === 'silver' ? 0.9 : 1.15) * dt;
    pushOutOfRocks(this.pos, colliders, 0.2);
    const rest = floorHeight(this.pos.x, this.pos.z) + 0.25;
    if (this.pos.y <= rest) {
      this.pos.y = rest;
      this.resting = true;
    }
    return false;
  }
}

export class Bolt {
  readonly mesh = makeBolt();
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  life = 1.3;
  dead = false;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, dir: THREE.Vector3) {
    this.pos = this.mesh.position;
    this.pos.copy(pos);
    this.vel = dir.clone().setLength(32);
    this.mesh.lookAt(tmp.copy(pos).add(dir));
    scene.add(this.mesh);
  }

  update(dt: number, target: Monster | null): boolean {
    if (target && target.alive) {
      // Gentle homing so near-misses still land.
      tmp.subVectors(target.pos, this.pos).setLength(32);
      if (tmp.angleTo(this.vel) < 0.35) this.vel.lerp(tmp, Math.min(1, dt * 5)).setLength(32);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.lookAt(tmp.copy(this.pos).add(this.vel));
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    if (target && target.alive && this.pos.distanceTo(target.pos) < target.radius) {
      this.dead = true;
      return true;
    }
    return false;
  }
}

export class Monster {
  readonly model: MonsterModel = makeMonster();
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  readonly radius = 1.7;
  hp: number;
  readonly maxHp: number;
  alive = true;
  leaving = false;
  removed = false;
  private chew = 0;
  private hitFlash = 0;
  private fade = 1;

  constructor(
    scene: THREE.Scene,
    readonly wave: number,
    hp: number,
    private readonly speed: number,
  ) {
    this.hp = this.maxHp = hp;
    this.pos = this.model.root.position;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.pos.set(side * (TANK.maxX - 2.5), 9, (Math.random() - 0.5) * 12);
    this.model.root.lookAt(0, 9, 0);
    this.model.root.scale.setScalar(0.01);
    this.model.mat.transparent = true;
    scene.add(this.model.root);
  }

  damage(n: number) {
    this.hp -= n;
    this.hitFlash = 0.15;
    if (this.hp <= 0) this.alive = false;
  }

  update(dt: number, t: number, w: World) {
    const root = this.model.root;
    root.scale.setScalar(THREE.MathUtils.damp(root.scale.x, this.alive ? 1 : 0.01, this.alive ? 4 : 8, dt));
    if (!this.alive) {
      if (root.scale.x < 0.05) this.removed = true;
      return;
    }

    let target: Fish | null = null;
    let best = Infinity;
    for (const f of w.fish) {
      if (!f.alive) continue;
      const d = f.pos.distanceToSquared(this.pos);
      if (d < best) {
        best = d;
        target = f;
      }
    }
    if (!target) this.leaving = true;

    const desired = tmp.set(0, 0, 0);
    if (this.leaving) {
      desired.set(0, 3, 0);
      this.fade -= dt * 0.5;
      this.model.mat.opacity = Math.max(0, this.fade);
      if (this.fade <= 0) this.removed = true;
    } else if (this.chew > 0) {
      this.chew -= dt;
    } else if (target) {
      desired.subVectors(target.pos, this.pos).setLength(this.speed);
      if (Math.sqrt(best) < 1.4 + target.stageInfo.scale * 0.4) {
        target.alive = false;
        target.removed = true;
        this.chew = 1.6;
        w.onFishEaten(target);
      }
    }
    this.vel.lerp(desired, Math.min(1, dt * 2));
    this.pos.addScaledVector(this.vel, dt);
    clampToTank(this.pos, 1.8, 1.6, 1.6);
    if (target) faceAlong(root, tmp2.subVectors(target.pos, this.pos), 3, dt, 1);

    this.model.body.position.y = Math.sin(t * 2.2) * 0.15;
    this.model.tentacles.forEach((tn, i) => {
      tn.rotation.x = Math.sin(t * 3 + i) * 0.45;
      tn.rotation.z = Math.cos(t * 2.4 + i * 1.3) * 0.3;
    });
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.model.mat.emissive.setHex(this.hitFlash > 0 ? 0xffffff : this.chew > 0 ? 0x5a0020 : 0x240046);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.model.root);
  }
}
