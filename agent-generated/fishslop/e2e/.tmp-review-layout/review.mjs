// Throwaway layout review. Usage: node review.mjs <vp,vp,...> <es,en>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const SCRATCH = '/tmp/claude-0/-home-user-vibecoding/f94979c2-849f-5ace-bede-2ab99257daf9/scratchpad';
const OUT = `${SCRATCH}/layout-review/`;
const FONTS = `${SCRATCH}/fonts/`;

const VIEWPORTS = {
  se_p: { w: 375, h: 667, touch: true },
  se_l: { w: 667, h: 375, touch: true },
  i14_p: { w: 390, h: 844, touch: true },
  i14_l: { w: 844, h: 390, touch: true },
  px7_p: { w: 412, h: 915, touch: true },
  px7_l: { w: 915, h: 412, touch: true },
  and_p: { w: 360, h: 640, touch: true },
  and_l: { w: 640, h: 360, touch: true },
  ipad_p: { w: 768, h: 1024, touch: true },
  ipad_l: { w: 1024, h: 768, touch: true },
  d1024: { w: 1024, h: 768, touch: false },
  d1366: { w: 1366, h: 768, touch: false },
  d1920: { w: 1920, h: 1080, touch: false },
};

const vps = (process.argv[2] ?? 'se_l').split(',');
const langs = (process.argv[3] ?? 'es').split(',');
const statesArg = (process.argv[4] ?? 'title,toast,monster,edge,pause,end').split(',');

await mkdir(`${OUT}metrics`, { recursive: true });
const fontCss = await readFile(`${FONTS}fonts.css`, 'utf8');

const server = await preview({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  preview: { port: 4191, strictPort: false },
  logLevel: 'warn',
});
const BASE = server.resolvedUrls.local[0];

// ---------- in-page measurement helpers (serialised into the page) ----------
const HELPERS = () => {
  const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) });
  const vis = (el) => el && el.checkVisibility({ visibilityProperty: true }) && el.getBoundingClientRect().width > 0.5 && el.getBoundingClientRect().height > 0.5;
  const textRect = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  };
  const overlapList = (shapes) => {
    const out = [];
    const keys = Object.keys(shapes);
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = shapes[keys[i]];
        const b = shapes[keys[j]];
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix <= 0 || iy <= 0) continue;
        let depth;
        const c = (s) => ({ x: s.r.left + s.r.width / 2, y: s.r.top + s.r.height / 2, rad: s.r.width / 2 });
        if (a.circle && b.circle) {
          const ca = c(a), cb = c(b);
          depth = ca.rad + cb.rad - Math.hypot(ca.x - cb.x, ca.y - cb.y);
        } else if (a.circle || b.circle) {
          const cc = c(a.circle ? a : b);
          const q = (a.circle ? b : a).r;
          const px = Math.max(q.left, Math.min(cc.x, q.right));
          const py = Math.max(q.top, Math.min(cc.y, q.bottom));
          depth = cc.rad - Math.hypot(cc.x - px, cc.y - py);
        } else depth = Math.min(ix, iy);
        if (depth > 0.5) out.push(`${keys[i]} x ${keys[j]}: box ${Math.round(ix)}x${Math.round(iy)}, depth ${Math.round(depth)}px`);
      }
    return out;
  };
  window.__rv = { round, vis, textRect, overlapList };
  // Render only on demand: the game loop re-reads g.frame each time it schedules itself.
  const g = window.__fishslop;
  const orig = g.frame;
  window.__renderOK = 0;
  g.frame = (now) => {
    if (window.__renderOK > 0) {
      window.__renderOK--;
      orig(now);
    } else requestAnimationFrame(g.frame);
  };
  // Keep toasts on screen until the script clears them.
  const st = window.setTimeout;
  window.setTimeout = (fn, ms, ...a) => (ms === 2600 || ms === 3200 ? 0 : st(fn, ms, ...a));
};

const measureHud = () => {
  const { round, vis, textRect, overlapList } = window.__rv;
  const W = innerWidth, H = innerHeight;
  const sels = ['#t-fire', '#t-feed', '#t-up', '#t-down', '#t-pause', '#stick', '#shop', '.gauges', '.goals', '#alert', '#toasts', '.hints', '#crosshair', '.monster-tag', '#overlay-pause .card'];
  const out = { W, H, els: {}, overlaps: [], offscreen: [], trunc: [], small: [], tbtn: {}, shop: {}, toasts: [] };
  const shapes = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    shapes[s] = { r, circle: getComputedStyle(el).borderRadius === '50%' };
    out.els[s] = round(r);
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.offscreen.push(`${s} ${JSON.stringify(round(r))}`);
  }
  out.overlaps = overlapList(shapes);
  const mt = document.querySelector('.monster-tag');
  if (vis(mt)) out.monsterEdge = mt.classList.contains('edge');
  const ch = document.getElementById('crosshair');
  if (vis(ch)) {
    const r = ch.getBoundingClientRect();
    out.crosshairOffset = [Math.round(r.x + r.width / 2 - W / 2), Math.round(r.y + r.height / 2 - H / 2)];
  }
  for (const t of document.querySelectorAll('.toast')) {
    const r = t.getBoundingClientRect();
    out.toasts.push({ text: t.textContent, ...round(r) });
  }
  const alert = document.getElementById('alert');
  if (vis(alert)) out.alert = { text: alert.textContent, ...round(alert.getBoundingClientRect()) };
  for (const b of document.querySelectorAll('.shop-item')) {
    const r = b.getBoundingClientRect();
    out.shop[b.dataset.id] = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (r.height < 40 || r.width < 40) out.small.push(`shop ${b.dataset.id} ${Math.round(r.width)}x${Math.round(r.height)}`);
    for (const c of b.querySelectorAll('.name,.short,.detail,.price,.key')) {
      if (!vis(c)) continue;
      if (c.scrollWidth > c.clientWidth + 1) out.trunc.push(`${b.dataset.id} .${c.className} "${c.textContent}" ${c.scrollWidth}>${c.clientWidth}`);
      const tr = textRect(c);
      if (tr.right > r.right - 1 || tr.left < r.left + 1) out.trunc.push(`${b.dataset.id} .${c.className} "${c.textContent}" text spills out of button`);
    }
  }
  for (const b of document.querySelectorAll('.t-btn')) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect();
    const tr = textRect(b);
    out.tbtn[b.id] = { size: `${Math.round(r.width)}x${Math.round(r.height)}`, text: b.textContent.trim() || b.getAttribute('aria-label'), textW: Math.round(tr.width), inner: Math.round(r.width - 4) };
    if (r.width < 44 || r.height < 44) out.small.push(`${b.id} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  // Can the shop still be tapped (nothing on top of each item's centre)?
  out.shopBlocked = [];
  for (const b of document.querySelectorAll('.shop-item')) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5]]) {
      const hit = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
      if (hit && !b.contains(hit)) out.shopBlocked.push(`${b.dataset.id}@${fx}: covered by ${hit.id ? '#' + hit.id : hit.className || hit.tagName}`);
    }
  }
  const g = document.querySelector('.gauges');
  if (vis(g)) out.gaugesText = g.innerText.replace(/\s+/g, ' ');
  return out;
};

const measureOverlay = (id) => {
  const { round, vis, textRect, overlapList } = window.__rv;
  const W = innerWidth, H = innerHeight;
  const ov = document.getElementById(id);
  const card = ov.querySelector('.card');
  const cr = card.getBoundingClientRect();
  const out = { W, H, card: round(cr), scroll: { top: ov.scrollTop, h: ov.scrollHeight, client: ov.clientHeight }, overlaps: [], spill: [], small: [] };
  const cs = getComputedStyle(card);
  const innerL = cr.left + parseFloat(cs.paddingLeft), innerR = cr.right - parseFloat(cs.paddingRight);
  const shapes = {};
  for (const el of card.querySelectorAll('h1,h2,p,button,.howto,.howto li,.stats')) {
    if (!vis(el)) continue;
    const key = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className || ''}${el.dataset.i18n ? '[' + el.dataset.i18n + ']' : ''}`;
    const tr = ['H1', 'H2', 'BUTTON'].includes(el.tagName) ? textRect(el) : el.getBoundingClientRect();
    if (!el.matches('.howto li')) shapes[key] = { r: tr, circle: false };
    if (tr.right > innerR + 1 || tr.left < innerL - 1) out.spill.push(`${key} text ${Math.round(tr.left)}..${Math.round(tr.right)} vs content ${Math.round(innerL)}..${Math.round(innerR)}`);
    if (el.scrollWidth > el.clientWidth + 1) out.spill.push(`${key} scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    if (el.tagName === 'BUTTON') {
      const br = el.getBoundingClientRect();
      if (br.height < 40) out.small.push(`${key} ${Math.round(br.width)}x${Math.round(br.height)}`);
    }
  }
  for (const b of card.querySelectorAll('.howto b')) if (b.scrollWidth > b.clientWidth + 1) out.spill.push(`howto label "${b.textContent}" ${b.scrollWidth}>${b.clientWidth}`);
  // The lang pill sits absolutely; check it against the logo's actual glyphs.
  out.overlaps = overlapList(shapes);
  const btn = card.querySelector('button.primary');
  if (btn) {
    const br = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2);
    out.primary = { ...round(br), visibleNow: br.top >= 0 && br.bottom <= H, hit: hit === btn || btn.contains(hit) };
  }
  out.cardTopClipped = cr.top < -0.5;
  out.cardSidesOff = cr.left < -0.5 || cr.right > W + 0.5;
  return out;
};

// ---------------------------------------------------------------------------
const errors = [];
let browser;
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  for (const vpName of vps) {
    for (const lang of langs) {
      const vp = VIEWPORTS[vpName];
      const tag = `${vpName}-${vp.w}x${vp.h}-${lang}`;
      const t0 = Date.now();
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        isMobile: vp.touch,
        hasTouch: vp.touch,
        deviceScaleFactor: 1,
        locale: lang === 'es' ? 'es-MX' : 'en-US',
      });
      await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: fontCss }));
      await ctx.route('https://fonts.gstatic.com/**', async (r) => {
        const f = new URL(r.request().url()).pathname.slice(1).replaceAll('/', '_');
        try {
          r.fulfill({ contentType: 'font/woff2', body: await readFile(FONTS + f), headers: { 'access-control-allow-origin': '*' } });
        } catch {
          r.abort();
        }
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
      const m = { tag, ...vp, lang };
      const frames = () =>
        page.evaluate(
          () =>
            new Promise((r) => {
              window.__renderOK = 2;
              const poll = () => (window.__renderOK > 0 ? requestAnimationFrame(poll) : requestAnimationFrame(() => r()));
              requestAnimationFrame(poll);
            }),
        );
      const shot = (state) => page.screenshot({ path: `${OUT}${tag}-${state}.png` });
      const fs = () => window.__fishslop;

      await page.goto(BASE);
      await page.locator('#overlay-title').waitFor({ state: 'visible' });
      await page.evaluate(() => (window.__fishslop.manualClock = true));
      await page.evaluate(HELPERS);
      await page.evaluate(() => document.fonts.ready);
      await frames();
      await page.evaluate(() => document.fonts.ready);
      m.fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`).filter((v, i, a) => a.indexOf(v) === i));
      m.touchMode = await page.evaluate(() => document.body.classList.contains('touch'));

      if (statesArg.includes('title')) {
        await page.evaluate(() => (document.getElementById('overlay-title').scrollTop = 0));
        await frames();
        await shot('title');
        m.title = await page.evaluate(measureOverlay, 'overlay-title');
        if (!m.title.primary.visibleNow) {
          await page.locator('#start').scrollIntoViewIfNeeded();
          m.titleAfterScroll = await page.evaluate(measureOverlay, 'overlay-title');
          await shot('title-scrolled');
          await page.evaluate(() => (document.getElementById('overlay-title').scrollTop = 0));
        }
      }

      // Start the run the way a player would.
      if (vp.touch) await page.tap('#start');
      else await page.click('#start');
      await page.locator('#hud').waitFor({ state: 'visible', timeout: 5000 });
      m.afterStart = await page.evaluate(() => window.__fishslop.debugState().state);
      if (m.afterStart !== 'playing') {
        await page.evaluate(() => window.__fishslop.resume());
        m.afterStart2 = await page.evaluate(() => window.__fishslop.debugState().state);
      }

      if (statesArg.includes('toast')) {
        await page.evaluate(() => {
          const g = window.__fishslop;
          g.advance(0.3);
          for (let i = 0; i < 4; i++) g.handleKey('KeyF'); // 4th one: pellet-cap toast
          g.buy('egg'); // can't afford: funds toast
          g.advance(0.2);
        });
        await frames();
        await shot('toast');
        m.toast = await page.evaluate(measureHud);
      }

      if (statesArg.includes('monster')) {
        await page.evaluate(() => {
          const g = window.__fishslop;
          document.getElementById('toasts').replaceChildren();
          g.hud.lastToast = '';
          g.nextMonsterAt = g.playTime + 1;
          g.advance(3);
          g.buy('egg');
        });
        await frames();
        await shot('monster');
        m.monster = await page.evaluate(measureHud);
      }

      if (statesArg.includes('edge') && m.monster) {
        for (const side of ['right', 'left']) {
          await page.evaluate((side) => {
            const g = window.__fishslop;
            const mp = g.world.monster.pos;
            const sp = g.sub.pos;
            const face = Math.atan2(mp.x - sp.x, mp.z - sp.z);
            g.sub.yaw = face + (side === 'right' ? Math.PI / 2 : -Math.PI / 2);
            g.sub.pitch = 0;
            g.advance(0.8);
          }, side);
          await frames();
          await shot(`monster-edge-${side}`);
          m[`edge_${side}`] = await page.evaluate(measureHud);
        }
        // Behind: the tag pins to the bottom of the screen.
        await page.evaluate(() => {
          const g = window.__fishslop;
          const mp = g.world.monster.pos;
          const sp = g.sub.pos;
          g.sub.yaw = Math.atan2(mp.x - sp.x, mp.z - sp.z) + Math.PI;
          g.sub.pitch = 0;
          g.advance(0.8);
        });
        await frames();
        await shot('monster-edge-behind');
        m.edge_behind = await page.evaluate(measureHud);
      }

      if (statesArg.includes('pause')) {
        if (vp.touch) await page.tap('#t-pause');
        else await page.evaluate(() => window.__fishslop.pause());
        await page.locator('#overlay-pause').waitFor({ state: 'visible', timeout: 3000 });
        await frames();
        await shot('pause');
        m.pause = { hud: await page.evaluate(measureHud), card: await page.evaluate(measureOverlay, 'overlay-pause') };
        await page.evaluate(() => window.__fishslop.resume());
      }

      if (statesArg.includes('end')) {
        await page.evaluate(() => window.__fishslop.finish(true));
        await page.locator('#overlay-end').waitFor({ state: 'visible', timeout: 3000 });
        await frames();
        await shot('end');
        m.end = await page.evaluate(measureOverlay, 'overlay-end');
      }

      await writeFile(`${OUT}metrics/${tag}.json`, JSON.stringify(m, null, 1));
      await ctx.close();
      console.log(`ok ${tag} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
  if (errors.length) console.log(errors.join('\n'));
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
