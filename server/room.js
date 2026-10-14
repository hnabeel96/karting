// One race room: the referee. Runs the shared race rules at 60 ticks a second,
// takes each phone's inputs, drives the bots, and sends everyone snapshots.

import { TICK, createWorld } from '../shared/sim.js';
import { createRace, startRace, stepRace, RACE } from '../shared/race.js';
import { createPathBot, pathBotInput } from '../shared/bot.js';
import { SNAPSHOT_EVERY, packKart, packEntrant, packEvents, bits } from '../shared/net.js';
import { getTrack } from '../shared/arenas/index.js';

const MAX_PLAYERS = 8;
const BOT_NAMES = ['Mango', 'Pebble', 'Tikka', 'Zippy', 'Coco', 'Jumbo', 'Kiwi', 'Rocket'];
const INPUT_QUEUE_MAX = 6;

let nextId = 1;

export class Room {
  /**
   * @param track  id of the track to start on (players can change it in the lobby)
   * @param laps   force this many laps on every track (otherwise each track's own)
   */
  constructor({ track, laps, log = () => {} } = {}) {
    this.arena = getTrack(track);
    this.lapsOverride = laps || 0;
    this.laps = this.lapsOverride || this.arena.laps || 3;
    this.log = log;
    this.players = new Map(); // id -> player
    this.world = createWorld(this.arena);
    this.race = createRace(this.world, { laps: this.laps });
    this.pending = []; // events since the last snapshot
    this.tickCount = 0;
    this.timer = null;
  }

  // ------------------------------------------------------------ players

  usedColors() {
    return new Set([...this.players.values()].map((p) => p.color));
  }

  freeColor(preferred) {
    const used = this.usedColors();
    if (Number.isInteger(preferred) && preferred >= 0 && preferred < 8 && !used.has(preferred)) return preferred;
    for (let c = 0; c < 8; c++) if (!used.has(c)) return c;
    return 0;
  }

  join(ws, { name, color } = {}) {
    if (this.players.size >= MAX_PLAYERS) {
      // make room by dropping a bot if there is one
      const bot = [...this.players.values()].find((p) => p.bot);
      if (!bot) {
        ws.send(JSON.stringify({ t: 'full' }));
        ws.close();
        return null;
      }
      this.removePlayer(bot.id);
    }
    const id = 'p' + nextId++;
    const p = {
      id,
      name: cleanName(name) || `Player ${nextId - 1}`,
      color: this.freeColor(color),
      ws,
      bot: false,
      queue: [],
      last: { steer: 0, drift: false },
      ack: 0,
      ping: 0,
    };
    this.players.set(id, p);
    ws.send(JSON.stringify({ t: 'welcome', id, arena: this.arena.id, tick: this.tickCount }));
    this.log(`${p.name} joined (${this.humans().length} human, ${this.bots().length} bot)`);
    this.broadcastLobby();
    // late joiners watch the current race and get a kart next time
    return p;
  }

  addBot() {
    if (this.players.size >= MAX_PLAYERS) return;
    const id = 'b' + nextId++;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
    const bot = this.makeBot(this.bots().length);
    this.players.set(id, { id, name, color: this.freeColor(), bot, queue: [], last: { steer: 0, drift: false }, ack: 0, ping: 0 });
    this.broadcastLobby();
  }

  makeBot(n) {
    return createPathBot(this.arena.track, {
      lane: [-0.6, 0.6, 0, -1, 1, 0.3, -0.3, 0.8][n % 8],
      skill: [0.85, 0.7, 0.95, 0.6, 0.8, 0.75, 0.9, 0.65][n % 8],
      obstacles: this.arena.obstacles,
    });
  }

  /** switch tracks (lobby only): bots relearn the new racing line */
  setTrack(id) {
    const arena = getTrack(id);
    if (arena.id !== id || arena === this.arena) return;
    this.arena = arena;
    this.laps = this.lapsOverride || arena.laps || 3;
    this.world = createWorld(arena);
    this.race = createRace(this.world, { laps: this.laps });
    this.bots().forEach((p, i) => (p.bot = this.makeBot(i)));
    this.log(`track: ${arena.name}`);
    this.broadcastLobby();
  }

  removeBot() {
    const bots = this.bots();
    if (bots.length) this.removePlayer(bots[bots.length - 1].id);
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.world.karts = this.world.karts.filter((k) => k.id !== id);
    delete this.race.entrants[id];
    if (!p.bot) this.log(`${p.name} left`);
    if (this.humans().length === 0) {
      // nobody left watching: clear the bots and go back to the lobby
      for (const b of this.bots()) this.players.delete(b.id);
      this.toLobby();
    }
    this.broadcastLobby();
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  bots() {
    return [...this.players.values()].filter((p) => p.bot);
  }

  // ------------------------------------------------------------ messages

  onMessage(p, raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.t) {
      case 'input': {
        const seq = m.s | 0;
        if (seq <= p.ack) return;
        p.queue.push({ seq, steer: Math.max(-1, Math.min(1, Number(m.x) || 0)), drift: !!m.d });
        if (p.queue.length > INPUT_QUEUE_MAX) p.queue.splice(0, p.queue.length - 3);
        break;
      }
      case 'name':
        p.name = cleanName(m.name) || p.name;
        if (Number.isInteger(m.color)) p.color = this.freeColor(m.color) === m.color ? m.color : p.color;
        this.broadcastLobby();
        break;
      case 'start':
        if (this.race.phase === 'lobby' || this.race.phase === 'results') this.start();
        break;
      case 'lobby':
        if (this.race.phase === 'results') this.toLobby();
        break;
      case 'addBot':
        if (this.race.phase === 'lobby') this.addBot();
        break;
      case 'track':
        if (this.race.phase === 'lobby') this.setTrack(String(m.id));
        break;
      case 'removeBot':
        if (this.race.phase === 'lobby') this.removeBot();
        break;
      case 'ping':
        p.ws.send(JSON.stringify({ t: 'pong', c: m.c }));
        if (Number.isFinite(m.rtt)) p.ping = Math.round(m.rtt);
        break;
      default:
    }
  }

  // ------------------------------------------------------------ race flow

  start() {
    const order = [...this.humans(), ...this.bots()].map((p) => p.id);
    if (!this.humans().length) return;
    this.world = createWorld(this.arena);
    this.race = createRace(this.world, { laps: this.laps });
    startRace(this.race, this.world, order);
    for (const p of this.players.values()) {
      p.queue = [];
      p.last = { steer: 0, drift: false };
      if (p.bot) p.bot.idx = -1;
    }
    this.pending.push({ type: 'raceStart' });
    this.log(`race started with ${order.length} karts`);
    this.broadcastLobby();
  }

  toLobby() {
    this.race.phase = 'lobby';
    this.world.karts = [];
    this.race.entrants = {};
    this.broadcastLobby();
  }

  tick() {
    const inputs = {};
    for (const p of this.players.values()) {
      if (p.bot) {
        const k = this.world.karts.find((k) => k.id === p.id);
        if (k) inputs[p.id] = pathBotInput(p.bot, k, TICK);
        continue;
      }
      const next = p.queue.shift();
      if (next) {
        p.last = next;
        p.ack = next.seq;
      }
      inputs[p.id] = p.last;
    }
    const events = stepRace(this.race, this.world, inputs);
    for (const e of events) this.pending.push(e);
    if (events.some((e) => e.type === 'raceEnd')) {
      this.log('race over: ' + Object.entries(this.race.entrants).sort((a, b) => a[1].place - b[1].place).map(([id]) => this.players.get(id)?.name).join(', '));
    }
    this.tickCount++;
    if (this.tickCount % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  snapshot() {
    const r = this.race;
    return {
      t: 's',
      n: this.tickCount,
      ph: r.phase,
      cd: Math.round(r.countdown * 100) / 100,
      rt: Math.round(r.t * 1000) / 1000,
      laps: r.laps,
      ff: r.firstFinish === null ? -1 : r.firstFinish,
      grace: RACE.finishGrace,
      k: this.world.karts.map((k) => packKart(k, this.players.get(k.id)?.ack || 0)),
      e: Object.entries(r.entrants).map(([id, e]) => packEntrant(id, e)),
      cr: bits(this.world.crates),
      fr: bits(this.world.fruit),
      ev: packEvents(this.pending),
    };
  }

  broadcastSnapshot() {
    if (this.race.phase === 'lobby' && !this.pending.length) return;
    const msg = JSON.stringify(this.snapshot());
    this.pending = [];
    for (const p of this.humans()) p.ws.send(msg);
  }

  lobbyState() {
    return {
      t: 'lobby',
      phase: this.race.phase,
      arena: this.arena.id,
      laps: this.laps,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, bot: !!p.bot, ping: p.ping, racing: !!this.race.entrants[p.id] })),
    };
  }

  broadcastLobby() {
    const msg = JSON.stringify(this.lobbyState());
    for (const p of this.humans()) p.ws.send(msg);
  }

  // ------------------------------------------------------------ clock

  run() {
    let last = performance.now();
    let acc = 0;
    let lobbyPing = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(250, now - last);
      last = now;
      let steps = 0;
      while (acc >= TICK * 1000 && steps < 8) {
        this.tick();
        acc -= TICK * 1000;
        steps++;
      }
      // keep ping numbers in the lobby fresh
      if (now - lobbyPing > 2000 && this.race.phase === 'lobby') {
        lobbyPing = now;
        this.broadcastLobby();
      }
    }, 4);
  }

  stop() {
    clearInterval(this.timer);
  }
}

function cleanName(s) {
  return String(s || '')
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .trim()
    .slice(0, 14);
}
