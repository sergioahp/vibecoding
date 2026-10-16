export class Input {
  readonly keys = new Set<string>();
  readonly buttons = new Set<number>();
  /** On-screen stick from the touch controls, -1..1: x turns right, y drives forward. */
  readonly stick = { x: 0, y: 0, boost: false };
  locked = false;
  /** Pointer lock refused (some embeds, some browsers): steer with arrow keys instead. */
  fallback = false;
  /** Touch controls drive the sub, so there's no pointer lock to hold. */
  touch = false;
  onKey: (code: string) => void = () => {};
  onClick: (button: number) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
  onModeChange: (touch: boolean) => void = () => {};
  private lookX = 0;
  private lookY = 0;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.onKey(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
      this.stick.x = this.stick.y = 0;
      this.stick.boost = false;
    });
    // Whatever the player last pressed with decides the controls, so a touchscreen laptop
    // switches to the on-screen stick on a tap and back to mouse look on a click.
    document.addEventListener('pointerdown', (e) => this.setTouch(e.pointerType !== 'mouse'), true);
    el.addEventListener('mousedown', (e) => {
      if (!this.active || this.touch) return;
      this.buttons.add(e.button);
      this.onClick(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.buttons.clear();
      this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.fallback = true;
      this.onLockChange(false);
    });
  }

  get active() {
    return this.locked || this.fallback || this.touch;
  }

  /** Whether play depends on holding pointer lock, so losing it pauses. */
  get needsLock() {
    return !this.fallback && !this.touch;
  }

  setTouch(on: boolean) {
    if (on === this.touch) return;
    this.touch = on;
    this.stick.x = this.stick.y = 0;
    this.stick.boost = false;
    this.onModeChange(on);
  }

  /** Look input in mouse pixels; the touch controls scale their drags into it. */
  addLook(dx: number, dy: number) {
    this.lookX += dx;
    this.lookY += dy;
  }

  requestLock() {
    if (!this.needsLock) return;
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {
        this.fallback = true;
        this.onLockChange(false);
      });
    } catch {
      this.fallback = true;
      this.onLockChange(false);
    }
  }

  consumeLook(): [number, number] {
    const out: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return out;
  }

  axis(neg: string[], pos: string[]) {
    return (pos.some((k) => this.keys.has(k)) ? 1 : 0) - (neg.some((k) => this.keys.has(k)) ? 1 : 0);
  }
}
