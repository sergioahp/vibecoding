import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4396, strictPort: false }, logLevel: 'warn' });
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
    for (const t of ['pointercancel', 'contextmenu', 'lostpointercapture'])
      window.addEventListener(t, (e) => window.__ev.push(`${t}#${e.pointerId ?? '-'}@${e.target.id || e.target.tagName}`), true);
  });
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  await G(() => window.__fishslop.advance(0.05));

  // Long press: stick held still
  await touch('touchStart', [[1, 60, 150]]);
  await touch('touchMove', [[1, 60, 100]]);
  await page.waitForTimeout(1500);
  log('LP stick held still 1.5s', JSON.stringify(await G(() => ({ ev: window.__ev.splice(0), y: window.__fishslop.input.stick.y }))));
  await touch('touchEnd', [[1, 60, 100]]);
  // Long press: harpoon held still
  const [fx, fy] = await centre('#t-fire');
  await touch('touchStart', [[2, fx, fy]]);
  await page.waitForTimeout(1500);
  log('LP fire held still 1.5s', JSON.stringify(await G(() => ({ ev: window.__ev.splice(0), keys: [...window.__fishslop.input.keys] }))));
  await touch('touchEnd', [[2, fx, fy]]);
  log('LP fire released', JSON.stringify(await G(() => ({ ev: window.__ev.splice(0), keys: [...window.__fishslop.input.keys] }))));

  // Clean D2: look drag across game over, then Play again
  await G(() => window.__fishslop.advance(1 / 60));
  await touch('touchStart', [[3, 500, 150]]);
  await G(() => window.__fishslop.finish(false));
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[3, 500 - i * 20, 150]]);
  await touch('touchEnd', [[3, 400, 150]]);
  log('D2 pending look after run ended', await G(() => [window.__fishslop.input.lookX, window.__fishslop.input.lookY]));
  await page.tap('#restart');
  await page.locator('#hud').waitFor({ state: 'visible' });
  const d = await G(() => window.__fishslop.advance(1 / 60));
  log('D2 yaw on first frame of new run', d.yaw.toFixed(3), '(reset yaw is', Math.PI.toFixed(3) + ')');
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
