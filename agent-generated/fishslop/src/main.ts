import './style.css';
import { Game } from './game.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { Sfx } from './audio.ts';
import { TouchControls } from './touch.ts';
import { applyStatic, lang, setLang, setTouchWording } from './i18n.ts';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
applyStatic();
const hud = new Hud();
const input = new Input(canvas);
const sfx = new Sfx();
const game = new Game(canvas, hud, input, sfx);
const touch = new TouchControls(canvas, input, {
  playing: () => game.state === 'playing',
  press: (code) => game.handleKey(code),
  pause: () => game.pause(),
});

hud.onBuy = (id) => game.buy(id);
input.onKey = (code) => game.handleKey(code);
input.onClick = (button) => game.handleClick(button);
input.onLockChange = (locked) => game.onLockChange(locked);
input.onModeChange = (on) => {
  document.body.classList.toggle('touch', on);
  setTouchWording(on);
  touch.release();
  // Switching to the mouse mid-run needs pointer lock, which takes a click on Resume.
  if (!on && !input.locked) game.pause();
};

/** On phones, hide the browser bars for more tank. Either orientation works, so it isn't locked. */
function goFullscreen() {
  if (!input.touch || document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {
    // iPhone Safari has no element fullscreen; the game just runs inside the browser.
  });
}

const play = () => {
  goFullscreen();
  game.start();
};
document.getElementById('start')!.addEventListener('click', play);
document.getElementById('restart')!.addEventListener('click', play);
document.getElementById('resume')!.addEventListener('click', () => game.resume());
document.getElementById('lang')!.addEventListener('click', () => {
  setLang(lang === 'en' ? 'es' : 'en');
  hud.relabel();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  game.pause();
  touch.release();
});

// Phones and tablets start on touch controls; the first click or tap switches if that guess is wrong.
if (matchMedia('(pointer: coarse)').matches) input.setTouch(true);

hud.overlay('title');
requestAnimationFrame(game.frame);

Object.assign(window, { __fishslop: game });
