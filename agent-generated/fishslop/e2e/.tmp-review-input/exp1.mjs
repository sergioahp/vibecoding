import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4391, strictPort: false }, logLevel: 'warn' });
const BASE = server.resolvedUrls.local[0];
let browser;
const log = (...a) => console.log(...a);
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 300 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, f) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: f.map(([id, x, y]) => ({ id, x, y })) });
  const G = (fn, arg) => page.evaluate(fn, arg);
  const st = () => G(() => { const g = window.__fishslop; return { ...g.debugState(), keys: [...g.input.keys], stick: { ...g.input.stick }, money: g.econ.money }; });
  const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await page.goto(BASE);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await G(() => {
    window.__fishslop.manualClock = true;
    window.__clicks = [];
    document.addEventListener('click', (e) => window.__clicks.push(e.target.closest('button')?.id || e.target.closest('button')?.dataset.id || e.target.tagName), true);
  });
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await G(() => (window.__fishslop.econ.money = 5000));

  // A: shop tap with a second finger while the stick finger is down
  const [gx, gy] = await centre('.shop-item[data-id="guppy"]');
  log('guppy btn centre', gx, gy);
  let s0 = await st();
  await G(() => (window.__clicks = []));
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 120]]);
  await touch('touchStart', [[1, 60, 120], [2, gx, gy]]);
  await touch('touchEnd', [[1, 60, 120]]);
  await page.waitForTimeout(150);
  let s1 = await st();
  log('A multi-touch shop tap: fish', s0.fish, '->', s1.fish, 'clicks', await G(() => window.__clicks), 'stick', s1.stick);
  await touch('touchEnd', []);
  // control: single finger
  await G(() => (window.__clicks = []));
  await touch('touchStart', [[2, gx, gy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  let s2 = await st();
  log('A control single tap: fish', s1.fish, '->', s2.fish, 'clicks', await G(() => window.__clicks));

  // A2: Resume tap with a second finger while the stick finger is down
  const [px, py] = await centre('#t-pause');
  await touch('touchStart', [[3, px, py]]);
  await touch('touchEnd', []);
  log('A2 after pause tap state', (await st()).state);
  const [rx, ry] = await centre('#resume');
  await G(() => (window.__clicks = []));
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchStart', [[1, 60, 150], [2, rx, ry]]);
  await touch('touchEnd', [[1, 60, 150]]);
  await page.waitForTimeout(150);
  log('A2 multi-touch resume tap: state', (await st()).state, 'clicks', await G(() => window.__clicks));
  await touch('touchEnd', []);
  await touch('touchStart', [[2, rx, ry]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  log('A2 control single resume tap: state', (await st()).state);

  // B: hold t-up, run ends, then lift
  const [ux, uy] = await centre('#t-up');
  await touch('touchStart', [[4, ux, uy]]);
  log('B holding up keys', (await st()).keys);
  await G(() => window.__fishslop.finish(false));
  await page.waitForTimeout(100);
  await touch('touchEnd', []);
  await page.waitForTimeout(100);
  log('B after finish + lift: state', (await st()).state, 'keys', (await st()).keys);

  // B2: stick held when run ends, lift after
  await page.tap('#restart');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await touch('touchStart', [[5, 60, 150]]);
  await touch('touchMove', [[5, 60, 100]]);
  await G(() => window.__fishslop.finish(false));
  await touch('touchMove', [[5, 60, 90]]);
  log('B2 stick during end overlay', (await st()).stick);
  await touch('touchEnd', []);
  log('B2 stick after lift', (await st()).stick);

  // D: look drag accumulates while paused / over
  await page.tap('#restart');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await G(() => window.__fishslop.advance(0.1));
  const yaw0 = (await st()).yaw;
  await touch('touchStart', [[6, 500, 150]]);
  await G(() => window.__fishslop.pause());
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[6, 500 - i * 20, 150]]);
  await touch('touchEnd', []);
  log('D pending look while paused', await G(() => [window.__fishslop.input.lookX, window.__fishslop.input.lookY]));
  await G(() => window.__fishslop.resume());
  const after = await G(() => window.__fishslop.advance(1 / 60));
  log('D yaw jump on first resumed frame', (after.yaw - yaw0).toFixed(3), 'rad');

  // E: pointercancel on stick
  await touch('touchStart', [[7, 60, 150]]);
  await touch('touchMove', [[7, 60, 100]]);
  log('E stick before cancel', (await st()).stick);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  log('E stick after cancel', (await st()).stick, 'stickId', await G(() => window.__fishslop && null));
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
