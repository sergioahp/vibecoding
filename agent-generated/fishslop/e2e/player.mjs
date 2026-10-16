// The scripted player, shared by the balance bot and the video recorder. installBot runs inside
// the page: it feeds hungry fish, chases coins, shops and harpoons monsters by holding the same
// keys a person would. Shop prices and hunger come from src/rules.ts, so it follows rebalances.
import { HUNGER, SHOP, pelletCap } from '../src/rules.ts';

const prices = Object.fromEntries(
  SHOP.map((s) => [s.id, s.id === 'guppy' ? [s.cost(0)] : Array.from({ length: s.maxLevel }, (_, l) => s.cost(l))]),
);
const caps = Array.from({ length: 6 }, (_, l) => pelletCap({ food: 0, capacity: l, magnet: 0, harpoon: 0, egg: 0 }));
/** Everything installBot needs, as plain data it can carry into the page. */
export const botConfig = (strategy) => ({ prices, caps, seekBelow: HUNGER.seekBelow, strategy });

// Runs inside the page. Holds keys by writing into the game's own key set, the same Set real keyboard events fill.
export function installBot(cfg) {
  const g = window.__fishslop;
  const keys = g.input.keys;
  const stats = { expired: 0, expiredValue: 0, buys: [], monsters: [], timeline: [] };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const CONTROL_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'KeyC', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyR', 'ShiftLeft'];
  const SHOPKEY = { guppy: 'Digit1', food: 'Digit2', capacity: 'Digit3', magnet: 'Digit4', harpoon: 'Digit5', egg: 'Digit6' };

  function hold(set) {
    for (const k of CONTROL_KEYS) keys.delete(k);
    for (const k of set) keys.add(k);
  }

  function steerTo(t, stopAt = 0.3) {
    const s = g.sub;
    const dx = t.x - s.pos.x;
    const dz = t.z - s.pos.z;
    const dy = t.y - s.pos.y;
    const dyaw = wrap(Math.atan2(dx, dz) - s.yaw);
    const set = [];
    if (dyaw > 0.08) set.push('ArrowLeft');
    else if (dyaw < -0.08) set.push('ArrowRight');
    const horiz = Math.hypot(dx, dz);
    if (Math.abs(dyaw) < 0.9 && horiz > stopAt) set.push('KeyW');
    if (horiz > 6) set.push('ShiftLeft');
    if (dy > 0.3) set.push('Space');
    else if (dy < -0.3) set.push('KeyC');
    if (s.pitch > 0.05) set.push('ArrowDown');
    else if (s.pitch < -0.05) set.push('ArrowUp');
    return set;
  }

  // Aims the way a player does: turn until the crosshair (camera centre) is on the target.
  function aimAt(target) {
    const cam = g.camera;
    const dir = cam.getWorldDirection(target.clone());
    const to = target.clone().sub(cam.position).normalize();
    const dyaw = wrap(Math.atan2(to.x, to.z) - Math.atan2(dir.x, dir.z));
    const dpitch = Math.asin(to.y) - Math.asin(dir.y);
    const set = [];
    if (dyaw > 0.03) set.push('ArrowLeft');
    else if (dyaw < -0.03) set.push('ArrowRight');
    if (dpitch > 0.03) set.push('ArrowUp');
    else if (dpitch < -0.03) set.push('ArrowDown');
    return { set, err: Math.hypot(dyaw, dpitch) };
  }

  function priceOf(id) {
    const table = cfg.prices[id];
    if (id === 'guppy') return table[0];
    const level = g.econ.levels[id];
    return level >= table.length ? null : table[level];
  }

  function buy(id) {
    const price = priceOf(id);
    if (price === null || g.econ.money < price) return false;
    const before = g.econ.money;
    g.handleKey(SHOPKEY[id]);
    if (g.econ.money >= before) return false;
    stats.buys.push([Math.round(g.playTime), id, price]);
    return true;
  }

  function shop() {
    const fish = g.world.fish.filter((f) => f.alive).length;
    const lv = g.econ.levels;
    if (fish < 2) return void buy('guppy');
    if (cfg.strategy.startsWith('eggrush')) {
      if (!buy('egg') && fish < 4) buy('guppy');
      return;
    }
    // Grow the tank, buy the upgrades that pay off, then save for eggs.
    const plan = [
      () => fish < 4 && 'guppy',
      () => lv.food < 1 && 'food',
      () => fish < 6 && 'guppy',
      () => lv.magnet < 1 && 'magnet',
      () => lv.capacity < 1 && 'capacity',
      () => fish < 8 && 'guppy',
      () => lv.harpoon < 1 && 'harpoon',
      () => lv.food < 2 && 'food',
      () => lv.capacity < 2 && 'capacity',
      () => fish < 10 && 'guppy',
      () => 'egg',
    ];
    for (const step of plan) {
      const id = step();
      if (!id || priceOf(id) === null) continue;
      buy(id);
      return;
    }
  }

  function decide() {
    const w = g.world;
    const s = g.sub;
    const m = w.monster;
    if (m && m.alive && !cfg.strategy.includes('nofight')) {
      const { set, err } = aimAt(m.pos);
      const d = s.pos.distanceTo(m.pos);
      if (d > 14) set.push('KeyW');
      else if (d < 5) set.push('KeyS');
      if (m.pos.y - s.pos.y > 2) set.push('Space');
      else if (m.pos.y - s.pos.y < -2) set.push('KeyC');
      if (err < 0.2) set.push('KeyR');
      return set;
    }

    const fish = w.fish.filter((f) => f.alive);
    const out = w.pellets.filter((p) => !p.dead).length;
    const cap = cfg.caps[g.econ.levels.capacity];
    const hungry = fish.filter((f) => f.hunger < cfg.seekBelow).sort((a, b) => a.hunger - b.hunger);
    const unfed = hungry.filter((f) => !w.pellets.some((p) => !p.dead && p.pos.distanceTo(f.pos) < 6)).length;
    if (hungry.length && out < cap && (unfed || hungry[0].hunger < 0.25)) {
      const t = hungry[0].pos.clone();
      t.y = Math.min(t.y + 1.2, 17);
      if (Math.hypot(t.x - s.pos.x, t.z - s.pos.z) < 2.5 && Math.abs(t.y - s.pos.y) < 2.5) g.handleKey('KeyF');
      return steerTo(t);
    }

    let best = null;
    let bestScore = -1;
    for (const c of w.coins) {
      if (c.dead) continue;
      const score = c.value / (c.pos.distanceTo(s.pos) + 3);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) return steerTo(best.pos, 0.1);

    if (fish.length) {
      const centre = fish.reduce((acc, f) => acc.add(f.pos), s.pos.clone().set(0, 0, 0)).multiplyScalar(1 / fish.length);
      centre.y = Math.max(3, centre.y - 2);
      return steerTo(centre);
    }
    return [];
  }

  /** One decision: shop if worth it, then hold the keys for the next moment of play. */
  function think() {
    if (g.state !== 'playing') return hold([]);
    shop();
    if (g.state === 'playing') hold(decide());
  }

  function run(seconds) {
    const end = g.playTime + seconds;
    while (g.playTime < end && g.state === 'playing') {
      think();
      if (g.state !== 'playing') break;
      const coinsBefore = [...g.world.coins];
      const hadMonster = !!g.world.monster;
      g.advance(0.1);
      for (const c of coinsBefore) {
        if (!g.world.coins.includes(c) && c.restLeft <= 0) {
          stats.expired++;
          stats.expiredValue += c.value;
        }
      }
      const m = g.world.monster;
      if (m && !hadMonster) stats.monsters.push({ wave: m.wave, arrived: Math.round(g.playTime), hp: m.maxHp });
      const last = stats.monsters.at(-1);
      if (last && !last.ended && hadMonster && !m) last.ended = Math.round(g.playTime);
    }
    hold([]);
    return {
      state: g.state,
      t: Math.round(g.playTime),
      money: Math.round(g.econ.money),
      fish: g.world.fish.filter((f) => f.alive).length,
      levels: { ...g.econ.levels },
      game: { ...g.stats },
      expired: { count: stats.expired, value: stats.expiredValue },
    };
  }

  window.__bot = { run, think, stats };
}
