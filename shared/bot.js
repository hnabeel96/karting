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
