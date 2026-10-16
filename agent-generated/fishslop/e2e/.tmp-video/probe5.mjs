import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const server = await preview({ root: fileURLToPath(new URL('../..', import.meta.url)), preview: { port: 4177, strictPort: false }, logLevel: 'warn' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => log('pageerror', e.message));
  page.on('console', (m) => log('console', m.text()));
  page.on('request', (r) => log('req', r.url().slice(0, 90)));
  page.on('requestfinished', (r) => log('done', r.url().slice(0, 90)));
  page.on('requestfailed', (r) => log('fail', r.url().slice(0, 90)));
  page.on('load', () => log('LOAD'));
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 5000);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'commit' });
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    log(await page.evaluate(() => [document.readyState, typeof window.__fishslop, performance.now()]).catch((e) => e.message));
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
