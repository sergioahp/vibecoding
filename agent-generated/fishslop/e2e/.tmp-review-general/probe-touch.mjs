// Probes whether CDP touchMove is handled before the next page.evaluate when frames are slow.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const BURN = Number(process.argv[2] ?? 0); // ms of busy work per frame, to emulate a slow renderer
const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4190, strictPort: false }, logLevel: 'warn' });
const BASE = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, f) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: f.map(([id, x, y]) => ({ id, x, y })) });
  await page.goto(BASE);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await page.evaluate(() => (window.__fishslop.manualClock = true));
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  if (BURN) await page.evaluate((ms) => { const burn = () => { const t = performance.now(); while (performance.now() - t < ms); requestAnimationFrame(burn); }; requestAnimationFrame(burn); }, BURN);
  // measure fps
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) r(n / ((performance.now() - t0) / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log(`fps ~ ${fps.toFixed(1)}`);
  const el = await page.evaluate(() => { const e = document.elementFromPoint(130, 260); return e.id || e.className || e.tagName; });
  console.log('element at (130,260):', el);
  let miss = 0, boostMiss = 0;
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    await touch('touchStart', [[1, 130, 260]]);
    const t1 = Date.now();
    await touch('touchMove', [[1, 130, 200]]);
    const t2 = Date.now();
    const y = await page.evaluate(() => window.__fishslop.input.stick.y);
    await touch('touchMove', [[1, 130, 160]]);
    const b = await page.evaluate(() => window.__fishslop.input.stick.boost);
    await touch('touchEnd', []);
    if (!(y > 0.5)) miss++;
    if (!b) boostMiss++;
    console.log(`iter ${i}: start ${t1 - t0}ms move ${t2 - t1}ms stick.y=${y.toFixed(2)} boost=${b}`);
  }
  console.log(`stick misses ${miss}/6, boost misses ${boostMiss}/6`);
  // resize timing
  const t0 = Date.now();
  await page.setViewportSize({ width: 390, height: 844 });
  const fov0 = await page.evaluate(() => window.__fishslop.debugState().fov);
  await page.waitForFunction(() => window.__fishslop.debugState().fov > 80, null, { timeout: 20000 });
  console.log(`fov right after setViewportSize: ${fov0.toFixed(1)}; >80 after ${Date.now() - t0}ms`);
  // tap -> click race
  await page.tap('#t-pause');
  await page.locator('#overlay-pause').waitFor({ state: 'visible' });
  await page.tap('#resume');
  console.log('state right after tap #resume:', await page.evaluate(() => window.__fishslop.state));
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
