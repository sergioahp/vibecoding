// Plays the built game as a Spanish-speaking phone would: touch screen, landscape then portrait,
// es-MX browser language. Then checks the language switch on a desktop browser set to English.
// Touches go through Chromium's touch emulation, so they arrive as real pointer events.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));

const server = await preview({
  root: fileURLToPath(new URL('..', import.meta.url)),
  preview: { port: 4174, strictPort: false },
  logLevel: 'warn',
});
const BASE = server.resolvedUrls.local[0];

const errors = [];
let browser;
try {
  await mkdir(OUT, { recursive: true });
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.g(oogleapis|static)/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
  };
  const step = async (name, fn) => {
    const t = Date.now();
    await fn();
    console.log(`ok  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  };
  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  // A landscape phone (iPhone 14 size) with Spanish as the browser language.
  const phone = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    locale: 'es-MX',
  });
  const page = await phone.newPage();
  watch(page);
  const cdp = await phone.newCDPSession(page);
  // Each finger is [id, x, y]. touchStart and touchMove list every finger that is down; touchEnd
  // lists the fingers that lift, and an empty touchEnd lifts them all.
  const touch = (type, fingers) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers.map(([id, x, y]) => ({ id, x, y })) });
  // Fixed touch points must land on the 3D scene, not on a button or the shop, or the step tests the wrong thing.
  const onScene = async (...points) => {
    for (const [x, y] of points) {
      const id = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [x, y]);
      expect(id === 'scene', `touch point (${x}, ${y}) lands on #${id}, not on the scene`);
    }
  };
  const state = () => page.evaluate(() => window.__fishslop.debugState());
  const advance = (s) => page.evaluate((s) => window.__fishslop.advance(s), s);
  const centre = async (sel) => {
    const b = await page.locator(sel).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const text = (sel) => page.locator(sel).innerText();

  await step('a Spanish browser gets the game in Spanish', async () => {
    await page.goto(BASE);
    await page.locator('#overlay-title').waitFor({ state: 'visible' });
    await page.evaluate(() => (window.__fishslop.manualClock = true));
    expect((await page.evaluate(() => document.documentElement.lang)) === 'es', 'html lang is not es');
    expect((await text('#start')) === '¡AL AGUA!' || (await text('#start')) === '¡Al agua!', `start button reads ${await text('#start')}`);
    expect((await text('#lang')) === 'English', 'the language button should offer English');
  });

  await step('a phone gets touch controls and touch wording', async () => {
    expect(await page.evaluate(() => document.body.classList.contains('touch')), 'body is not in touch mode');
    await page.locator('.touch-help').waitFor({ state: 'visible' });
    const feedHow = await page.locator('[data-i18n="howFeed"]').innerText();
    expect(feedHow.startsWith('Toca Comida'), `feed instructions are not the touch version: ${feedHow}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}mobile-01-title-es.png` });
  });

  await step('held upright, the title fits the width and the start button can be reached', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await page.locator('#overlay-title .card').boundingBox();
    expect(card.x >= 0 && card.x + card.width <= 390, 'the title card is wider than the phone');
    await page.locator('#start').scrollIntoViewIfNeeded();
    const start = await page.locator('#start').boundingBox();
    expect(start.y >= 0 && start.y + start.height <= 844, `the start button is out of reach at y=${start.y}`);
    await page.screenshot({ path: `${OUT}mobile-01b-title-portrait.png` });
    await page.setViewportSize({ width: 844, height: 390 });
  });

  await step('tapping start plays without pointer lock', async () => {
    await page.tap('#start');
    await page.locator('#hud').waitFor({ state: 'visible', timeout: 5000 });
    const s = await state();
    expect(s.state === 'playing', `expected playing, got ${s.state}`);
    expect(s.touch && !s.pointerLock, `expected touch play without pointer lock: ${JSON.stringify(s)}`);
    await page.locator('#t-fire').waitFor({ state: 'visible' });
    expect(!(await page.locator('.hints').isVisible()), 'keyboard hints should be hidden on touch');
  });

  await step('the left thumb drives the sub forward', async () => {
    await onScene([130, 260], [130, 200], [190, 260], [130, 160], [640, 160], [540, 160]);
    const before = (await state()).sub;
    await touch('touchStart', [[1, 130, 260]]);
    await touch('touchMove', [[1, 130, 200]]);
    const after = (await advance(1.2)).sub;
    await touch('touchEnd', []);
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    expect(moved > 3, `sub only moved ${moved.toFixed(2)} in 1.2s`);
  });

  await step('pushing the stick sideways turns, and past the ring boosts', async () => {
    const yaw0 = (await state()).yaw;
    await touch('touchStart', [[1, 130, 260]]);
    await touch('touchMove', [[1, 190, 260]]);
    const yaw1 = (await advance(0.5)).yaw;
    expect(yaw1 < yaw0 - 0.5, `stick right should turn right: yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);
    const booster = await page.evaluate(() => window.__fishslop.input.stick.boost);
    expect(!booster, 'boost should be off inside the ring');
    await touch('touchMove', [[1, 130, 160]]);
    expect(await page.evaluate(() => window.__fishslop.input.stick.boost), 'dragging past the ring should boost');
    await touch('touchEnd', []);
    expect(await page.evaluate(() => window.__fishslop.input.stick.y === 0), 'stick should recentre on release');
  });

  await step('the right thumb looks around while the left one drives', async () => {
    const s0 = await state();
    await touch('touchStart', [[1, 130, 260]]);
    await touch('touchStart', [[1, 130, 260], [2, 640, 160]]);
    await touch('touchMove', [[1, 130, 205], [2, 540, 160]]);
    const s1 = await advance(0.6);
    await touch('touchEnd', [[1, 130, 205]]);
    await touch('touchEnd', []);
    expect(s1.yaw > s0.yaw + 0.3, `dragging left should look left: yaw ${s0.yaw.toFixed(2)} -> ${s1.yaw.toFixed(2)}`);
    const moved = Math.hypot(s1.sub[0] - s0.sub[0], s1.sub[2] - s0.sub[2]);
    expect(moved > 1, `the sub should keep moving while looking, moved ${moved.toFixed(2)}`);
  });

  await step('the feed button drops a pellet', async () => {
    await page.tap('#t-feed');
    const s = await state();
    expect(s.pellets === 1, `expected 1 pellet, got ${s.pellets}`);
  });

  await step('holding the harpoon button keeps firing', async () => {
    const [x, y] = await centre('#t-fire');
    await touch('touchStart', [[3, x, y]]);
    const held = await advance(0.6);
    await touch('touchEnd', []);
    expect(held.bolts >= 2, `expected repeated bolts while held, got ${held.bolts}`);
    await advance(3);
    const after = await advance(0.6);
    expect(after.bolts === 0, `bolts kept firing after release: ${after.bolts}`);
  });

  await step('the up button rises', async () => {
    const [x, y] = await centre('#t-up');
    const y0 = (await state()).sub[1];
    await touch('touchStart', [[4, x, y]]);
    const y1 = (await advance(1)).sub[1];
    await touch('touchEnd', []);
    expect(y1 > y0 + 1, `sub rose only ${(y1 - y0).toFixed(2)}`);
  });

  await step('tapping the shop buys a guppy', async () => {
    await page.tap('.shop-item[data-id="guppy"]');
    const s = await state();
    expect(s.fish === 3 && s.money === 50, `expected 3 fish and 50 coins: ${JSON.stringify(s)}`);
    expect((await page.locator('.shop-item[data-id="food"] .short').innerText()) === 'Comida+', 'shop is not in Spanish');
    await advance(0.4);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}mobile-02-play-landscape.png` });
  });

  await step('the shop and Resume still answer while a thumb rests on the stick', async () => {
    // Browsers don't turn a tap into a click while another finger is down, so these act on the lift.
    await page.evaluate(() => (window.__fishslop.econ.money += 100));
    const before = await state();
    const [gx, gy] = await centre('.shop-item[data-id="guppy"]');
    await touch('touchStart', [[1, 130, 260]]);
    await touch('touchStart', [[1, 130, 260], [2, gx, gy]]);
    await touch('touchEnd', [[2, gx, gy]]);
    const bought = await state();
    expect(bought.fish === before.fish + 1, `a shop tap with the stick held bought nothing: fish ${before.fish} -> ${bought.fish}`);
    const [px, py] = await centre('#t-pause');
    await touch('touchStart', [[1, 130, 260], [3, px, py]]);
    await touch('touchEnd', [[3, px, py]]);
    await page.locator('#overlay-pause').waitFor({ state: 'visible', timeout: 3000 });
    const [rx, ry] = await centre('#resume');
    await touch('touchStart', [[1, 130, 260], [4, rx, ry]]);
    await touch('touchEnd', [[4, rx, ry]]);
    await touch('touchEnd', []);
    const resumed = await state();
    expect(resumed.state === 'playing', `Resume with a finger resting on the screen left the game ${resumed.state}`);
  });

  await step('dragging to look while paused does not swing the view on Resume', async () => {
    const yaw0 = (await state()).yaw;
    await touch('touchStart', [[5, 640, 160]]);
    const [px, py] = await centre('#t-pause');
    await touch('touchStart', [[5, 640, 160], [6, px, py]]);
    await touch('touchEnd', [[6, px, py]]);
    await touch('touchMove', [[5, 440, 160]]);
    const [rx, ry] = await centre('#resume');
    await touch('touchStart', [[5, 440, 160], [7, rx, ry]]);
    await touch('touchEnd', [[7, rx, ry]]);
    await touch('touchEnd', []);
    const yaw1 = (await advance(0.1)).yaw;
    expect(Math.abs(yaw1 - yaw0) < 0.05, `the view swung ${(yaw1 - yaw0).toFixed(2)} rad from a drag made while paused`);
  });

  await step('the pause button pauses and resume continues', async () => {
    await page.tap('#t-pause');
    await page.locator('#overlay-pause').waitFor({ state: 'visible', timeout: 3000 });
    const body = await page.locator('[data-i18n="pausedBody"]').innerText();
    expect(body === 'Puedes seguir comprando con los botones de abajo.', `pause text: ${body}`);
    await page.tap('#resume');
    expect((await state()).state === 'playing', 'resume did not continue the run');
  });

  await step('portrait widens the view and moves the controls above the shop', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The resize event fires with the next rendered frame, which CI takes a second or two to draw.
    await page
      .waitForFunction(() => window.__fishslop.debugState().fov > 80, null, { timeout: 30_000, polling: 100 })
      .catch(async () => expect(false, `portrait fov should widen, got ${(await state()).fov.toFixed(1)}`));
    const fire = await page.locator('#t-fire').boundingBox();
    const shop = await page.locator('#shop').boundingBox();
    expect(fire.y + fire.height <= shop.y, 'the harpoon button overlaps the shop');
    await advance(0.2);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}mobile-03-play-portrait.png` });
  });

  await step('held upright, the thumbs still drive, look, feed and fire', async () => {
    await onScene([100, 600], [100, 540], [300, 300], [230, 300]);
    const s0 = await state();
    await touch('touchStart', [[1, 100, 600]]);
    await touch('touchStart', [[1, 100, 600], [2, 300, 300]]);
    await touch('touchMove', [[1, 100, 540], [2, 230, 300]]);
    const s1 = await advance(1);
    await touch('touchEnd', [[1, 100, 540]]);
    await touch('touchEnd', []);
    const moved = Math.hypot(s1.sub[0] - s0.sub[0], s1.sub[1] - s0.sub[1], s1.sub[2] - s0.sub[2]);
    expect(moved > 2, `portrait stick moved the sub only ${moved.toFixed(2)}`);
    expect(s1.yaw > s0.yaw + 0.2, 'portrait look drag did not turn the view');
    await advance(20);
    const before = (await state()).pellets;
    await page.tap('#t-feed');
    expect((await state()).pellets === before + 1, 'the feed button did nothing in portrait');
    const [x, y] = await centre('#t-fire');
    await touch('touchStart', [[3, x, y]]);
    const firing = await advance(0.3);
    await touch('touchEnd', []);
    expect(firing.bolts >= 1, 'the harpoon button did nothing in portrait');
  });

  // Software rendering is slow; a second page rendering alongside would halve both.
  await phone.close();

  // An English desktop: the default stays English, the button switches, and the choice sticks.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
  const dpage = await desk.newPage();
  watch(dpage);
  await step('an English browser gets English, and the switch remembers Spanish', async () => {
    await dpage.goto(BASE);
    await dpage.locator('#overlay-title').waitFor({ state: 'visible' });
    expect((await dpage.locator('#start').innerText()).toLowerCase() === 'dive in', 'start button is not English');
    expect(!(await dpage.evaluate(() => document.body.classList.contains('touch'))), 'desktop should not be in touch mode');
    await dpage.click('#lang');
    expect((await dpage.evaluate(() => document.documentElement.lang)) === 'es', 'switch did not change html lang');
    expect((await dpage.locator('[data-i18n="howFeed"]').innerText()).startsWith('Suelta bolitas con clic'), 'desktop Spanish should mention the click');
    await dpage.reload();
    await dpage.locator('#overlay-title').waitFor({ state: 'visible' });
    expect((await dpage.locator('#start').innerText()).toLowerCase() === '¡al agua!', 'the Spanish choice was not remembered');
    await dpage.goto(`${BASE}?lang=en`);
    expect((await dpage.locator('#start').innerText()).toLowerCase() === 'dive in', '?lang=en should win over the saved choice');
  });

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log('mobile test passed');
} catch (e) {
  console.error(`FAIL ${e.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
