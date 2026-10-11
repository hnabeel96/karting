// A race on the game server. The server is the referee; this phone:
//  - sends its controls every tick,
//  - predicts its own kart immediately so steering never feels laggy,
//  - corrects that prediction when the server's answer arrives (replaying unconfirmed inputs),
//  - shows everyone else slightly in the past, smoothly between snapshots.

import { createKart, stepKart, collideArena, expandFruit } from '@shared/sim.js';
import { unpackKart, unpackEntrant } from '@shared/net.js';
import { lerp, lerpAngle } from './util.js';

const INTERP_DELAY = 110; // ms behind the newest snapshot that other karts are drawn
const PREDICTED = new Set(['hop', 'land', 'boost', 'fizzle', 'driftStart', 'driftEnd', 'bonk']);

export function serverUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export class NetSession {
  constructor(arena, { name, color, onLobby, onStatus } = {}) {
    this.arena = arena;
    this.online = true;
    this.localId = null;
    this.status = 'connecting';
    this.lobby = null;
    this.phase = 'lobby';
    this.info = null;
    this.names = {};
    this.colors = {};
    this.inbox = [];
    this.seq = 0;
    this.history = [];
    this.me = null;
    this.mePrev = null;
    this.err = { x: 0, z: 0, yaw: 0 };
    this.buffer = []; // [{at, karts: Map}]
    this.crates = arena.crates.map(() => true);
    this.fruit = expandFruit(arena).map(() => true);
    this.rtt = 0;
    this.onLobby = onLobby || (() => {});
    this.onStatus = onStatus || (() => {});

    const ws = (this.ws = new WebSocket(serverUrl()));
    const timeout = setTimeout(() => {
      if (this.status === 'connecting') this.fail('timeout');
    }, 4000);
    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      ws.send(JSON.stringify({ t: 'hello', name, color }));
      this.setStatus('open');
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now(), rtt: this.rtt }), 1000);
    });
    ws.addEventListener('message', (ev) => this.onMessage(ev.data));
    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      clearInterval(this.pingTimer);
      if (this.status !== 'failed') this.setStatus('closed');
    });
    ws.addEventListener('error', () => this.fail('error'));
  }

  setStatus(s) {
    this.status = s;
    this.onStatus(s);
  }

  fail(why) {
    if (this.status === 'failed') return;
    this.why = why;
    this.setStatus('failed');
    try {
      this.ws.close();
    } catch {}
  }

  send(o) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  close() {
    clearInterval(this.pingTimer);
    this.setStatus('closed');
    try {
      this.ws.close();
    } catch {}
  }

  // ------------------------------------------------------------ messages

  onMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'welcome') this.localId = m.id;
    else if (m.t === 'lobby') {
      this.lobby = m;
      for (const p of m.players) {
        this.names[p.id] = p.name;
        this.colors[p.id] = p.color;
      }
      if (m.phase === 'lobby') {
        this.phase = 'lobby';
        this.me = null;
        this.buffer = [];
      }
      this.onLobby(m);
    } else if (m.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - m.c) * 0.3 : performance.now() - m.c;
    else if (m.t === 'full') this.fail('full');
    else if (m.t === 's') this.onSnapshot(m);
  }

  onSnapshot(s) {
    this.phase = s.ph;
    const entrants = {};
    for (const a of s.e) {
      const e = unpackEntrant(a);
      entrants[e.id] = e;
    }
    this.info = { phase: s.ph, countdown: s.cd, t: s.rt, laps: s.laps, entrants, firstFinish: s.ff < 0 ? null : s.ff, grace: s.grace, at: performance.now() };
    this.crates = [...s.cr].map((c) => c === '1');
    this.fruit = [...s.fr].map((c) => c === '1');

    for (const e of s.ev) {
      if (e.kart === this.localId && PREDICTED.has(e.type)) continue; // already shown by prediction
      if (e.type === 'raceStart') {
        this.me = null;
        this.buffer = [];
        this.history = [];
      }
      this.inbox.push(e);
    }

    const others = new Map();
    for (const arr of s.k) {
      if (arr[0] === this.localId) this.reconcile(arr);
      else {
        const k = {};
        unpackKart(arr, k);
        others.set(k.id, k);
      }
    }
    if (!s.k.some((a) => a[0] === this.localId)) this.me = null;
    this.buffer.push({ at: performance.now(), karts: others });
    if (this.buffer.length > 30) this.buffer.shift();
  }

  /** the server's word on my kart: adopt it, then replay what it has not seen yet */
  reconcile(arr) {
    const server = createKart(this.localId, { x: 0, z: 0, yaw: 0 });
    const ack = unpackKart(arr, server);
    if (!this.me) {
      this.me = server;
      this.mePrev = { x: server.x, z: server.z, yaw: server.yaw };
      this.history = this.history.filter((h) => h.seq > ack);
      return;
    }
    const before = { x: this.me.x, z: this.me.z, yaw: this.me.yaw };
    this.history = this.history.filter((h) => h.seq > ack);
    const moving = this.phase === 'race' || this.phase === 'results';
    const sink = [];
    for (const h of this.history) {
      if (!moving) break;
      stepKart(server, h.input, sink);
      collideArena(server, this.arena, sink);
    }
    this.me = server;
    const dx = before.x - server.x;
    const dz = before.z - server.z;
    if (Math.hypot(dx, dz) > 6) {
      // a rescue or a big knock: jump, do not slide
      this.err = { x: 0, z: 0, yaw: 0 };
      this.mePrev = { x: server.x, z: server.z, yaw: server.yaw };
    } else {
      this.err.x += dx;
      this.err.z += dz;
      this.err.yaw += Math.atan2(Math.sin(before.yaw - server.yaw), Math.cos(before.yaw - server.yaw));
    }
  }

  // ------------------------------------------------------------ the loop

  tick(input) {
    if (this.status !== 'open' || !this.localId || this.phase === 'lobby') return this.drain();
    this.seq++;
    this.send({ t: 'input', s: this.seq, x: Math.round(input.steer * 1000) / 1000, d: input.drift ? 1 : 0 });
    this.history.push({ seq: this.seq, input: { steer: input.steer, drift: input.drift } });
    if (this.history.length > 180) this.history.shift();
    if (this.me) {
      this.mePrev = { x: this.me.x, z: this.me.z, yaw: this.me.yaw };
      const racing = this.phase === 'race' || this.phase === 'results';
      if (racing) {
        const evs = [];
        stepKart(this.me, input, evs);
        collideArena(this.me, this.arena, evs);
        for (const e of evs) this.inbox.push(e);
      } else {
        this.me.held = !!input.drift;
      }
    }
    // the visual correction melts away over a few frames
    const k = 0.86;
    this.err.x *= k;
    this.err.z *= k;
    this.err.yaw *= k;
    return this.drain();
  }

  drain() {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }

  karts(alpha) {
    const out = [];
    if (this.me) {
      const p = this.mePrev || this.me;
      out.push({
        id: this.localId,
        k: this.me,
        pose: {
          x: lerp(p.x, this.me.x, alpha) + this.err.x,
          z: lerp(p.z, this.me.z, alpha) + this.err.z,
          yaw: lerpAngle(p.yaw, this.me.yaw, alpha) + this.err.yaw,
        },
      });
    }
    // others, drawn a little in the past between two snapshots
    const b = this.buffer;
    if (!b.length) return out;
    const t = performance.now() - INTERP_DELAY;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > t) i--;
    const newer = b[i];
    const older = i > 0 ? b[i - 1] : newer;
    const span = newer.at - older.at || 1;
    const f = Math.max(0, Math.min(1, (t - older.at) / span));
    for (const [id, k] of newer.karts) {
      const o = older.karts.get(id) || k;
      out.push({ id, k, pose: { x: lerp(o.x, k.x, f), z: lerp(o.z, k.z, f), yaw: lerpAngle(o.yaw, k.yaw, f) } });
    }
    return out;
  }

  raceInfo() {
    if (!this.info || this.phase === 'lobby') return null;
    const i = this.info;
    // keep the clock running smoothly between snapshots
    const since = i.phase === 'race' ? (performance.now() - i.at) / 1000 : 0;
    return { ...i, t: i.t + since };
  }

  pickups() {
    return { crates: this.crates, fruit: this.fruit };
  }

  // lobby actions
  start() { this.send({ t: 'start' }); }
  toLobby() { this.send({ t: 'lobby' }); }
  addBot() { this.send({ t: 'addBot' }); }
  removeBot() { this.send({ t: 'removeBot' }); }
  rename(name, color) { this.send({ t: 'name', name, color }); }
}
