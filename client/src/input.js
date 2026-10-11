// Phone controls: drag anywhere on the left half to steer, hold anywhere on the right
// half to hop and drift. Keyboard works too (arrows or A/D, Space or Shift).

import { clamp } from './util.js';

export class Controls {
  constructor({ steerZone, driftZone, pill, knob, driftBtn }) {
    this.steer = 0;
    this.drift = false;
    this.enabled = false;
    this.els = { pill, knob, driftBtn };

    this.steerId = null;
    this.anchorX = 0;
    this.touchSteer = 0;
    this.driftIds = new Set();
    this.keys = new Set();
    this.keySteer = 0;

    const range = () => Math.max(46, Math.min(window.innerWidth, window.innerHeight) * 0.14);

    steerZone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.steerId !== null) return;
      e.preventDefault();
      this.steerId = e.pointerId;
      this.anchorX = e.clientX;
      steerZone.setPointerCapture?.(e.pointerId);
      pill.style.left = `${e.clientX}px`;
      pill.style.top = `${e.clientY}px`;
      pill.classList.add('active');
      this.touchSteer = 0;
      this.drawKnob();
    });
    steerZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      const r = range();
      let dx = e.clientX - this.anchorX;
      // the anchor trails the finger, so reversing direction is instant
      if (dx > r) { this.anchorX = e.clientX - r; dx = r; }
      if (dx < -r) { this.anchorX = e.clientX + r; dx = -r; }
      pill.style.left = `${this.anchorX}px`;
      const dead = 5;
      const s = Math.abs(dx) < dead ? 0 : (dx - Math.sign(dx) * dead) / (r - dead);
      this.touchSteer = clamp(s, -1, 1);
      this.drawKnob();
    });
    const endSteer = (e) => {
      if (e.pointerId !== this.steerId) return;
      this.steerId = null;
      this.touchSteer = 0;
      pill.classList.remove('active');
      this.drawKnob();
    };
    steerZone.addEventListener('pointerup', endSteer);
    steerZone.addEventListener('pointercancel', endSteer);

    driftZone.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.driftIds.add(e.pointerId);
      driftZone.setPointerCapture?.(e.pointerId);
      driftBtn.classList.add('down');
    });
    const endDrift = (e) => {
      this.driftIds.delete(e.pointerId);
      if (!this.driftIds.size) driftBtn.classList.remove('down');
    };
    driftZone.addEventListener('pointerup', endDrift);
    driftZone.addEventListener('pointercancel', endDrift);

    const map = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      Space: 'drift', ShiftLeft: 'drift', ShiftRight: 'drift', KeyJ: 'drift', KeyK: 'drift',
    };
    window.addEventListener('keydown', (e) => {
      const k = map[e.code];
      if (!k || !this.enabled) return;
      e.preventDefault();
      this.keys.add(k);
      if (k === 'drift') driftBtn.classList.add('down');
    });
    window.addEventListener('keyup', (e) => {
      const k = map[e.code];
      if (!k) return;
      this.keys.delete(k);
      if (k === 'drift' && !this.driftIds.size) driftBtn.classList.remove('down');
    });
    window.addEventListener('blur', () => this.reset());
  }

  drawKnob() {
    this.els.knob.style.transform = `translate(calc(-50% + ${this.touchSteer * 38}px), -50%)`;
  }

  reset() {
    this.keys.clear();
    this.driftIds.clear();
    this.steerId = null;
    this.touchSteer = 0;
    this.els.pill.classList.remove('active');
    this.els.driftBtn.classList.remove('down');
    this.drawKnob();
  }

  /** call once per sim tick */
  read(dt) {
    const want = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    // keyboard steering ramps so taps make small corrections
    const rate = want === 0 ? 12 : Math.sign(want) !== Math.sign(this.keySteer) ? 14 : 6;
    this.keySteer += clamp(want - this.keySteer, -rate * dt, rate * dt);
    const steer = this.steerId !== null ? this.touchSteer : this.keySteer;
    this.steer = clamp(steer, -1, 1);
    this.drift = this.driftIds.size > 0 || this.keys.has('drift');
    return { steer: this.steer, drift: this.drift };
  }
}
