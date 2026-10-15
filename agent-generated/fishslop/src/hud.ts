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
  private readonly monsterBar: HTMLElement;
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
      b.innerHTML = `<span class="key">${item.key}</span><span class="name">${item.name}</span><span class="detail"></span><span class="price"></span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onBuy(item.id);
      });
      shop.append(b);
      this.buttons.set(item.id, b);
    }
    for (let i = 0; i < EGG_PIECES; i++) this.eggPips.append(document.createElement('i'));

    this.monsterBar = document.createElement('div');
    this.monsterBar.className = 'monster-bar';
    this.monsterBar.hidden = true;
    this.monsterFill = document.createElement('div');
    this.monsterBar.append(this.monsterFill);
    this.labels.append(this.monsterBar);
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
    $('end-title').textContent = s.won ? 'The egg hatched' : 'The tank went quiet';
    $('end-sub').textContent = s.won
      ? 'All three egg pieces are yours. Whatever was inside is very pleased with you.'
      : 'No fish left and not enough coins for another. Every keeper loses a tank eventually.';
    $('end-stats').innerHTML = [
      ['Time', fmtTime(s.time)],
      ['Coins earned', s.earned.toLocaleString()],
      ['Monsters harpooned', String(s.slain)],
      ['King guppies raised', String(s.kings)],
      ['Fish lost', String(s.lost)],
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
      this.money.textContent = money.toLocaleString();
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
    this.contact.textContent = monsterUp ? 'CONTACT' : contactIn === null ? '--:--' : fmtTime(Math.max(0, contactIn));
    this.contact.classList.toggle('hot', monsterUp || (warning !== null && warning > 0));

    if (monsterUp) this.setAlert('Monster in the tank. Harpoon it: right-click or R', 'danger');
    else if (warning !== null) this.setAlert(`Sonar contact. Something big arrives in ${Math.ceil(warning)}`, 'warn');
    else this.setAlert(null);

    for (const item of SHOP) {
      const b = this.buttons.get(item.id)!;
      const price = priceOf(econ, item.id, fish);
      const l = econ.levels;
      const detail: Record<ShopId, string> = {
        guppy: 'Fry. Feed it to grow',
        food: `${foodValue(l)} growth per pellet`,
        capacity: `${cap} pellets at once`,
        magnet: `${magnetRadius(l).toFixed(1)} m pull`,
        harpoon: `${harpoonDamage(l)} dmg per bolt`,
        egg: `${l.egg}/${EGG_PIECES} pieces`,
      };
      b.querySelector('.detail')!.textContent = detail[item.id];
      b.querySelector('.price')!.textContent = price === null ? 'MAX' : price.toLocaleString();
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
    const x = ((this.v.x + 1) / 2) * window.innerWidth;
    const y = ((1 - this.v.y) / 2) * window.innerHeight + dy;
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
      this.monsterBar.hidden = false;
      this.v.copy(monster.pos);
      this.v.y += 2.6;
      this.place(this.monsterBar, this.v, camera);
      this.monsterFill.style.width = `${Math.max(0, (monster.hp / monster.maxHp) * 100)}%`;
    } else {
      this.monsterBar.hidden = true;
    }
  }

  clearWorld() {
    this.floaters.forEach((f) => f.el.remove());
    this.floaters.length = 0;
    this.toasts.replaceChildren();
  }
}
