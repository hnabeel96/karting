import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICK, TUNING, createWorld, addKart, stepWorld, speedOf, expandFruit,
} from '../shared/sim.js';
import { createBot, botInput } from '../shared/bot.js';
import temple from '../shared/arenas/temple.js';

// an empty arena so tests are not disturbed by obstacles
const open = { ...temple, half: 500, obstacles: [], crates: [], fruitLines: [], spawns: [{ x: 0, z: 0, yaw: 0 }] };

function run(world, inputFn, seconds) {
  const all = [];
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) {
    const evs = stepWorld(world, inputFn(i, world));
    for (const e of evs) all.push({ ...e, tick: world.tick });
  }
  return all;
}

test('auto-accelerates to top speed driving straight', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  run(w, () => ({ a: { steer: 0, drift: false } }), 3);
  assert.ok(Math.abs(speedOf(k) - TUNING.topSpeed) < 0.5, `speed ${speedOf(k)}`);
  assert.ok(k.z > 20, 'moved forward along +z');
  assert.ok(Math.abs(k.x) < 1e-9, 'did not drift sideways');
});

test('steering right turns toward -x (screen right with a chase camera)', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  run(w, () => ({ a: { steer: 0, drift: false } }), 1.5);
  run(w, () => ({ a: { steer: 1, drift: false } }), 0.5);
  assert.ok(k.yaw < 0);
  assert.ok(k.x < 0);
});

test('hold drift while steering: hop, then drift', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  run(w, () => ({ a: { steer: 0, drift: false } }), 1.5);
  const evs = run(w, () => ({ a: { steer: 1, drift: true } }), 0.5);
  assert.ok(evs.some((e) => e.type === 'hop'));
  assert.ok(evs.some((e) => e.type === 'driftStart' && e.dir === 1));
  assert.equal(k.state, 'drift');
  assert.ok(k.charge > 0);
});

test('hop with no steering does not start a drift', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  run(w, () => ({ a: { steer: 0, drift: false } }), 1.5);
  run(w, () => ({ a: { steer: 0, drift: true } }), 0.6);
  assert.equal(k.state, 'drive');
});

function driftThen(w, k, chargeTarget) {
  run(w, () => ({ a: { steer: 0, drift: false } }), 1.5);
  // enter the drift
  let guard = 0;
  while (k.state !== 'drift' && guard++ < 100) stepWorld(w, { a: { steer: -1, drift: true } });
  // hold until the charge reaches the target
  while (k.charge < chargeTarget && guard++ < 400) stepWorld(w, { a: { steer: -1, drift: true } });
  // pump: let go for two ticks, press again
  const evs = [];
  for (let i = 0; i < 2; i++) evs.push(...stepWorld(w, { a: { steer: -1, drift: false } }));
  for (let i = 0; i < 3; i++) evs.push(...stepWorld(w, { a: { steer: -1, drift: true } }));
  return evs;
}

test('pump inside the window fires a level 1 boost and keeps drifting', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  const evs = driftThen(w, k, 0.85);
  assert.ok(evs.some((e) => e.type === 'boost' && e.level === 1), JSON.stringify(evs));
  assert.equal(k.state, 'drift');
  assert.equal(k.pumps, 1);
  assert.ok(k.boostT > 0);
});

test('pump too early fizzles', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  const evs = driftThen(w, k, 0.3);
  assert.ok(evs.some((e) => e.type === 'fizzle' && !e.late));
  assert.ok(!evs.some((e) => e.type === 'boost'));
  assert.equal(k.charge < 0.2, true);
});

test('pump too late fizzles', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  const evs = driftThen(w, k, 1.2);
  assert.ok(evs.some((e) => e.type === 'fizzle' && e.late));
});

test('three pumps max, boost levels climb', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  const levels = [];
  run(w, () => ({ a: { steer: 0, drift: false } }), 1.5);
  let gap = 0;
  run(w, () => {
    let drift = true;
    if (gap > 0) { gap--; drift = false; }
    else if (k.state === 'drift' && k.held && k.charge > 0.85) { gap = 2; drift = false; }
    return { a: { steer: -1, drift } };
  }, 6).forEach((e) => e.type === 'boost' && levels.push(e.level));
  assert.deepEqual(levels.slice(0, 3), [1, 2, 3]);
  assert.ok(levels.length === 3, `levels ${levels}`);
});

test('letting go in the window ends the drift with a boost', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  run(w, () => ({ a: { steer: 0, drift: false } }), 1.5);
  let guard = 0;
  while (k.state !== 'drift' && guard++ < 100) stepWorld(w, { a: { steer: 1, drift: true } });
  while (k.charge < 0.85 && guard++ < 400) stepWorld(w, { a: { steer: 1, drift: true } });
  const evs = run(w, () => ({ a: { steer: 1, drift: false } }), 0.4);
  assert.ok(evs.some((e) => e.type === 'boost' && e.level === 1));
  assert.equal(k.state, 'drive');
});

test('boost raises speed above top speed, then it settles back', () => {
  const w = createWorld(open);
  const k = addKart(w, 'a');
  driftThen(w, k, 0.85);
  run(w, () => ({ a: { steer: 0, drift: false } }), 0.5);
  assert.ok(speedOf(k) > TUNING.topSpeed + 2, `speed ${speedOf(k)}`);
  run(w, () => ({ a: { steer: 0, drift: false } }), 4);
  assert.ok(Math.abs(speedOf(k) - TUNING.topSpeed) < 1);
});

test('walls keep the kart inside the arena', () => {
  const w = createWorld({ ...open, half: 20 });
  const k = addKart(w, 'a');
  const evs = run(w, () => ({ a: { steer: 0, drift: false } }), 4);
  assert.ok(k.z <= 20 - TUNING.radius + 1e-6);
  assert.ok(evs.some((e) => e.type === 'bonk'));
});

test('crate breaks, then respawns', () => {
  const arena = { ...open, crates: [[0, 10]] };
  const w = createWorld(arena);
  addKart(w, 'a');
  const evs = run(w, () => ({ a: { steer: 0, drift: false } }), 3);
  assert.ok(evs.some((e) => e.type === 'crate'));
  assert.equal(w.crates[0].alive, false);
  const later = run(w, () => ({ a: { steer: 0, drift: false } }), TUNING.crateRespawn);
  assert.ok(later.some((e) => e.type === 'crateBack'));
  assert.equal(w.crates[0].alive, true);
});

test('fruit counts up and caps at the max with one juiced event', () => {
  const arena = { ...open, fruitLines: [{ from: [0, 10], to: [0, 200], count: 14 }] };
  const w = createWorld(arena);
  const k = addKart(w, 'a');
  const evs = run(w, () => ({ a: { steer: 0, drift: false } }), 12);
  assert.equal(k.fruit, TUNING.fruitMax);
  assert.equal(evs.filter((e) => e.type === 'juiced').length, 1);
});

test('temple arena: fruit lines expand to the expected count', () => {
  assert.equal(expandFruit(temple).length, 48);
});

test('temple arena: spawns and pickups are clear of obstacles', () => {
  const w = createWorld(temple);
  temple.spawns.forEach((_, i) => addKart(w, 'k' + i, i));
  stepWorld(w, {});
  for (const k of w.karts) {
    const s = temple.spawns[w.karts.indexOf(k)];
    assert.ok(Math.hypot(k.x - s.x, k.z - s.z) < 0.5, `spawn ${k.id} pushed by an obstacle`);
  }
});

test('the bot laps the temple at speed and lands boosts', () => {
  const w = createWorld(temple);
  const k = addKart(w, 'bot', 0);
  const bot = createBot();
  let speedSum = 0;
  let boosts = 0;
  let bonks = 0;
  const n = Math.round(60 / TICK);
  let angle = 0;
  let prevA = Math.atan2(k.x, k.z);
  for (let i = 0; i < n; i++) {
    const evs = stepWorld(w, { bot: botInput(bot, k, TICK) });
    speedSum += speedOf(k);
    boosts += evs.filter((e) => e.type === 'boost').length;
    bonks += evs.filter((e) => e.type === 'bonk').length;
    const a = Math.atan2(k.x, k.z);
    angle += Math.atan2(Math.sin(a - prevA), Math.cos(a - prevA));
    prevA = a;
  }
  const avg = speedSum / n;
  const laps = Math.abs(angle) / (2 * Math.PI);
  assert.ok(avg > 15, `average speed ${avg.toFixed(1)}`);
  assert.ok(boosts >= 10, `boosts ${boosts}`);
  assert.ok(laps >= 5, `laps ${laps.toFixed(1)}`);
  assert.ok(bonks <= 3, `bonks ${bonks}`);
});

test('simulation is deterministic', () => {
  const sim = () => {
    const w = createWorld(temple);
    const k = addKart(w, 'bot', 0);
    const bot = createBot();
    for (let i = 0; i < 1200; i++) stepWorld(w, { bot: botInput(bot, k, TICK) });
    return JSON.stringify(w.karts);
  };
  assert.equal(sim(), sim());
});
