import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4394, strictPort: false }, logLevel: 'warn' });
const BASE = server.resolvedUrls.local[0];
let browser;
const log = (...a) => console.log(...a);
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  // A touchscreen laptop: fine pointer, but touch available.
  const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, f) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: f.map(([id, x, y]) => ({ id, x, y })) });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const st = () => G(() => { const g = window.__fishslop; const d = g.debugState(); return { state: d.state, touch: d.touch, lock: d.pointerLock, fallback: d.fallback, pellets: d.pellets, y: +d.sub[1].toFixed(2), yaw: +d.yaw.toFixed(3), keys: [...g.input.keys], pause: !document.getElementById('overlay-pause').hidden }; });
  const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await page.goto(BASE);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await G(() => (window.__fishslop.manualClock = true));
  log('coarse?', await G(() => matchMedia('(pointer: coarse)').matches), await st());

  // Start by tapping (touch mode).
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  log('C0 tapped start', await st());

  // C: mouse click on the visible on-screen Up button while in touch mode
  const [ux, uy] = await centre('#t-up');
  await page.mouse.move(ux, uy);
  await page.mouse.down();
  log('C1 mouse down on t-up', await st());
  await page.mouse.up();
  await page.waitForTimeout(100);
  log('C2 mouse up', await st());
  // resume with the mouse
  const [rx, ry] = await centre('#resume');
  await page.mouse.click(rx, ry);
  await page.waitForTimeout(500);
  log('C3 clicked resume', await st());
  // Try once more if lock was refused (fallback)
  if ((await st()).state === 'paused') { await page.mouse.click(rx, ry); await page.waitForTimeout(300); log('C3b clicked resume again', await st()); }
  const y0 = (await st()).y;
  await G(() => window.__fishslop.advance(1));
  log('C4 after 1s with no input, sub y', y0, '->', (await st()).y, (await st()).keys);
  await G(() => window.__fishslop.input.keys.clear());
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
