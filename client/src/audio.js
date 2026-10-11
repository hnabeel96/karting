// Every sound is synthesised with WebAudio: no files to download.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.fruitStreak = 0;
    this.lastFruit = 0;
  }

  /** must be called from a tap */
  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // one second of white noise, reused for everything noisy
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // engine: two detuned oscillators through a lowpass
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 700;
    this.engFilter.Q.value = 4;
    this.eng1 = ctx.createOscillator();
    this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator();
    this.eng2.type = 'square';
    this.eng1.connect(this.engFilter);
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.eng2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.eng1.start();
    this.eng2.start();

    // tyre screech: looped noise through a narrow band
    this.skid = ctx.createBufferSource();
    this.skid.buffer = buf;
    this.skid.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 2300;
    this.skidFilter.Q.value = 6;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skid.connect(this.skidFilter).connect(this.skidGain).connect(this.master);
    this.skid.start();

    // jungle ambience: soft wind plus the odd bird
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
    this.birdT = 2;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, type = 'lowpass', f0 = 1000, f1 = f0, delay = 0, q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // ---- game events
  hop() { this.tone('triangle', 260, 560, 0.13, 0.12); }
  land() { this.tone('sine', 140, 60, 0.12, 0.16); this.noise(0.08, 0.06, 'lowpass', 500); }
  window() { this.tone('sine', 1320, 1320, 0.07, 0.09); this.tone('sine', 1980, 1980, 0.06, 0.05, 0.03); }
  boost(level) {
    const base = [0, 330, 440, 587][level] || 330;
    this.tone('sawtooth', base, base * 2, 0.22, 0.09);
    this.tone('square', base * 1.5, base * 3, 0.18, 0.05, 0.04);
    this.noise(0.45, 0.22, 'highpass', 600, 3800);
  }
  fizzle() {
    for (let i = 0; i < 3; i++) this.tone('square', 95 - i * 10, 60, 0.06, 0.08, i * 0.07);
    this.noise(0.3, 0.1, 'lowpass', 600, 200);
  }
  bonk(impact) {
    const v = Math.min(1, impact / 18);
    this.tone('sine', 210, 50, 0.22, 0.25 * v + 0.08);
    this.noise(0.14, 0.2 * v + 0.05, 'lowpass', 900, 200);
  }
  crate() {
    this.noise(0.22, 0.32, 'bandpass', 1200, 500, 0, 1.4);
    this.tone('square', 150, 70, 0.16, 0.12);
    for (let i = 0; i < 4; i++) this.noise(0.03, 0.12, 'highpass', 3000, 3000, 0.05 + i * 0.045);
  }
  fruit() {
    const now = performance.now();
    this.fruitStreak = now - this.lastFruit < 900 ? this.fruitStreak + 1 : 0;
    this.lastFruit = now;
    const f = 880 * Math.pow(2, Math.min(this.fruitStreak, 12) / 12);
    this.tone('sine', f, f, 0.12, 0.13);
    this.tone('triangle', f * 2, f * 2, 0.08, 0.05, 0.02);
  }
  juiced() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.12, i * 0.07));
  }
  click() { this.tone('triangle', 660, 990, 0.08, 0.1); }

  /** continuous sounds, every frame */
  update(dt, k, drifting) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const speed = Math.hypot(k.vx, k.vz);
    const boost = k.boostT > 0 ? k.boostLevel : 0;
    const f = 48 + speed * 3.2 + boost * 22 + (k.hopT > 0 ? 14 : 0);
    this.eng1.frequency.setTargetAtTime(f, t, 0.05);
    this.eng2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(500 + speed * 45 + boost * 500, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.05 + Math.min(1, speed / 25) * 0.07, t, 0.1);
    const skidVol = drifting ? 0.05 + Math.min(1, k.charge) * 0.04 : 0;
    this.skidGain.gain.setTargetAtTime(skidVol, t, drifting ? 0.03 : 0.08);
    this.skidFilter.frequency.setTargetAtTime(1900 + Math.sin(t * 23) * 250 + k.charge * 600, t, 0.02);

    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 3 + Math.random() * 6;
      const b = 1800 + Math.random() * 1600;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.tone('sine', b, b * 1.35, 0.07, 0.025, i * 0.11);
    }
  }
}
