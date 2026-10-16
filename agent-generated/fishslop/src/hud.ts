import * as THREE from 'three';
import {
  EGG_PIECES,
  SHOP,
  foodValue,
  harpoonDamage,
  magnetRadius,
  pelletCap,
  priceOf,
  type Economy,
  type ShopId,
} from './rules.ts';
import { num, t, type Key } from './i18n.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

export type Overlay = 'title' | 'pause' | 'end' | null;

export interface EndStats {
  won: boolean;
  time: number;
  earned: number;
  slain: number;
  lost: number;
  kings: number;
}

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SHOP_NAME: Record<ShopId, Key> = {
  guppy: 'shopGuppy',
  food: 'shopFood',
  capacity: 'shopCapacity',
  magnet: 'shopMagnet',
  harpoon: 'shopHarpoon',
  egg: 'shopEgg',
};

export const shopName = (id: ShopId) => t(SHOP_NAME[id]);
const shortName = (id: ShopId) => t(`short${SHOP_NAME[id].slice(4)}` as Key);
export const stageName = (stage: number) => t(`stage${stage}` as Key);

export class Hud {
  onBuy: (id: ShopId) => void = () => {};
  private readonly root = $('hud');
  private readonly money = $('money');
  private readonly fishCount = $('fish-count');
  private readonly pellets = $('pellets');
  private readonly depth = $('depth');
  private readonly eggPips = $('egg-pips');
  private readonly contact = $('contact');
  private readonly alertEl = $('alert');
  private readonly toasts = $('toasts');
  private readonly labels = $('labels');
  private readonly monsterTag: HTMLElement;
  private readonly monsterArrow: HTMLElement;
  private readonly monsterFill: HTMLElement;
  private readonly buttons = new Map<ShopId, HTMLButtonElement>();
  private readonly floaters: Floater[] = [];
  private readonly v = new THREE.Vector3();
  private lastMoney = -1;
  private lastToast = '';
  private lastToastAt = 0;

  constructor() {
    const shop = $('shop');
    for (const item of SHOP) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shop-item';
      b.dataset.id = item.id;
      b.innerHTML = `<span class="key">${item.key}</span><span class="name"></span><span class="short"></span><span class="detail"></span><span class="price"></span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onBuy(item.id);
      });
      shop.append(b);
      this.buttons.set(item.id, b);
    }
    for (let i = 0; i < EGG_PIECES; i++) this.eggPips.append(document.createElement('i'));

    this.monsterTag = document.createElement('div');
    this.monsterTag.className = 'monster-tag';
    this.monsterTag.hidden = true;
    this.monsterTag.innerHTML = '<span class="arrow"></span><span class="name"></span><div class="monster-bar"><div></div></div>';
    this.monsterArrow = this.monsterTag.querySelector('.arrow')!;
    this.monsterFill = this.monsterTag.querySelector('.monster-bar > div')!;
    this.labels.append(this.monsterTag);
    this.relabel();
  }

  /** Re-reads the strings built in code, after a language change. */
  relabel() {
    for (const [id, b] of this.buttons) {
      b.querySelector('.name')!.textContent = shopName(id);
      b.querySelector('.short')!.textContent = shortName(id);
      b.title = shopName(id);
    }
    this.monsterTag.querySelector('.name')!.textContent = t('monster');
    this.lastMoney = -1;
  }

  show(on: boolean) {
    this.root.hidden = !on;
  }

  overlay(which: Overlay) {
    $('overlay-title').hidden = which !== 'title';
    $('overlay-pause').hidden = which !== 'pause';
    $('overlay-end').hidden = which !== 'end';
  }

  end(s: EndStats) {
    $('end-title').textContent = t(s.won ? 'wonTitle' : 'lostTitle');
    $('end-sub').textContent = t(s.won ? 'wonBody' : 'lostBody');
    $('end-stats').innerHTML = [
      [t('statTime'), fmtTime(s.time)],
      [t('statEarned'), num(s.earned)],
      [t('statSlain'), String(s.slain)],
      [t('statKings'), String(s.kings)],
      [t('statLost'), String(s.lost)],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
    $('overlay-end').classList.toggle('won', s.won);
  }

  update(
    econ: Economy,
    fish: number,
    pelletsOut: number,
    depthM: number,
    contactIn: number | null,
    warning: number | null,
    monsterUp: boolean,
  ) {
    const money = Math.floor(econ.money);
    if (money !== this.lastMoney) {
      this.money.textContent = num(money);
      if (money > this.lastMoney && this.lastMoney >= 0) {
        this.money.classList.remove('bump');
        void this.money.offsetWidth;
        this.money.classList.add('bump');
      }
      this.lastMoney = money;
    }
    this.fishCount.textContent = String(fish);
    const cap = pelletCap(econ.levels);
    this.pellets.textContent = `${pelletsOut}/${cap}`;
    this.pellets.classList.toggle('full', pelletsOut >= cap);
    this.depth.textContent = `${depthM.toFixed(1)} m`;
    [...this.eggPips.children].forEach((pip, i) => pip.classList.toggle('on', i < econ.levels.egg));
    // Round up like the warning banner does, so both read the same second.
    this.contact.textContent = monsterUp ? t('contactNow') : contactIn === null ? '--:--' : fmtTime(Math.max(0, Math.ceil(contactIn)));
    this.contact.classList.toggle('hot', monsterUp || (warning !== null && warning > 0));

    if (monsterUp) this.setAlert(t('alertMonster'), 'danger');
    else if (warning !== null) this.setAlert(t('alertSonar', { n: Math.ceil(warning) }), 'warn');
    else this.setAlert(null);

    for (const item of SHOP) {
      const b = this.buttons.get(item.id)!;
      const price = priceOf(econ, item.id, fish);
      const l = econ.levels;
      const detail: Record<ShopId, string> = {
        guppy: t('detailGuppy'),
        food: t('detailFood', { n: foodValue(l) }),
        capacity: t('detailCapacity', { n: cap }),
        magnet: t('detailMagnet', { n: num(Number(magnetRadius(l).toFixed(1))) }),
        harpoon: t('detailHarpoon', { n: harpoonDamage(l) }),
        egg: t('detailEgg', { n: l.egg, m: EGG_PIECES }),
      };
      b.querySelector('.detail')!.textContent = detail[item.id];
      b.querySelector('.price')!.textContent = price === null ? t('max') : num(price);
      b.classList.toggle('maxed', price === null);
      b.classList.toggle('afford', price !== null && econ.money >= price);
      b.disabled = price === null;
    }
  }

  private setAlert(text: string | null, tone?: 'warn' | 'danger') {
    this.alertEl.hidden = !text;
    if (!text) return;
    if (this.alertEl.textContent !== text) this.alertEl.textContent = text;
    this.alertEl.dataset.tone = tone;
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info') {
    const now = performance.now();
    if (text === this.lastToast && now - this.lastToastAt < 1500) return;
    this.lastToast = text;
    this.lastToastAt = now;
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = text;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  float(pos: THREE.Vector3, text: string, cls = '') {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.labels.append(el);
    this.floaters.push({ el, pos: pos.clone(), age: 0 });
  }

  private place(el: HTMLElement, pos: THREE.Vector3, camera: THREE.Camera, dy = 0) {
    this.v.copy(pos).project(camera);
    const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2;
    el.style.visibility = visible ? 'visible' : 'hidden';
    this.moveTo(el, this.v.x, this.v.y, dy);
  }

  private moveTo(el: HTMLElement, nx: number, ny: number, dy = 0) {
    const x = ((nx + 1) / 2) * window.innerWidth;
    const y = ((1 - ny) / 2) * window.innerHeight + dy;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  updateWorld(dt: number, camera: THREE.Camera, monster: { pos: THREE.Vector3; hp: number; maxHp: number; alive: boolean } | null) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      this.place(f.el, f.pos, camera, -f.age * 50);
      f.el.style.opacity = String(Math.max(0, 1 - f.age / 1.1));
      if (f.age > 1.1) {
        f.el.remove();
        this.floaters.splice(i, 1);
      }
    }
    if (monster && monster.alive) {
      this.monsterTag.hidden = false;
      this.v.copy(monster.pos);
      this.v.y += 2.6;
      this.v.project(camera);
      let { x, y } = this.v;
      const behind = this.v.z > 1;
      if (behind) {
        x = -x;
        y = -y;
      }
      const onScreen = !behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.95;
      this.monsterTag.classList.toggle('edge', !onScreen);
      this.monsterTag.style.visibility = 'visible';
      if (onScreen) {
        this.moveTo(this.monsterTag, x, y);
      } else {
        // Pin to the screen edge in the monster's direction, clear of the HUD panels and shop.
        const k = 1 / Math.max(Math.abs(x), Math.abs(y), 1e-6);
        x *= k;
        y *= k;
        this.monsterArrow.style.transform = `rotate(${Math.atan2(-y, x)}rad)`;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const hw = this.monsterTag.offsetWidth / 2 + 12;
        const hh = this.monsterTag.offsetHeight / 2 + 12;
        const px = THREE.MathUtils.clamp(((x + 1) / 2) * W, hw, W - hw);
        const py = THREE.MathUtils.clamp(((1 - y) / 2) * H, hh + 90, H - hh - 120);
        this.monsterTag.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      }
      this.monsterFill.style.width = `${Math.max(0, (monster.hp / monster.maxHp) * 100)}%`;
    } else {
      this.monsterTag.hidden = true;
    }
  }

  clearWorld() {
    this.floaters.forEach((f) => f.el.remove());
    this.floaters.length = 0;
    this.toasts.replaceChildren();
  }
}
