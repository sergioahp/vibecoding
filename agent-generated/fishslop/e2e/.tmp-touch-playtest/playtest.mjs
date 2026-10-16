// node e2e/.tmp-touch-playtest/playtest.mjs <turn|nav|vertical|feed|combat> <land|port> [options]
import { appendFileSync } from 'node:fs';
import {
  openBrowser,
  openPage,
  Human,
  reseedHuman,
  rnd,
  gauss,
  clamp,
  wrap,
  screenAngles,
  dist3,
  distH,
  floorH,
  humanSwipe,
  stats,
  RAD_PER_PX,
  layout,
} from './lib.mjs';

const OUTFILE = '/tmp/claude-0/-home-user-vibecoding/f94979c2-849f-5ace-bede-2ab99257daf9/scratchpad/results.jsonl';
const [scenario, orient = 'land', ...args] = process.argv.slice(2);
const VIEW = orient === 'port' ? { width: 390, height: 844 } : { width: 844, height: 390 };
const opt = Object.fromEntries(args.map((a) => a.split('=')));
const SEEDS = (opt.seeds ?? '1,2,3').split(',').map(Number);
const SHOTS_ON = opt.shots !== '0';
const log = (obj) => {
  const line = JSON.stringify({ scenario, orient, ...obj });
  console.log(line);
  appendFileSync(OUTFILE, line + '\n');
};
const r2 = (v) => (v === null || v === undefined ? null : +v.toFixed(2));

async function reset(p, h, o = {}) {
  if (h) await h.liftAll();
  else await p.touch.endAll();
  await p.page.evaluate((o) => {
    const g = window.__fishslop;
    window.__reseed(o.seed ?? 1);
    g.start();
    g.manualClock = true;
    window.__m.eaten = 0;
    window.__m.fired = 0;
    window.__m.shots = [];
    delete window.__cone;
    if (o.cone !== undefined) window.__cone = o.cone;
    if (o.noMonster) g.nextMonsterAt = 1e9;
    if (o.subPos) g.sub.pos.set(...o.subPos);
    if (o.yaw !== undefined) g.sub.yaw = o.yaw;
    if (o.pitch !== undefined) g.sub.pitch = o.pitch;
    g.sub.vel.set(0, 0, 0);
    for (let i = 0; i < 40; i++) g.tick(1 / 60); // camera settles behind the sub
  }, o);
}

// ---------------------------------------------------------------- 1. turning
async function turnTrial(p, method, seed, shotName) {
  reseedHuman(seed * 7 + 11);
  const h = new Human(p);
  await reset(p, h, { seed, noMonster: true });
  let s = await p.step(0);
  const yaw0 = s.yaw;
  const pitch0 = s.pitch;
  const pos0 = s.pos;
  const t0 = s.t;
  const target = yaw0 - Math.PI; // a 180 degree turn to the right
  let reached = null;
  let stableFrom = null;
  let maxOver = 0;
  const ev0 = p.touch.events;
  const brain = (seen) => {
    const err = wrap(target - seen.yaw) + gauss() * 0.03; // < 0: still has to turn right
    const ae = Math.abs(err);
    if (method !== 'look') h.left.set(ae < 0.06 ? null : { x: clamp(-err / 0.45, -1, 1), y: 0 });
    if (method === 'stick' || !h.right.idle || ae < 0.08) return;
    if (method === 'both') {
      if (ae < 0.5) return; // the stick finishes the turn
      const [dx, dy] = humanSwipe(-Math.sign(err) * (ae - 0.4), 0);
      h.right.swipe(dx, dy);
    } else {
      const [dx, dy] = humanSwipe(-err, 0);
      h.right.swipe(dx, dy);
    }
  };
  s = await h.run(brain, {
    maxT: 8,
    onStep: (s) => {
      const e = wrap(target - s.yaw);
      if (e > 0) maxOver = Math.max(maxOver, e);
      if (Math.abs(e) < 0.175) {
        reached ??= s.t - t0;
        stableFrom ??= s.t - t0;
      } else stableFrom = null;
    },
    done: (s) => stableFrom !== null && s.t - t0 - stableFrom >= 0.4 && !h.thumbs.some((th) => th.moving) && h.right.idle,
  });
  const turned = { pitch: s.pitch, y: s.pos[1] };
  if (shotName && SHOTS_ON) await p.shot(shotName);
  // Then drive straight on for 3 s without touching the look, to see what the pitch drift does to depth.
  const before = s;
  s = await h.run((seen) => h.left.set({ x: 0, y: 1 }), { maxT: 3 });
  await h.liftAll();
  log({
    test: 'turn180',
    method,
    seed,
    reached: r2(reached),
    settled: r2(stableFrom),
    overshootDeg: r2((maxOver * 180) / Math.PI),
    swipes: h.right.swipes,
    swipePx: Math.round(h.right.swipePx),
    pitchDrift: r2(turned.pitch - pitch0),
    moved: r2(dist3(pos0, before.pos)),
    dyAfter3sDrive: r2(s.pos[1] - before.pos[1]),
    yawDriftDuringDriveDeg: r2((wrap(s.yaw - before.yaw) * 180) / Math.PI),
    events: p.touch.events - ev0,
  });
}

// ---------------------------------------------------------------- navigation helpers
function steer(seen, goal, { boost = false, ease = 4 } = {}) {
  const dx = goal[0] - seen.pos[0];
  const dz = goal[2] - seen.pos[2];
  const hd = Math.hypot(dx, dz);
  const herr = wrap(Math.atan2(dx, dz) - seen.yaw) + gauss() * 0.04; // > 0: goal is to the left
  const ah = Math.abs(herr);
  let y = ah > 1.3 ? 0.1 : ah > 0.6 ? 0.45 : 1;
  if (hd < ease) y *= clamp(hd / ease, 0.3, 1);
  let x = clamp(-herr * 1.4, -1, 1);
  if (Math.abs(x) < 0.08) x = 0;
  return { intent: { x, y, boost: boost && hd > 6 && ah < 0.3 }, hd, herr };
}

/** Depth with the Up/Down buttons (right thumb), with hysteresis; levels the pitch with a swipe if it is way off. */
function depthButtons(h, seen, goalY, { levelAt = 0.3 } = {}) {
  const r = h.right;
  if (r.mode === 'swipe' || r.mode === 'travel' || r.mode === 'lifting') return;
  if (Math.abs(seen.pitch + 0.1) > levelAt) {
    if (r.mode === 'button') return r.release();
    const [dx, dy] = humanSwipe(0, -0.1 - seen.pitch);
    return r.swipe(dx, dy);
  }
  const want = goalY - seen.pos[1];
  const onFloor = seen.pos[1] < floorH(seen.pos[0], seen.pos[2]) + 0.8;
  const holdingDown = r.holding('down');
  const holdingUp = r.holding('up');
  if (want < -0.6 && !onFloor) return r.hold('down');
  if (want > 0.6) return r.hold('up');
  if ((holdingDown && (want > -0.25 || onFloor)) || (holdingUp && want < 0.25)) r.release();
}

/** Depth by pitch: aims the nose at a point just above the goal, levels out near the sand. */
function depthPitch(h, seen, goal, hd, herr) {
  const r = h.right;
  if (!r.idle) return;
  const floor = floorH(seen.pos[0], seen.pos[2]);
  let want = Math.atan2(goal[1] + 0.5 - seen.pos[1], Math.max(hd, 0.5));
  if (seen.pos[1] - floor < 1.3 && hd > 1.5) want = -0.1;
  want = clamp(want, -1.0, 0.8);
  const dv = want - seen.pitch;
  const dh = Math.abs(herr) > 0.8 ? -herr : 0;
  if (Math.abs(dv) > 0.15 || dh) {
    const [dx, dy] = humanSwipe(dh, dv);
    r.swipe(dx, dy);
  }
}

// ---------------------------------------------------------------- 2. navigation to a coin on the sand
async function freeSpot(p, x, z) {
  return p.page.evaluate(
    ([x, z]) => {
      const g = window.__fishslop;
      const V = g.sub.pos.constructor;
      const pt = new V(x, 0, z);
      for (let k = 0; k < 40; k++) {
        const hit = g.world.colliders.find((c) => Math.hypot(pt.x - c.center.x, pt.z - c.center.z) < c.radius + 0.6);
        if (!hit) break;
        pt.x += 0.5 * Math.sign(pt.x - hit.center.x || 1);
        pt.z += 0.5 * Math.sign(pt.z - hit.center.z || 1);
      }
      return [pt.x, pt.z];
    },
    [x, z],
  );
}

async function navTrial(p, { bearingDeg, depth, boost, seed, shotName }) {
  reseedHuman(seed * 13 + bearingDeg + (boost ? 5 : 0) + (depth === 'pitch' ? 3 : 0));
  const h = new Human(p);
  const start = [-6, 7, 0];
  const yaw = Math.PI / 2; // facing +x
  await reset(p, h, { seed, noMonster: true, subPos: start, yaw, pitch: -0.1 });
  const b = (bearingDeg * Math.PI) / 180; // positive = to the right (+z)
  const horiz = Math.sqrt(15 * 15 - 6.9 * 6.9);
  let [cx, cz] = await freeSpot(p, start[0] + horiz * Math.cos(b), start[2] + horiz * Math.sin(b));
  cx = clamp(cx, -18.8, 18.8);
  cz = clamp(cz, -10.8, 10.8);
  const coin = await p.page.evaluate(
    ([x, z]) => {
      const g = window.__fishslop;
      const V = g.sub.pos.constructor;
      const y = -0.18 + 0.12 * Math.sin(x * 0.33) * Math.cos(z * 0.41) + 0.06 * Math.sin(x * 1.07 + z * 0.73) + 0.25;
      g.world.spawnCoin('silver', new V(x, y + 0.001, z), 15);
      const c = g.world.coins[g.world.coins.length - 1];
      g.tick(1 / 60);
      c.restLeft = 1e9; // measure past the real 12 s lifetime, and report against it
      return c.pos.toArray();
    },
    [cx, cz],
  );
  let s = await p.step(0);
  const t0 = s.t;
  const money0 = s.money;
  const d0 = dist3(s.pos, coin);
  let path = 0;
  let last = s.pos;
  let minD = Infinity;
  let passes = 0;
  let wasClose = false;
  let yawNear = 0;
  let lastYaw = s.yaw;
  let boostT = 0;
  let floorT = 0;
  let maxSpeed = 0;
  let collected = null;
  let shotTaken = false;
  const brain = (seen) => {
    const st = steer(seen, coin, { boost });
    h.left.set(st.intent);
    if (depth === 'buttons') depthButtons(h, seen, coin[1] + 0.6);
    else depthPitch(h, seen, coin, st.hd, st.herr);
  };
  s = await h.run(brain, {
    maxT: 25,
    onStep: (s) => {
      path += dist3(last, s.pos);
      last = s.pos;
      const d = dist3(s.pos, coin);
      const hd = distH(s.pos, coin);
      minD = Math.min(minD, d);
      if (hd < 3) wasClose = true;
      if (wasClose && hd > 4.5) {
        passes++;
        wasClose = false;
      }
      if (hd < 5) yawNear += Math.abs(wrap(s.yaw - lastYaw));
      lastYaw = s.yaw;
      if (s.stick.boost) boostT += 1 / 15;
      if (s.pos[1] < floorH(s.pos[0], s.pos[2]) + 0.7) floorT += 1 / 15;
      maxSpeed = Math.max(maxSpeed, Math.hypot(...s.vel));
      if (s.money > money0 && collected === null) collected = s.t - t0;
    },
    done: (s) => s.money > money0,
  });
  if (shotName && SHOTS_ON) await p.shot(shotName);
  await h.liftAll();
  log({
    test: 'coin15',
    bearingDeg,
    depth,
    boost,
    seed,
    startDist: r2(d0),
    collected: r2(collected),
    within12s: collected !== null && collected <= 12,
    pathLen: r2(path),
    pathRatio: r2(path / d0),
    passesBy: passes,
    yawTurnedNearDeg: Math.round((yawNear * 180) / Math.PI),
    boostTime: r2(boostT),
    maxSpeed: r2(maxSpeed),
    swipes: h.right.swipes,
    stickLandings: h.left.landings,
    finalPitch: r2(s.pitch),
  });
}

// ---------------------------------------------------------------- 5. vertical movement
async function verticalTrials(p, seed) {
  // (a) sink with Down from mid-water to the sand, (b) rise with Up to near the surface
  reseedHuman(seed * 17 + 1);
  let h = new Human(p);
  await reset(p, h, { seed, noMonster: true, subPos: [0, 7, 0], yaw: Math.PI / 2, pitch: -0.1 });
  let s0 = await p.step(0);
  let t0 = s0.t;
  let s = await h.run((seen) => h.right.hold('down'), { maxT: 6, done: (s) => s.pos[1] < floorH(s.pos[0], s.pos[2]) + 0.75 });
  const sinkT = s.t - t0;
  const sinkDrift = distH(s0.pos, s.pos);
  t0 = s.t;
  s0 = s;
  s = await h.run((seen) => h.right.hold('up'), { maxT: 6, done: (s) => s.pos[1] > 14 });
  const riseT = s.t - t0;
  await h.liftAll();
  // (c) sink while driving forward: stick forward + Down held together
  reseedHuman(seed * 17 + 2);
  h = new Human(p);
  await reset(p, h, { seed, noMonster: true, subPos: [-12, 7, 0], yaw: Math.PI / 2, pitch: -0.1 });
  s0 = await p.step(0);
  t0 = s0.t;
  s = await h.run(
    (seen) => {
      h.left.set({ x: 0, y: 1 });
      h.right.hold('down');
    },
    { maxT: 6, done: (s) => s.pos[1] < floorH(s.pos[0], s.pos[2]) + 0.75 },
  );
  const sinkFwdT = s.t - t0;
  const sinkFwdRun = distH(s0.pos, s.pos);
  await h.liftAll();
  // (d) dive by pitch: swipe the nose down, drive, level out over the sand
  reseedHuman(seed * 17 + 3);
  h = new Human(p);
  await reset(p, h, { seed, noMonster: true, subPos: [-12, 7, 0], yaw: Math.PI / 2, pitch: -0.1 });
  s0 = await p.step(0);
  t0 = s0.t;
  let reachedFloor = null;
  let leveled = null;
  let minY = 99;
  s = await h.run(
    (seen) => {
      h.left.set({ x: 0, y: 1 });
      const floor = floorH(seen.pos[0], seen.pos[2]);
      const want = seen.pos[1] - floor > 1.4 ? -0.75 : -0.05;
      if (h.right.idle && Math.abs(want - seen.pitch) > 0.15) {
        const [dx, dy] = humanSwipe(0, want - seen.pitch);
        h.right.swipe(dx, dy);
      }
    },
    {
      maxT: 8,
      onStep: (s) => {
        const above = s.pos[1] - floorH(s.pos[0], s.pos[2]);
        minY = Math.min(minY, above);
        if (above < 1.4) reachedFloor ??= s.t - t0;
        if (reachedFloor !== null && Math.abs(s.pitch + 0.05) < 0.2) leveled ??= s.t - t0;
      },
      done: (s) => leveled !== null && s.t - t0 - leveled > 0.5,
    },
  );
  const pitchRun = distH(s0.pos, s.pos);
  log({
    test: 'vertical',
    seed,
    sinkDown7to0: r2(sinkT),
    sinkDrift: r2(sinkDrift),
    riseUpTo14: r2(riseT),
    sinkWhileDriving: r2(sinkFwdT),
    sinkWhileDrivingRun: r2(sinkFwdRun),
    pitchDiveReach: r2(reachedFloor),
    pitchDiveLeveled: r2(leveled),
    pitchDiveRun: r2(pitchRun),
    pitchDiveSwipes: h.right.swipes,
    pitchDiveMinAbove: r2(minY),
  });
  await h.liftAll();
}

// ---------------------------------------------------------------- 3. feeding: the first 90 s
async function feedRun(p, { variant, seed, shotAt }) {
  reseedHuman(seed * 31 + (variant === 'lazy' ? 1 : 0));
  const h = new Human(p);
  await reset(p, h, { seed });
  const L = layout(p.view);
  let s = await p.step(0);
  const t0 = s.t - 40 / 60;
  let task = null; // {kind: feed|coin|idle, ...}
  const feeds = []; // {fishId, decided, tapped, ate}
  const hungerSeen = new Map();
  let goalT = 0;
  let offDepthT = 0;
  let tiltT = 0;
  let totalT = 0;
  let lastT = s.t;
  let bought = 0;
  let starved = 0;
  let pendingTap = null;
  let shotDone = false;
  const coinsSeen = new Map();
  let expired = 0;
  const brain = (seen, now) => {
    const r = h.right;
    // Shop: keep 3-4 fish when there's money
    if (seen.money >= 100 && seen.fish.length < 4 && r.idle && !pendingTap) {
      r.tap('guppy');
      bought++;
      return;
    }
    // Pick a task
    const sick = seen.fish.filter((f) => f.hunger < 0.5).sort((a, b) => a.hunger - b.hunger);
    const pendingFor = (id) => feeds.some((f) => f.fishId === id && f.ate === null && seen.t - (f.tapped ?? f.decided) < 10);
    const hungry = sick.find((f) => !pendingFor(f.id));
    if (hungry && seen.pellets.length < 3 && (!task || task.kind !== 'feed')) {
      task = { kind: 'feed', fishId: hungry.id, since: seen.t };
      feeds.push({ fishId: hungry.id, decided: seen.t, tapped: null, ate: null, posT: null });
    }
    if (task?.kind === 'feed') {
      const f = seen.fish.find((x) => x.id === task.fishId);
      const rec = feeds[feeds.length - 1];
      if (!f) {
        task = null;
        return;
      }
      const goal = [f.pos[0], f.pos[1] + 2.2, f.pos[2]];
      const st = steer(seen, goal, { ease: 3 });
      const above = st.hd < 1.6 && seen.pos[1] - f.pos[1] > 0.5 && seen.pos[1] - f.pos[1] < 4.5;
      const giveUp = seen.t - task.since > 12;
      if (variant === 'lazy' || above || giveUp) {
        h.left.set(null);
        if (r.mode === 'button' && !r.holding('feed')) r.release();
        else if (r.idle) {
          r.tap('feed');
          rec.tapped = seen.t;
          rec.posT = seen.t - task.since;
          rec.above = above;
          task = null;
        }
        return;
      }
      h.left.set(st.intent);
      depthButtons(h, seen, goal[1]);
      task.goalY = goal[1];
      return;
    }
    // Coins: go scoop the nearest one
    const coin = seen.coins.map((c) => ({ c, d: dist3(seen.pos, c.pos) })).sort((a, b) => a.d - b.d)[0];
    if (coin && coin.d < 30) {
      const goal = coin.c.pos;
      const st = steer(seen, goal, { boost: true });
      h.left.set(st.intent);
      depthButtons(h, seen, goal[1] + 0.6);
      task = { kind: 'coin', goalY: goal[1] + 0.6 };
      return;
    }
    // Nothing to do: drift to mid-water in the middle of the tank
    task = { kind: 'idle', goalY: 6 };
    const st = steer(seen, [0, 6, 0], { ease: 6 });
    h.left.set(st.hd > 4 ? st.intent : null);
    depthButtons(h, seen, 6);
  };
  s = await h.run(brain, {
    maxT: 90 - (s.t - t0),
    every: [0.1, 0.2],
    onStep: (s) => {
      const dt = s.t - lastT;
      lastT = s.t;
      totalT += dt;
      if (Math.abs(s.pitch + 0.1) > 0.3) tiltT += dt;
      if (task && task.goalY !== undefined && task.kind !== 'idle') {
        goalT += dt;
        if (Math.abs(task.goalY - s.pos[1]) > 1.5) offDepthT += dt;
      }
      for (const f of s.fish) {
        const prev = hungerSeen.get(f.id);
        if (prev !== undefined && f.hunger > prev + 0.2) {
          const rec = feeds.find((x) => x.fishId === f.id && x.tapped !== null && x.ate === null);
          if (rec) rec.ate = s.t - rec.tapped;
        }
        hungerSeen.set(f.id, f.hunger);
      }
      for (const c of s.coins) coinsSeen.set(c.pos.map((v) => v.toFixed(0)).join(','), c.restLeft);
      if (shotAt && !shotDone && s.t - t0 > shotAt) shotDone = true;
    },
  });
  if (SHOTS_ON) await p.shot(`feed-${orient}-${variant}-${seed}-end`);
  await h.liftAll();
  const end = s;
  log({
    test: 'feed90',
    variant,
    seed,
    t: r2(end.t - t0),
    fishAlive: end.fish.length,
    starved: end.stats.lost,
    bought,
    money: end.money,
    earned: end.stats.earned,
    feeds: feeds.length,
    tapped: feeds.filter((f) => f.tapped !== null).length,
    tappedAbove: feeds.filter((f) => f.above).length,
    targetAte: feeds.filter((f) => f.ate !== null).length,
    posTime: stats(feeds.map((f) => f.posT)),
    eatDelay: stats(feeds.map((f) => f.ate)),
    minHunger: r2(Math.min(...end.fish.map((f) => f.hunger))),
    offDepthFrac: r2(goalT ? offDepthT / goalT : 0),
    tiltFrac: r2(tiltT / totalT),
    swipes: h.right.swipes,
    taps: h.right.taps,
  });
}

// ---------------------------------------------------------------- 4. combat
function perceive(seen, p, monsterPos, sd = 1) {
  const a = screenAngles(seen, monsterPos);
  if (!a.onScreen) {
    // The HUD pins the monster tag to the screen edge in its direction: a rough heading only.
    const hh = Math.sign(a.h || 1) * Math.min(Math.abs(a.h), a.hfov / 2 + 0.5);
    return { h: hh, v: clamp(a.v, -a.vfov / 2, a.vfov / 2), on: false, true: a };
  }
  const n = (x) => x + gauss() * (0.015 + 0.06 * Math.abs(x)) * sd;
  return { h: n(a.h), v: n(a.v), on: true, true: a };
}

async function combatTrial(p, { strategy, seed, cone, shotName }) {
  reseedHuman(seed * 101 + strategy.length);
  const h = new Human(p, { third: strategy === 'claw' || strategy === 'perfect' });
  await reset(p, h, { seed, cone });
  // Buy a guppy by tapping the shop, then wait a few seconds so the fish spread out.
  await p.touch.apply([{ id: 2, type: 'start', x: p.buttons.guppy.x, y: p.buttons.guppy.y }]);
  await p.touch.apply([{ id: 2, type: 'end' }]);
  await p.step(240);
  const spawnAt = await p.page.evaluate(() => {
    const g = window.__fishslop;
    g.nextMonsterAt = g.playTime;
    g.tick(1 / 60);
    window.__m.shots = [];
    window.__m.fired = 0;
    window.__m.eaten = 0;
    return g.playTime;
  });
  let s = await p.step(0);
  const fish0 = s.fish.length;
  const hp0 = s.m.maxHp;
  let killedAt = null;
  let firstShot = null;
  let onT = 0;
  let allT = 0;
  let errSum = 0;
  let lastT = s.t;
  let holdSince = null;
  let shot = false;
  const fireHold = strategy === 'claw' || strategy === 'perfect' ? h.third : h.right;
  const brain = (seen) => {
    if (!seen.m || !seen.m.alive) {
      h.left.set(null);
      if (fireHold.holding('fire')) fireHold.release();
      return;
    }
    const P = perceive(seen, p, seen.m.pos);
    const err = Math.hypot(P.h, P.v);
    if (strategy === 'noaim') return fireHold.hold('fire');
    if (strategy === 'stickonly') {
      fireHold.hold('fire');
      h.left.set(Math.abs(P.h) > 0.06 ? { x: clamp(P.h * 2.5, -1, 1), y: 0 } : null);
      return;
    }
    if (strategy === 'claw') {
      if (P.on && err < 0.5) fireHold.hold('fire');
      h.left.set(!P.on ? { x: clamp(P.h * 2, -1, 1), y: 0 } : null);
      if (h.right.idle && err > 0.05) {
        const [dx, dy] = humanSwipe(P.h, P.v);
        h.right.swipe(dx, dy);
      }
      return;
    }
    // alt: two thumbs. The left stick tracks the monster sideways the whole time; the right thumb
    // either aims with a swipe or holds Harpoon, never both.
    h.left.set(Math.abs(P.h) > 0.06 ? { x: clamp(P.h * 2.5, -1, 1), y: 0 } : null);
    const r = h.right;
    if (r.holding('fire')) {
      holdSince ??= seen.t;
      const held = seen.t - holdSince;
      if ((Math.abs(P.v) > 0.28 || Math.abs(P.h) > 0.45 || !P.on) && held > 0.3) r.release();
      else if (held > 1.6 && err > 0.12) r.release();
      return;
    }
    holdSince = null;
    if (!r.idle) return;
    if (err > 0.15 || !P.on) {
      const [dx, dy] = humanSwipe(P.h, P.v);
      r.swipe(dx, dy);
    } else r.hold('fire');
  };
  const onStep = (s) => {
    const dt = s.t - lastT;
    lastT = s.t;
    if (s.m && s.m.alive) {
      const a = screenAngles(s, s.m.pos);
      allT += dt;
      if (a.onScreen) onT += dt;
      errSum += a.off * dt;
      if (firstShot === null && s.fired > 0) firstShot = s.t - spawnAt;
      if (!shot && shotName && SHOTS_ON && s.t - spawnAt > 3) shot = true;
    }
    if (s.m && !s.m.alive && killedAt === null) killedAt = s.t - spawnAt;
  };
  const done = (s) => !s.m || !s.m.alive || s.m.leaving;
  if (strategy === 'perfect') {
    // Every 4 frames, an exact drag that puts the crosshair on the monster; a third finger holds Harpoon.
    const L = h.L;
    let fx = L.lookAnchor.x;
    let fy = L.lookAnchor.y;
    await p.touch.apply([
      { id: 3, type: 'start', x: p.buttons.fire.x, y: p.buttons.fire.y },
      { id: 2, type: 'start', x: fx, y: fy },
    ]);
    const t0 = s.t;
    while (!done(s) && s.t - t0 < 40) {
      const a = screenAngles(s, s.m.pos);
      let dx = a.h / RAD_PER_PX;
      let dy = -a.v / RAD_PER_PX;
      if (fx + dx < L.zoneX + 10 || fx + dx > p.view.width - 10 || fy + dy < 60 || fy + dy > L.maxY) {
        await p.touch.apply([{ id: 2, type: 'end' }]);
        fx = L.lookAnchor.x;
        fy = L.lookAnchor.y;
        await p.touch.apply([{ id: 2, type: 'start', x: fx, y: fy }]);
      }
      fx += dx;
      fy += dy;
      if (Math.abs(dx) + Math.abs(dy) > 0.2) await p.touch.apply([{ id: 2, type: 'move', x: fx, y: fy }]);
      s = await p.step(4);
      onStep(s);
      if (shotName && SHOTS_ON && shot === true) {
        shot = 'done';
        await p.shot(shotName);
      }
    }
  } else {
    s = await h.run(brain, {
      maxT: 40,
      onStep: (st) => {
        onStep(st);
      },
      done: (st) => done(st) || (shot === true && shotName),
    });
    if (shot === true && shotName && SHOTS_ON && !done(s)) {
      shot = 'done';
      await p.shot(shotName);
      s = await h.run(brain, { maxT: 40 - (s.t - spawnAt), onStep, done });
    }
  }
  const shots = await p.page.evaluate(() => window.__m.shots);
  await h.liftAll();
  const hits = Math.round((hp0 - Math.max(0, s.m ? s.m.hp : 0)) / 6);
  log({
    test: 'combat',
    strategy,
    cone: cone ?? 0.3,
    seed,
    killed: killedAt !== null,
    ttk: r2(killedAt),
    firstShot: r2(firstShot),
    shotsAlive: shots.length,
    hits,
    hitRate: r2(shots.length ? hits / shots.length : 0),
    fishEaten: s.eaten,
    fish0,
    monsterLeft: !!(s.m && s.m.leaving),
    onScreenFrac: r2(allT ? onT / allT : 0),
    meanOffDeg: r2(allT ? ((errSum / allT) * 180) / Math.PI : 0),
    aimErr: stats(shots),
    within: {
      '0.08': r2(shots.filter((x) => x < 0.08).length / (shots.length || 1)),
      '0.18': r2(shots.filter((x) => x < 0.18).length / (shots.length || 1)),
      '0.3': r2(shots.filter((x) => x < 0.3).length / (shots.length || 1)),
    },
    swipes: h.right.swipes,
    events: p.touch.events,
  });
}

// ---------------------------------------------------------------- main
const { server, browser, base } = await openBrowser();
const wall = Date.now();
try {
  const p = await openPage(browser, base, VIEW);
  // Prime the what-if harpoon with the game's own Bolt class.
  await p.page.evaluate(() => {
    const g = window.__fishslop;
    g.fireCooldown = 0;
    g.fire();
    g.bolts.forEach((b) => g.scene.remove(b.mesh));
    g.bolts = [];
  });
  log({ test: 'setup', fov: (await p.step(0)).fov, buttons: p.buttons, layout: layout(VIEW) });
  if (scenario === 'turn') {
    for (const method of (opt.methods ?? 'stick,look,both').split(','))
      for (const seed of SEEDS) await turnTrial(p, method, seed, seed === SEEDS[0] && method === 'look' ? `turn-${orient}-look` : null);
  } else if (scenario === 'nav') {
    const bearings = (opt.bearings ?? '20,-55,145').split(',').map(Number);
    const depths = (opt.depths ?? 'pitch,buttons').split(',');
    const boosts = (opt.boost ?? '0,1').split(',').map((v) => v === '1');
    for (const seed of SEEDS)
      for (const bearingDeg of bearings)
        for (const depth of depths)
          for (const boost of boosts)
            await navTrial(p, { bearingDeg, depth, boost, seed, shotName: bearingDeg === 145 && boost && depth === 'pitch' && seed === SEEDS[0] ? `nav-${orient}-145-boost-pitch` : null });
  } else if (scenario === 'vertical') {
    for (const seed of SEEDS) await verticalTrials(p, seed);
  } else if (scenario === 'feed') {
    for (const variant of (opt.variants ?? 'careful,lazy').split(','))
      for (const seed of SEEDS) await feedRun(p, { variant, seed });
  } else if (scenario === 'combat') {
    const strategies = (opt.strategies ?? 'perfect,alt,claw,stickonly,noaim').split(',');
    const cones = opt.cones ? opt.cones.split(',').map(Number) : [undefined];
    for (const cone of cones)
      for (const strategy of strategies)
        for (const seed of SEEDS)
          await combatTrial(p, { strategy, seed, cone, shotName: seed === SEEDS[0] && cone === undefined && (strategy === 'alt' || strategy === 'perfect') ? `combat-${orient}-${strategy}` : null });
  }
  if (p.errors.length) log({ test: 'errors', errors: p.errors });
  await p.ctx.close();
} finally {
  await browser.close();
  await server.close();
  console.error(`wall ${((Date.now() - wall) / 1000).toFixed(0)}s`);
}
process.exit(0);
