import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_VALUE,
  EGG_PIECES,
  FISH_FLOOR_CLEARANCE,
  FOOD_REST_OFFSET,
  GUPPY_COST,
  MAX_FISH,
  SHOP,
  STAGES,
  eatRadius,
  hasWon,
  isGameOver,
  newEconomy,
  priceOf,
  stageFor,
  tryBuy,
} from './rules.ts';

test('fish of every size can eat food resting on the sand', () => {
  const gap = FISH_FLOOR_CLEARANCE - FOOD_REST_OFFSET;
  for (const s of STAGES) assert.ok(eatRadius(s.scale) > gap, `${s.name} can't reach floor food`);
});

test('growth thresholds map to stages', () => {
  assert.equal(stageFor(0), 0);
  assert.equal(stageFor(2.9), 0);
  assert.equal(stageFor(3), 1);
  assert.equal(stageFor(9), 2);
  assert.equal(stageFor(100), 3);
});

test('only grown fish drop coins, and bigger fish drop more', () => {
  assert.equal(STAGES[0].coin, null);
  const values = STAGES.slice(1).map((s) => COIN_VALUE[s.coin as 'silver' | 'gold' | 'gem']);
  assert.deepEqual([...values].sort((a, b) => a - b), values);
});

test('buying deducts money and raises the level', () => {
  const e = newEconomy();
  e.money = 1000;
  const r = tryBuy(e, 'magnet', 2);
  assert.deepEqual(r, { ok: true, cost: 200 });
  assert.equal(e.money, 800);
  assert.equal(e.levels.magnet, 1);
  assert.equal(priceOf(e, 'magnet', 2), 340);
});

test('cannot buy without funds, and nothing changes', () => {
  const e = newEconomy();
  e.money = 50;
  assert.deepEqual(tryBuy(e, 'guppy', 2), { ok: false, reason: 'funds' });
  assert.equal(e.money, 50);
});

test('upgrades stop at their max level', () => {
  const e = newEconomy();
  e.money = 1e9;
  const food = SHOP.find((s) => s.id === 'food')!;
  for (let i = 0; i < food.maxLevel; i++) assert.equal(tryBuy(e, 'food', 2).ok, true);
  assert.deepEqual(tryBuy(e, 'food', 2), { ok: false, reason: 'maxed' });
});

test('guppies stop when the tank is full', () => {
  const e = newEconomy();
  e.money = 1e6;
  assert.equal(priceOf(e, 'guppy', MAX_FISH - 1), GUPPY_COST);
  assert.equal(priceOf(e, 'guppy', MAX_FISH), null);
});

test('buying every egg piece wins', () => {
  const e = newEconomy();
  e.money = 1e6;
  for (let i = 0; i < EGG_PIECES; i++) {
    assert.equal(hasWon(e), false);
    tryBuy(e, 'egg', 2);
  }
  assert.equal(hasWon(e), true);
});

test('game over only when no fish and no way to afford one', () => {
  const e = newEconomy();
  e.money = 40;
  assert.equal(isGameOver(e, 1, 0), false);
  assert.equal(isGameOver(e, 0, 0), true);
  assert.equal(isGameOver(e, 0, 60), false, 'coins still in the tank can save you');
});
