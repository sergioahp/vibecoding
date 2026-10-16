// Renders the link-preview image and the app icons from the real game, into public/.
//
//   npm run build && npm run images
//
// og.jpg (1200×630) is what WhatsApp, Slack, Discord and X show under a shared link. It stages a
// moment in a real run (the sub harpooning a monster among guppies and coins), then adds the logo.
// The icons are rasterized from public/icon.svg. Rerun this after changing the look of the game.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = `${ROOT}public/`;

const server = await preview({ root: ROOT, preview: { port: 4176, strictPort: false }, logLevel: 'warn' });
const BASE = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await page.evaluate(() => (window.__fishslop.manualClock = true));
  await page.click('#start');

  // Private fields are only private to TypeScript; the staging reaches into the running game.
  await page.evaluate(() => {
    const g = window.__fishslop;
    const V = g.sub.pos.constructor;
    g.world.fish.forEach((f) => f.dispose(g.scene));
    g.world.fish = [];
    const fish = [
      [-5.5, 6.5, -1, 30],
      [-8, 9.5, -5, 14],
      [5.5, 5.2, 0.5, 8],
      [7.5, 10.5, -6, 25],
      [-2.5, 4.2, 1.5, 3],
      [-10, 7, -3, 0],
      [9.5, 7.5, -2, 4],
      [1, 11.5, -8, 16],
    ];
    for (const [x, y, z, growth] of fish) g.spawnFish(new V(x, y, z), growth);
    for (const [kind, x, y, z] of [
      ['gold', 0.6, 6.2, 2.6],
      ['gem', 3.4, 7.6, 1.2],
      ['silver', -1.4, 7.9, 1.8],
      ['gold', 5.6, 5.4, -0.5],
    ])
      g.world.spawnCoin(kind, new V(x, y, z));
    g.nextMonsterAt = g.playTime;
  });
  // Lets the fish pick a heading and the monster grow to full size.
  await page.evaluate(() => window.__fishslop.advance(2.5));
  await page.evaluate(() => {
    const g = window.__fishslop;
    const m = g.world.monster;
    const s = g.sub;
    s.pos.set(-1.2, 7.4, 6.5);
    s.vel.set(0, 0, 0);
    m.pos.set(3.4, 8.7, 0.6);
    const d = m.pos.clone().sub(s.pos);
    s.yaw = Math.atan2(d.x, d.z) + 0.05;
    s.pitch = Math.asin(d.y / d.length()) - 0.06;
    m.model.root.lookAt(s.pos);
    m.hp = m.maxHp * 0.55;
    g.world.coins.forEach((c) => (c.restLeft = 99));
    // Two bolts already in flight, then a short step to put them between the sub and the monster.
    g.fireCooldown = 0;
    g.fire();
    g.advance(0.12);
    g.fireCooldown = 0;
    g.fire();
    g.advance(0.06);
    m.pos.set(3.4, 8.7, 0.6);
    m.model.root.lookAt(s.pos);
    g.updateCamera(5);
    // Pan left so the sub and monster sit right of centre, clear of the logo.
    const right = s.right().multiplyScalar(-2.4);
    g.camera.position.add(right);
    g.camera.lookAt(g.lookAt.clone().add(right));
    document.getElementById('hud').hidden = true;
  });
  await page.waitForTimeout(2500);
  // An error mid-frame can leave a half-drawn or stale scene on the canvas, so don't ship it.
  if (errors.length) throw new Error(`the game threw while staging the shot:\n${errors.join('\n')}`);
  const scene = await page.screenshot({ type: 'png' });

  // The card: the render with the logo laid over it, in the game's own fonts.
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<!doctype html>
    <link href="https://fonts.googleapis.com/css2?family=Bungee&family=Chakra+Petch:wght@600;700&display=block" rel="stylesheet">
    <style>
      html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
      body { background: url(data:image/png;base64,${scene.toString('base64')}) center / cover; font-family: 'Chakra Petch', sans-serif; }
      .shade { position: absolute; inset: 0; background: linear-gradient(100deg, rgba(2, 18, 28, 0.82) 0%, rgba(2, 18, 28, 0.55) 34%, rgba(2, 18, 28, 0) 58%); }
      .text { position: absolute; left: 64px; top: 70px; }
      h1 { margin: 0; font: 400 112px/0.95 'Bungee', sans-serif; color: #ffc83d; text-shadow: 0 7px 0 #b06a00, 0 16px 34px rgba(0, 0, 0, 0.55); }
      p { margin: 26px 0 0; max-width: 470px; font-size: 31px; line-height: 1.3; font-weight: 600; color: #e6f7ff; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6); }
      .play { display: inline-block; margin-top: 30px; padding: 12px 22px; border-radius: 8px; background: rgba(4, 24, 36, 0.8);
        border: 2px solid rgba(95, 242, 255, 0.5); color: #5ff2ff; font-size: 24px; font-weight: 700; letter-spacing: 0.02em; }
    </style>
    <div class="shade"></div>
    <div class="text">
      <h1>FISHSLOP</h1>
      <p>Feed the guppies, grab the coins, harpoon the monster.</p>
      <div class="play">Play free in your browser · Juega gratis</div>
    </div>`);
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: `${PUBLIC}og.jpg`, type: 'jpeg', quality: 84 });

  // App icons: full-bleed squares, since Android and iOS round the corners themselves.
  const svg = (await readFile(`${PUBLIC}icon.svg`, 'utf8')).replace('rx="14"', 'rx="0"');
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await writeFile(`${PUBLIC}${name}`, await p.screenshot({ type: 'png', omitBackground: true }));
    await p.close();
  }
  console.log('wrote public/og.jpg, icon-192.png, icon-512.png, apple-touch-icon.png');
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
