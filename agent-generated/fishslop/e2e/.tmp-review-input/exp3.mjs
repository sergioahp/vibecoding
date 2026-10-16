import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4393, strictPort: false }, logLevel: 'warn' });
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
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click'])
      window.addEventListener(t, (e) => window.__ev.push(`${t}#${e.pointerId ?? '-'}@${e.target.id || e.target.className || e.target.tagName}`), true);
  });
  const dump = async (label) => { log(label, JSON.stringify(await G(() => ({ ev: window.__ev.splice(0), state: window.__fishslop.state, fish: window.__fishslop.debugState().fish, stickY: +window.__fishslop.input.stick.y.toFixed(2) })))); };
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await G(() => (window.__fishslop.econ.money = 5000));
  await dump('start');
  const [gx, gy] = await centre('.shop-item[data-id="guppy"]');

  // A: stick held, second finger taps the shop and lifts, stick still held
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 120]]);
  await touch('touchStart', [[1, 60, 120], [2, gx, gy]]);
  await touch('touchEnd', [[2, gx, gy]]);
  await touch('touchMove', [[1, 60, 118]]);
  await page.waitForTimeout(400);
  await dump('A shop tap while steering');
  await touch('touchEnd', []);
  await dump('A all up');
  await touch('touchStart', [[2, gx, gy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  await dump('A control lone tap');

  // A2: Resume while stick finger held
  const [px, py] = await centre('#t-pause');
  await touch('touchStart', [[3, px, py]]);
  await touch('touchEnd', []);
  const [rx, ry] = await centre('#resume');
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchStart', [[1, 60, 150], [2, rx, ry]]);
  await touch('touchEnd', [[2, rx, ry]]);
  await page.waitForTimeout(400);
  await dump('A2 resume tap while a finger rests on the canvas');
  await touch('touchEnd', []);

  // A3: stick held, second finger on the look side, while also tapping shop with a third
  await touch('touchStart', [[2, rx, ry]]);
  await touch('touchEnd', []);
  await dump('A3 resumed');
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 120]]);
  await touch('touchStart', [[1, 60, 120], [4, gx, gy]]);
  await touch('touchMove', [[1, 60, 112], [4, gx, gy]]);
  await touch('touchEnd', [[4, gx, gy]]);
  await touch('touchMove', [[1, 60, 110]]);
  await page.waitForTimeout(400);
  await dump('A3 shop tap with stick moving');
  await touch('touchEnd', []);
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
