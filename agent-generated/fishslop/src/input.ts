export class Input {
  readonly keys = new Set<string>();
  readonly buttons = new Set<number>();
  locked = false;
  /** Pointer lock refused (some embeds, some browsers): steer with arrow keys instead. */
  fallback = false;
  onKey: (code: string) => void = () => {};
  onClick: (button: number) => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};
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
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.active) return;
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
    return this.locked || this.fallback;
  }

  requestLock() {
    if (this.fallback) return;
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
