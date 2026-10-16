// Records a gameplay highlight reel: the scripted player from e2e/player.mjs plays a whole run
// and the interesting parts are captured frame by frame into an H.264 MP4, plus a poster frame.
//
//   npm run build && npm run video -- <out.mp4> [poster.jpg] [--quick]
//
// The reel is the title screen, the opening, the first monster fight, wave 5, and the final egg
// piece through the win screen. Segment boundaries come from game events (monster spawned or slain,
// purchases, egg level, state), and the stretches in between are played fast without rendering.
// --quick caps every segment at 3 s to check the pipeline in a few minutes.
//
// Clock: there's no GPU, and SwiftShader renders only a few frames a second, so real-time capture
// is out. Playwright's fake clock is installed and paused before the page loads, so
// requestAnimationFrame, setTimeout and performance.now move only when page.clock.runFor() says.
// The game runs with manualClock on: each video frame is advance(1/30), the same fixed 60 Hz steps
// the bot uses (with think() every third frame, i.e. every 0.1 s of game time), then runFor(1/30 s)
// lets the game's own frame loop update the HUD and fires timers such as the 2.6 s toast lifetime.
// CSS animations run on the real clock, so the recorder pauses them and sets their time from the
// fake clock instead. The game's own renders are skipped and the recorder draws once per frame
// right before the screenshot, since each render costs real time. JPEG frames stay in memory and
// are piped to ffmpeg (image2pipe) at the end, so they never touch disk and a file over the size
// budget can be re-encoded at a higher CRF without rendering again.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { botConfig, installBot } from '../e2e/player.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const QUICK = args.includes('--quick');
const OUT = positional[0];
if (!OUT?.endsWith('.mp4')) {
  console.error('usage: npm run video -- <out.mp4> [poster.jpg] [--quick]');
  process.exit(2);
}
const POSTER = positional[1] ?? OUT.replace(/\.mp4$/, '.jpg');

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;
const FADE = 6; // frames of fade through black at each cut
const LATER_WAVE = 5;
const CRF = 30;
const MAX_BYTES = 12_000_000;
const cfg = botConfig('sensible');
const FINAL_EGG_PRICE = cfg.prices.egg[2];

const started = Date.now();
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const log = (msg) => console.log(`[${clock((Date.now() - started) / 1000)}] ${msg}`);

// Runs inside the page, after installBot. Adds the caption and fade layers, takes over drawing,
// and holds back the third egg piece until the recorder lets the bot buy it on camera.
function installRecorder() {
  const g = window.__fishslop;
  g.manualClock = true;
  const renderer = g.renderer;
  const draw = renderer.render.bind(renderer);
  renderer.render = () => {};

  const style = document.createElement('style');
  style.textContent = `
    #rec-caption { position: fixed; left: 16px; bottom: 8px; display: flex; align-items: baseline; gap: 8px;
      padding: 6px 12px; border-radius: 6px; background: var(--panel); border: 1px solid var(--panel-edge);
      backdrop-filter: blur(4px); font: 700 13px/1.2 var(--ui); letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--ink); white-space: nowrap; pointer-events: none; }
    #rec-caption .sep { color: var(--ink-dim); }
    #rec-caption .time { font: 400 15px/1.2 var(--display); letter-spacing: 0; color: var(--gold); }
    #rec-fade { position: fixed; inset: 0; background: #021018; opacity: 0; pointer-events: none; }`;
  document.head.append(style);
  const caption = document.createElement('div');
  caption.id = 'rec-caption';
  caption.hidden = true;
  caption.innerHTML = '<span class="name"></span><span class="sep">·</span><span class="time"></span>';
  const fade = document.createElement('div');
  fade.id = 'rec-fade';
  document.body.append(caption, fade);

  let holdEgg = true;
  const buy = g.buy.bind(g);
  g.buy = (id) => {
    if (id === 'egg' && holdEgg && g.econ.levels.egg === 2) return;
    buy(id);
  };

  // Each animation's clock starts when it's first seen, so blinking and fading follow game time.
  const born = new WeakMap();
  function syncAnimations() {
    const now = performance.now();
    for (const a of document.getAnimations()) {
      if (!born.has(a)) {
        born.set(a, now);
        a.pause();
      }
      const t = now - born.get(a);
      if (t >= (a.effect?.getComputedTiming().endTime ?? Infinity)) a.finish();
      else a.currentTime = t;
    }
  }

  // Toast lifetimes in video frames, from first seen to fading out: a check on the clock.
  let frame = 0;
  const toastFrames = [];
  function watchToasts() {
    for (const el of document.querySelectorAll('.toast')) {
      if (!el.dataset.born) el.dataset.born = String(frame);
      if (el.classList.contains('out') && !el.dataset.out) {
        el.dataset.out = String(frame);
        toastFrames.push(frame - Number(el.dataset.born));
      }
    }
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const info = () => {
    const m = g.world.monster;
    let monster = null;
    if (m) {
      const v = m.pos.clone().project(g.camera);
      monster = { alive: m.alive, hp: m.hp / m.maxHp, x: v.x, y: v.y, z: v.z, dist: g.sub.pos.distanceTo(m.pos) };
    }
    return {
      state: g.state,
      t: g.playTime,
      wave: g.wave,
      nextMonsterAt: g.nextMonsterAt,
      monster,
      bolts: g.bolts.length,
      treasure: g.world.coins.some((c) => c.kind === 'treasure'),
      money: g.econ.money,
      eggs: g.econ.levels.egg,
      buys: window.__bot.stats.buys.length,
    };
  };

  window.__rec = {
    info,
    toastFrames,
    releaseEgg: () => (holdEgg = false),
    /** Drops toasts and coin pop-ups left over from a skipped stretch. */
    cut: () => g.hud.clearWorld(),
    /** Game time for one video frame. */
    step(think) {
      if (think && g.state === 'playing') window.__bot.think();
      g.advance(1 / 30);
    },
    /** Everything after the page clock has run: caption, fade, animations, then one render. */
    draw(name, opacity) {
      caption.hidden = !name;
      if (name) {
        caption.querySelector('.name').textContent = name;
        caption.querySelector('.time').textContent = fmt(g.playTime);
      }
      fade.style.opacity = String(opacity);
      watchToasts();
      syncAnimations();
      draw(g.scene, g.camera);
      frame++;
      return info();
    },
  };
}

const server = await preview({
  root: fileURLToPath(new URL('..', import.meta.url)),
  preview: { port: 4178, strictPort: false },
  logLevel: 'warn',
});
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const frames = [];
const segments = [];
const checks = { rates: [], duplicates: 0 };
let poster = null;
let posterScore = 0;
let pageMs = 0;

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  // Under SwiftShader on a busy machine one frame can take many seconds.
  page.setDefaultTimeout(600_000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g(oogleapis|static)/.test(m.text())) errors.push(m.text());
  });
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  const fonts = await Promise.race([
    page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === 'loaded' && /Bungee|Chakra Petch/.test(f.family)).length >= 2;
    }),
    new Promise((r) => setTimeout(() => r(false), 30_000)),
  ]);
  if (!fonts) console.warn('warning: the Google fonts did not load, so the HUD uses fallback fonts');
  await page.evaluate(installBot, cfg);
  await page.evaluate(installRecorder);
  const info = () => page.evaluate(() => window.__rec.info());

  /**
   * Records one segment. decide(info, i) runs after each frame and returns how many more seconds
   * to record once the segment should end (at least the fade), or null to keep going.
   */
  async function record(name, label, decide) {
    const startInfo = await info();
    const seg = { name: label, video: frames.length / FPS, game: startInfo.t, frames: 0 };
    segments.push(seg);
    log(`${label}: video ${clock(seg.video)}, game ${clock(seg.game)}`);
    let end = Infinity;
    const cap = QUICK ? 3 * FPS : 90 * FPS;
    const played = [];
    let prev = frames.at(-1);
    for (let i = 0; i < Math.min(end, cap); i++) {
      const t0 = Date.now();
      await page.evaluate((think) => window.__rec.step(think), i % 3 === 0);
      const n = frames.length;
      await page.clock.runFor(Math.round(((n + 1) * 1000) / FPS) - Math.round((n * 1000) / FPS));
      const stop = Math.min(end, cap);
      const opacity = Math.max(0, 1 - i / FADE, 1 - (stop - 1 - i) / FADE);
      const s = await page.evaluate(([nm, o]) => window.__rec.draw(nm, o), [name, opacity]);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 90, caret: 'initial' });
      pageMs += Date.now() - t0;
      if (prev && jpg.equals(prev)) checks.duplicates++;
      frames.push(jpg);
      prev = jpg;
      if (s.state === 'playing') played.push(s.t);
      if (label === 'First monster') {
        const m = s.monster;
        // Poster: the monster alive, big and near the middle of the frame, with a bolt in flight.
        const score =
          m && m.alive && m.z < 1 && Math.abs(m.x) < 0.6 && Math.abs(m.y) < 0.6
            ? (s.bolts ? 1 : 0.4) * (1 - Math.hypot(m.x, m.y)) * Math.min(1, 9 / m.dist) * (m.hp < 0.9 ? 1 : 0.6)
            : 0;
        if (score > posterScore) {
          posterScore = score;
          poster = jpg;
        }
      }
      if (end === Infinity) {
        const tail = await decide(s, i);
        if (tail !== null) end = i + 1 + Math.max(FADE, Math.round(tail * FPS));
        // A segment that never ends on its own (a stuck run) still fades out at the cap.
        else if (i + 1 + FADE >= cap) end = cap;
      }
      if (frames.length % 150 === 0) {
        const rate = pageMs / frames.length / 1000;
        log(`${frames.length} frames (${clock(frames.length / FPS)} of video), ${rate.toFixed(2)} s per frame`);
      }
    }
    seg.frames = Math.min(end, cap);
    if (played.length > FPS) checks.rates.push([label, ((played.at(-1) - played[0]) / (played.length - 1)) * FPS]);
    return info();
  }

  /** Plays fast, without rendering, until pred(info) holds. */
  async function skipUntil(pred, what) {
    for (;;) {
      const s = await info();
      if (pred(s)) return page.evaluate(() => (window.__rec.cut(), window.__rec.info()));
      if (s.state !== 'playing') throw new Error(`the run ended (${s.state}) at ${clock(s.t)} while waiting for ${what}`);
      await page.evaluate(() => window.__bot.run(1));
    }
  }
  const skipTo = async (t) => {
    const s = await info();
    if (t > s.t) await page.evaluate((d) => window.__bot.run(d), t - s.t);
    await page.evaluate(() => window.__rec.cut());
  };

  // A monster segment ends two seconds after the monster is gone and its treasure picked up.
  const fightOver = (wave) => {
    let seen = false;
    return (s) => {
      if (s.monster && s.wave === wave) seen = true;
      return seen && !s.monster?.alive && !s.treasure ? 2 : null;
    };
  };

  await record(null, 'Title', (s, i) => (i === 0 ? 3 : null));

  await page.evaluate(() => window.__fishslop.start());
  // The first seconds: the starting toast and the first guppy bought.
  await record('Opening', 'Opening', (s, i) => (i === 0 ? 5 : null));
  // Then from when the fish first get hungry until the second guppy, at most to 0:47.
  await skipTo(12);
  await record('Opening', 'Opening, feeding', (s) => {
    if (s.buys >= 2) return 2.5;
    return s.t >= 46.5 ? 0.5 : null;
  });

  // From a few seconds before the sonar warning (8 s before contact).
  let s = await info();
  await skipTo(s.nextMonsterAt - 11);
  s = await record('First monster', 'First monster', fightOver(1));

  s = await skipUntil((x) => x.wave >= LATER_WAVE - 1 && !x.monster, `wave ${LATER_WAVE - 1} to end`);
  await skipTo(s.nextMonsterAt - 11);
  await record(`Wave ${LATER_WAVE}`, `Wave ${LATER_WAVE}`, fightOver(LATER_WAVE));

  // The bot would buy the last piece the moment it can; it waits four seconds so it happens on camera.
  await skipUntil((x) => x.eggs === 2 && x.money >= FINAL_EGG_PRICE, 'money for the third egg piece');
  const last = await record('Third egg piece', 'Third egg piece', async (x, i) => {
    if (i === (QUICK ? 30 : 4 * FPS)) await page.evaluate(() => window.__rec.releaseEgg());
    return x.state === 'won' ? 7 : null;
  });
  if (last.state !== 'won') errors.push(`the final segment ended without a win (${last.state})`);
  checks.toasts = await page.evaluate(() => window.__rec.toastFrames);
} finally {
  await browser.close();
  await server.close();
}

const renderSeconds = (Date.now() - started) / 1000;
log(`rendered ${frames.length} frames in ${clock(renderSeconds)}`);

/** Pipes the JPEG frames through ffmpeg into an H.264 MP4 and returns its size in bytes. */
async function encode(crf) {
  const ff = spawn(
    'ffmpeg',
    [
      ['-hide_banner', '-loglevel', 'error', '-y'],
      ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0'],
      // Chromium's JPEGs are full-range BT.601; players expect limited-range BT.709 for HD.
      ['-vf', 'scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p'],
      ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf)],
      ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'],
      ['-movflags', '+faststart', '-an', OUT],
    ].flat(),
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = once(ff, 'close');
  for (const f of frames) if (!ff.stdin.write(f)) await once(ff.stdin, 'drain');
  ff.stdin.end();
  const [code] = await done;
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
  return (await stat(OUT)).size;
}

let crf = CRF;
let size = await encode(crf);
for (let tries = 0; size > MAX_BYTES && tries < 4; tries++) {
  // Bitrate roughly halves every 6 CRF steps.
  const step = Math.max(1, Math.ceil(6 * Math.log2(size / MAX_BYTES)));
  log(`${(size / 1e6).toFixed(1)} MB is over the budget at CRF ${crf}, trying CRF ${crf + step}`);
  crf += step;
  size = await encode(crf);
}
if (poster) await writeFile(POSTER, poster);

const duration = frames.length / FPS;
console.log(`\n${OUT}: ${(size / 1e6).toFixed(2)} MB, ${clock(duration)}, ${WIDTH}x${HEIGHT} at ${FPS} fps, CRF ${crf}`);
console.log(`poster: ${poster ? POSTER : 'none (no good monster frame)'}`);
console.log('segments:');
for (const g of segments) console.log(`  ${clock(g.video).padStart(6)}  ${g.name} (game ${clock(g.game)}, ${(g.frames / FPS).toFixed(1)} s)`);
const toastSeconds = checks.toasts?.length ? checks.toasts.reduce((a, b) => a + b, 0) / checks.toasts.length / FPS : null;
console.log(
  `checks: game seconds per 30 frames ${checks.rates.map(([n, r]) => `${n} ${r.toFixed(3)}`).join(', ')}; ` +
    `identical consecutive frames ${checks.duplicates}; ` +
    `toasts shown ${toastSeconds === null ? 'n/a' : `${toastSeconds.toFixed(2)} s on average (${checks.toasts.length})`}`,
);
console.log(`render time ${clock(renderSeconds)} (${(pageMs / frames.length / 1000).toFixed(2)} s per frame), total ${clock((Date.now() - started) / 1000)}`);
if (errors.length) {
  console.error(`browser errors:\n${errors.join('\n')}`);
  process.exitCode = 1;
}
if (size > MAX_BYTES) {
  console.error(`the video is still ${(size / 1e6).toFixed(1)} MB, over the ${MAX_BYTES / 1e6} MB budget`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
