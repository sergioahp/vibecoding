import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4392, strictPort: false }, logLevel: 'warn' });
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
  const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await page.goto(BASE);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await G(() => {
    window.__fishslop.manualClock = true;
    window.__ev = [];
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'mousedown', 'lostpointercapture'])
      window.addEventListener(t, (e) => window.__ev.push(`${t}#${e.pointerId ?? '-'}:${e.pointerType ?? ''}@${e.target.id || e.target.className || e.target.tagName}`), true);
  });
  const dump = async (label) => { log(label, JSON.stringify(await G(() => ({ ev: window.__ev.splice(0), stick: { ...window.__fishslop.input.stick }, keys: [...window.__fishslop.input.keys] })))); };
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await G(() => (window.__fishslop.econ.money = 5000));
  await dump('start');
  const [gx, gy] = await centre('.shop-item[data-id="guppy"]');
  const [fx, fy] = await centre('#t-feed');
  const [ux, uy] = await centre('#t-up');

  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 120]]);
  await dump('1 stick down+move');
  await touch('touchStart', [[1, 60, 120], [2, gx, gy]]);
  await dump('2 second finger on shop');
  await touch('touchMove', [[1, 60, 110], [2, gx, gy]]);
  await dump('3 stick moves again');
  await touch('touchEnd', [[1, 60, 110]]);
  await dump('4 shop finger lifts');
  await touch('touchMove', [[1, 60, 100]]);
  await dump('5 stick moves after');
  await touch('touchEnd', []);
  await dump('6 all up');

  // second finger on canvas (look) instead of shop
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 120]]);
  await touch('touchStart', [[1, 60, 120], [2, 500, 150]]);
  await touch('touchMove', [[1, 60, 110], [2, 480, 150]]);
  await dump('7 stick + look');
  await touch('touchEnd', []);
  await dump('8 all up');

  // second finger on t-feed while stick held
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 120]]);
  await touch('touchStart', [[1, 60, 120], [2, fx, fy]]);
  await touch('touchEnd', [[1, 60, 120]]);
  await touch('touchMove', [[1, 60, 110]]);
  await dump('9 stick + feed tap');
  await touch('touchEnd', []);
  log('pellets', (await G(() => window.__fishslop.debugState())).pellets);
  await dump('10');
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
