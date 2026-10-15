// Tiny synthesized sound effects. Nothing loads from disk.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.5, slideTo?: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  plop() {
    this.tone(520, 0.12, 'sine', 0.4, 180);
  }
  gulp() {
    this.tone(220, 0.09, 'sine', 0.35, 420);
  }
  coin(value: number) {
    const base = value >= 150 ? 1320 : value >= 35 ? 1046 : 880;
    this.tone(base, 0.08, 'square', 0.18);
    this.tone(base * 1.5, 0.16, 'square', 0.15, undefined, 0.06);
  }
  pew() {
    this.tone(1400, 0.1, 'sawtooth', 0.12, 300);
  }
  hit() {
    this.tone(160, 0.12, 'square', 0.25, 70);
  }
  buy() {
    [660, 830, 990].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.3, undefined, i * 0.07));
  }
  deny() {
    this.tone(180, 0.18, 'square', 0.18, 140);
  }
  grow() {
    [520, 660, 880, 1040].forEach((f, i) => this.tone(f, 0.1, 'triangle', 0.25, undefined, i * 0.05));
  }
  death() {
    this.tone(400, 0.6, 'sine', 0.3, 80);
  }
  siren() {
    for (let i = 0; i < 3; i++) this.tone(440, 0.35, 'sawtooth', 0.15, 880, i * 0.4);
  }
  monsterDown() {
    [880, 660, 520, 1320].forEach((f, i) => this.tone(f, 0.18, 'square', 0.2, undefined, i * 0.09));
  }
  win() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.3, undefined, i * 0.14));
  }
}
