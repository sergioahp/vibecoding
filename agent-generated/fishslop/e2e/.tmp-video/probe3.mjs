import { chromium } from 'playwright';
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.clock.install();
  await page.setContent('<div id=x>hi</div><script>window.n=0;function f(){n++;requestAnimationFrame(f)};requestAnimationFrame(f)</script>');
  const now = () => page.evaluate(() => [Math.round(performance.now()), n]);
  log('start', await now());
  await new Promise((r) => setTimeout(r, 2000));
  log('after 2s real', await now());
  await page.clock.runFor(100);
  log('after runFor 100', await now());
  await new Promise((r) => setTimeout(r, 2000));
  log('after 2s real', await now());
  await page.screenshot();
  log('after shot', await now());
  await page.clock.runFor(100);
  log('after runFor 100', await now());
  await page.clock.runFor(100);
  log('after runFor 100', await now());
  await page.evaluate(() => globalThis.__pwClock.controller.runFor(100));
  log('after direct runFor 100', await now());
  await new Promise((r) => setTimeout(r, 2000));
  log('after 2s real', await now());
} finally {
  await browser.close();
}
