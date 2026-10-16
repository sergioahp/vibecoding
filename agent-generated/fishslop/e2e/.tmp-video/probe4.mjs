import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { botConfig, installBot } from '../player.mjs';
const OUT = '/tmp/claude-0/-home-user-vibecoding/f94979c2-849f-5ace-bede-2ab99257daf9/scratchpad/video/';
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4177, strictPort: false }, logLevel: 'warn' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 5000);
  log('goto');
  page.on('load', () => log('LOAD')); await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  log('loaded', await page.evaluate(() => performance.now()));
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  log('fonts', await page.evaluate(() => performance.now()));
  await page.evaluate(() => {
    const g = window.__fishslop;
    const r = g.renderer;
    const real = r.render.bind(r);
    window.__rec = { renders: 0, draw(finish) { real(g.scene, g.camera); if (finish) r.getContext().finish(); } };
    r.render = () => { window.__rec.renders++; };
  });
  for (let i = 0; i < 3; i++) { await page.clock.runFor(33); let a = Date.now(); await page.evaluate(() => window.__rec.draw(true)); log('title render+finish', Date.now() - a); a = Date.now(); await page.screenshot({ type: 'jpeg', quality: 85 }); log('shot', Date.now() - a); }
  await page.screenshot({ path: OUT + 'probe-title.jpg', type: 'jpeg', quality: 85 });
  await page.click('#start');
  log('started', await page.evaluate(() => performance.now()));
  await page.evaluate(installBot, botConfig('sensible'));
  const s0 = await page.evaluate(() => [window.__fishslop.playTime, performance.now()]);
  let tot = { think: 0, run: 0, draw: 0, shot: 0 };
  let prevMs = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    let a = Date.now();
    if (i % 3 === 0) await page.evaluate(() => window.__bot.think());
    tot.think += Date.now() - a; a = Date.now();
    const to = Math.round(((i + 1) * 1000) / 30);
    await page.clock.runFor(to - prevMs); prevMs = to;
    tot.run += Date.now() - a; a = Date.now();
    await page.evaluate((f) => window.__rec.draw(f), i % 2 === 0);
    tot.draw += Date.now() - a; a = Date.now();
    const buf = await page.screenshot({ type: 'jpeg', quality: 85 });
    tot.shot += Date.now() - a;
    if (i % 10 === 9) { log('frame', i, JSON.stringify(tot), buf.length); tot = { think: 0, run: 0, draw: 0, shot: 0 }; }
  }
  log('playTime', s0, '->', await page.evaluate(() => [window.__fishslop.playTime, window.__rec.renders, performance.now(), document.querySelectorAll('.toast').length]));
  await page.screenshot({ path: OUT + 'probe-play.jpg', type: 'jpeg', quality: 85 });
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
