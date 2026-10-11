import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TICK, TUNING, createWorld, addKart, stepWorld, speedOf } from '../shared/sim.js';
import { createRace, startRace, stepRace, standings, RACE } from '../shared/race.js';
import { createPathBot, pathBotInput } from '../shared/bot.js';
import circuit from '../shared/arenas/circuit.js';
import temple from '../shared/arenas/temple.js';

const segDist = (px, pz, o) => {
  const ex = o.x2 - o.x1;
  const ez = o.z2 - o.z1;
  let u = ((px - o.x1) * ex + (pz - o.z1) * ez) / (ex * ex + ez * ez);
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(px - (o.x1 + ex * u), pz - (o.z1 + ez * u)) - o.r;
};

test('circuit: the road is clear between its walls everywhere', () => {
  const t = circuit.track;
  for (const c of t.center) {
    for (const w of t.walls) assert.ok(segDist(c.x, c.z, w) > t.width / 2 - 0.5);
  }
});

test('circuit: separate parts of the track never overlap', () => {
  const t = circuit.track;
  const n = t.center.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const along = Math.min(j - i, n - (j - i)) * (t.length / n);
      if (along < 40) continue;
      assert.ok(Math.hypot(t.center[i].x - t.center[j].x, t.center[i].z - t.center[j].z) > t.width + 4);
    }
  }
});

test('circuit: scenery stays off the road and inside the walls', () => {
  const t = circuit.track;
  for (const d of circuit.decor) {
    assert.ok(Math.abs(d.x) < circuit.half && Math.abs(d.z) < circuit.half);
    if (d.kind === 'temple' || d.kind === 'ruin') continue;
    for (const c of t.center) assert.ok(Math.hypot(c.x - d.x, c.z - d.z) > t.width / 2 + 2, `${d.kind} at ${d.x},${d.z}`);
  }
});

test('circuit: the grid is behind the start line and facing it', () => {
  const g = circuit.track.gates[0];
  for (const s of circuit.spawns) {
    const toLine = (g.mx - s.x) * g.tx + (g.mz - s.z) * g.tz;
    assert.ok(toLine > 3, 'behind the line');
    assert.ok(Math.cos(s.yaw - Math.atan2(g.tx, g.tz)) > 0.9, 'facing forward');
  }
});

test('segment walls stop a kart', () => {
  const arena = { ...temple, half: 500, crates: [], fruitLines: [], spawns: [{ x: 0, z: 0, yaw: 0 }], obstacles: [{ shape: 'seg', x1: -10, z1: 15, x2: 10, z2: 15, r: 0.6 }] };
  const w = createWorld(arena);
  const k = addKart(w, 'a');
  const evs = [];
  for (let i = 0; i < 180; i++) evs.push(...stepWorld(w, { a: { steer: 0, drift: false } }));
  assert.ok(k.z < 15 - 0.6 - TUNING.radius + 0.05, `z ${k.z}`);
  assert.ok(evs.some((e) => e.type === 'bonk'));
});

test('karts bump instead of overlapping', () => {
  const arena = { ...temple, half: 500, crates: [], fruitLines: [], obstacles: [], spawns: [{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 12, yaw: Math.PI }] };
  const w = createWorld(arena);
  const a = addKart(w, 'a', 0);
  const b = addKart(w, 'b', 1);
  const evs = [];
  for (let i = 0; i < 90; i++) evs.push(...stepWorld(w, {}));
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= TUNING.radius * 2 - 0.05);
  assert.ok(evs.some((e) => e.type === 'bump'));
});

test('mangoes raise top speed a little', () => {
  const arena = { ...temple, half: 500, crates: [], fruitLines: [], obstacles: [], spawns: [{ x: 0, z: 0, yaw: 0 }] };
  const w = createWorld(arena);
  const k = addKart(w, 'a');
  k.fruit = 10;
  for (let i = 0; i < 240; i++) stepWorld(w, {});
  assert.ok(speedOf(k) > TUNING.topSpeed + 1);
});

function botRace(n, laps = 3) {
  const w = createWorld(circuit);
  const race = createRace(w, { laps });
  const ids = Array.from({ length: n }, (_, i) => 'k' + i);
  startRace(race, w, ids);
  const bots = Object.fromEntries(ids.map((id, i) => [id, createPathBot(circuit.track, { lane: [-1, 1, -0.5, 0.5, 0, -0.8, 0.8, 0.2][i], skill: 1 - i * 0.1, obstacles: circuit.obstacles })]));
  const events = [];
  let guard = 0;
  while (race.phase !== 'results' && guard++ < 60 * 400) {
    const inputs = {};
    for (const k of w.karts) inputs[k.id] = pathBotInput(bots[k.id], k, TICK);
    for (const e of stepRace(race, w, inputs)) events.push(e);
  }
  return { race, w, events };
}

test('race: countdown, then karts move; nobody moves before go', () => {
  const w = createWorld(circuit);
  const race = createRace(w);
  startRace(race, w, ['a', 'b']);
  const start = w.karts.map((k) => [k.x, k.z]);
  const evs = [];
  for (let i = 0; i < Math.round((RACE.countdown - 0.1) / TICK); i++) evs.push(...stepRace(race, w, { a: { steer: 1, drift: true } }));
  assert.equal(race.phase, 'countdown');
  assert.deepEqual(w.karts.map((k) => [k.x, k.z]), start);
  assert.deepEqual(evs.filter((e) => e.type === 'count').map((e) => e.n), [2, 1]);
  for (let i = 0; i < 20; i++) evs.push(...stepRace(race, w, {}));
  assert.ok(evs.some((e) => e.type === 'go'));
  assert.equal(race.phase, 'race');
});

test('race: four bots finish three laps, with sensible places and lap times', () => {
  const { race, events } = botRace(4);
  assert.equal(race.phase, 'results');
  const s = standings(race);
  assert.deepEqual(s.map((r) => r.place), [1, 2, 3, 4]);
  assert.ok(s[0].finished && s[0].time > 50 && s[0].time < 150, `winner time ${s[0].time}`);
  const finishes = events.filter((e) => e.type === 'finish');
  assert.ok(finishes.length >= 3, `finishers ${finishes.length}`);
  assert.equal(finishes[0].place, 1);
  const laps = events.filter((e) => e.type === 'lap');
  assert.ok(laps.every((e) => e.time > 15 && e.time < 60), JSON.stringify(laps.map((e) => e.time.toFixed(1))));
  const rescues = events.filter((e) => e.type === 'rescue').length;
  assert.ok(rescues <= 4, `rescues ${rescues}`);
});

test('race: driving backwards over a gate does not count as progress', () => {
  const w = createWorld(circuit);
  const race = createRace(w, { laps: 1 });
  startRace(race, w, ['a']);
  const k = w.karts[0];
  for (let i = 0; i < 200; i++) stepRace(race, w, {});
  const e = race.entrants.a;
  // let the kart get past the start line and the first gate
  for (let i = 0; i < 120; i++) stepRace(race, w, { a: { steer: 0, drift: false } });
  const before = e.progress;
  assert.ok(e.lap === 1 && before > 0);
  // turn it round and drive back over the start line
  k.yaw += Math.PI;
  k.vx = -k.vx;
  k.vz = -k.vz;
  for (let i = 0; i < 240; i++) stepRace(race, w, { a: { steer: 0, drift: false } });
  assert.ok(e.progress < before);
  assert.ok(e.lap <= 1);
});

test('race: a stuck kart is put back on the road', () => {
  const w = createWorld(circuit);
  const race = createRace(w);
  startRace(race, w, ['a']);
  for (let i = 0; i < 200; i++) stepRace(race, w, {});
  const k = w.karts[0];
  const evs = [];
  // pin it: zero speed every tick
  for (let i = 0; i < 60 * (RACE.stuckTime + 1); i++) {
    k.vx = 0;
    k.vz = 0;
    evs.push(...stepRace(race, w, {}));
  }
  assert.ok(evs.some((e) => e.type === 'rescue'));
});
