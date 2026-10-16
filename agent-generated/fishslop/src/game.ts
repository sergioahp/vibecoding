import * as THREE from 'three';
import {
  HARPOON_COOLDOWN,
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
  tryBuy,
  type CoinKind,
  type Economy,
  type ShopId,
} from './rules.ts';
import { buildTank, floorHeight, type Tank } from './tank.ts';
import { Bolt, Coin, Fish, Monster, Pellet, type World } from './entities.ts';
import { Sub } from './sub.ts';
import { Particles } from './particles.ts';
import { shopName, stageName, type Hud } from './hud.ts';
import { num, t } from './i18n.ts';
import type { Input } from './input.ts';
import type { Sfx } from './audio.ts';

type State = 'title' | 'playing' | 'paused' | 'over' | 'won';

const FAR = new THREE.Vector3(0, -999, 0);
/** Horizontal field of view to aim for when the screen is taller than wide. The vertical field of
 * view stops at 90° before fisheye sets in, so the tallest phones get a little under this. */
const MIN_HFOV = THREE.MathUtils.degToRad(58);
const BASE_FOV = 62;
/** How far off the crosshair the monster can be and still draw the harpoon onto it, in radians.
 * Thumbs aim less precisely than a mouse, so touch gets the wider cone. */
const LOCK_ON = { mouse: 0.08, touch: 0.2 } as const;

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
  private readonly tmp2 = new THREE.Vector3();
  private readonly upTmp = new THREE.Vector3();
  private readonly aimTmp = new THREE.Vector3();
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private frameAvg = 1 / 60;
  private slowFor = 0;
  private adapting = true;
  private avgBeforeDrop = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: Hud,
    private readonly input: Input,
    private readonly sfx: Sfx,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
          game.hud.float(f.pos, stageName(f.stage), 'grow');
          if (grewTo === 3) {
            game.stats.kings++;
            game.hud.toast(t('toastKing'), 'good');
          }
        }
      },
      onFishStarved(f) {
        if (game.state !== 'playing') return;
        game.stats.lost++;
        game.sfx.death();
        game.hud.toast(t('toastStarved', { stage: stageName(f.stage).toLowerCase() }), 'bad');
      },
      onFishEaten(f) {
        game.stats.lost++;
        game.sfx.death();
        game.particles.emit(f.pos, 24, 0xff5d73, 3, 1.4, 0.3, 0.9);
        game.hud.toast(t('toastEaten'), 'bad');
        game.buzz([60, 40, 60]);
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
    const aspect = w / h;
    this.camera.aspect = aspect;
    const fovForWidth = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(MIN_HFOV / 2) / aspect));
    this.camera.fov = THREE.MathUtils.clamp(fovForWidth, BASE_FOV, 90);
    this.camera.updateProjectionMatrix();
  }

  /** Short vibration on phones that support it (Android; iOS Safari has no vibrate). */
  buzz(pattern: number | number[]) {
    if (this.input.touch && !this.sfx.muted) navigator.vibrate?.(pattern);
  }

  /** Drops the render resolution while frames run slow, down to one pixel per CSS pixel. */
  private adaptQuality(dt: number) {
    if (!this.adapting) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    // Under about 26 fps. Phones capped at 30 fps (iOS Low Power Mode, Chrome Energy Saver) sit at
    // 33 ms a frame whatever the resolution, so they stay above this line and keep full detail.
    if (this.frameAvg < 1 / 26 || this.pixelRatio <= 1) {
      this.slowFor = 0;
      return;
    }
    this.slowFor += dt;
    if (this.slowFor < 2) return;
    this.slowFor = 0;
    if (this.avgBeforeDrop && this.frameAvg > this.avgBeforeDrop * 0.9) {
      // The last drop bought nothing, so the bottleneck is elsewhere: put it back and stop trying.
      this.setPixelRatio(this.pixelRatio + 0.25);
      this.adapting = false;
      return;
    }
    this.avgBeforeDrop = this.frameAvg;
    this.setPixelRatio(Math.max(1, this.pixelRatio - 0.25));
  }

  private setPixelRatio(ratio: number) {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.resize();
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
    this.input.consumeLook();
    this.hud.overlay(null);
    this.hud.show(true);
    this.camera.position.set(0, 8.5, 12);
    this.input.requestLock();
    this.hud.toast(t('toastStart'), 'info');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.overlay('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.sfx.unlock();
    if (!this.input.needsLock) {
      this.state = 'playing';
      this.input.consumeLook();
      this.hud.overlay(null);
    } else {
      this.input.requestLock();
    }
  }

  onLockChange(locked: boolean) {
    if (locked && this.state === 'paused') {
      this.state = 'playing';
      this.input.consumeLook();
      this.hud.overlay(null);
    } else if (!locked && this.state === 'playing' && this.input.needsLock) {
      this.pause();
    }
  }

  private finish(won: boolean) {
    this.state = won ? 'won' : 'over';
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
    this.hud.clearWorld();
    this.hud.end({ won, time: this.playTime, ...this.stats });
    this.hud.overlay('end');
    if (won) this.sfx.win();
  }

  dropFood() {
    if (this.state !== 'playing') return;
    const cap = pelletCap(this.econ.levels);
    if (this.pelletsOut >= cap) {
      this.sfx.deny();
      this.hud.toast(t('toastPelletCap', { n: cap }), 'info');
      return;
    }
    const pos = this.tmp.copy(this.sub.pos);
    pos.y -= 0.55;
    this.world.pellets.push(new Pellet(this.scene, pos, this.sub.vel.clone().multiplyScalar(0.35), foodValue(this.econ.levels)));
    this.sfx.plop();
  }

  /** Whether the crosshair is on the monster, measured as the player sees it so range doesn't matter. */
  private onTarget() {
    const m = this.world.monster;
    if (!m || !m.alive) return false;
    const camDir = this.camera.getWorldDirection(this.aimTmp);
    const cone = this.input.touch ? LOCK_ON.touch : LOCK_ON.mouse;
    return camDir.angleTo(m.pos.clone().sub(this.camera.position)) < cone;
  }

  private fire() {
    if (this.fireCooldown > 0) return;
    this.fireCooldown = HARPOON_COOLDOWN;
    const nose = this.sub.nose();
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const target = this.camera.position.clone().addScaledVector(camDir, 40);
    const dir = target.sub(nose).normalize();
    const m = this.world.monster;
    if (m && this.onTarget()) dir.copy(m.pos.clone().sub(nose).normalize());
    this.bolts.push(new Bolt(this.scene, nose, dir));
    this.particles.emit(nose, 3, 0x9ff7ff, 1.2, 0.8, 0.2, 0.3);
    this.sfx.pew();
  }

  buy(id: ShopId) {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    const res = tryBuy(this.econ, id, this.aliveFish);
    if (!res.ok) {
      this.sfx.deny();
      const maxed = id === 'guppy' ? t('toastTankFull') : t('toastMaxed', { name: shopName(id) });
      this.hud.toast(res.reason === 'maxed' ? maxed : t('toastFunds'), 'bad');
      return;
    }
    this.sfx.buy();
    this.buzz(15);
    if (id === 'guppy') {
      const p = this.sub.pos.clone();
      p.y = Math.min(p.y + 1.5, TANK.maxY - 1.5);
      this.spawnFish(p);
      this.particles.emit(p, 14, 0xffd6a5, 2, 1, 0.8, 0.8);
      this.hud.toast(t('toastGuppy'), 'good');
    } else if (id === 'egg') {
      this.hud.toast(t('toastEgg', { n: this.econ.levels.egg }), 'good');
      if (hasWon(this.econ)) this.finish(true);
    } else {
      this.hud.toast(t('toastUpgraded', { name: shopName(id) }), 'good');
    }
  }

  handleKey(code: string) {
    if (code === 'KeyM') {
      const muted = this.sfx.toggleMute();
      this.hud.toast(t(muted ? 'toastSoundOff' : 'toastSoundOn'));
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
      if (!this.input.needsLock && (code === 'KeyP' || code === 'Escape')) this.pause();
    } else if (this.state === 'paused' && !this.input.needsLock && (code === 'KeyP' || code === 'Escape')) {
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
          this.warned = false;
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
      // On touch the harpoon also fires by itself while the crosshair is on the monster, so a
      // player's right thumb can keep aiming instead of switching to the button.
      const autoFire = this.input.touch && this.onTarget();
      if (this.input.buttons.has(2) || this.input.keys.has('KeyR') || autoFire) this.fire();
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
        this.buzz(12);
        this.particles.emit(b.pos, 8, 0xc77dff, 3, 1, 0, 0.5);
        if (!m.alive) {
          const reward = MONSTER.reward(m.wave - 1);
          w.spawnCoin('treasure', m.pos, reward);
          this.stats.slain++;
          this.sfx.monsterDown();
          this.particles.emit(m.pos, 60, 0xc77dff, 6, 2, 0.4, 1.2);
          this.hud.toast(t('toastMonsterDown', { n: num(reward) }), 'good');
          this.buzz([40, 30, 120]);
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
    // Offsets use the sub's own up axis so the sub sits below the crosshair at any pitch.
    const up = this.sub.right(this.upTmp).cross(fwd);
    // Spring arm: if the glass or sand is in the way, pull the camera in along the same line
    // instead of clamping one axis, so the sub never slides over the crosshair.
    const anchor = this.tmp.copy(this.sub.pos).addScaledVector(up, 0.5);
    const arm = this.tmp2.copy(fwd).multiplyScalar(-6.4).addScaledVector(up, 1.8);
    const end = arm.clone().add(anchor);
    const floorY = floorHeight(end.x, end.z) + 0.5;
    let t = 1;
    const limits: ['x' | 'y' | 'z', number, number][] = [
      ['x', TANK.minX + 0.3, TANK.maxX - 0.3],
      // The tank is open at the top, so the camera may rise above the waterline.
      ['y', floorY, TANK.maxY + 8],
      ['z', TANK.minZ + 0.3, TANK.maxZ - 0.3],
    ];
    for (const [k, lo, hi] of limits) {
      if (end[k] > hi && arm[k] > 0) t = Math.min(t, (hi - anchor[k]) / arm[k]);
      if (end[k] < lo && arm[k] < 0) t = Math.min(t, (lo - anchor[k]) / arm[k]);
    }
    const desired = anchor.addScaledVector(arm, Math.max(0.2, t));
    cam.position.lerp(desired, 1 - Math.exp(-dt * 8));
    this.lookAt.copy(this.sub.pos).addScaledVector(fwd, 9).addScaledVector(up, 1.4);
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
    // Asked for first, so one frame that throws can't stop the game.
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (!this.manualClock) this.tick(dt);
    this.adaptQuality(dt);
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
      yaw: this.sub.yaw,
      bolts: this.bolts.length,
      playTime: this.playTime,
      minHunger: Math.min(...this.world.fish.filter((f) => f.alive).map((f) => f.hunger)),
      totalGrowth: this.world.fish.reduce((s, f) => s + f.growth, 0),
      pointerLock: this.input.locked,
      fallback: this.input.fallback,
      touch: this.input.touch,
      fov: this.camera.fov,
    };
  }
}
