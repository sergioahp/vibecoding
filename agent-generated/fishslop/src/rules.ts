// Pure game rules: economy, growth, balance. No rendering imports so it runs under node:test.

export const TANK = { minX: -20, maxX: 20, minY: 0, maxY: 18, minZ: -12, maxZ: 12 } as const;

export const START_MONEY = 150;
export const START_FISH = 2;
export const MAX_FISH = 24;
export const GUPPY_COST = 100;

export type ShopId = 'guppy' | 'food' | 'capacity' | 'magnet' | 'harpoon' | 'egg';
export type UpgradeId = Exclude<ShopId, 'guppy'>;
export type Levels = Record<UpgradeId, number>;

export interface Economy {
  money: number;
  levels: Levels;
}

interface ShopDef {
  id: ShopId;
  key: string;
  name: string;
  maxLevel: number;
  cost: (level: number) => number;
}

const roundTo10 = (n: number) => Math.round(n / 10) * 10;

export const SHOP: readonly ShopDef[] = [
  { id: 'guppy', key: '1', name: 'Guppy', maxLevel: Infinity, cost: () => GUPPY_COST },
  { id: 'food', key: '2', name: 'Better food', maxLevel: 2, cost: (l) => [250, 700][l] },
  { id: 'capacity', key: '3', name: 'More pellets', maxLevel: 5, cost: (l) => roundTo10(300 * 1.6 ** l) },
  { id: 'magnet', key: '4', name: 'Coin magnet', maxLevel: 4, cost: (l) => roundTo10(200 * 1.7 ** l) },
  { id: 'harpoon', key: '5', name: 'Harpoon', maxLevel: 4, cost: (l) => roundTo10(300 * 1.8 ** l) },
  { id: 'egg', key: '6', name: 'Egg piece', maxLevel: 3, cost: (l) => [1500, 4000, 8000][l] },
];

export const EGG_PIECES = 3;

export function newEconomy(): Economy {
  return { money: START_MONEY, levels: { food: 0, capacity: 0, magnet: 0, harpoon: 0, egg: 0 } };
}

export function shopDef(id: ShopId): ShopDef {
  const def = SHOP.find((s) => s.id === id);
  if (!def) throw new Error(`unknown shop item ${id}`);
  return def;
}

/** Current price, or null when the item can't be bought any more. */
export function priceOf(e: Economy, id: ShopId, fishCount: number): number | null {
  if (id === 'guppy') return fishCount >= MAX_FISH ? null : GUPPY_COST;
  const def = shopDef(id);
  const level = e.levels[id];
  return level >= def.maxLevel ? null : def.cost(level);
}

export type BuyResult = { ok: true; cost: number } | { ok: false; reason: 'maxed' | 'funds' };

export function tryBuy(e: Economy, id: ShopId, fishCount: number): BuyResult {
  const price = priceOf(e, id, fishCount);
  if (price === null) return { ok: false, reason: 'maxed' };
  if (e.money < price) return { ok: false, reason: 'funds' };
  e.money -= price;
  if (id !== 'guppy') e.levels[id] += 1;
  return { ok: true, cost: price };
}

export const hasWon = (e: Economy) => e.levels.egg >= EGG_PIECES;

// Derived stats from upgrade levels.
export const foodValue = (l: Levels) => l.food + 1;
export const pelletCap = (l: Levels) => 3 + l.capacity;
export const magnetRadius = (l: Levels) => 1.8 + 0.9 * l.magnet;
export const harpoonDamage = (l: Levels) => 6 + 4 * l.harpoon;
export const HARPOON_COOLDOWN = 0.25;

// Fish growth. Growth points come from eating; better food = more points per pellet.
export type CoinKind = 'silver' | 'gold' | 'gem' | 'treasure';

export interface Stage {
  name: string;
  scale: number;
  coin: CoinKind | null;
  coinEvery: number;
  speed: number;
}

export const STAGE_THRESHOLDS = [0, 2, 6, 14] as const;

export const STAGES: readonly Stage[] = [
  { name: 'Fry', scale: 0.55, coin: null, coinEvery: 0, speed: 2.6 },
  { name: 'Guppy', scale: 0.85, coin: 'silver', coinEvery: 10, speed: 2.9 },
  { name: 'Big guppy', scale: 1.15, coin: 'gold', coinEvery: 10, speed: 3.1 },
  { name: 'King guppy', scale: 1.45, coin: 'gem', coinEvery: 16, speed: 3.3 },
];

export function stageFor(growth: number): number {
  let s = 0;
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) if (growth >= STAGE_THRESHOLDS[i]) s = i;
  return s;
}

export const COIN_VALUE: Record<Exclude<CoinKind, 'treasure'>, number> = { silver: 15, gold: 35, gem: 100 };

// Hunger runs 1 (full) -> 0 (starved). Fish only chase food once below SEEK_BELOW,
// which keeps one fish from hoovering every pellet.
export const HUNGER = { drainPerSec: 1 / 45, seekBelow: 0.7 } as const;

// Vertical reach: food rests a little above the sand and fish can swim down to a
// clearance above it. The eat radius must cover that gap or fish starve over food.
export const FOOD_REST_OFFSET = 0.12;
/** Fish and pellets keep the same distance from the glass, so no pellet settles where fish can't swim. */
export const WALL_INSET = 0.7;
export const FISH_FLOOR_CLEARANCE = 0.45;
export const eatRadius = (scale: number) => 0.35 + 0.3 * scale;

export const FOOD_FLOOR_LIFETIME = 10;
export const COIN_FLOOR_LIFETIME = 12;

export const MONSTER = {
  firstAt: 90,
  interval: 75,
  warning: 8,
  hp: (wave: number) => 120 + 90 * wave,
  speed: (wave: number) => Math.min(3.8 + 0.3 * wave, 5.5),
  reward: (wave: number) => 150 + 75 * wave,
} as const;

/** Lost when there's no fish, and no money (in hand or still in the tank) to buy one. */
export function isGameOver(e: Economy, fishCount: number, coinValueInTank: number): boolean {
  return fishCount === 0 && e.money + coinValueInTank < GUPPY_COST;
}
