// A simple driver that laps the ring around the temple and pump-boosts its drifts.
// Used for the title-screen attract mode now, and to fill empty seats later.
// It only produces inputs, exactly like a phone would.

import { TUNING, inWindow } from './sim.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createBot({ radius = 16, lookahead = -0.5, skill = 1 } = {}) {
  return { radius, lookahead, skill, holding: false, gap: 0, cool: 0.8, hold3: 0 };
}

export function botInput(bot, k, dt) {
  // pure pursuit: aim at a point a little further along a circle around the centre
  const a = Math.atan2(k.x, k.z) + bot.lookahead;
  const tx = bot.radius * Math.sin(a);
  const tz = bot.radius * Math.cos(a);
  const want = Math.atan2(tx - k.x, tz - k.z);
  const diff = wrap(want - k.yaw);
  const steer = clamp(-diff * 2.4, -1, 1);

  bot.cool = Math.max(0, bot.cool - dt);

  if (k.state === 'drive') {
    bot.gap = 0; // a pump left over from a drift that already ended
    if (bot.holding && k.hopT <= 0) {
      // the hop never became a drift, or the drift just ended: let go
      bot.holding = false;
      bot.cool = 0.9;
    } else if (!bot.holding && bot.cool <= 0 && Math.abs(steer) > 0.35) {
      bot.holding = true;
    }
    return { steer, drift: bot.holding };
  }

  // drifting
  if (bot.gap > 0) {
    bot.gap--;
    return { steer, drift: false };
  }
  if (k.pumps < TUNING.maxPumps) {
    // pump in the middle of the window
    if (inWindow(k.charge) && k.charge > (TUNING.windowLo + TUNING.windowHi) / 2 - 0.05 * bot.skill) {
      bot.gap = 2;
      return { steer, drift: false };
    }
    bot.hold3 = 0;
  } else {
    bot.hold3 += dt;
    if (bot.hold3 > 0.7) {
      bot.holding = false;
      bot.hold3 = 0;
      bot.cool = 1.1;
      return { steer, drift: false };
    }
  }
  return { steer, drift: true };
}

// ---------------------------------------------------------------- racing bot

/**
 * Follows a track's centre line (with its own lane offset), drifts the bends and
 * pump-boosts them. `skill` 0..1: how far ahead it looks and how cleanly it pumps.
 */
export function createPathBot(track, { lane = 0, skill = 0.8, seed = 1, obstacles = [] } = {}) {
  // obstacles sitting on the road, located by track position and sideways offset
  const n = track.center.length;
  const hazards = obstacles
    .filter((o) => o.shape === 'circle')
    .map((o) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (track.center[i].x - o.x) ** 2 + (track.center[i].z - o.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const c = track.center[best];
      return { idx: best, lat: (o.x - c.x) * c.nx + (o.z - c.z) * c.nz, r: o.r };
    })
    .filter((h) => Math.abs(h.lat) < track.width / 2 + h.r);
  return { track, lane, skill, idx: -1, holding: false, gap: 0, cool: 0, hold3: 0, seed, hazards };
}

export function pathBotInput(bot, k, dt) {
  const { center, width, length } = bot.track;
  const n = center.length;
  const step = length / n;

  // where am I along the track? search near the last known point
  if (bot.idx < 0) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (center[i].x - k.x) ** 2 + (center[i].z - k.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    bot.idx = best;
  } else {
    let best = bot.idx;
    let bd = Infinity;
    for (let o = -3; o <= 8; o++) {
      const i = (bot.idx + o + n) % n;
      const d = (center[i].x - k.x) ** 2 + (center[i].z - k.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    bot.idx = best;
  }

  const look = Math.round((7 + bot.skill * 6) / step);
  const c = center[(bot.idx + look) % n];
  let lat = bot.lane * width * 0.22;
  // swerve round anything on the road in the next 35 metres
  for (const h of bot.hazards) {
    const ahead = (h.idx - bot.idx + n) % n;
    if (ahead * step > 35 || ahead === 0) continue;
    const clear = h.r + 3.4;
    if (Math.abs(lat - h.lat) < clear) {
      const side = lat === h.lat ? (h.lat > 0 ? -1 : 1) : Math.sign(lat - h.lat);
      lat = h.lat + side * clear;
      if (Math.abs(lat) > width / 2 - 1.5) lat = h.lat - side * clear;
    }
  }
  const tx = c.x + c.nx * lat;
  const tz = c.z + c.nz * lat;
  const diff = wrap(Math.atan2(tx - k.x, tz - k.z) - k.yaw);
  const steer = clamp(-diff * 2.6, -1, 1);

  // how sharp is the road further ahead?
  const far = center[(bot.idx + look * 3) % n];
  const bend = Math.abs(wrap(far.yaw - center[bot.idx].yaw));
  const speed = Math.hypot(k.vx, k.vz);

  bot.cool = Math.max(0, bot.cool - dt);
  if (k.state === 'drive') {
    bot.gap = 0; // a pump left over from a drift that already ended
    if (bot.holding && k.hopT <= 0) {
      bot.holding = false;
      bot.cool = 0.5;
    } else if (!bot.holding && bot.cool <= 0 && bend > 0.55 && speed > 12 && Math.abs(steer) > 0.3) {
      bot.holding = true;
    }
    return { steer, drift: bot.holding };
  }

  if (bot.gap > 0) {
    bot.gap--;
    return { steer, drift: false };
  }
  if (bend < 0.2 && k.pumps > 0) {
    // road straightens out: let go
    bot.holding = false;
    bot.cool = 0.6;
    return { steer, drift: false };
  }
  if (k.pumps < TUNING.maxPumps) {
    const aim = TUNING.windowLo + (TUNING.windowHi - TUNING.windowLo) * (0.75 - bot.skill * 0.3);
    if (inWindow(k.charge) && k.charge >= aim) {
      bot.gap = 2;
      return { steer, drift: false };
    }
  }
  return { steer, drift: true };
}
