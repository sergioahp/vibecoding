// Plays the built game in headless Chromium: loads it, starts a run, swims, buys a fish,
// feeds a hungry fish and checks it actually eats. Screenshots land in e2e/screenshots/.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));
// The HUD redraws once per rendered frame, and CI renders a frame every second or two. Game time
// is frozen while the test waits (manualClock), so a long wait for a frame changes nothing else.
const FRAME_WAIT = 30_000;

// In-process server: nothing to orphan when the test ends. strictPort off so a dev server
// already on 4173 doesn't make the test silently hit stale files.
const server = await preview({
  root: fileURLToPath(new URL('..', import.meta.url)),
  preview: { port: 4173, strictPort: false },
  logLevel: 'warn',
});
const BASE = server.resolvedUrls.local[0];

const errors = [];
let browser;
try {
  await mkdir(OUT, { recursive: true });
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g(oogleapis|static)/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    if (!/fonts\.g(oogleapis|static)/.test(r.url())) errors.push(`request failed: ${r.url()}`);
  });

  const state = () => page.evaluate(() => window.__fishslop.debugState());
  // Software rendering in CI runs at a few FPS, so drive the simulation in fixed steps instead of waiting on frames.
  const advance = (seconds) => page.evaluate((s) => window.__fishslop.advance(s), seconds);
  const step = async (name, fn) => {
    const t = Date.now();
    await fn();
    console.log(`ok  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  };
  const advanceUntil = async (what, pred, maxSeconds, each = () => {}) => {
    let s;
    for (let t = 0; t < maxSeconds; t++) {
      await each(t);
      s = await advance(1);
      if (pred(s)) return s;
    }
    throw new Error(`no ${what} after ${maxSeconds}s of game time; last state ${JSON.stringify(s)}`);
  };

  await step('title screen renders', async () => {
    await page.goto(BASE);
    await page.locator('#overlay-title').waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    const s = await state();
    if (s.state !== 'title') throw new Error(`expected title state, got ${s.state}`);
    await page.screenshot({ path: `${OUT}01-title.png` });
    await page.evaluate(() => (window.__fishslop.manualClock = true));
  });

  await step('a run starts', async () => {
    await page.click('#start');
    await page.locator('#hud').waitFor({ state: 'visible', timeout: 5000 });
    const s = await state();
    if (s.state !== 'playing') throw new Error(`expected playing state, got ${s.state}`);
    if (s.fish !== 2) throw new Error(`expected 2 starting fish, got ${s.fish}`);
  });

  await step('the sub swims forward', async () => {
    const before = (await state()).sub;
    await page.keyboard.down('KeyW');
    const after = (await advance(1.2)).sub;
    await page.keyboard.up('KeyW');
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    if (moved < 3) throw new Error(`sub only moved ${moved.toFixed(2)} in 1.2s`);
  });

  await step('buying a guppy spends coins and adds a fish', async () => {
    await page.keyboard.press('Digit1');
    const s = await state();
    if (s.fish !== 3) throw new Error(`expected 3 fish, got ${s.fish}`);
    if (s.money !== 50) throw new Error(`expected 50 coins left, got ${s.money}`);
  });

  await step('pellet cap is enforced', async () => {
    for (let i = 0; i < 6; i++) await page.keyboard.press('KeyF');
    const s = await state();
    if (s.pellets !== 3) throw new Error(`expected 3 pellets (the cap), got ${s.pellets}`);
    await advance(0.5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}02-feeding.png` });
  });

  await step('uneaten pellets expire instead of piling up', async () => {
    // Sink ~6s + rest 10s: pellets linger long enough to be found, then never pile up.
    const mid = await advance(5);
    if (mid.pellets + mid.totalGrowth < 3) throw new Error(`pellets vanished too early: ${JSON.stringify(mid)}`);
    await advanceUntil('empty tank floor', (s) => s.pellets === 0, 20);
  });

  await step('a hungry fish finds food and eats it', async () => {
    await advanceUntil('hungry fish', (s) => s.minHunger < 0.55, 40);
    const before = (await state()).totalGrowth;
    for (let i = 0; i < 3; i++) await page.keyboard.press('KeyF');
    await advanceUntil('fish eating', (s) => s.totalGrowth > before, 30);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}03-ate.png` });
  });

  await step('keeping fish fed until the first monster arrives', async () => {
    const s = await advanceUntil('monster', (s) => s.monster, 120, async (t) => {
      if (t % 4 === 0) for (let i = 0; i < 3; i++) await page.keyboard.press('KeyF');
    });
    if (s.fish < 1) throw new Error('every fish died before the monster came');
    await page.locator('#alert').waitFor({ state: 'visible', timeout: FRAME_WAIT });
    await advance(1.5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}04-monster.png` });
  });

  await step('pausing shows the pause screen', async () => {
    const s = await state();
    if (s.pointerLock) await page.evaluate(() => document.exitPointerLock());
    else await page.keyboard.press('KeyP');
    await page.locator('#overlay-pause').waitFor({ state: 'visible', timeout: 3000 });
    await page.screenshot({ path: `${OUT}05-paused.png` });
  });

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('smoke test passed');
} catch (e) {
  console.error(`FAIL ${e.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
// Belt and braces: never let a stray handle keep CI waiting after the verdict.
process.exit(process.exitCode ?? 0);
