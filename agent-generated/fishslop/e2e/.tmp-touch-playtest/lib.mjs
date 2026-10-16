// Throwaway touch play-test harness. Real touch input only (CDP Input.dispatchTouchEvent);
// the page is read for measurements, never written to input.keys / input.stick.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SHOTS = '/tmp/claude-0/-home-user-vibecoding/f94979c2-849f-5ace-bede-2ab99257daf9/scratchpad/shots/';

// Game constants mirrored for the human model (src/touch.ts, src/sub.ts).
export const RADIUS = 52;
export const RAD_PER_PX = 0.0022 * 2.2; // look drag: LOOK_SENS * LOOK_SCALE

// ---------- deterministic noise for the human ----------
let seedState = 1;
export function reseedHuman(s) {
  seedState = s >>> 0 || 1;
}
export function rnd() {
  let a = (seedState = (seedState + 0x6d2b79f5) | 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function gauss() {
  let u = 0;
  while (!u) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- browser + page ----------
export async function openBrowser() {
  const server = await preview({ root: ROOT, preview: { port: 4190, strictPort: false }, logLevel: 'warn' });
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-compositing'],
  });
  return { server, browser, base: server.resolvedUrls.local[0] };
}

const PAGE_SETUP = () => {
  const g = window.__fishslop;
  g.manualClock = true;
  // Rendering in software is the slow part and nothing in the simulation depends on it,
  // so frames are skipped except while a screenshot is taken.
  const r = g.renderer;
  const orig = r.render.bind(r);
  window.__render = false;
  r.render = (s, c) => {
    if (window.__render) orig(s, c);
  };
  window.__m = { eaten: 0, fired: 0, shots: [], hitsAt: [] };
  window.__fid = 0;
  const w = g.world;
  const eaten = w.onFishEaten;
  w.onFishEaten = function (f) {
    window.__m.eaten++;
    return eaten.call(this, f);
  };
  // Measure the aim error of every shot, and allow a what-if lock-on cone (window.__cone).
  const origFire = g.fire;
  g.fire = function () {
    if (this.fireCooldown > 0) return;
    const V = this.sub.pos.constructor;
    const nose = this.sub.nose();
    const camDir = this.camera.getWorldDirection(new V());
    const target = this.camera.position.clone().addScaledVector(camDir, 40);
    const dir = target.sub(nose).normalize();
    const m = this.world.monster;
    const ang = m && m.alive ? m.pos.clone().sub(nose).angleTo(dir) : null;
    window.__m.fired++;
    if (ang !== null) window.__m.shots.push(+ang.toFixed(4));
    if (window.__cone === undefined || !window.__Bolt) {
      const n = this.bolts.length;
      origFire.call(this);
      if (!window.__Bolt && this.bolts.length > n) window.__Bolt = this.bolts[this.bolts.length - 1].constructor;
      return;
    }
    this.fireCooldown = 0.25;
    if (m && m.alive) {
      const toM = m.pos.clone().sub(nose);
      if (toM.angleTo(dir) < window.__cone) dir.copy(toM.normalize());
    }
    this.bolts.push(new window.__Bolt(this.scene, nose, dir));
  };
  window.__snap = () => {
    const V = g.sub.pos.constructor;
    const cd = g.camera.getWorldDirection(new V());
    const m = g.world.monster;
    return {
      t: g.playTime,
      state: g.state,
      pos: g.sub.pos.toArray(),
      vel: g.sub.vel.toArray(),
      yaw: g.sub.yaw,
      pitch: g.sub.pitch,
      cam: g.camera.position.toArray(),
      camDir: cd.toArray(),
      fov: g.camera.fov,
      aspect: g.camera.aspect,
      m: m ? { pos: m.pos.toArray(), alive: m.alive, hp: m.hp, maxHp: m.maxHp, leaving: m.leaving } : null,
      fish: g.world.fish.filter((f) => f.alive).map((f) => ({ id: (f.__id ??= ++window.__fid), pos: f.pos.toArray(), hunger: f.hunger, stage: f.stage })),
      pellets: g.world.pellets.filter((p) => !p.dead).map((p) => p.pos.toArray()),
      coins: g.world.coins.filter((c) => !c.dead).map((c) => ({ pos: c.pos.toArray(), value: c.value, resting: c.resting, restLeft: c.restLeft })),
      money: g.econ.money,
      bolts: g.bolts.length,
      stats: { ...g.stats },
      eaten: window.__m.eaten,
      fired: window.__m.fired,
      stick: { x: g.input.stick.x, y: g.input.stick.y, boost: g.input.stick.boost },
      keys: [...g.input.keys],
    };
  };
  window.__step = (n) => {
    for (let i = 0; i < n; i++) g.tick(1 / 60);
    return window.__snap();
  };
};

export async function openPage(browser, base, view, pageSeed = 12345) {
  const ctx = await browser.newContext({ viewport: view, isMobile: true, hasTouch: true, locale: 'en-US' });
  await ctx.addInitScript((seed) => {
    let a = seed;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__reseed = (s) => {
      a = s;
    };
  }, pageSeed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.goto(base);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await page.evaluate(PAGE_SETUP);
  await page.tap('#start');
  await page.locator('#t-fire').waitFor({ state: 'visible' });
  const cdp = await ctx.newCDPSession(page);
  const touch = new Touch(cdp, view);
  const box = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  };
  const buttons = {
    fire: await box('#t-fire'),
    feed: await box('#t-feed'),
    up: await box('#t-up'),
    down: await box('#t-down'),
    pause: await box('#t-pause'),
    guppy: await box('.shop-item[data-id="guppy"]'),
    shop: await box('#shop'),
  };
  const step = (n) => page.evaluate((n) => window.__step(n), n);
  const shot = async (name) => {
    await page.evaluate(() => (window.__render = true));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}${name}.png` });
    await page.evaluate(() => (window.__render = false));
  };
  return { ctx, page, cdp, touch, buttons, step, shot, errors, view };
}

// ---------- fingers ----------
/** Every finger still down goes in each CDP event, as on a real touch screen. */
export class Touch {
  constructor(cdp, view) {
    this.cdp = cdp;
    this.view = view;
    this.pts = new Map();
    this.events = 0;
  }
  list() {
    return [...this.pts].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 9, radiusY: 9, force: 1 }));
  }
  fit(x, y) {
    return { x: clamp(x, 2, this.view.width - 2), y: clamp(y, 2, this.view.height - 2) };
  }
  send(type) {
    this.events++;
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: this.list() });
  }
  /** acts: [{id, type: start|move|end, x, y}]; ends, then starts, then one move event for all moved fingers. */
  async apply(acts) {
    const ends = acts.filter((a) => a.type === 'end' && this.pts.has(a.id));
    if (ends.length) {
      for (const a of ends) this.pts.delete(a.id);
      await this.send('touchEnd');
    }
    const starts = acts.filter((a) => a.type === 'start');
    for (const a of starts) {
      this.pts.set(a.id, this.fit(a.x, a.y));
      await this.send('touchStart');
    }
    const moves = acts.filter((a) => a.type === 'move' && this.pts.has(a.id));
    if (moves.length) {
      for (const a of moves) this.pts.set(a.id, this.fit(a.x, a.y));
      await this.send('touchMove');
    }
  }
  async endAll() {
    if (!this.pts.size) return;
    this.pts.clear();
    await this.send('touchEnd');
  }
}

/**
 * Left thumb on the floating stick. intent = {x, y, boost} in stick units (x right, y forward), or null to lift.
 * It lands near its resting spot with a little scatter, carries a per-landing aiming bias (~6 degrees, ~8%
 * of reach), moves at ~780 px/s and lands each new target with ~1.5 px of scatter.
 */
export class LeftThumb {
  constructor(anchor) {
    this.anchor = anchor;
    this.id = 1;
    this.down = false;
    this.intent = null;
    this.target = null;
    this.landings = 0;
  }
  set(intent) {
    this.intent = intent;
    this.fresh = true;
  }
  get moving() {
    if (!this.down) return !!this.intent && (Math.abs(this.intent.x) >= 0.03 || Math.abs(this.intent.y) >= 0.03 || this.intent.boost);
    if (this.fresh) return true;
    return !!this.target && Math.hypot(this.target.x - this.pos.x, this.target.y - this.pos.y) > 0.6;
  }
  plan(frames) {
    const it = this.intent;
    const zero = !it || (Math.abs(it.x) < 0.03 && Math.abs(it.y) < 0.03 && !it.boost);
    if (zero) {
      if (!this.down) return null;
      this.down = false;
      this.target = null;
      return { id: this.id, type: 'end' };
    }
    if (!this.down) {
      this.origin = { x: this.anchor.x + gauss() * 10, y: this.anchor.y + gauss() * 10 };
      this.pos = { ...this.origin };
      this.biasAng = gauss() * 0.1;
      this.biasMag = 1 + gauss() * 0.08;
      this.landings++;
      this.down = true;
      this.target = null;
      this.fresh = true;
      return { id: this.id, type: 'start', x: this.origin.x, y: this.origin.y };
    }
    if (this.fresh) {
      this.fresh = false;
      const reach = it.boost ? 1.75 : 1.0;
      let vx = it.x * RADIUS * reach * this.biasMag;
      let vy = -it.y * RADIUS * reach * this.biasMag;
      const c = Math.cos(this.biasAng);
      const s = Math.sin(this.biasAng);
      [vx, vy] = [vx * c - vy * s, vx * s + vy * c];
      const tgt = { x: this.origin.x + vx + gauss() * 1.5, y: this.origin.y + vy + gauss() * 1.5 };
      if (!this.target || Math.hypot(tgt.x - this.target.x, tgt.y - this.target.y) > 2.5) this.target = tgt;
    }
    if (!this.moving) return null;
    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    const k = Math.min(1, (13 * frames) / d);
    this.pos = { x: this.pos.x + dx * k, y: this.pos.y + dy * k };
    return { id: this.id, type: 'move', x: this.pos.x, y: this.pos.y };
  }
}

/**
 * Right thumb: swipes to look, or presses one of the buttons. One thumb can't do both, so switching
 * means lifting and moving (0.1-0.2 s). A third finger (claw grip) uses the same class for Harpoon.
 */
export class RightThumb {
  constructor(opts) {
    this.o = opts; // { anchor, buttons, maxSwipe, zoneX, maxY, id }
    this.id = opts.id ?? 2;
    this.mode = 'free'; // free | travel | swipe | button
    this.busyUntil = 0;
    this.swipes = 0;
    this.swipePx = 0;
    this.taps = 0;
    this.queue = null;
    this.tapUntil = undefined;
  }
  get idle() {
    return this.mode === 'free' && !this.queue;
  }
  get moving() {
    return this.mode === 'swipe';
  }
  holding(name) {
    return this.mode === 'button' && this.btn === name && this.tapUntil === undefined;
  }
  wakeAt() {
    if (this.mode === 'travel') return this.busyUntil;
    if (this.tapUntil !== undefined) return this.tapUntil;
    if (this.queue && this.mode !== 'swipe') return 0;
    return Infinity;
  }
  swipe(dxpx, dypx) {
    if (this.mode === 'swipe') return false;
    this.queue = { kind: 'swipe', dxpx, dypx };
    return true;
  }
  hold(name) {
    if (this.holding(name)) return;
    this.queue = { kind: 'hold', name };
  }
  tap(name) {
    this.queue = { kind: 'tap', name };
  }
  release() {
    if (this.mode === 'button' || this.queue) this.queue = { kind: 'release' };
  }
  plan(t, frames) {
    if (this.mode === 'travel') {
      if (t < this.busyUntil - 1e-9) return null;
      this.mode = 'free';
    }
    if (this.mode === 'swipe') {
      const sw = this.sw;
      const left = Math.hypot(sw.tx - this.pos.x, sw.ty - this.pos.y);
      const max = sw.speed * frames;
      if (left <= max + 0.5) {
        this.pos = { x: sw.tx, y: sw.ty };
        this.mode = 'lifting';
        return { id: this.id, type: 'move', x: this.pos.x, y: this.pos.y };
      }
      const k = max / left;
      this.pos = { x: this.pos.x + (sw.tx - this.pos.x) * k + gauss() * 0.8, y: this.pos.y + (sw.ty - this.pos.y) * k + gauss() * 0.8 };
      return { id: this.id, type: 'move', x: this.pos.x, y: this.pos.y };
    }
    if (this.mode === 'lifting') {
      this.mode = 'travel';
      this.busyUntil = t + 0.1 + rnd() * 0.08;
      return { id: this.id, type: 'end' };
    }
    if (this.mode === 'button' && this.tapUntil !== undefined && t >= this.tapUntil - 1e-9) {
      this.tapUntil = undefined;
      this.mode = 'free';
      return { id: this.id, type: 'end' };
    }
    const q = this.queue;
    if (!q) return null;
    if (this.mode === 'button') {
      if (q.kind === 'hold' && q.name === this.btn && this.tapUntil === undefined) {
        this.queue = null;
        return null;
      }
      if (q.kind === 'release') {
        this.queue = null;
        this.mode = 'free';
      } else {
        this.mode = 'travel';
        this.busyUntil = t + 0.12 + rnd() * 0.08;
      }
      this.tapUntil = undefined;
      return { id: this.id, type: 'end' };
    }
    if (this.mode !== 'free') return null;
    this.queue = null;
    if (q.kind === 'release') return null;
    if (q.kind === 'swipe') {
      const { anchor, maxSwipe, zoneX } = this.o;
      let { dxpx, dypx } = q;
      const len = Math.hypot(dxpx, dypx);
      if (len < 3) return null;
      // Direction error: the swipe wanders off its line by ~6 degrees.
      const a = gauss() * 0.1;
      [dxpx, dypx] = [dxpx * Math.cos(a) - dypx * Math.sin(a), dxpx * Math.sin(a) + dypx * Math.cos(a)];
      const k = len > maxSwipe ? maxSwipe / len : 1;
      dxpx *= k;
      dypx *= k;
      // Start so the swipe is centred on the thumb's resting spot, inside the look zone.
      const sx = clamp(anchor.x - dxpx / 2 + gauss() * 8, zoneX + 12, this.o.viewW - 12);
      const sy = clamp(anchor.y - dypx / 2 + gauss() * 8, 70, this.o.maxY);
      this.pos = { x: sx, y: sy };
      this.sw = { tx: sx + dxpx, ty: sy + dypx, speed: 14 + rnd() * 6 };
      this.mode = 'swipe';
      this.swipes++;
      this.swipePx += Math.hypot(dxpx, dypx);
      return { id: this.id, type: 'start', x: sx, y: sy };
    }
    const b = this.o.buttons[q.name];
    const x = b.x + gauss() * b.w * 0.12;
    const y = b.y + gauss() * b.h * 0.12;
    this.pos = { x, y };
    this.mode = 'button';
    this.btn = q.name;
    if (q.kind === 'tap') {
      this.tapUntil = t + 0.07 + rnd() * 0.05;
      this.taps++;
    } else this.tapUntil = undefined;
    return { id: this.id, type: 'start', x, y };
  }
}
// ---------- geometry helpers on snapshots ----------
/** Where a point sits relative to the crosshair: horizontal and vertical angles in the camera frame (rad). */
export function screenAngles(s, p) {
  const [cx, cy, cz] = s.cam;
  let tx = p[0] - cx;
  let ty = p[1] - cy;
  let tz = p[2] - cz;
  const tl = Math.hypot(tx, ty, tz);
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const [fx, fy, fz] = s.camDir;
  // right = f x up(0,1,0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  // up = r x f
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const x = tx * rx + tz * rz;
  const y = tx * ux + ty * uy + tz * uz;
  const z = tx * fx + ty * fy + tz * fz;
  const h = Math.atan2(x, z);
  const v = Math.atan2(y, Math.hypot(x, z));
  const vfov = (s.fov * Math.PI) / 180;
  const tanV = Math.tan(vfov / 2);
  const tanH = tanV * s.aspect;
  const onScreen = z > 0 && Math.abs(x / z) < tanH && Math.abs(y / z) < tanV;
  return { h, v, onScreen, off: Math.acos(clamp(z, -1, 1)), hfov: 2 * Math.atan(tanH), vfov };
}

export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const distH = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const floorH = (x, z) => -0.18 + 0.12 * Math.sin(x * 0.33) * Math.cos(z * 0.41) + 0.06 * Math.sin(x * 1.07 + z * 0.73);

export function layout(view) {
  const portrait = view.height > view.width;
  return portrait
    ? { stickAnchor: { x: 100, y: 634 }, lookAnchor: { x: 285, y: 400 }, maxSwipe: 170, zoneX: view.width * 0.45, maxY: 480 }
    : { stickAnchor: { x: 105, y: 285 }, lookAnchor: { x: 620, y: 175 }, maxSwipe: 260, zoneX: view.width * 0.45, maxY: 280 };
}

/** One human: two thumbs (and optionally a third finger on Harpoon), with a decision every 0.1-0.2 s. */
export class Human {
  constructor(p, { third = false } = {}) {
    this.p = p;
    const L = layout(p.view);
    this.L = L;
    const common = { anchor: L.lookAnchor, buttons: p.buttons, maxSwipe: L.maxSwipe, zoneX: L.zoneX, maxY: L.maxY, viewW: p.view.width };
    this.left = new LeftThumb(L.stickAnchor);
    this.right = new RightThumb(common);
    this.third = third ? new RightThumb({ ...common, id: 3 }) : null;
    this.history = [];
  }
  get thumbs() {
    return [this.left, this.right, this.third].filter(Boolean);
  }
  /**
   * Runs until done(s) or maxT seconds. brain(seen, now) is called every 0.1-0.2 s of game time with the
   * state the human saw `latency` seconds ago (reaction time). Moving fingers step every `sub` frames;
   * when no finger is moving, game time jumps to the next decision.
   */
  async run(brain, { maxT = 20, done = () => false, sub = 4, latency = 0.1, every = [0.1, 0.2], onStep } = {}) {
    let s = await this.p.step(0);
    const t0 = s.t;
    let next = s.t;
    this.history = [s];
    while (true) {
      if (s.t >= next - 1e-9) {
        let seen = this.history[0];
        for (let i = this.history.length - 1; i >= 0; i--) {
          if (s.t - this.history[i].t >= latency - 1e-6) {
            seen = this.history[i];
            break;
          }
        }
        brain(seen, s);
        next = s.t + every[0] + rnd() * (every[1] - every[0]);
      }
      const acts = [this.left.plan(sub), this.right.plan(s.t, sub), this.third?.plan(s.t, sub)].filter(Boolean);
      if (acts.length) await this.p.touch.apply(acts);
      let n = sub;
      if (!this.thumbs.some((th) => th.moving)) {
        const wake = Math.min(next, ...[this.right, this.third].filter(Boolean).map((th) => th.wakeAt()));
        n = clamp(Math.round((wake - s.t) * 60), 1, 30);
      }
      if (this.thumbs.some((th) => th.mode === 'lifting')) n = 1;
      s = await this.p.step(n);
      this.history.push(s);
      if (this.history.length > 60) this.history.shift();
      onStep?.(s);
      if (done(s) || s.t - t0 >= maxT - 1e-9 || s.state !== 'playing') break;
    }
    return s;
  }
  async liftAll() {
    this.left.intent = null;
    this.left.down = false;
    this.left.target = null;
    await this.p.touch.endAll();
    for (const th of [this.right, this.third].filter(Boolean)) {
      th.mode = 'free';
      th.queue = null;
      th.tapUntil = undefined;
    }
  }
}

/** Swipe pixels a human uses to move the view by (dh, dv) radians, with gain error. */
export function humanSwipe(dh, dv, gainMean = 0.85, gainSd = 0.15) {
  const g = clamp(gainMean + gauss() * gainSd, 0.45, 1.35);
  return [(dh / RAD_PER_PX) * g, (-dv / RAD_PER_PX) * g];
}

export const stats = (arr) => {
  const a = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return { n: a.length, mean: +mean.toFixed(3), med: +q(0.5).toFixed(3), min: +a[0].toFixed(3), max: +a[a.length - 1].toFixed(3) };
};
