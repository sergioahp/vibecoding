import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4395, strictPort: false }, logLevel: 'warn' });
const BASE = server.resolvedUrls.local[0];
let browser;
const log = (...a) => console.log(...a);
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, f) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: f.map(([id, x, y]) => ({ id, x, y })) });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const st = async (l) => log(l, JSON.stringify(await G(() => { const g = window.__fishslop; const d = g.debugState(); return { state: d.state, touch: d.touch, lock: d.pointerLock, pellets: d.pellets, yaw: +d.yaw.toFixed(3), look: [g.input.lookX, g.input.lookY], pauseOverlay: !document.getElementById('overlay-pause').hidden }; })));
  const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await page.goto(BASE);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await G(() => (window.__fishslop.manualClock = true));
  // Start with the mouse: switches to mouse mode, takes pointer lock
  await page.mouse.click(...(await centre('#start')));
  await page.waitForTimeout(400);
  await st('M0 mouse start');
  // Tap the canvas: switches to touch, lock still held
  await touch('touchStart', [[1, 700, 200]]);
  await touch('touchEnd', [[1, 700, 200]]);
  await st('M1 tapped canvas');
  // Tap the on-screen pause button
  const [px, py] = await centre('#t-pause');
  await touch('touchStart', [[2, px, py]]);
  await touch('touchEnd', [[2, px, py]]);
  await st('M2 tapped pause');
  // Back to the mouse: click (lands on the locked canvas, not on Resume)
  await page.mouse.click(450, 210);
  await page.waitForTimeout(200);
  await st('M3 mouse click while paused + locked');
  await page.mouse.click(...(await centre('#resume')));
  await page.waitForTimeout(200);
  await st('M4 mouse click "on" Resume while locked');
  await page.keyboard.press('KeyP');
  await st('M5 P key');
  await G(() => document.exitPointerLock());
  await page.waitForTimeout(200);
  await st('M6 lock released (Esc)');
  await page.mouse.click(...(await centre('#resume')));
  await page.waitForTimeout(400);
  await st('M7 clicked Resume');

  // D2: look drag spans the end of a run, then Play again
  await touch('touchStart', [[3, 700, 200]]);
  await st('D2a touch look start');
  await G(() => window.__fishslop.finish(false));
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[3, 700 - i * 20, 200]]);
  await touch('touchEnd', [[3, 540, 200]]);
  await st('D2b after drag on end screen');
  await page.tap('#restart');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await G(() => window.__fishslop.advance(1 / 60));
  await st('D2c first frame of new run (fresh yaw is 3.142)');
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
