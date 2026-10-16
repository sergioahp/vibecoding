// Is fov updated 300 ms after setViewportSize when frames are slow?
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const BURN = Number(process.argv[2] ?? 0);
const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4191, strictPort: false }, logLevel: 'warn' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await page.evaluate(() => (window.__fishslop.manualClock = true));
  await page.tap('#start');
  await page.locator('#hud').waitFor({ state: 'visible' });
  if (BURN) await page.evaluate((ms) => { const burn = () => { const t = performance.now(); while (performance.now() - t < ms); requestAnimationFrame(burn); }; requestAnimationFrame(burn); }, BURN);
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) r(n / ((performance.now() - t0) / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log(`burn ${BURN}ms, fps ~ ${fps.toFixed(1)}`);
  let fail = 0;
  for (let i = 0; i < 5; i++) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const fov = await page.evaluate(() => window.__fishslop.debugState().fov);
    if (!(fov > 80)) fail++;
    console.log(`trial ${i}: fov after 300ms = ${fov.toFixed(1)}`);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => window.__fishslop.debugState().fov < 63, null, { timeout: 30000 });
  }
  console.log(`fov>80 failed ${fail}/5`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
