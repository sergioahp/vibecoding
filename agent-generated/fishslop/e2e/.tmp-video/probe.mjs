import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { botConfig, installBot } from '../player.mjs';
const OUT = '/tmp/claude-0/-home-user-vibecoding/f94979c2-849f-5ace-bede-2ab99257daf9/scratchpad/video/';
const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4177, strictPort: false }, logLevel: 'warn' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => console.log('console', m.type(), m.text()));
  page.on('requestfailed', (r) => console.log('reqfailed', r.url(), r.failure()?.errorText));
  await page.clock.install();
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`); });
  console.log('fonts', fonts);
  console.log('t0', await page.evaluate(() => [performance.now(), window.__fishslop.state]));
  let t = Date.now();
  for (let i = 0; i < 5; i++) { await page.clock.runFor(33); }
  console.log('5 runFor ms', Date.now() - t);
  t = Date.now();
  await page.screenshot({ path: OUT + 'probe-title.jpg', type: 'jpeg', quality: 85 });
  console.log('shot ms', Date.now() - t);
  await page.click('#start');
  await page.evaluate(installBot, botConfig('sensible'));
  const s0 = await page.evaluate(() => window.__fishslop.playTime);
  t = Date.now();
  for (let i = 0; i < 30; i++) {
    if (i % 3 === 0) await page.evaluate(() => window.__bot.think());
    await page.clock.runFor(i % 3 === 2 ? 34 : 33);
    await page.screenshot({ type: 'jpeg', quality: 85 });
  }
  console.log('30 frames ms', Date.now() - t, 'playTime', s0, '->', await page.evaluate(() => window.__fishslop.playTime));
  await page.screenshot({ path: OUT + 'probe-play.jpg', type: 'jpeg', quality: 85 });
  console.log(await page.evaluate(() => ({ dpr: devicePixelRatio, pr: window.__fishslop.pixelRatio, toasts: document.querySelectorAll('.toast').length, anims: document.getAnimations().length })));
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
