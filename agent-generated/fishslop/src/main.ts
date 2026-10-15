import './style.css';
import { Game } from './game.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { Sfx } from './audio.ts';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hud = new Hud();
const input = new Input(canvas);
const sfx = new Sfx();
const game = new Game(canvas, hud, input, sfx);

hud.onBuy = (id) => game.buy(id);
input.onKey = (code) => game.handleKey(code);
input.onClick = (button) => game.handleClick(button);
input.onLockChange = (locked) => game.onLockChange(locked);

document.getElementById('start')!.addEventListener('click', () => game.start());
document.getElementById('resume')!.addEventListener('click', () => game.resume());
document.getElementById('restart')!.addEventListener('click', () => game.start());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

hud.overlay('title');
requestAnimationFrame(game.frame);

Object.assign(window, { __fishslop: game });
