import type { Input } from './input.ts';

/** How far, in CSS pixels, the knob travels from the centre of the stick. */
const RADIUS = 52;
const DEAD_ZONE = 0.12;
/** Dragging this many radii out from where the thumb landed switches on boost. */
const BOOST_AT = 1.4;
/** Thumb drags cover less distance than mouse moves, so they turn the view faster per pixel. */
const LOOK_SCALE = 2.2;
/** Touches that start left of this fraction of the screen move the stick; the rest look around. */
const STICK_ZONE = 0.45;

export interface TouchActions {
  /** Whether a run is in progress; outside of one, touches on the scene do nothing. */
  playing(): boolean;
  press(code: string): void;
  pause(): void;
}

/**
 * Twin-thumb controls for phones and tablets. Left thumb: a floating stick that appears where
 * it lands (up drives, sideways turns). Right thumb: drag to look. Buttons feed, fire, rise,
 * sink and pause. Everything writes into Input, so the sub reads touch and keyboard the same way.
 */
export class TouchControls {
  private stickId: number | null = null;
  private lookId: number | null = null;
  private readonly origin = { x: 0, y: 0 };
  private readonly last = { x: 0, y: 0 };
  private readonly base = document.getElementById('stick')!;
  private readonly knob = document.getElementById('stick-knob')!;

  constructor(
    canvas: HTMLElement,
    private readonly input: Input,
    private readonly actions: TouchActions,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));

    this.hold('t-up', 'Space');
    this.hold('t-down', 'KeyC');
    this.hold('t-fire', 'KeyR', () => actions.press('KeyR'));
    this.tap('t-feed', () => actions.press('KeyF'));
    this.tap('t-pause', () => actions.pause());
  }

  /** Lets go of everything, for when a run ends or the page is hidden mid-drag. */
  release() {
    this.endStick();
    this.lookId = null;
    for (const code of ['Space', 'KeyC', 'KeyR']) this.input.keys.delete(code);
    document.querySelectorAll('.t-btn.down').forEach((b) => b.classList.remove('down'));
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse' || !this.actions.playing()) return;
    // Stops the browser turning the tap into mouse events, which would drop food.
    e.preventDefault();
    if (e.clientX < window.innerWidth * STICK_ZONE) {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.origin.x = e.clientX;
      this.origin.y = e.clientY;
      this.base.classList.add('active');
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.last.x = e.clientX;
      this.last.y = e.clientY;
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.origin.x;
      const dy = e.clientY - this.origin.y;
      const dist = Math.hypot(dx, dy);
      const reach = dist / RADIUS;
      const s = this.input.stick;
      if (reach < DEAD_ZONE) {
        s.x = s.y = 0;
      } else {
        const mag = (Math.min(reach, 1) - DEAD_ZONE) / (1 - DEAD_ZONE);
        s.x = (dx / dist) * mag;
        s.y = (-dy / dist) * mag;
      }
      s.boost = reach > BOOST_AT;
      this.base.classList.toggle('boost', s.boost);
      const k = dist > RADIUS ? RADIUS / dist : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    } else if (e.pointerId === this.lookId) {
      this.input.addLook((e.clientX - this.last.x) * LOOK_SCALE, (e.clientY - this.last.y) * LOOK_SCALE);
      this.last.x = e.clientX;
      this.last.y = e.clientY;
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.stickId) this.endStick();
    else if (e.pointerId === this.lookId) this.lookId = null;
  }

  private endStick() {
    this.stickId = null;
    const s = this.input.stick;
    s.x = s.y = 0;
    s.boost = false;
    this.base.classList.remove('active', 'boost');
    this.base.style.left = this.base.style.top = '';
    this.knob.style.transform = '';
  }

  /** A button that holds a key down for as long as the finger stays on it. */
  private hold(id: string, code: string, onPress?: () => void) {
    const el = document.getElementById(id)!;
    const off = () => {
      this.input.keys.delete(code);
      el.classList.remove('down');
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Keep receiving this finger's events even if it slides off the button.
      el.setPointerCapture?.(e.pointerId);
      this.input.keys.add(code);
      el.classList.add('down');
      onPress?.();
    });
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private tap(id: string, fn: () => void) {
    const el = document.getElementById(id)!;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('down');
      fn();
    });
    const off = () => el.classList.remove('down');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
