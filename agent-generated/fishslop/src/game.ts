import * as THREE from 'three';
import {
  MONSTER,
  START_FISH,
  TANK,
  foodValue,
  harpoonDamage,
  hasWon,
  isGameOver,
  magnetRadius,
  newEconomy,
  pelletCap,
  shopDef,
  tryBuy,
  type CoinKind,
  type Economy,
  type ShopId,
} from './rules.ts';
import { buildTank, floorHeight, type Tank } from './tank.ts';
import { Bolt, Coin, Fish, Monster, Pellet, type World } from './entities.ts';
import { Sub } from './sub.ts';
import { Particles } from './particles.ts';
import type { Hud } from './hud.ts';
import type { Input } from './input.ts';
import type { Sfx } from './audio.ts';

type State = 'title' | 'playing' | 'paused' | 'over' | 'won';

const FAR = new THREE.Vector3(0, -999, 0);

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
  state: State = 'title';
  private readonly tank: Tank;
  private readonly sub: Sub;
  private readonly particles: Particles;
  private readonly world: World;
  private econ: Economy = newEconomy();
  private bolts: Bolt[] = [];
  private playTime = 0;
  private nextMonsterAt: number = MONSTER.firstAt;
  private wave = 0;
  private warned = false;
  private fireCooldown = 0;
  private bubbleTimer = 0;
  private titleAngle = 0;
  private stats = { earned: 0, slain: 0, lost: 0, kings: 0 };
  private last = performance.now();
  private elapsed = 0;
  private readonly lookAt = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: Hud,
    private readonly input: Input,
    private readonly sfx: Sfx,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.tank = buildTank(this.scene);
    this.sub = new Sub(this.scene);
    this.particles = new Particles(this.scene);

    const game = this;
    this.world = {
      scene: this.scene,
      fish: [],
      pellets: [],
      coins: [],
      monster: null,
      colliders: this.tank.colliders,
      hungerDrains: false,
      spawnCoin(kind: CoinKind, pos: THREE.Vector3, value?: number) {
        this.coins.push(new Coin(game.scene, kind, pos, value));
      },
      onFishAte(f, grewTo) {
        if (game.state !== 'playing') return;
        game.sfx.gulp();
        game.particles.emit(f.pos, 6, 0xfff3c4, 1, 0.8, 0.6, 0.6);
        if (grewTo !== null) {
          game.sfx.grow();
          game.hud.float(f.pos, f.stageInfo.name, 'grow');
          if (grewTo === 3) {
            game.stats.kings++;
            game.hud.toast('A king guppy! It drops gems.', 'good');
          }
        }
      },
      onFishStarved(f) {
        if (game.state !== 'playing') return;
        game.stats.lost++;
        game.sfx.death();
        game.hud.toast(`A ${f.stageInfo.name.toLowerCase()} starved. Watch for green fish.`, 'bad');
      },
      onFishEaten(f) {
        game.stats.lost++;
        game.sfx.death();
        game.particles.emit(f.pos, 24, 0xff5d73, 3, 1.4, 0.3, 0.9);
        game.hud.toast('The monster ate a fish!', 'bad');
        f.dispose(game.scene);
      },
    };

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.populateTitle();
    this.camera.position.set(0, 8, 10);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private get aliveFish() {
    return this.world.fish.filter((f) => f.alive).length;
  }

  private get pelletsOut() {
    return this.world.pellets.filter((p) => !p.dead).length;
  }

  private spawnFish(pos: THREE.Vector3, growth = 0) {
    this.world.fish.push(new Fish(this.scene, pos, growth));
  }

  private randomTankPoint() {
    return new THREE.Vector3(
      THREE.MathUtils.randFloat(TANK.minX + 3, TANK.maxX - 3),
      THREE.MathUtils.randFloat(3, TANK.maxY - 4),
      THREE.MathUtils.randFloat(TANK.minZ + 3, TANK.maxZ - 3),
    );
  }

  private clearEntities() {
    const w = this.world;
    w.fish.forEach((f) => f.dispose(this.scene));
    w.pellets.forEach((p) => this.scene.remove(p.mesh));
    w.coins.forEach((c) => this.scene.remove(c.mesh));
    this.bolts.forEach((b) => this.scene.remove(b.mesh));
    w.monster?.dispose(this.scene);
    w.fish = [];
    w.pellets = [];
    w.coins = [];
    w.monster = null;
    this.bolts = [];
    this.hud.clearWorld();
  }

  private populateTitle() {
    this.clearEntities();
    this.world.hungerDrains = false;
    [0, 2, 4, 5, 10, 12, 25, 30].forEach((g) => this.spawnFish(this.randomTankPoint(), g));
    this.sub.model.root.visible = false;
  }

  start() {
    this.sfx.unlock();
    this.clearEntities();
    this.econ = newEconomy();
    this.world.hungerDrains = true;
    for (let i = 0; i < START_FISH; i++) this.spawnFish(new THREE.Vector3(-2 + i * 4, 6, 0));
    this.sub.reset();
    this.sub.model.root.visible = true;
    this.playTime = 0;
    this.nextMonsterAt = MONSTER.firstAt;
    this.wave = 0;
    this.warned = false;
    this.stats = { earned: 0, slain: 0, lost: 0, kings: 0 };
    this.state = 'playing';
    this.hud.overlay(null);
    this.hud.show(true);
    this.camera.position.set(0, 8.5, 12);
    this.input.requestLock();
    this.hud.toast('Feed your guppies before they turn green', 'info');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.overlay('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.sfx.unlock();
    if (this.input.fallback) {
      this.state = 'playing';
      this.hud.overlay(null);
    } else {
      this.input.requestLock();
    }
  }

  onLockChange(locked: boolean) {
    if (locked && this.state === 'paused') {
      this.state = 'playing';
      this.hud.overlay(null);
    } else if (!locked && this.state === 'playing' && !this.input.fallback) {
      this.pause();
    }
  }

  private finish(won: boolean) {
    this.state = won ? 'won' : 'over';
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.end({ won, time: this.playTime, ...this.stats });
    this.hud.overlay('end');
    if (won) this.sfx.win();
  }

  dropFood() {
    if (this.state !== 'playing') return;
    const cap = pelletCap(this.econ.levels);
    if (this.pelletsOut >= cap) {
      this.sfx.deny();
      this.hud.toast(`Only ${cap} pellets at once. Upgrade with 3`, 'info');
      return;
    }
    const pos = this.tmp.copy(this.sub.pos);
    pos.y -= 0.55;
    this.world.pellets.push(new Pellet(this.scene, pos, this.sub.vel.clone().multiplyScalar(0.35), foodValue(this.econ.levels)));
    this.sfx.plop();
  }

  private fire() {
    if (this.fireCooldown > 0) return;
    this.fireCooldown = 0.18;
    const nose = this.sub.nose();
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const target = this.camera.position.clone().addScaledVector(camDir, 40);
    const dir = target.sub(nose).normalize();
    const m = this.world.monster;
    if (m && m.alive) {
      const toM = m.pos.clone().sub(nose);
      if (toM.angleTo(dir) < 0.16) dir.copy(toM.normalize());
    }
    this.bolts.push(new Bolt(this.scene, nose, dir));
    this.particles.emit(nose, 3, 0x9ff7ff, 1.2, 0.8, 0.2, 0.3);
    this.sfx.pew();
  }

  buy(id: ShopId) {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const res = tryBuy(this.econ, id, this.aliveFish);
    if (!res.ok) {
      this.sfx.deny();
      this.hud.toast(res.reason === 'maxed' ? `${shopDef(id).name} is maxed out` : 'Not enough coins', 'bad');
      return;
    }
    this.sfx.buy();
    if (id === 'guppy') {
      const p = this.sub.pos.clone();
      p.y = Math.min(p.y + 1.5, TANK.maxY - 1.5);
      this.spawnFish(p);
      this.particles.emit(p, 14, 0xffd6a5, 2, 1, 0.8, 0.8);
      this.hud.toast('New guppy in the tank', 'good');
    } else if (id === 'egg') {
      this.hud.toast(`Egg piece ${this.econ.levels.egg} of 3`, 'good');
      if (hasWon(this.econ)) this.finish(true);
    } else {
      this.hud.toast(`${shopDef(id).name} upgraded`, 'good');
    }
  }

  handleKey(code: string) {
    if (code === 'KeyM') {
      const muted = this.sfx.toggleMute();
      this.hud.toast(muted ? 'Sound off' : 'Sound on');
      return;
    }
    if (this.state === 'playing' || this.state === 'paused') {
      const digit = /^Digit([1-6])$/.exec(code);
      if (digit) {
        this.buy(['guppy', 'food', 'capacity', 'magnet', 'harpoon', 'egg'][Number(digit[1]) - 1] as ShopId);
        return;
      }
    }
    if (this.state === 'playing') {
      if (code === 'KeyF') this.dropFood();
      if (code === 'KeyR') this.fire();
      if (this.input.fallback && (code === 'KeyP' || code === 'Escape')) this.pause();
    } else if (this.state === 'paused' && this.input.fallback && (code === 'KeyP' || code === 'Escape')) {
      this.resume();
    }
  }

  handleClick(button: number) {
    if (this.state !== 'playing') return;
    if (button === 0) this.dropFood();
    if (button === 2) this.fire();
  }

  private stepMonsters(dt: number) {
    const w = this.world;
    if (!w.monster) {
      const until = this.nextMonsterAt - this.playTime;
      if (!this.warned && until <= MONSTER.warning && this.aliveFish > 0) {
        this.warned = true;
        this.sfx.siren();
      }
      if (until <= 0) {
        if (this.aliveFish > 0) {
          this.wave++;
          w.monster = new Monster(this.scene, this.wave, MONSTER.hp(this.wave - 1), MONSTER.speed(this.wave - 1));
          this.warned = false;
        } else {
          this.nextMonsterAt = this.playTime + 15;
        }
      }
      return;
    }
    const m = w.monster;
    m.update(dt, this.elapsed, w);
    if (m.removed) {
      m.dispose(this.scene);
      w.monster = null;
      this.nextMonsterAt = this.playTime + MONSTER.interval;
    }
  }

  private step(dt: number) {
    const w = this.world;
    const playing = this.state === 'playing';

    if (playing) {
      this.playTime += dt;
      this.sub.update(dt, this.input, w.colliders);
      this.fireCooldown -= dt;
      if (this.input.buttons.has(2) || this.input.keys.has('KeyR')) this.fire();
      this.bubbleTimer -= dt;
      if (this.sub.thrust > 0.1 && this.bubbleTimer <= 0) {
        this.bubbleTimer = 0.06;
        const back = this.sub.forward().multiplyScalar(-1.1).add(this.sub.pos);
        this.particles.emit(back, 1, 0xe8fbff, 0.6, 1.1, 1.6, 1.4);
      }
      this.stepMonsters(dt);
    }

    for (const f of w.fish) f.update(dt, w);
    w.fish = w.fish.filter((f) => {
      if (f.removed && !f.alive && f.deadFor > 0) f.dispose(this.scene);
      return !f.removed;
    });

    for (const p of w.pellets) p.update(dt, this.elapsed, w.colliders);
    w.pellets = w.pellets.filter((p) => {
      if (p.dead) this.scene.remove(p.mesh);
      return !p.dead;
    });

    const magnet = magnetRadius(this.econ.levels);
    for (const c of w.coins) {
      if (c.update(dt, playing ? this.sub.pos : FAR, magnet, w.colliders)) {
        c.dead = true;
        this.econ.money += c.value;
        this.stats.earned += c.value;
        this.sfx.coin(c.value);
        this.hud.float(c.pos, `+${c.value}`, c.kind);
        this.particles.emit(c.pos, 6, c.kind === 'silver' ? 0xe6edf5 : c.kind === 'gold' ? 0xffd34d : 0x7ff9e3, 1.5, 0.8, 0, 0.5);
      }
    }
    w.coins = w.coins.filter((c) => {
      if (c.dead) this.scene.remove(c.mesh);
      return !c.dead;
    });

    const m = w.monster;
    for (const b of this.bolts) {
      if (b.update(dt, m) && m) {
        m.damage(harpoonDamage(this.econ.levels));
        this.sfx.hit();
        this.particles.emit(b.pos, 8, 0xc77dff, 3, 1, 0, 0.5);
        if (!m.alive) {
          const reward = MONSTER.reward(m.wave - 1);
          w.spawnCoin('treasure', m.pos, reward);
          this.stats.slain++;
          this.sfx.monsterDown();
          this.particles.emit(m.pos, 60, 0xc77dff, 6, 2, 0.4, 1.2);
          this.hud.toast(`Monster down! Grab the treasure: ${reward} coins`, 'good');
        }
      }
    }
    this.bolts = this.bolts.filter((b) => {
      if (b.dead) this.scene.remove(b.mesh);
      return !b.dead;
    });

    this.particles.update(dt);

    if (playing) {
      const inTank = w.coins.reduce((s, c) => s + c.value, 0);
      if (isGameOver(this.econ, this.aliveFish, inTank)) this.finish(false);
    }
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (this.state === 'title') {
      this.titleAngle += dt * 0.06;
      cam.position.set(Math.sin(this.titleAngle) * 13, 7 + Math.sin(this.elapsed * 0.15) * 1.5, Math.cos(this.titleAngle) * 8);
      cam.lookAt(0, 5, 0);
      return;
    }
    const fwd = this.sub.forward();
    const desired = this.tmp.copy(this.sub.pos).addScaledVector(fwd, -6.4);
    desired.y += 2.3;
    desired.x = THREE.MathUtils.clamp(desired.x, TANK.minX + 0.4, TANK.maxX - 0.4);
    desired.z = THREE.MathUtils.clamp(desired.z, TANK.minZ + 0.4, TANK.maxZ - 0.4);
    desired.y = THREE.MathUtils.clamp(desired.y, floorHeight(desired.x, desired.z) + 0.5, TANK.maxY - 0.4);
    cam.position.lerp(desired, 1 - Math.exp(-dt * 8));
    this.lookAt.copy(this.sub.pos).addScaledVector(fwd, 9);
    this.lookAt.y += 1.4;
    cam.lookAt(this.lookAt);
  }

  private tick(dt: number) {
    this.elapsed += dt;
    if (this.state === 'playing' || this.state === 'title') this.step(dt);
    this.updateCamera(dt);
  }

  /** Test hook: run the simulation in fixed 60 Hz steps without waiting for frames. */
  advance(seconds: number) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) this.tick(1 / 60);
    return this.debugState();
  }

  /** Test hook: when true, only advance() moves game time; frames just render. */
  manualClock = false;

  frame = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (!this.manualClock) this.tick(dt);
    this.tank.update(this.elapsed);
    this.hud.updateWorld(dt, this.camera, this.world.monster);
    if (this.state !== 'title') {
      const m = this.world.monster;
      const until = this.nextMonsterAt - this.playTime;
      this.hud.update(
        this.econ,
        this.aliveFish,
        this.pelletsOut,
        TANK.maxY - this.sub.pos.y,
        m ? null : until,
        !m && this.warned ? until : null,
        !!m && m.alive,
      );
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  /** Read-only snapshot for automated smoke tests. */
  debugState() {
    return {
      state: this.state,
      money: this.econ.money,
      fish: this.aliveFish,
      pellets: this.pelletsOut,
      coins: this.world.coins.length,
      monster: !!this.world.monster,
      sub: this.sub.pos.toArray(),
      playTime: this.playTime,
      minHunger: Math.min(...this.world.fish.filter((f) => f.alive).map((f) => f.hunger)),
      totalGrowth: this.world.fish.reduce((s, f) => s + f.growth, 0),
      pointerLock: this.input.locked,
      fallback: this.input.fallback,
    };
  }
}
