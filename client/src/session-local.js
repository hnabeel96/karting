// A game that runs entirely on this phone: the title-screen demo, free driving,
// and races against bots. Same rules as the server, no network.

import { TICK, createWorld, addKart, stepWorld } from '@shared/sim.js';
import { createRace, startRace, stepRace } from '@shared/race.js';
import { createBot, botInput, createPathBot, pathBotInput } from '@shared/bot.js';
import { lerp, lerpAngle } from './util.js';

const BOT_NAMES = ['Mango', 'Pebble', 'Tikka', 'Zippy', 'Coco', 'Jumbo', 'Kiwi'];

export class LocalSession {
  /**
   * @param arena
   * @param opts.player  true: a kart for this phone (id 'me')
   * @param opts.bots    number of bot karts
   * @param opts.race    true: grid, countdown, laps
   * @param opts.name    this phone's player name
   */
  constructor(arena, { player = true, bots = 0, race = false, name = 'You', color = 0 } = {}) {
    this.arena = arena;
    this.online = false;
    this.localId = player ? 'me' : null;
    this.world = createWorld(arena);
    this.names = {};
    this.colors = {};
    this.bots = {};
    this.prev = {};
    const ids = [];
    if (player) {
      ids.push('me');
      this.names.me = name;
      this.colors.me = color;
    }
    for (let i = 0; i < bots; i++) {
      const id = 'bot' + i;
      ids.push(id);
      this.names[id] = BOT_NAMES[i % BOT_NAMES.length];
      this.colors[id] = (color + 1 + i) % 8;
      this.bots[id] = arena.track
        ? createPathBot(arena.track, { lane: [-0.6, 0.6, 0, -1, 1, 0.3, -0.3][i % 7], skill: [0.9, 0.75, 0.6, 0.85, 0.7, 0.8, 0.65][i % 7], obstacles: arena.obstacles })
        : createBot();
    }
    this.race = race ? createRace(this.world) : null;
    if (this.race) startRace(this.race, this.world, ids);
    else ids.forEach((id, i) => addKart(this.world, id, i));
    if (!player && !arena.track) {
      // the courtyard demo driver starts on the ring around the temple, already rolling
      Object.assign(this.world.karts[0], { x: 0, z: -16, yaw: Math.PI / 2, vx: 18, vz: 0 });
    }
    this.snapPrev();
  }

  snapPrev() {
    for (const k of this.world.karts) this.prev[k.id] = { x: k.x, z: k.z, yaw: k.yaw };
  }

  /** one fixed step; `input` is this phone's controls */
  tick(input) {
    this.snapPrev();
    const inputs = {};
    for (const k of this.world.karts) {
      const bot = this.bots[k.id];
      if (bot) inputs[k.id] = bot.track ? pathBotInput(bot, k, TICK) : botInput(bot, k, TICK);
      else if (k.id === this.localId) inputs[k.id] = input;
    }
    return this.race ? stepRace(this.race, this.world, inputs) : stepWorld(this.world, inputs);
  }

  /** karts to draw, interpolated `alpha` of the way through the current tick */
  karts(alpha) {
    return this.world.karts.map((k) => {
      const p = this.prev[k.id] || k;
      return { id: k.id, k, pose: { x: lerp(p.x, k.x, alpha), z: lerp(p.z, k.z, alpha), yaw: lerpAngle(p.yaw, k.yaw, alpha) } };
    });
  }

  raceInfo() {
    const r = this.race;
    if (!r) return null;
    return { phase: r.phase, countdown: r.countdown, t: r.t, laps: r.laps, entrants: r.entrants, firstFinish: r.firstFinish };
  }

  pickups() {
    return { crates: this.world.crates.map((c) => c.alive), fruit: this.world.fruit.map((f) => f.alive) };
  }

  restart() {
    if (!this.race) return;
    const ids = this.world.karts.map((k) => k.id);
    this.world = createWorld(this.arena);
    this.race = createRace(this.world);
    startRace(this.race, this.world, ids);
    for (const b of Object.values(this.bots)) b.idx = -1;
    this.snapPrev();
  }

  close() {}
}
