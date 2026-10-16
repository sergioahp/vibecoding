// A scripted player for balance testing. It feeds hungry fish, chases coins, buys upgrades
// and harpoons monsters, then reports how the run went in game time.
//
//   npm run build && npm run bot -- [strategy] [maxSeconds] [--expect=win|no-win]
//
// Strategies: sensible (default), sensible-nofight, eggrush.
// With --expect the process fails when the outcome differs, which CI uses as a balance check.
// The player itself lives in player.mjs.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { botConfig, installBot } from './player.mjs';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const strategy = positional[0] ?? 'sensible';
const maxSeconds = Number(positional[1] ?? 1200);
const expect = process.argv.find((a) => a.startsWith('--expect='))?.slice('--expect='.length);
if (expect && expect !== 'win' && expect !== 'no-win') throw new Error(`--expect must be win or no-win, got ${expect}`);
const OUT = fileURLToPath(new URL('./screenshots/', import.meta.url));

const server = await preview({
  root: fileURLToPath(new URL('..', import.meta.url)),
  preview: { port: 4175, strictPort: false },
  logLevel: 'warn',
});
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.g(oogleapis|static)/.test(m.text())) errors.push(m.text());
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator('#overlay-title').waitFor({ state: 'visible' });
  await page.evaluate(() => (window.__fishslop.manualClock = true));
  await page.click('#start');
  await page.evaluate(installBot, botConfig(strategy));

  console.log(`strategy: ${strategy}`);
  let r;
  for (let t = 0; t < maxSeconds; t += 60) {
    r = await page.evaluate(() => window.__bot.run(60));
    const mm = String(Math.floor(r.t / 60)).padStart(2, ' ');
    const ss = String(r.t % 60).padStart(2, '0');
    console.log(
      `${mm}:${ss}  ${r.state.padEnd(7)} money ${String(r.money).padStart(5)}  fish ${String(r.fish).padStart(2)}  ` +
        `lost ${r.game.lost}  monsters slain ${r.game.slain}  eggs ${r.levels.egg}/3  ` +
        `upgrades food ${r.levels.food} pellets ${r.levels.capacity} magnet ${r.levels.magnet} harpoon ${r.levels.harpoon}`,
    );
    if (r.state !== 'playing') break;
  }
  const stats = await page.evaluate(() => window.__bot.stats);
  console.log(`\nresult: ${r.state === 'won' ? 'won' : r.state === 'over' ? 'game over' : 'still playing'} at ${r.t}s of game time`);
  console.log(`coins that faded uncollected: ${r.expired.count} worth ${r.expired.value}`);
  console.log(`monsters: ${stats.monsters.map((m) => `wave ${m.wave} (${m.hp} hp) ${m.arrived}s→${m.ended ?? '?'}s`).join(', ') || 'none'}`);
  console.log(`purchases: ${stats.buys.map(([t, id]) => `${t}s ${id}`).join(', ')}`);
  await mkdir(OUT, { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}bot-${strategy}-end.png` });
  if (errors.length) {
    console.error(`browser errors:\n${errors.join('\n')}`);
    process.exitCode = 1;
  }
  const won = r.state === 'won';
  if (expect && won !== (expect === 'win')) {
    console.error(`balance check failed: expected ${strategy} to ${expect === 'win' ? 'win' : 'not win'} within ${maxSeconds}s`);
    process.exitCode = 1;
  } else if (expect) {
    console.log(`balance check passed: ${strategy} ${won ? 'won' : 'did not win'} within ${maxSeconds}s, as expected`);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(process.exitCode ?? 0);
